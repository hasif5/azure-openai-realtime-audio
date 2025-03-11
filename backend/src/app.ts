// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import express from "express";
import { WebSocketServer } from "ws";
import http from "http";
import { config } from "dotenv";
import { pino } from "pino";
import { RTSession } from "./session.js";

config();

/**
 * Configures and creates a logger instance using Pino.
 * The log level is determined by the environment variable LOG_LEVEL,
 * defaulting to "info" if not specified. Logs are formatted for readability
 * using the pino-pretty transport.
 */
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});

/**
 * Creates an Express application instance.
 */
const app = express();
/**
 * Creates an HTTP server using the Express application.
 */
const server = http.createServer(app);
/**
 * Creates a WebSocket server instance, configured to not listen directly.
 * It will use the HTTP server for upgrading connections.
 */
const wss = new WebSocketServer({ noServer: true });

/**
 * Handles HTTP upgrade requests, specifically for WebSocket connections.
 * It checks if the requested path is "/realtime". If so, it upgrades the
 * connection to a WebSocket and emits a "connection" event on the WebSocket server.
 * If the path is invalid, the connection is destroyed.
 */
server.on("upgrade", (request, socket, head) => {
  const { pathname } = new URL(request.url!, `http://${request.headers.host}`);
  if (pathname === "/realtime") {
    logger.debug({ pathname }, "Handling WebSocket upgrade request");
    wss.handleUpgrade(request, socket, head, (ws) => {
      logger.debug("WebSocket upgrade successful");
      wss.emit("connection", ws, request);
    });
  } else {
    logger.warn({ pathname }, "Invalid WebSocket path - destroying connection");
    socket.destroy();
  }
});

/**
 * Listens for new WebSocket connections. When a connection is established,
 * it creates a new RTSession instance to manage the real-time session.
 */
wss.on("connection", (ws) => {
  logger.info("New WebSocket connection established");
  new RTSession(ws, process.env.BACKEND, logger);
});

/**
 * Defines the port for the server to listen on, defaulting to 8080 if the
 * environment variable PORT is not set.
 */
const PORT = process.env.PORT || 8080;

/**
 * Starts the HTTP server and listens on the specified port.
 * Logs a message to indicate that the server has started.
 */
server.listen(PORT, () => {
  logger.info(`Server started on http://localhost:${PORT}`);
});
