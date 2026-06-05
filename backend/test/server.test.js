"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createRuntimeConfig } = require("../src/config");
const { createServer } = require("../src/index");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function getJson(port, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: pathname,
      },
      (response) => {
        let body = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body: JSON.parse(body),
          });
        });
      },
    );

    request.on("error", reject);
  });
}

function createTestServer() {
  const config = createRuntimeConfig(
    {
      LAN_HOST: "127.0.0.1",
    },
    {
      backendRoot: path.join(os.tmpdir(), "ott-express-test"),
    },
  );

  return createServer(config);
}

test("serves runtime status through the Express API", async () => {
  const server = createTestServer();
  const address = await listen(server);

  try {
    const response = await getJson(address.port, "/api/runtime/status");

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["x-powered-by"], undefined);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.runtime.urls.backendApi, "http://127.0.0.1:4000");
    assert.equal(response.body.sampleStream.playbackUrl, "http://127.0.0.1/hls/stream-sample/master.m3u8");
  } finally {
    await close(server);
  }
});

test("returns JSON for unknown API routes", async () => {
  const server = createTestServer();
  const address = await listen(server);

  try {
    const response = await getJson(address.port, "/api/unknown");

    assert.equal(response.statusCode, 404);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.body.error, "Not found");
  } finally {
    await close(server);
  }
});
