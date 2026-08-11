const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { env } = require("../../config/env");
const { logger } = require("../../shared/logger/logger");

let io = null;

function attachSocketServer(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: env.socket.corsOrigin,
      methods: ["GET", "POST"],
    },
  });

  io.use((socket, next) => {
    const rawToken = socket.handshake.auth?.token || socket.handshake.headers.authorization;
    if (!rawToken) {
      return next();
    }

    const token = rawToken.startsWith("Bearer ") ? rawToken.replace("Bearer ", "") : rawToken;

    try {
      const payload = jwt.verify(token, env.jwtAccessSecret);
      socket.data.auth = payload;
      return next();
    } catch (error) {
      return next(new Error("Unauthorized socket connection"));
    }
  });

  io.on("connection", (socket) => {
    const auth = socket.data.auth;
    if (auth?.sub) {
      socket.join(`user:${auth.sub}`);
      socket.join(`role:${auth.role}`);
    }

    socket.on("join:order", (orderId) => {
      if (auth?.sub && orderId) {
        socket.join(`order:${orderId}`);
      }
    });

    socket.on("disconnect", () => {
      logger.debug({ socketId: socket.id }, "Socket disconnected");
    });
  });

  logger.info("Socket.IO server attached");
  return io;
}

function getSocketServer() {
  return io;
}

async function closeSocketServer() {
  const current = io;
  io = null;
  if (!current) return;
  await new Promise((resolve) => current.close(() => resolve()));
}

function emitToUser(userId, eventName, payload) {
  io?.to(`user:${userId}`).emit(eventName, payload);
}

function emitToRole(role, eventName, payload) {
  io?.to(`role:${role}`).emit(eventName, payload);
}

function emitToOrder(orderId, eventName, payload) {
  io?.to(`order:${orderId}`).emit(eventName, payload);
}

module.exports = {
  attachSocketServer,
  closeSocketServer,
  getSocketServer,
  emitToUser,
  emitToRole,
  emitToOrder,
};
