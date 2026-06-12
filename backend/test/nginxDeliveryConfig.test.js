"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const nginxConfigPath = path.join(
  __dirname,
  "..",
  "..",
  "config",
  "nginx",
  "chapter-1-hls.conf",
);
const nginxRuntimeConfigPath = path.join(
  __dirname,
  "..",
  "..",
  "config",
  "nginx",
  "runtime-nginx.conf",
);
const repoRoot = path.resolve(__dirname, "..", "..");
const hlsRoot = path.join(repoRoot, "backend", "media", "live").replace(/\\/g, "/");
const vodRoot = path.join(repoRoot, "backend", "media", "vod").replace(/\\/g, "/");
const runtimeIncludePath = path.join(repoRoot, "config", "nginx", "chapter-1-hls.conf").replace(
  /\\/g,
  "/",
);

function readNginxConfig() {
  return fs.readFileSync(nginxConfigPath, "utf8");
}

function readNginxRuntimeConfig() {
  return fs.readFileSync(nginxRuntimeConfigPath, "utf8");
}

test("nginx HLS config aliases /hls/ to the generated media root", () => {
  const config = readNginxConfig();

  assert.match(config, /location \/hls\//);
  assert.match(config, new RegExp(`alias ${hlsRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\/`));
  assert.match(config, /autoindex off;/);
  assert.doesNotMatch(config, /proxy_pass/);
});

test("nginx VOD config aliases /vod/ to the generated VOD media root", () => {
  const config = readNginxConfig();

  assert.match(config, /location \/vod\//);
  assert.match(config, new RegExp(`alias ${vodRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\/`));
  assert.match(config, /autoindex off;/);
  assert.doesNotMatch(config, /proxy_pass/);
});

test("nginx HLS config keeps manifests fresh and segments briefly cacheable", () => {
  const config = readNginxConfig();

  assert.match(config, /location ~ \^\/hls\/\(\.\+\\\.m3u8\)\$/);
  assert.match(config, /Cache-Control "no-cache, no-store, must-revalidate"/);
  assert.match(config, /application\/vnd\.apple\.mpegurl m3u8/);

  assert.match(config, /location ~ \^\/hls\/\(\.\+\\\.ts\)\$/);
  assert.match(config, /Cache-Control "public, max-age=10"/);
  assert.match(config, /video\/mp2t ts/);
});

test("nginx HLS config includes CORS headers for cross-origin frontend playback", () => {
  const config = readNginxConfig();

  assert.match(config, /Access-Control-Allow-Origin "\*"/);
  assert.match(config, /Access-Control-Allow-Methods "GET, HEAD, OPTIONS"/);
  assert.match(config, /Access-Control-Allow-Headers "Range"/);
});

test("nginx runtime config loads the Chapter 1 HLS server block", () => {
  const config = readNginxRuntimeConfig();

  assert.match(config, /events\s*{/);
  assert.match(config, /http\s*{/);
  assert.match(config, new RegExp(`include ${runtimeIncludePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")};`));
});

test("nginx VOD config allows stable caching for packaged manifests and segments", () => {
  const config = readNginxConfig();

  assert.match(config, /location ~ \^\/vod\/\(\.\+\\\.m3u8\)\$/);
  assert.match(config, /Cache-Control "public, max-age=60"/);
  assert.match(config, /application\/vnd\.apple\.mpegurl m3u8/);

  assert.match(config, /location ~ \^\/vod\/\(\.\+\\\.ts\)\$/);
  assert.match(config, /Cache-Control "public, max-age=86400, immutable"/);
  assert.match(config, /video\/mp2t ts/);
});
