const fs = require('fs/promises');
const path = require('path');
const logger = require('../utils/logger');

const ALLOWED_STATUSES = new Set(['ok', 'fail', 'error', 'timeout']);
const MAX_RECENT_CHECKS = 90;

class StatusStore {
  constructor(options = {}) {
    this.logger = options.logger || logger;
    this.dataDir = path.resolve(
      options.dataDir || path.join(__dirname, '..', '..', 'data')
    );
    this.configDir = path.resolve(
      options.configDir || path.join(__dirname, '..', '..', 'config')
    );

    this.paths = {
      status: path.join(this.dataDir, 'status.json'),
      config: path.resolve(
        options.configPath || path.join(this.configDir, 'services.json')
      ),
      legacy: [
        path.join(this.dataDir, 'timeseries.json'),
        path.join(this.dataDir, 'realtime.json'),
        path.join(this.dataDir, 'hourly.json'),
        path.join(this.dataDir, 'daily.json')
      ]
    };

    this.statusData = {};
    this.initialized = false;
  }

  async initialize() {
    await this.#ensureDir(this.dataDir);
    await this.#ensureDir(this.configDir);
    await this.#removeLegacyFiles();
    await this.#resetStatusFile();
    this.initialized = true;
  }

  async #resetStatusFile() {
    try {
      await fs.unlink(this.paths.status);
      this.logger.log('info', 'status-store', 'Reset status.json on startup');
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        this.logger.log('info', 'status-store', 'No status.json to reset');
      } else {
        this.logger.log('warn', 'status-store', 'Failed to reset status.json', error);
      }
    }
    this.statusData = {};
  }

  async loadConfig() {
    const fallback = {
      services: [],
      checkInterval: 300
    };
    const data = await this.#safeReadJSON(this.paths.config, fallback);
    const services = Array.isArray(data.services) ? data.services : [];
    return {
      ...fallback,
      ...data,
      services
    };
  }

  async recordCheckResult(serviceId, rawResult) {
    this.#assertInitialized();
    if (!serviceId) {
      return;
    }

    const result = this.#normalizeResult(rawResult);
    const previous = this.statusData[serviceId];
    const existingRecent = Array.isArray(previous?.recentChecks)
      ? previous.recentChecks
      : [];
    const mergedRecent = [
      ...existingRecent,
      {
        timestamp: result.checkedAt,
        status: result.status,
        responseTime: result.responseTime
      }
    ];
    const recentChecks = this.#sanitizeRecentChecks(mergedRecent);

    const entry = {
      status: result.status,
      lastCheck: result.checkedAt,
      lastResult: result,
      recentChecks
    };

    this.statusData[serviceId] = entry;
    await this.#writeStatusFile();
  }

  async addCheck(serviceId, rawResult) {
    await this.recordCheckResult(serviceId, rawResult);
  }

  async getAllServicesSummary() {
    this.#assertInitialized();
    const config = await this.loadConfig();
    const configuredServices = Array.isArray(config.services)
      ? config.services
      : [];

    const summaries = [];
    const seen = new Set();

    for (const service of configuredServices) {
      if (!service) {
        continue;
      }

      // Only include enabled services
      if (service.enabled !== true) {
        continue;
      }

      const serviceId = service.id || service.name;
      if (!serviceId) {
        continue;
      }

      const statusEntry = this.statusData[serviceId];
      const recentChecks = this.#sanitizeRecentChecks(statusEntry?.recentChecks);
      summaries.push({
        id: serviceId,
        name: service.name || serviceId,
        model: (service.params && service.params.model) || service.model || null,
        currentStatus: statusEntry?.status ?? 'unknown',
        lastCheck: statusEntry?.lastCheck ?? null,
        recentChecks
      });
      seen.add(serviceId);
    }

    for (const [serviceId, statusEntry] of Object.entries(this.statusData)) {
      if (seen.has(serviceId)) {
        continue;
      }
      const recentChecks = this.#sanitizeRecentChecks(statusEntry?.recentChecks);
      summaries.push({
        id: serviceId,
        name: serviceId,
        model: null,
        currentStatus: statusEntry?.status ?? 'unknown',
        lastCheck: statusEntry?.lastCheck ?? null,
        recentChecks
      });
    }

    return summaries;
  }

  async getServiceDetail(serviceId) {
    this.#assertInitialized();
    if (!serviceId) {
      return null;
    }

    const entry = this.statusData[serviceId];
    if (!entry || !entry.lastResult) {
      return null;
    }

    return {
      serviceId,
      lastCheck: entry.lastCheck ?? null,
      result: { ...entry.lastResult }
    };
  }

  async getServiceRecentChecks(serviceId) {
    this.#assertInitialized();
    if (!serviceId) {
      return [];
    }

    const entry = this.statusData[serviceId];
    if (!entry) {
      return [];
    }

    const recentChecks = this.#sanitizeRecentChecks(entry.recentChecks);
    return recentChecks.map((item) => ({ ...item }));
  }

  async getHealthOverview() {
    this.#assertInitialized();
    const services = {};

    for (const [serviceId, entry] of Object.entries(this.statusData)) {
      services[serviceId] = {
        name: serviceId,
        status: entry.status ?? 'unknown',
        lastCheck: entry.lastCheck ?? null
      };
    }

    return {
      services,
      generatedAt: new Date().toISOString()
    };
  }

  async refreshFromDisk() {
    await this.#loadStatusFile();
  }

  async #loadStatusFile() {
    const data = await this.#safeReadJSON(this.paths.status, {});
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      this.statusData = {};
      return;
    }

    const upgraded = {};
    for (const [serviceId, entry] of Object.entries(data)) {
      upgraded[serviceId] = this.#upgradeEntry(entry);
    }
    this.statusData = upgraded;
  }

  async #writeStatusFile() {
    const payload = JSON.stringify(this.statusData, null, 2);
    await fs.writeFile(this.paths.status, payload, 'utf8');
  }

  async #removeLegacyFiles() {
    await Promise.all(
      this.paths.legacy.map(async (legacyPath) => {
        try {
          await fs.unlink(legacyPath);
          this.logger.log(
            'info',
            'status-store',
            `Removed legacy file ${path.basename(legacyPath)}`
          );
        } catch (error) {
          if (error && error.code === 'ENOENT') {
            return;
          }
          this.logger.log(
            'warn',
            'status-store',
            `Failed to remove legacy file ${legacyPath}`,
            error
          );
        }
      })
    );
  }

  #normalizeResult(rawResult) {
    const result = rawResult && typeof rawResult === 'object' ? rawResult : {};

    const status = this.#normalizeStatus(result.status);
    const checkedAt = this.#normalizeTimestamp(result.checkedAt);

    const safeString = (value) =>
      typeof value === 'string' ? value : value != null ? String(value) : '';

    const nullableString = (value) => {
      if (value == null) {
        return null;
      }
      const stringified = typeof value === 'string' ? value : String(value);
      return stringified.length > 0 ? stringified : null;
    };

    const responseTime = Number.isFinite(result.responseTime)
      ? Number(result.responseTime)
      : 0;

    return {
      name: nullableString(result.name) ?? 'Unknown Service',
      status,
      responseTime,
      stdout: safeString(result.stdout),
      stderr: safeString(result.stderr),
      answer: nullableString(result.answer),
      message: nullableString(result.message),
      checkedAt,
      expectedAnswer:
        result.expectedAnswer !== undefined ? result.expectedAnswer : null
    };
  }

  #normalizeStatus(status) {
    if (typeof status === 'string') {
      const trimmed = status.trim().toLowerCase();
      if (ALLOWED_STATUSES.has(trimmed)) {
        return trimmed;
      }
      if (trimmed === 'degraded' || trimmed === 'down') {
        return 'fail';
      }
      if (trimmed === 'unknown') {
        return 'error';
      }
    }
    return 'error';
  }

  #normalizeTimestamp(value) {
    const date =
      typeof value === 'string' || value instanceof Date ? new Date(value) : null;
    if (date && !Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
    return new Date().toISOString();
  }

  #assertInitialized() {
    if (!this.initialized) {
      throw new Error('StatusStore has not been initialized');
    }
  }

  async #ensureDir(dirPath) {
    await fs.mkdir(dirPath, { recursive: true });
  }

  async #safeReadJSON(filePath, fallback) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return fallback;
      }
      this.logger.log('warn', 'status-store', `Failed to read ${filePath}`, error);
      return fallback;
    }
  }

  #upgradeEntry(entry) {
    if (!entry || typeof entry !== 'object') {
      return {
        status: 'unknown',
        lastCheck: null,
        lastResult: null,
        recentChecks: []
      };
    }

    const hasLastResult =
      entry.lastResult && typeof entry.lastResult === 'object';
    const normalizedLastResult = hasLastResult
      ? this.#normalizeResult(entry.lastResult)
      : null;

    const statusSource =
      entry.status ??
      normalizedLastResult?.status ??
      (typeof entry.lastStatus === 'string' ? entry.lastStatus : 'error');
    const status = this.#normalizeStatus(statusSource);

    const lastCheck =
      typeof entry.lastCheck === 'string'
        ? entry.lastCheck
        : normalizedLastResult?.checkedAt ?? null;

    const recentChecks = this.#sanitizeRecentChecks(entry.recentChecks);
    const withFallback =
      recentChecks.length > 0 || !normalizedLastResult
        ? recentChecks
        : this.#sanitizeRecentChecks([
            {
              timestamp: normalizedLastResult.checkedAt,
              status: normalizedLastResult.status,
              responseTime: normalizedLastResult.responseTime
            }
          ]);

    return {
      status,
      lastCheck,
      lastResult: normalizedLastResult,
      recentChecks: withFallback
    };
  }

  #sanitizeRecentChecks(checks) {
    if (!Array.isArray(checks)) {
      return [];
    }

    const sanitized = [];
    for (const item of checks) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const timestamp =
        typeof item.timestamp === 'string' ? item.timestamp : null;
      if (!timestamp) {
        continue;
      }

      const status = this.#normalizeStatus(item.status);
      const responseTime = Number.isFinite(item.responseTime)
        ? Number(item.responseTime)
        : 0;

      sanitized.push({
        timestamp,
        status,
        responseTime
      });
    }

    if (sanitized.length > MAX_RECENT_CHECKS) {
      return sanitized.slice(-MAX_RECENT_CHECKS);
    }
    return sanitized;
  }
}

module.exports = { StatusStore };
