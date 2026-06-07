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

function readNginxConfig() {
  return fs.readFileSync(nginxConfigPath, "utf8");
}

test("nginx HLS config aliases /hls/ to the generated media root", () => {
  const config = readNginxConfig();

  assert.match(config, /location \/hls\//);
  assert.match(config, /alias D:\/Work\/OTT-Platform\/backend\/media\/live\//);
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
