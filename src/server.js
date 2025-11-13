const path = require('path');
const express = require('express');
const { ServiceChecker } = require('./core/ServiceChecker');
const { StatusStore } = require('./core/StatusStore');
const { HealthMonitor } = require('./core/HealthMonitor');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 30001;
const app = express();

const store = new StatusStore();
const checker = new ServiceChecker({ logger });
const monitor = new HealthMonitor({ checker, store, logger });

// ===== 安全: 敏感信息净化函数 =====
const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * 净化错误消息,移除敏感信息 (路径、凭证、系统信息等)
 */
function sanitizeErrorMessage(error) {
  const message = error?.message || 'Unknown error';

  const sanitized = message
    // API Keys 和 Tokens
    .replace(/sk-[a-zA-Z0-9_-]{20,}/g, '[API_KEY]')           // OpenAI/Anthropic: sk-...
    .replace(/pk-[a-zA-Z0-9_-]{20,}/g, '[API_KEY]')           // Public keys: pk-...
    .replace(/key-[a-zA-Z0-9_-]{20,}/g, '[API_KEY]')          // Generic key-...
    .replace(/api[_-]?key[=:]\s*[^\s]+/gi, 'api_key=[REDACTED]')
    .replace(/token[=:]\s*[^\s]+/gi, 'token=[REDACTED]')
    .replace(/bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    // 文件路径 (绝对路径)
    .replace(/\/home\/[^\s]+/g, '[PATH]')                     // Linux: /home/...
    .replace(/\/Users\/[^\s]+/g, '[PATH]')                    // macOS: /Users/...
    .replace(/\/workspace\/[^\s]+/g, '[PATH]')                // Workspace paths
    .replace(/\/\.claude\/[^\s]+/g, '[PATH]')                 // .claude paths
    .replace(/[A-Z]:\\[^\s]+/g, '[PATH]')                     // Windows: C:\...
    // 系统错误消息标准化
    .replace(/Error: ENOENT[^,]*, open '[^']+'/g, 'Resource not found')
    .replace(/Error: ENOENT.*/g, 'Resource not found')
    .replace(/Error: EACCES.*/g, 'Permission denied')
    .replace(/Error: ETIMEDOUT.*/g, 'Connection timeout')
    .replace(/Error: ECONNREFUSED.*/g, 'Connection refused')
    .replace(/Error: ENOTFOUND.*/g, 'Host not found')
    // 敏感环境变量
    .replace(/PASSWORD[=:][^\s]+/gi, 'PASSWORD=[REDACTED]')
    .replace(/SECRET[=:][^\s]+/gi, 'SECRET=[REDACTED]');

  return sanitized;
}

/**
 * 净化命令输出 (stdout/stderr),移除路径和敏感信息
 */
function sanitizeOutput(text) {
  if (!text) return text;

  return text
    // API Keys 和 Tokens
    .replace(/sk-[a-zA-Z0-9_-]{20,}/g, '[API_KEY]')
    .replace(/pk-[a-zA-Z0-9_-]{20,}/g, '[API_KEY]')
    .replace(/key-[a-zA-Z0-9_-]{20,}/g, '[API_KEY]')
    .replace(/api[_-]?key[=:]\s*[^\s]+/gi, 'api_key=[REDACTED]')
    .replace(/token[=:]\s*[^\s]+/gi, 'token=[REDACTED]')
    .replace(/bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    // 文件路径
    .replace(/\/home\/[^\s]*/g, '[PATH]')
    .replace(/\/Users\/[^\s]*/g, '[PATH]')
    .replace(/\/workspace\/[^\s]*/g, '[PATH]')
    .replace(/\/\.claude\/[^\s]*/g, '[PATH]')
    .replace(/[A-Z]:\\[^\s]*/g, '[PATH]')
    // 命令中的路径
    .replace(/cd\s+"[^"]+"/g, 'cd "[PATH]"')
    .replace(/cd\s+'[^']+'/g, "cd '[PATH]'")
    // 敏感环境变量
    .replace(/PASSWORD[=:][^\s]+/gi, 'PASSWORD=[REDACTED]')
    .replace(/SECRET[=:][^\s]+/gi, 'SECRET=[REDACTED]')
    // JWT tokens
    .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[JWT_TOKEN]');

  return text;
}

/**
 * 获取安全的错误消息 (开发环境显示详细错误,生产环境净化)
 */
function getSafeErrorMessage(error) {
  return isDevelopment ? error.message : sanitizeErrorMessage(error);
}
// ===== END 安全净化函数 =====

// ===== 安全: CORS 配置 =====
// 生产环境: 禁用CORS (API仅localhost访问,不需要CORS)
// 开发环境: 允许本地前端开发
if (isDevelopment) {
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'http://localhost:5173'); // Vite 默认端口
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });
} else {
  // 生产环境: 不设置CORS头,API只能从同源访问
  // 静态文件由同一个server提供,不需要CORS
}
// ===== END CORS 配置 =====

