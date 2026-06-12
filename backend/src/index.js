"use strict";

const http = require("node:http");
const express = require("express");

const { createRuntimeConfig } = require("./config");
const { loadEnvFile } = require("./env");
const { buildMediaMtxRelayDescriptor } = require("./mediaMtx");
const { getRuntimeSummary, validateRuntime } = require("./runtime");
const { createStreamApi, sendApiError } = require("./streamApi");
const { buildStreamUrls } = require("./urlBuilders");

/**
 * Creates the Express application with all backend routes and middleware wired up.
 * @param {object} config - Runtime configuration used by the API routes.
 * @param {object} [options={}] - Optional dependency injection for the stream API layer.
 * @returns {import("express").Express} The configured Express app.
 */
function createApp(config, options = {}) {
  const app = express();
  const streamApi = createStreamApi(config, options.streamApiOptions);
  app.locals.streamApi = streamApi;

  // Keep the API surface small and predictable for the Chapter 1 runtime checks.
  app.disable("x-powered-by");
  app.use(express.json());
  app.use((request, response, next) => {
    // The runtime status endpoint should always be fresh, never cached.
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/api/runtime/status", (request, response) => {
    response.status(200).json({
      ok: true,
      runtime: getRuntimeSummary(config),
      sampleStream: buildStreamUrls(config, "stream-sample"),
      sampleRelay: buildMediaMtxRelayDescriptor(config, "stream-sample"),
    });
  });

  app.use("/api", streamApi.router);

  app.use((request, response) => {
    response.status(404).json({
      error: "Not found",
      message: "No backend API route matches this request.",
    });
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    if (error && error.type === "entity.parse.failed") {
      response.status(400).json({
        error: "BAD_JSON",
        message: "Request body must be valid JSON.",
      });
      return;
    }

    sendApiError(error, response);
  });

  return app;
}

/**
 * Creates the HTTP server that wraps the Express app.
 * @param {object} config - Runtime configuration used to build the app.
 * @param {object} [options={}] - Optional dependency injection passed through to `createApp`.
 * @returns {import("node:http").Server & {streamApi?: object}} The created Node HTTP server.
 */
function createServer(config, options = {}) {
  // Express handles request routing; Node still owns the actual HTTP server socket.
  const app = createApp(config, options);
  const server = http.createServer(app);
  server.streamApi = app.locals.streamApi;
  return server;
}

/**
 * Starts the backend from environment variables and wires up shutdown handlers.
 * @returns {import("node:http").Server} The started HTTP server instance.
 */
function start() {
  // Startup does three things in order: load env, build config, validate the runtime layout.
  loadEnvFile();

  const config = createRuntimeConfig();
  const validation = validateRuntime(config);
  const server = createServer(config);

  server.listen(config.backend.port, () => {
    console.log(`Backend API listening on ${config.backend.baseUrl}`);
    console.log(`HLS output root: ${validation.mediaRoot}`);
    console.log(`Recording archive root: ${validation.archiveRoot}`);
    console.log(`VOD output root: ${validation.vodRoot}`);
    console.log(`nginx HLS base URL: ${config.nginx.hlsBaseUrl}`);
    console.log(`nginx VOD base URL: ${config.nginx.vodBaseUrl}`);
    console.log(`MediaMTX WebRTC base URL: ${config.mediaMtx.webRtcBaseUrl}`);
  });

  /**
   * Stops encoder workers first, then closes the HTTP server and exits the process.
   * @returns {void}
   */
  function shutdown() {
    console.log("Stopping encoder workers before backend shutdown...");
    server.streamApi.encoderManager.stopAllEncoders();
    const forceExit = setTimeout(() => {
      process.exit(0);
    }, 3000);
    forceExit.unref();
    server.close(() => {
      process.exit(0);
    });
  }

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return server;
}

if (require.main === module) {
  try {
    start();
  } catch (error) {
    console.error(`Backend startup failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  createApp,
  createServer,
  start,
};
