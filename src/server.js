const { createApp } = require("./app/create-app");
const { env } = require("./config/env");
const { logger } = require("./shared/logger/logger");
const http = require("http");
const os = require("os");

const { attachSocketServer } = require("./infrastructure/realtime/socket-server");

function getLocalIp() {
  const interfaces = os.networkInterfaces();

  for (const interfaceName in interfaces) {
    for (const iface of interfaces[interfaceName]) {
      if (
        iface.family === "IPv4" &&
        !iface.internal
      ) {
        return iface.address;
      }
    }
  }

  return "localhost";
}

async function bootstrap() {
  const app = await createApp();

  const httpServer = http.createServer(app);

  attachSocketServer(httpServer);

  const localIp = getLocalIp();

  httpServer.listen(env.port, () => {
    logger.info(
      {
        port: env.port,
        localhost: `http://localhost:${env.port}`,
        network: `http://${localIp}:${env.port}`,
      },
      "HTTP server started"
    );

    console.log(`
🚀 Server Running
────────────────────────────────
Local:    http://localhost:${env.port}
Network:  http://${localIp}:${env.port}
────────────────────────────────
    `);
  });
}

bootstrap().catch((error) => {
  logger.error({ err: error }, "Bootstrap failed");
  process.exit(1);
});