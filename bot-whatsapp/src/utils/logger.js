'use strict';

const pino = require('pino');
const path = require('path');
const fs = require('fs');

const logDir = '/app/logs';
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    targets: [
      {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard' },
        level: 'info'
      },
      {
        target: 'pino/file',
        options: { destination: path.join(logDir, 'bot.log'), mkdir: true },
        level: 'debug'
      }
    ]
  }
});

module.exports = logger;
