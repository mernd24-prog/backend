const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { env } = require("../../config/env");
const { logger } = require("../../shared/logger/logger");
const { UserModel } = require("../../modules/user/models/user.model");
const { OrderRepository } = require("../../modules/order/repositories/order.repository");
const { getSessionAuthError, getStatusAuthError } = require("../../shared/auth/session-state");

let io = null;
const orderRepository = new OrderRepository();
const ADMIN_ROLES = new Set(["admin", "sub-admin", "super-admin"]);

function attachSocketServer(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: env.socket.corsOrigin,
      methods: ["GET", "POST"],
    },
  });

  io.use(async (socket, next) => {
    const rawToken = socket.handshake.auth?.token || socket.handshake.headers.authorization;
    if (!rawToken) {
      return next(new Error("Authentication required"));
    }

    const token = rawToken.startsWith("Bearer ") ? rawToken.replace("Bearer ", "") : rawToken;

    try {
      const payload = jwt.verify(token, env.jwtAccessSecret);
      const user = await UserModel.findById(payload.sub).select("role accountStatus tokenVersion sessionVersion permissionVersion").lean();
      if (!user || getStatusAuthError(user) || getSessionAuthError(user, payload) || (payload.role && payload.role !== user.role)) {
        return next(new Error("Unauthorized socket connection"));
      }
      socket.data.auth = { ...payload, role: user.role };
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

    socket.on("join:order", async (orderId, acknowledge) => {
      try {
        if (!auth?.sub || !orderId) throw new Error("Invalid order room request");
        const order = await orderRepository.findByIdWithItems(String(orderId));
        const allowed = order && (
          ADMIN_ROLES.has(auth.role) ||
          String(order.buyer_id) === String(auth.sub) ||
          (order.items || []).some((item) => String(item.seller_id) === String(auth.ownerSellerId || auth.sub))
        );
        if (!allowed) throw new Error("Forbidden order room");
        await socket.join(`order:${orderId}`);
        if (typeof acknowledge === "function") acknowledge({ success: true });
      } catch (error) {
        logger.warn({ socketId: socket.id, orderId }, "Rejected unauthorized order room join");
        if (typeof acknowledge === "function") acknowledge({ success: false, message: "Forbidden" });
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
