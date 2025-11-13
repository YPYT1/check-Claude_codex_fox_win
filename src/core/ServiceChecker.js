const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Load environment variables
require('dotenv').config();

const PROJECT_ROOT = process.env.PROJECT_ROOT || process.cwd();

const EXEC_TIMEOUT = 30_000;
const SESSION_ID = 'f8362942-6c29-4ecc-bc16-02690d3727d1';
const TEMPLATE_FILE = path.join(__dirname, '../../template', `${SESSION_ID}.jsonl`);
const PROJECTS_BASE = path.join(require('os').homedir(), '.claude', 'projects');

/**
 * Normalize path to project name: /path/to/dir_name → -path-to-dir-name
 * Replaces both slashes (/) and underscores (_) with hyphens (-)
 * @param {string} dirPath
 * @returns {string}
 */
function normalizePathToProjectName(dirPath) {
  return dirPath.replace(/\/+$/, '').replace(/[/_:\\]/g, '-');
}

/**
 * Initialize Claude project: create directory and copy template with cwd replacement
 * @param {string} projectPath - The absolute path to the project directory
 * @param {Function} log
 */
function initializeClaudeProject(projectPath, log) {
  try {
    log('info', 'checker', 'initializeClaudeProject entry', { projectPath });
    const normalizedName = normalizePathToProjectName(projectPath);
    const targetDir = path.join(PROJECTS_BASE, normalizedName);
    log('info', 'checker', 'Normalized project info', { normalizedName, targetDir });

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
      log('info', 'checker', 'Claude project directory created', { targetDir });
    } else {
      log('info', 'checker', 'Claude project directory already exists', { targetDir });
    }

    const templateExists = fs.existsSync(TEMPLATE_FILE);
    log('info', 'checker', 'Template file check', { templateFile: TEMPLATE_FILE, exists: templateExists });

    if (templateExists) {
      const targetFile = path.join(targetDir, `${SESSION_ID}.jsonl`);

      // Read template content
      const templateContent = fs.readFileSync(TEMPLATE_FILE, 'utf8');

      // Parse each line, replace cwd field, and reconstruct
      const lines = templateContent.split('\n').filter(line => line.trim());
      log('info', 'checker', 'Template lines parsed', { lineCount: lines.length });
      const updatedLines = lines.map(line => {
        try {
          const obj = JSON.parse(line);
          if (obj.cwd) {
            obj.cwd = projectPath;
          }
          return JSON.stringify(obj);
        } catch (e) {
          // If line is not valid JSON, return as-is
          return line;
        }
      });

      // Write updated content
      fs.writeFileSync(targetFile, updatedLines.join('\n') + '\n', 'utf8');
      log('info', 'checker', 'Template written to target', { targetFile, cwd: projectPath, lineCount: updatedLines.length });
    } else {
      log('warn', 'checker', `Template file not found: ${TEMPLATE_FILE}`);
    }
  } catch (error) {
    log('error', 'checker', `Failed to initialize Claude project for ${projectPath}`, error);
  }
}

/**
 * Extract directory path from "cd <path> && ..." command
 * @param {string} command
 * @returns {string|null}
 */
function extractCdPath(command) {
  const cdMatch = /^cd\s+"([^"]+)"\s+&&/.exec(command);
  return cdMatch ? cdMatch[1] : null;
}

/**
 * Interpolate command template with parameters
 * @param {string} template - Command template with {key} placeholders
 * @param {object} params - Parameters map
 * @returns {string}
 * @example
 * interpolateCommand('echo {msg}', { msg: 'hello' });
 * // => 'echo "hello"'
 */
function interpolateCommand(template, params) {
  if (!template || typeof template !== 'string') {
    return '';
  }

  if (!params || typeof params !== 'object') {
    return template;
  }

  let result = template;
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;

    const isPathParam = /home|cwd|dir|path|root/i.test(key);
    const stringValue = String(value);
    const finalValue = isPathParam ? resolvePath(stringValue) : stringValue;

    const escaped = finalValue
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');

    const pattern = escapeRegExp(key);
    const regex = new RegExp(`\\{${pattern}\\}`, 'g');
    result = result.replace(regex, `"${escaped}"`);
  }

  return result;
}

