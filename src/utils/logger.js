const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
let currentDate = null;

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function getLogFilePath(date) {
  return path.join(LOG_DIR, `app-${date}.log`);
}

function normalizeData(data) {
  const serialize = (value) => {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack
      };
    }

    if (Array.isArray(value)) {
      return value.map((item) => serialize(item));
    }

    if (value && typeof value === 'object') {
      return Object.entries(value).reduce((acc, [key, item]) => {
        acc[key] = serialize(item);
        return acc;
      }, {});
    }

    return value;
  };

  if (data === undefined) {
    return undefined;
  }

  if (data instanceof Error) {
    return serialize(data);
  }

  if (data && typeof data === 'object') {
    return serialize(data);
  }

  return { value: data };
}

function writeLogEntry(entry) {
  try {
    fs.appendFileSync(entry.filePath, `${entry.message}\n`, 'utf8');
  } catch (error) {
    // Use console output as a fallback when writing to the log file fails.
    const fallback = `[${new Date().toISOString()}] [ERROR] [logger] Failed to write log file: ${error.message}`;
    console.error(fallback);
  }
}

function outputToConsole(level, text) {
  if (level === 'error') {
    console.error(text);
    return;
  }
  if (level === 'warn') {
    console.warn(text);
    return;
  }
  console.log(text);
}

function log(level = 'info', component = 'app', message = '', data) {
  const now = new Date();
  const date = formatDate(now);
  const timestamp = now.toISOString();

  if (currentDate !== date || !fs.existsSync(LOG_DIR)) {
    ensureLogDir();
    currentDate = date;
  }

  const normalizedData = normalizeData(data);
  const serializedData =
    normalizedData !== undefined ? ` ${JSON.stringify(normalizedData)}` : '';
  const text = `[${timestamp}] [${String(level).toUpperCase()}] [${component}] ${message}${serializedData}`;

  const filePath = getLogFilePath(date);
  writeLogEntry({ filePath, message: text });
  outputToConsole(level.toLowerCase(), text);
}

module.exports = { log };
