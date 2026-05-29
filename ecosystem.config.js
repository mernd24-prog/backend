const path = require("path");

const logDir = process.env.PM2_LOG_DIR || path.join(__dirname, "logs");

module.exports = {
  apps: [
    {
      name: "ecommerce-backend",
      cwd: __dirname,
      script: "src/server.js",
      exec_mode: "fork",
      instances: 1,
      watch: false,
      max_memory_restart: "450M",
      restart_delay: 5000,
      exp_backoff_restart_delay: 100,
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      out_file: path.join(logDir, "backend-out.log"),
      error_file: path.join(logDir, "backend-error.log"),
      env: {
        NODE_ENV: "production",
        PRODUCTION: "true",
        PORT: 4000,
      },
    },
  ],
};
