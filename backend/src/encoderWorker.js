"use strict";

const { spawn: defaultSpawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { buildMediaMtxPath, buildStreamHlsOutputDir } = require("./urlBuilders");

const MAX_STDERR_TAIL_LENGTH = 8 * 1024;
const HLS_SEGMENT_SECONDS = 2;
const HLS_PLAYLIST_SIZE = 5;

const RENDITION_DEFINITIONS = Object.freeze({
  "360p": Object.freeze({
    name: "360p",
    width: 640,
    height: 360,
    videoBitrate: "800k",
    maxrate: "856k",
    bufsize: "1200k",
    bandwidth: 928000,
  }),
  "480p": Object.freeze({
    name: "480p",
    width: 854,
    height: 480,
    videoBitrate: "1400k",
    maxrate: "1498k",
    bufsize: "2100k",
    bandwidth: 1528000,
  }),
  "720p": Object.freeze({
    name: "720p",
    width: 1280,
    height: 720,
    videoBitrate: "2800k",
    maxrate: "2996k",
    bufsize: "4200k",
    bandwidth: 2928000,
  }),
});

function appendPath(baseUrl, pathParts) {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  const suffix = pathParts.map((part) => encodeURIComponent(part)).join("/");
  url.pathname = `${basePath}/${suffix}`.replace(/\/+/g, "/");
  return url.toString();
}

function buildEncoderInputUrl(config, streamId) {
  const mediaMtxPath = buildMediaMtxPath(streamId);
  return appendPath(config.mediaMtx.rtspBaseUrl, mediaMtxPath.split("/"));
}

function getRenditionDefinitions(renditions) {
  return renditions.map((rendition) => {
    const definition = RENDITION_DEFINITIONS[rendition];

    if (!definition) {
      throw new Error(`Unsupported rendition: ${rendition}`);
    }

    return definition;
  });
}

function appendToTail(currentTail, chunk, maxLength = MAX_STDERR_TAIL_LENGTH) {
  const nextTail = `${currentTail}${chunk}`;
  if (nextTail.length <= maxLength) {
    return nextTail;
  }

  return nextTail.slice(nextTail.length - maxLength);
}

function ensureStreamOutputDirectories(outputDir, renditions) {
  fs.mkdirSync(outputDir, { recursive: true });

  for (const rendition of renditions) {
    fs.mkdirSync(path.join(outputDir, rendition.name), { recursive: true });
  }
}

function writeMasterPlaylist(outputDir, renditions) {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];

  for (const rendition of renditions) {
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${rendition.bandwidth},RESOLUTION=${rendition.width}x${rendition.height}`,
      `${rendition.name}/index.m3u8`,
    );
  }

  fs.writeFileSync(path.join(outputDir, "master.m3u8"), `${lines.join("\n")}\n`);
}

function normalizePathForComparison(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isPathInside(parentDir, candidatePath) {
  const relative = path.relative(parentDir, candidatePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function resolveValidatedCleanupDir(config, streamId, outputDir) {
  const expectedOutputDir = path.resolve(buildStreamHlsOutputDir(config, streamId));
  const actualOutputDir = path.resolve(outputDir);

  if (
    normalizePathForComparison(actualOutputDir) !== normalizePathForComparison(expectedOutputDir)
  ) {
    throw new Error(`Cleanup output directory must match stream ${streamId}'s HLS directory.`);
  }

  return expectedOutputDir;
}

function cleanupStreamOutputDirectory(config, streamId, outputDir) {
  const cleanupDir = resolveValidatedCleanupDir(config, streamId, outputDir);
  const result = {
    attempted: true,
    outputDir: cleanupDir,
    deletedEntries: [],
    errors: [],
  };

  if (!fs.existsSync(cleanupDir)) {
    return result;
  }

  for (const entry of fs.readdirSync(cleanupDir, { withFileTypes: true })) {
    const entryPath = path.resolve(cleanupDir, entry.name);

    if (!isPathInside(cleanupDir, entryPath)) {
      result.errors.push({
        path: entryPath,
        message: "Refusing to delete a path outside the stream output directory.",
      });
      continue;
    }

    try {
      fs.rmSync(entryPath, { force: true, recursive: true });
      result.deletedEntries.push(entry.name);
    } catch (error) {
      result.errors.push({
        path: entryPath,
        message: error.message,
      });
    }
  }

  return result;
}

function buildScaleFilter(renditions) {
  const inputLabels = renditions.map((rendition) => `[r${rendition.name}in]`).join("");
  const filters = [`[0:v]split=${renditions.length}${inputLabels}`];

  for (const rendition of renditions) {
    filters.push(
      `[r${rendition.name}in]scale=w=${rendition.width}:h=${rendition.height}:force_original_aspect_ratio=decrease,pad=${rendition.width}:${rendition.height}:(ow-iw)/2:(oh-ih)/2:color=black[vr${rendition.name}]`,
    );
  }

  return filters.join(";");
}

function buildFfmpegArgs(inputUrl, outputDir, renditions) {
  const args = ["-hide_banner", "-loglevel", "info", "-fflags", "+genpts"];

  if (inputUrl.startsWith("rtsp://") || inputUrl.startsWith("rtsps://")) {
    args.push("-rtsp_transport", "tcp");
  }

  args.push("-i", inputUrl, "-filter_complex", buildScaleFilter(renditions));

  for (const rendition of renditions) {
    const renditionDir = path.join(outputDir, rendition.name);

    args.push(
      "-map",
      `[vr${rendition.name}]`,
      "-map",
      "0:a:0?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-profile:v",
      "main",
      "-pix_fmt",
      "yuv420p",
      "-b:v",
      rendition.videoBitrate,
      "-maxrate",
      rendition.maxrate,
      "-bufsize",
      rendition.bufsize,
      "-g",
      "60",
      "-keyint_min",
      "60",
      "-sc_threshold",
      "0",
      "-force_key_frames",
      `expr:gte(t,n_forced*${HLS_SEGMENT_SECONDS})`,
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ac",
      "2",
      "-f",
      "hls",
      "-hls_time",
      String(HLS_SEGMENT_SECONDS),
      "-hls_list_size",
      String(HLS_PLAYLIST_SIZE),
      "-hls_flags",
      "delete_segments+independent_segments+program_date_time",
      "-hls_segment_type",
      "mpegts",
      "-hls_segment_filename",
      path.join(renditionDir, "%06d.ts"),
      path.join(renditionDir, "index.m3u8"),
    );
  }

  return args;
}

