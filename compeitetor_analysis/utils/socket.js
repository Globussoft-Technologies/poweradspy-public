import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import config from "config";
import logger from "../resources/logs/logger.log.js";

let io;

export const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
        },
    });

    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;

        if (!token) {
            return next(new Error("Authentication token missing"));
        }

        try {
            const secret = config.get("JWT_SECRET_KEY");
            const decoded = jwt.verify(token, secret);
            socket.user = decoded;
            next();
        } catch (err) {
            return next(new Error("Invalid or expired token"));
        }
    });

    io.on("connection", (socket) => {
        logger.info(`Socket connected: ${socket.id}, user: ${socket.user?.user_id}`);

        socket.emit("socket-ready", { socket_id: socket.id });

        socket.on("join-room", (content_ref_id) => {
            if (!content_ref_id) return;

            socket.join(content_ref_id);
            logger.info(
                `Socket ${socket.id} joined room: ${content_ref_id}, user: ${socket.user?.user_id}`
            );
        });

        socket.on("leave-room", (content_ref_id) => {
            socket.leave(content_ref_id);

            logger.info(
                `Socket ${socket.id} left room: ${content_ref_id}`
            );
        });

        socket.on("ping", () => {
            socket.emit("pong");
        });

        socket.on("disconnect", (reason) => {
            logger.info(`Socket disconnected: ${socket.id}, reason: ${reason}`);
        });
    });
};

export const getIO = () => {
    if (!io) {
        throw new Error("Socket.io not initialized");
    }
    return io;
};

export const sendPayloadToRoom = (room, event, payload) => {
    const io = getIO();
    io.to(room).emit(event, payload);
};
