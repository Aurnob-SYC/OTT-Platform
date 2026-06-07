"use strict";

const path = require("node:path");

const DEFAULTS = {
  frontendPort: 5173,
  backendPort: 4000,
  mediaMtxWebRtcPort: 8889,
  mediaMtxApiPort: 9997,
  mediaMtxRtspPort: 8554,
  nginxPort: 80,
  mediaRootRelative: path.join("media", "live"),
};

function readString(env, key, fallback) {
  const value = env[key];
  if (value === undefined || value === null || value.trim() === "") {
    return fallback;
  }

  return value.trim();
}

function readPort(env, key, fallback) {
  const rawValue = readString(env, key, String(fallback));
  const value = Number(rawValue);

  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${key} must be an integer port between 1 and 65535.`);
  }

  return value;
}

function readBoolean(env, key, fallback) {
  const rawValue = readString(env, key, fallback ? "true" : "false").toLowerCase();

  if (["1", "true", "yes", "on"].includes(rawValue)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(rawValue)) {
    return false;
  }

  throw new Error(`${key} must be true or false.`);
}

function normalizeBaseUrl(value, key) {
  let url;

  try {
    // Parse once so we can validate the scheme and also normalize the final shape.
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid http:// or https:// URL.`);
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${key} must use http:// or https://.`);
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";

  return url.toString().replace(/\/$/, "");
}

function normalizeMediaBaseUrl(value, key, allowedProtocols) {
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid URL.`);
  }

  if (!allowedProtocols.includes(url.protocol)) {
    throw new Error(`${key} must use one of: ${allowedProtocols.join(", ")}.`);
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";

  return url.toString().replace(/\/$/, "");
}

function createRuntimeConfig(env = process.env, options = {}) {
  // Build one normalized config object so the rest of the backend does not need to
  // know about raw env variables or string parsing rules.
  const backendRoot = path.resolve(options.backendRoot || path.join(__dirname, ".."));
  const lanHost = readString(env, "LAN_HOST", "127.0.0.1");
  const frontendPort = readPort(env, "FRONTEND_PORT", DEFAULTS.frontendPort);
  const backendPort = readPort(env, "BACKEND_PORT", DEFAULTS.backendPort);
  const mediaMtxWebRtcPort = readPort(
    env,
    "MEDIAMTX_WEBRTC_PORT",
    DEFAULTS.mediaMtxWebRtcPort,
  );
  const mediaMtxApiPort = readPort(env, "MEDIAMTX_API_PORT", DEFAULTS.mediaMtxApiPort);
  const mediaMtxRtspPort = readPort(env, "MEDIAMTX_RTSP_PORT", DEFAULTS.mediaMtxRtspPort);
  const nginxPort = readPort(env, "NGINX_PORT", DEFAULTS.nginxPort);

  const mediaRoot = path.resolve(
    backendRoot,
    readString(env, "HLS_MEDIA_ROOT", DEFAULTS.mediaRootRelative),
  );

  const mediaMtxBaseUrl = normalizeBaseUrl(
    readString(env, "MEDIAMTX_WEBRTC_BASE_URL", `http://${lanHost}:${mediaMtxWebRtcPort}`),
    "MEDIAMTX_WEBRTC_BASE_URL",
  );
  const mediaMtxApiBaseUrl = normalizeBaseUrl(
    readString(env, "MEDIAMTX_API_BASE_URL", `http://${lanHost}:${mediaMtxApiPort}`),
    "MEDIAMTX_API_BASE_URL",
  );
  const mediaMtxRtspBaseUrl = normalizeMediaBaseUrl(
    readString(env, "MEDIAMTX_RTSP_BASE_URL", `rtsp://127.0.0.1:${mediaMtxRtspPort}`),
    "MEDIAMTX_RTSP_BASE_URL",
    ["rtsp:", "rtsps:"],
  );
  const nginxHlsBaseUrl = normalizeBaseUrl(
    readString(
      env,
      "NGINX_HLS_BASE_URL",
      nginxPort === 80 ? `http://${lanHost}/hls` : `http://${lanHost}:${nginxPort}/hls`,
    ),
    "NGINX_HLS_BASE_URL",
  );

  return {
    env: readString(env, "NODE_ENV", "development"),
    lanHost,
    ports: {
      frontend: frontendPort,
      backend: backendPort,
      mediaMtxWebRtc: mediaMtxWebRtcPort,
      mediaMtxApi: mediaMtxApiPort,
      mediaMtxRtsp: mediaMtxRtspPort,
      nginx: nginxPort,
    },
    backend: {
      baseUrl: normalizeBaseUrl(
        readString(env, "BACKEND_BASE_URL", `http://${lanHost}:${backendPort}`),
        "BACKEND_BASE_URL",
      ),
      port: backendPort,
    },
    frontend: {
      baseUrl: normalizeBaseUrl(
        readString(env, "FRONTEND_BASE_URL", `http://${lanHost}:${frontendPort}`),
        "FRONTEND_BASE_URL",
      ),
      port: frontendPort,
    },
    mediaMtx: {
      webRtcBaseUrl: mediaMtxBaseUrl,
      apiBaseUrl: mediaMtxApiBaseUrl,
      rtspBaseUrl: mediaMtxRtspBaseUrl,
      webRtcPort: mediaMtxWebRtcPort,
      apiPort: mediaMtxApiPort,
      rtspPort: mediaMtxRtspPort,
    },
    nginx: {
      hlsBaseUrl: nginxHlsBaseUrl,
      port: nginxPort,
    },
    hls: {
      mediaRoot,
      cleanStaleOutputOnStart: readBoolean(env, "HLS_CLEAN_STALE_OUTPUT_ON_START", false),
    },
    externalBinaries: {
      mediaMtx: readString(env, "MEDIAMTX_BINARY", "mediamtx"),
      ffmpeg: readString(env, "FFMPEG_BINARY", "ffmpeg"),
      nginx: readString(env, "NGINX_BINARY", "nginx"),
    },
  };
}

module.exports = {
  DEFAULTS,
  createRuntimeConfig,
};