/**
 * Resolve relative path to absolute path using PROJECT_ROOT
 * @param {string} pathValue - Path value (relative or absolute)
 * @returns {string}
 */
function resolvePath(pathValue) {
  if (!pathValue || typeof pathValue !== 'string') {
    return pathValue;
  }

  const trimmed = pathValue.trim();

  if (trimmed.startsWith('/')) {
    return trimmed;
  }

  return path.join(PROJECT_ROOT, trimmed);
}

/**
 * Inject --resume parameter to claude command if not present
 * @param {string} command
 * @returns {string}
 */
function injectResumeParameter(command) {
  if (command.includes('--resume')) {
    return command;
  }

  const claudeMatch = /\bclaude\s+/i.exec(command);
  if (!claudeMatch) {
    return command;
  }

  const insertPos = claudeMatch.index + claudeMatch[0].length;
  return (
    command.slice(0, insertPos) +
    `--resume ${SESSION_ID} ` +
    command.slice(insertPos)
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract the expected answer from the command output.
 * @param {string|undefined|null} text
 * @param {string|string[]|RegExp|RegExp[]|undefined|null} expectedAnswer
 * @returns {string|null}
 */
function extractAnswer(text, expectedAnswer) {
  if (!text) return null;

  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const expectedList = Array.isArray(expectedAnswer)
    ? expectedAnswer.filter(Boolean)
    : expectedAnswer != null
    ? [expectedAnswer]
    : [];

  if (expectedList.length === 0) {
    return lines[0] || null;
  }

  for (const expected of expectedList) {
    if (expected instanceof RegExp) {
      if (lines.some((line) => expected.test(line))) {
        const matched = lines.find((line) => expected.test(line));
        return matched ?? null;
      }
      if (expected.test(normalized)) {
        const match = normalized.match(expected);
        return match ? match[0] : null;
      }
      continue;
    }

    const expectedString = String(expected).trim();
    if (!expectedString) continue;

    if (lines.some((line) => line === expectedString)) {
      return expectedString;
    }

    const boundaryPattern = new RegExp(`\\b${escapeRegExp(expectedString)}\\b`);
    if (boundaryPattern.test(normalized)) {
      return expectedString;
    }
  }

  return null;
}

function parseCommand(command) {
  if (typeof command !== 'string' || !command.trim()) {
    return { cmd: null, args: [] };
  }
  const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const cmd = parts[0] ? parts[0].replace(/^"|"$/g, '') : null;
  const args = parts.slice(1).map((arg) => arg.replace(/^"|"$/g, ''));
  return { cmd, args };
}

function truncateForLog(value, limit = 200) {
  if (!value) return '';
  const normalized = value.trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit)}... [truncated, length ${normalized.length} chars] ...`;
}

function buildLogSummary(result) {
  return {
    status: result.status,
    responseTime: result.responseTime,
    stdout: truncateForLog(result.stdout || ''),
    stderr: truncateForLog(result.stderr || ''),
    answer: result.answer ?? null,
    message: result.message ?? null
  };
}

function checkService({ name, command, expectedAnswer, timeout, log, service }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const commandLine =
      typeof command === 'string'
        ? command.trim()
        : Array.isArray(command)
        ? command
            .filter((part) => part != null && part !== '')
            .map((part) => {
              const str = String(part);
              return /[\s"'\\]/.test(str) ? JSON.stringify(str) : str;
            })
            .join(' ')
            .trim()
        : '';
    let processedCommandLine = commandLine;
    if (
      processedCommandLine &&
      service &&
      service.params &&
      typeof service.params === 'object'
    ) {
      const interpolated = interpolateCommand(processedCommandLine, service.params);
      if (interpolated) {
        processedCommandLine = interpolated;
      }
      if (interpolated && interpolated !== commandLine) {
        log('info', 'checker', `Interpolated command: ${interpolated}`);
      }
    }

    const parseTarget = processedCommandLine || commandLine;
    const { cmd, args } = parseCommand(parseTarget);

    const checkedAt = () => new Date().toISOString();
    const fullCommand =
      parseTarget
        ? parseTarget
        : [cmd, ...(Array.isArray(args) ? args : [])]
            .filter((part) => part != null && part !== '')
            .join(' ');

    log('info', 'checker', `Starting check: ${name}`);
    if (fullCommand) {
      log('info', 'checker', `Executing command: ${fullCommand}`);
    }

    // === PRE-EXECUTION HOOK: Claude project initialization ===
    const explicitCwd = service && service.cwd;
    const resolvedCwd = explicitCwd ? resolvePath(explicitCwd) : null;
    let processedCommand = processedCommandLine;
    if (processedCommand && /\bclaude\s+/i.test(processedCommand)) {
      const cdPath = extractCdPath(processedCommand);
      if (cdPath) {
        log('info', 'checker', `Detected Claude command with cd path: ${cdPath}`);
      } else if (resolvedCwd) {
        log('info', 'checker', `Detected Claude command with explicit cwd: ${resolvedCwd}`);
      }
      const projectPath = resolvedCwd || cdPath;
      if (projectPath) {
        initializeClaudeProject(projectPath, log);
      }
      processedCommand = injectResumeParameter(processedCommand);
      if (processedCommand !== processedCommandLine) {
        log('info', 'checker', `Injected --resume parameter: ${processedCommand}`);
      }
    }
    // === END HOOK ===

    if (!processedCommand) {
      const payload = {
        name,
        stdout: '',
        stderr: '',
        checkedAt: checkedAt(),
        status: 'error',
        message: 'Command cannot be empty',
        responseTime: 0,
        expectedAnswer: expectedAnswer ?? null
      };
      log('info', 'checker', `Check ${name} completed`, buildLogSummary(payload));
      resolve(payload);
      return;
    }

    const effectiveTimeout =
      Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : EXEC_TIMEOUT;

    let proc;
    let timeoutHandle = null;
    let forceKillTimer = null;
    let timedOut = false;
    let stdout = '';
    let stderr = '';

    const finalize = (result) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      log('info', 'checker', `Check ${name} completed`, buildLogSummary(result));
      resolve(result);
    };

    const cdMatch = /^cd\s+"([^"]+)"\s+&&\s+(.+)$/.exec(processedCommand);
    const workingDirectory =
      resolvedCwd || (cdMatch ? cdMatch[1] : process.cwd());
    const actualCommand = cdMatch ? cdMatch[2] : processedCommand;

    if (resolvedCwd) {
      log('info', 'checker', `Using explicit working directory: ${resolvedCwd}`);
    }

    try {
      const isWindows = process.platform === 'win32';

      // Parse environment variables from command (e.g., "VAR=value command")
      const envVarMatch = actualCommand.match(/^(\w+="[^"]*"(?:\s+\w+="[^"]*")*)\s+(.+)$/);
      let cmdToRun = actualCommand;
      const customEnv = { ...process.env };

      if (envVarMatch && isWindows) {
        // Extract environment variables
        const envPart = envVarMatch[1];
        cmdToRun = envVarMatch[2];

        // Parse each VAR="value" pair
        const envPairs = envPart.match(/(\w+)="([^"]*)"/g);
        if (envPairs) {
          envPairs.forEach(pair => {
            const [key, value] = pair.split('=');
            customEnv[key] = value.replace(/^"|"$/g, '');
          });
        }
      }

      // Load environment variables from .claude/settings.json if running claude command
      if (actualCommand.includes('claude') && workingDirectory) {
        const settingsPath = path.join(workingDirectory, '.claude', 'settings.json');
        if (fs.existsSync(settingsPath)) {
          try {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            if (settings.env && typeof settings.env === 'object') {
              Object.assign(customEnv, settings.env);
            }
          } catch (e) {
            // Ignore settings read errors
          }
        }
      }

      // Set git-bash path for Claude on Windows
      if (isWindows && !customEnv.CLAUDE_CODE_GIT_BASH_PATH) {
        const possiblePaths = [
          'D:\\Git\\usr\\bin\\bash.exe',
          'C:\\Program Files\\Git\\bin\\bash.exe',
          'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
        ];
        for (const gitBashPath of possiblePaths) {
          if (fs.existsSync(gitBashPath)) {
            customEnv.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath;
            break;
          }
        }
      }

      const shell = isWindows ? 'cmd.exe' : '/bin/sh';
      const shellArgs = isWindows ? ['/c', cmdToRun] : ['-c', cmdToRun];

      proc = spawn(shell, shellArgs, {
        env: customEnv,
        cwd: workingDirectory,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      finalize({
        name,
        stdout: '',
        stderr: error.stack || error.message || '',
        checkedAt: checkedAt(),
        status: 'error',
        message: error.message,
        responseTime: Date.now() - startedAt,
        expectedAnswer: expectedAnswer ?? null
      });
      return;
    }

    if (proc.stdout) {
      proc.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
    }

    if (proc.stderr) {
      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
    }

    proc.on('error', (error) => {
      finalize({
        name,
        stdout: stdout.trim(),
        stderr: (stderr + error.message).trim(),
        checkedAt: checkedAt(),
        status: 'error',
        message: error.message,
        responseTime: Date.now() - startedAt,
        expectedAnswer: expectedAnswer ?? null
      });
    });

    timeoutHandle = setTimeout(() => {
      if (proc.exitCode != null || proc.signalCode) {
        return;
      }
      timedOut = true;
      proc.kill('SIGTERM');
      log('warn', 'checker', `Process ${name} exceeded timeout; sent SIGTERM to stop it`);

      forceKillTimer = setTimeout(() => {
        if (proc.exitCode == null && proc.signalCode == null) {
          proc.kill('SIGKILL');
          log('warn', 'checker', `Process ${name} ignored SIGTERM; sent SIGKILL`);
        }
      }, 2000);
    }, effectiveTimeout);

    proc.on('close', (code, signal) => {
      const responseTime = Date.now() - startedAt;
      const base = {
        name,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        checkedAt: checkedAt(),
        responseTime,
        expectedAnswer: expectedAnswer ?? null
      };

      if (timedOut) {
        finalize({
          ...base,
          status: 'timeout',
          message: `Execution timed out after ${effectiveTimeout}ms`
        });
        return;
      }

      if (code !== 0) {
        const reason = signal
          ? `Process stopped by signal: ${signal}`
          : `Exit code: ${code}`;
        finalize({
          ...base,
          status: 'error',
          message: reason
        });
        return;
      }

      const answer = extractAnswer(stdout, expectedAnswer);
      if (answer != null) {
        finalize({
          ...base,
          status: 'ok',
          answer,
          message: null
        });
        return;
      }

      finalize({
        ...base,
        status: 'fail',
        answer: null,
        message: 'Expected answer was not matched'
      });
    });
  });
}

class ServiceChecker {
  constructor(options = {}) {
    this.defaultTimeout = Number.isFinite(options.defaultTimeout)
      ? Math.floor(options.defaultTimeout)
      : EXEC_TIMEOUT;
    this.logger = options.logger || logger;
  }

  async check(service) {
    if (!service || typeof service !== 'object') {
      throw new Error('Service definition is required');
    }

    const name = service.name || service.id || 'unknown';
    const command = service.command;
    const expectedAnswer = service.expectedAnswer;
    const timeout = Number.isFinite(service.timeout)
      ? Math.floor(service.timeout)
      : this.defaultTimeout;

    return checkService({
      name,
      command,
      expectedAnswer,
      timeout,
      log: this.logger.log.bind(this.logger),
      service
    });
  }
}

module.exports = {
  EXEC_TIMEOUT,
  ServiceChecker,
  extractAnswer,
  interpolateCommand,
  resolvePath
};
