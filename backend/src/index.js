"use strict";

const http = require("node:http");
const express = require("express");

const { createRuntimeConfig } = require("./config");
const { loadEnvFile } = require("./env");
const { getRuntimeSummary, validateRuntime } = require("./runtime");
const { buildStreamUrls } = require("./urlBuilders");

function createApp(config) {
  const app = express();

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
    });
  });

  app.use((request, response) => {
    response.status(404).json({
      error: "Not found",
      message: "Chapter 1 Part 1 exposes runtime configuration only. Stream APIs come in later parts.",
    });
  });

  return app;
}

function createServer(config) {
  // Express handles request routing; Node still owns the actual HTTP server socket.
  return http.createServer(createApp(config));
}

function start() {
  // Startup does three things in order: load env, build config, validate the runtime layout.
  loadEnvFile();

  const config = createRuntimeConfig();
  const validation = validateRuntime(config);
  const server = createServer(config);

  server.listen(config.backend.port, () => {
    console.log(`Backend API listening on ${config.backend.baseUrl}`);
    console.log(`HLS output root: ${validation.mediaRoot}`);
    console.log(`nginx HLS base URL: ${config.nginx.hlsBaseUrl}`);
    console.log(`MediaMTX WebRTC base URL: ${config.mediaMtx.webRtcBaseUrl}`);
  });

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