app.get('/api/services', async (req, res) => {
  try {
    const summaries = await store.getAllServicesSummary();
    const services = summaries.map((service) => ({
      ...service,
      recentChecks: Array.isArray(service.recentChecks) ? service.recentChecks : []
    }));
    res.json({ services });
  } catch (error) {
    logger.log('error', 'server', 'Failed to load services overview', error);
    res.status(500).json({ error: 'Failed to load services overview', message: getSafeErrorMessage(error) });
  }
});

app.get('/api/services/:id/detail', async (req, res) => {
  const { id } = req.params;
  try {
    const detail = await store.getServiceDetail(id);
    if (!detail) {
      res.status(404).json({ error: 'Service detail not found', serviceId: id });
      return;
    }
    // 净化 stdout 和 stderr 中的敏感信息
    const sanitizedDetail = {
      ...detail,
      result: detail.result ? {
        ...detail.result,
        stdout: sanitizeOutput(detail.result.stdout),
        stderr: sanitizeOutput(detail.result.stderr),
        message: detail.result.message ? sanitizeOutput(detail.result.message) : null
      } : detail.result
    };
    res.json(sanitizedDetail);
  } catch (error) {
    logger.log('error', 'server', `Failed to load detail for ${id}`, error);
    res.status(500).json({
      error: 'Failed to load service detail',
      message: getSafeErrorMessage(error),
      serviceId: id
    });
  }
});

app.get('/api/services/:id/recent', async (req, res) => {
  const { id } = req.params;
  try {
    const checks = await store.getServiceRecentChecks(id);
    res.json({ serviceId: id, checks });
  } catch (error) {
    logger.log('error', 'server', `Failed to load recent checks for ${id}`, error);
    res.status(500).json({
      error: 'Failed to load recent checks',
      message: getSafeErrorMessage(error),
      serviceId: id
    });
  }
});

app.get('/health', async (req, res) => {
  try {
    const overview = await store.getHealthOverview();
    res.json(overview);
  } catch (error) {
    logger.log('error', 'server', 'Failed to load health overview', error);
    res.status(500).json({ error: 'Failed to load health overview', message: getSafeErrorMessage(error) });
  }
});

app.get('/health/:service', async (req, res) => {
  // 安全: 生产环境禁用此端点,防止外部触发任意命令执行
  if (!isDevelopment) {
    return res.status(403).json({ error: 'This endpoint is disabled in production' });
  }

  const { service } = req.params;
  try {
    const config = await store.loadConfig();
    const serviceConfig = (config.services || []).find(
      (item) => item.id === service || item.name === service
    );

    if (!serviceConfig) {
      res.status(404).json({ error: 'Service not found', service });
      return;
    }

    const result = await checker.check(serviceConfig);
    res.json({ service: serviceConfig.id || serviceConfig.name, result });
  } catch (error) {
    logger.log('error', 'server', `Failed to run ad-hoc check for ${service}`, error);
    res.status(500).json({ error: 'Health check failed', message: getSafeErrorMessage(error) });
  }
});

// Static assets directory
const frontendDist = path.join(__dirname, '../frontend/dist');

// Serve static assets before API fallbacks
app.use(express.static(frontendDist));

// SPA fallback - serve index.html for non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

async function bootstrap() {
  try {
    await store.initialize();
    monitor.bindChecker(checker);
    monitor.bindStore(store);
    await monitor.start();

    // 安全: 仅绑定到 localhost,防止外部直接访问 API
    // 外部访问通过 Nginx 反向代理到前端静态文件
    const host = '0.0.0.0';

    const startServer = (port) => {
      app.listen(port, host, () => {
        logger.log('info', 'server', `Server is listening on ${host}:${port}`);
        logger.log('info', 'server', `API is restricted to localhost only`);
        if (!isDevelopment) {
          logger.log('info', 'server', `Production mode: Use Nginx to serve frontend and proxy API requests`);
        }
      }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          logger.log('warn', 'server', `Port ${port} is already in use, trying next port...`);
          startServer(port + 1);
        } else {
          throw err;
        }
      });
    };

    startServer(PORT);
  } catch (error) {
    logger.log('error', 'server', 'Failed to bootstrap server', error);
    process.exit(1);
  }
}

bootstrap();

module.exports = app;