function quoteCommandPart(value) {
  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

function buildFfmpegCommand(config, stream, options = {}) {
  const renditionNames = options.renditions || Object.keys(RENDITION_DEFINITIONS);
  const renditions = getRenditionDefinitions(renditionNames);
  const inputUrl = buildEncoderInputUrl(config, stream.streamId);
  const outputDir = stream.output.hlsOutputDir;
  const command = config.externalBinaries.ffmpeg;
  const args = buildFfmpegArgs(inputUrl, outputDir, renditions);

  return {
    command,
    args,
    commandLine: [command, ...args].map(quoteCommandPart).join(" "),
    inputUrl,
    outputDir,
    renditions: renditions.map((rendition) => rendition.name),
  };
}

function stopChildProcess(child) {
  if (!child || !child.pid) {
    return false;
  }

  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGTERM");
      return true;
    } catch {
      return child.kill("SIGTERM");
    }
  }

  return child.kill("SIGTERM");
}

function createEncoderWorkerManager(config, options = {}) {
  const spawn = options.spawn || defaultSpawn;
  const getNow = options.now || (() => new Date().toISOString());
  const onEncoderExit = options.onEncoderExit || (() => {});
  const workers = new Map();

  function toStatus(worker) {
    return {
      state: worker.exited ? "exited" : "encoding",
      pid: worker.pid,
      startedAt: worker.startedAt,
      stoppedAt: worker.stoppedAt,
      exitCode: worker.exitCode,
      exitSignal: worker.exitSignal,
      stderrTail: worker.stderrTail,
      inputUrl: worker.inputUrl,
      outputDir: worker.outputDir,
      renditions: [...worker.renditions],
      commandLine: worker.commandLine,
      expectedStop: worker.expectedStop,
      running: !worker.exited,
    };
  }

  function getEncoderStatus(streamId) {
    const worker = workers.get(streamId);
    return worker ? toStatus(worker) : null;
  }

  function listEncoderWorkers() {
    return Array.from(workers.values()).map(toStatus);
  }

  function startEncoder(stream, optionsForStart = {}) {
    const existing = getEncoderStatus(stream.streamId);
    if (existing && existing.running) {
      return existing;
    }

    const command = buildFfmpegCommand(config, stream, optionsForStart);
    const renditions = getRenditionDefinitions(command.renditions);

    ensureStreamOutputDirectories(command.outputDir, renditions);
    writeMasterPlaylist(command.outputDir, renditions);

    const child = spawn(command.command, command.args, {
      detached: process.platform !== "win32",
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });

    const worker = {
      child,
      commandLine: command.commandLine,
      exitCode: null,
      exitSignal: null,
      exited: false,
      expectedStop: false,
      inputUrl: command.inputUrl,
      outputDir: command.outputDir,
      pid: child.pid || null,
      renditions: command.renditions,
      startedAt: getNow(),
      stoppedAt: null,
      stderrTail: "",
      streamId: stream.streamId,
    };

    workers.set(stream.streamId, worker);

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        worker.stderrTail = appendToTail(worker.stderrTail, chunk.toString("utf8"));
      });
    }

    child.on("error", (error) => {
      if (worker.exited) {
        return;
      }

      worker.exited = true;
      worker.stoppedAt = getNow();
      worker.stderrTail = appendToTail(worker.stderrTail, error.message);
      workers.delete(stream.streamId);
      onEncoderExit({
        ...toStatus(worker),
        error,
        streamId: stream.streamId,
      });
    });

    child.on("close", (exitCode, exitSignal) => {
      if (worker.exited) {
        return;
      }

      worker.exited = true;
      worker.exitCode = exitCode;
      worker.exitSignal = exitSignal;
      worker.stoppedAt = getNow();
      workers.delete(stream.streamId);
      onEncoderExit({
        ...toStatus(worker),
        streamId: stream.streamId,
      });
    });

    return toStatus(worker);
  }

  function stopEncoder(streamId) {
    const worker = workers.get(streamId);

    if (!worker) {
      return {
        state: "stopped",
        stoppedAt: getNow(),
      };
    }

    worker.expectedStop = true;
    worker.stoppedAt = getNow();
    stopChildProcess(worker.child);

    return {
      ...toStatus(worker),
      state: "stopped",
      running: false,
    };
  }

  function stopAllEncoders() {
    for (const streamId of workers.keys()) {
      stopEncoder(streamId);
    }
  }

  return {
    getEncoderStatus,
    listEncoderWorkers,
    startEncoder,
    stopAllEncoders,
    stopEncoder,
  };
}

module.exports = {
  HLS_PLAYLIST_SIZE,
  HLS_SEGMENT_SECONDS,
  MAX_STDERR_TAIL_LENGTH,
  RENDITION_DEFINITIONS,
  appendToTail,
  buildEncoderInputUrl,
  buildFfmpegCommand,
  cleanupStreamOutputDirectory,
  createEncoderWorkerManager,
  ensureStreamOutputDirectories,
  writeMasterPlaylist,
};
