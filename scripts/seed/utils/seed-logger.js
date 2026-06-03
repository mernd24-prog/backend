/**
 * Seed Logger with Progress Tracking
 */

const fs = require('fs');
const path = require('path');
const pino = require('pino');

class SeedLogger {
  constructor(moduleName) {
    this.moduleName = moduleName;
    const logsDir = path.join(__dirname, '../logs');
    
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logFile = path.join(logsDir, `${moduleName}-${timestamp}.log`);

    this.logger = pino(
      {
        level: process.env.LOG_LEVEL || 'info',
        transport: {
          targets: [
            {
              level: 'info',
              target: 'pino/file',
              options: { destination: this.logFile },
            },
            {
              level: 'info',
              target: 'pino-pretty',
              options: { colorize: true },
            },
          ],
        },
      },
      pino.multistream([
        { stream: process.stdout },
        { stream: fs.createWriteStream(this.logFile, { flags: 'a' }) },
      ])
    );

    this.stats = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      startTime: Date.now(),
    };
  }

  info(message, data = {}) {
    this.logger.info({ ...data }, message);
  }

  success(message, data = {}) {
    this.logger.info({ ...data, status: 'SUCCESS' }, `✓ ${message}`);
    this.stats.created++;
  }

  warn(message, data = {}) {
    this.logger.warn({ ...data }, message);
    this.stats.skipped++;
  }

  error(message, error = {}) {
    this.logger.error({ error }, `✗ ${message}`);
    this.stats.failed++;
  }

  recordBatch(count) {
    this.stats.created += count;
  }

  getStats() {
    const duration = Date.now() - this.stats.startTime;
    return {
      ...this.stats,
      duration: `${(duration / 1000).toFixed(2)}s`,
    };
  }

  printStats() {
    const stats = this.getStats();
    console.log('\n' + '='.repeat(50));
    console.log(`📊 Seed Statistics - ${this.moduleName}`);
    console.log('='.repeat(50));
    console.log(`✓ Created:  ${stats.created}`);
    console.log(`↻ Updated:  ${stats.updated}`);
    console.log(`⊘ Skipped:  ${stats.skipped}`);
    console.log(`✗ Failed:   ${stats.failed}`);
    console.log(`⏱ Duration: ${stats.duration}`);
    console.log('='.repeat(50) + '\n');
  }
}

module.exports = SeedLogger;
