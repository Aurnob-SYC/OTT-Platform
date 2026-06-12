"use strict";

const { spawn: defaultSpawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { buildMediaMtxPath, buildStreamHlsOutputDir } = require("./urlBuilders");
const { buildRecordingArchiveDir } = require("./recordingPaths");

const MAX_STDERR_TAIL_LENGTH = 8 * 1024;
const OUTPUT_FRAME_RATE = 30;
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

/**
 * Appends URL path segments to a base URL without disturbing the protocol or host.
 * @param {string} baseUrl - The starting URL to extend.
 * @param {string[]} pathParts - Individual path segments to append.
 * @returns {string} A normalized URL string containing the appended path.
 */
function appendPath(baseUrl, pathParts) {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  const suffix = pathParts.map((part) => encodeURIComponent(part)).join("/");
  url.pathname = `${basePath}/${suffix}`.replace(/\/+/g, "/");
  return url.toString();
}

/**
 * Builds the MediaMTX input URL that FFmpeg should read for a stream.
 * @param {object} config - Runtime configuration containing MediaMTX URLs.
 * @param {string} streamId - The stream identifier to convert into a relay path.
 * @returns {string} The RTSP or RTSPS URL FFmpeg should use as input.
 */
function buildEncoderInputUrl(config, streamId) {
  const mediaMtxPath = buildMediaMtxPath(streamId);
  return appendPath(config.mediaMtx.rtspBaseUrl, mediaMtxPath.split("/"));
}

/**
 * Resolves rendition names into their encoding definitions and rejects unknown ones.
 * @param {string[]} renditions - Rendition names requested for this encoder run.
 * @returns {Array<object>} The matching rendition definition objects.
 */
function getRenditionDefinitions(renditions) {
  return renditions.map((rendition) => {
    const definition = RENDITION_DEFINITIONS[rendition];

    if (!definition) {
      throw new Error(`Unsupported rendition: ${rendition}`);
    }

    return definition;
  });
}

/**
 * Appends new stderr text to a bounded tail buffer.
 * @param {string} currentTail - The existing retained stderr text.
 * @param {string} chunk - Newly received stderr text to append.
 * @param {number} [maxLength=MAX_STDERR_TAIL_LENGTH] - Maximum number of characters to keep.
 * @returns {string} The updated tail, trimmed to the configured maximum length.
 */
function appendToTail(currentTail, chunk, maxLength = MAX_STDERR_TAIL_LENGTH) {
  const nextTail = `${currentTail}${chunk}`;
  if (nextTail.length <= maxLength) {
    return nextTail;
  }

  return nextTail.slice(nextTail.length - maxLength);
}

/**
 * Creates the HLS output directory tree for a stream and all requested renditions.
 * @param {string} outputDir - Base HLS output directory for the stream.
 * @param {Array<{name: string}>} renditions - Renditions that need their own subdirectories.
 * @returns {void}
 */
function ensureStreamOutputDirectories(outputDir, renditions) {
  fs.mkdirSync(outputDir, { recursive: true });

  for (const rendition of renditions) {
    fs.mkdirSync(path.join(outputDir, rendition.name), { recursive: true });
  }
}

/**
 * Writes the HLS master playlist that points viewers at each rendition playlist.
 * @param {string} outputDir - Base HLS output directory for the stream.
 * @param {Array<{bandwidth: number, width: number, height: number, name: string}>} renditions - Renditions to advertise.
 * @returns {void}
 */
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

/**
 * Normalizes a path for safe equality checks across operating systems.
 * @param {string} value - The path to normalize.
 * @returns {string} The resolved path, lowercased on Windows for case-insensitive comparison.
 */
function normalizePathForComparison(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Checks whether a candidate path lives inside a parent directory.
 * @param {string} parentDir - The directory that should contain the candidate.
 * @param {string} candidatePath - The path to validate.
 * @returns {boolean} True when the candidate is a nested path inside the parent directory.
 */
function isPathInside(parentDir, candidatePath) {
  const relative = path.relative(parentDir, candidatePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Verifies that a cleanup path matches the stream's expected HLS output directory.
 * @param {object} config - Runtime configuration used to rebuild the expected HLS directory.
 * @param {string} streamId - Stream identifier used to derive the expected directory.
 * @param {string} outputDir - Directory proposed for cleanup.
 * @returns {string} The validated, absolute HLS output directory.
 */
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

/**
 * Removes files inside a stream's HLS output directory without deleting the directory itself.
 * @param {object} config - Runtime configuration used to validate the cleanup target.
 * @param {string} streamId - Stream identifier whose output directory is being cleared.
 * @param {string} outputDir - Directory to clean up.
 * @returns {{attempted: boolean, outputDir: string, deletedEntries: string[], errors: Array<object>}} A cleanup report.
 */
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

/**
 * Builds the FFmpeg filter graph that splits and scales the input into multiple renditions.
 * @param {Array<{name: string, width: number, height: number}>} renditions - Renditions to generate.
 * @returns {string} The FFmpeg filter_complex string.
 */
function buildScaleFilter(renditions) {
  const inputLabels = renditions.map((rendition) => `[r${rendition.name}in]`).join("");
  const filters = [`[0:v]split=${renditions.length}${inputLabels}`];

  for (const rendition of renditions) {
    filters.push(
      `[r${rendition.name}in]fps=${OUTPUT_FRAME_RATE},scale=w=${rendition.width}:h=${rendition.height}:force_original_aspect_ratio=decrease,pad=${rendition.width}:${rendition.height}:(ow-iw)/2:(oh-ih)/2:color=black[vr${rendition.name}]`,
    );
  }

  return filters.join(";");
}

/**
 * Builds the FFmpeg command-line arguments for generating HLS output and an optional MKV archive.
 * @param {string} inputUrl - MediaMTX input URL for the encoder to read.
 * @param {string} outputDir - Base directory where HLS output should be written.
 * @param {Array<object>} renditions - Rendition definitions to encode.
 * @param {string | null} archivePath - Optional MKV archive path for the same live input.
 * @returns {string[]} The full FFmpeg argument list.
 */
function buildFfmpegArgs(inputUrl, outputDir, renditions, archivePath = null) {
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

  if (archivePath) {
    const archiveRendition = renditions[renditions.length - 1];

    args.push(
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-vf",
      `fps=${OUTPUT_FRAME_RATE},format=yuv420p`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-profile:v",
      "main",
      "-pix_fmt",
      "yuv420p",
      "-b:v",
      archiveRendition.videoBitrate,
      "-maxrate",
      archiveRendition.maxrate,
      "-bufsize",
      archiveRendition.bufsize,
      "-g",
      "60",
      "-keyint_min",
      "60",
      "-sc_threshold",
      "0",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ac",
      "2",
      "-f",
      "matroska",
      archivePath,
    );
  }

  return args;
}

/**
 * Quotes a single command fragment when it contains whitespace or double quotes.
 * @param {string} value - The command fragment to quote if needed.
 * @returns {string} The original fragment or a safely quoted version of it.
 */
function quoteCommandPart(value) {
  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Builds the FFmpeg executable, arguments, and derived metadata for one stream.
 * @param {object} config - Runtime configuration containing binary paths and relay URLs.
 * @param {object} stream - Stream record that provides the streamId and output directory.
 * @param {object} [options={}] - Optional encoder settings such as the renditions list.
 * @returns {{archivePath: string | null, command: string, args: string[], commandLine: string, inputUrl: string, outputDir: string, renditions: string[], recordingId: string | null}} The command description used to start FFmpeg.
 */
function buildFfmpegCommand(config, stream, options = {}) {
  const renditionNames = options.renditions || Object.keys(RENDITION_DEFINITIONS);
  const renditions = getRenditionDefinitions(renditionNames);
  const inputUrl = buildEncoderInputUrl(config, stream.streamId);
  const outputDir = stream.output.hlsOutputDir;
  const recording = options.recording || null;
  const archivePath = recording ? recording.archivePath : null;
  const command = config.externalBinaries.ffmpeg;
  const args = buildFfmpegArgs(inputUrl, outputDir, renditions, archivePath);

  return {
    archivePath,
    command,
    args,
    commandLine: [command, ...args].map(quoteCommandPart).join(" "),
    inputUrl,
    outputDir,
    recordingId: recording ? recording.recordingId : null,
    renditions: renditions.map((rendition) => rendition.name),
  };
}

/**
 * Sends SIGTERM to a child process, trying the whole process group on non-Windows platforms first.
 * @param {import("node:child_process").ChildProcess | null | undefined} child - The spawned encoder process.
 * @returns {boolean} True when a termination signal was sent successfully.
 */
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

/**
 * Creates an in-memory manager for FFmpeg encoder workers.
 * @param {object} config - Runtime configuration used to build encoder commands.
 * @param {object} [options={}] - Dependency injection hooks for spawning, timing, and exit callbacks.
 * @returns {{
 *   getEncoderStatus: (streamId: string) => object | null,
 *   listEncoderWorkers: () => object[],
 *   startEncoder: (stream: object, optionsForStart?: object) => object,
 *   stopAllEncoders: () => void,
 *   stopEncoder: (streamId: string) => object
 * }} The worker manager API.
 */
function createEncoderWorkerManager(config, options = {}) {
  const spawn = options.spawn || defaultSpawn;
  const getNow = options.now || (() => new Date().toISOString());
  const onEncoderExit = options.onEncoderExit || (() => {});
  const workers = new Map();

  /**
   * Converts an internal worker record into the public status shape.
   * @param {object} worker - Internal worker state stored in the manager.
   * @returns {object} A plain status object suitable for APIs and logs.
   */
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
      archivePath: worker.archivePath,
      recordingId: worker.recordingId,
      renditions: [...worker.renditions],
      commandLine: worker.commandLine,
      expectedStop: worker.expectedStop,
      running: !worker.exited,
    };
  }

  /**
   * Looks up the current encoder status for one stream.
   * @param {string} streamId - The stream identifier to inspect.
   * @returns {object | null} The current status, or null if no worker exists.
   */
  function getEncoderStatus(streamId) {
    const worker = workers.get(streamId);
    return worker ? toStatus(worker) : null;
  }

  /**
   * Returns the status of every tracked encoder worker.
   * @returns {object[]} A list of worker status objects.
   */
  function listEncoderWorkers() {
    return Array.from(workers.values()).map(toStatus);
  }

  /**
   * Starts FFmpeg for a stream unless that stream already has a running encoder.
   * @param {object} stream - Stream record that includes streamId and output metadata.
   * @param {object} [optionsForStart={}] - Optional encoder settings such as requested renditions.
   * @returns {object} The newly started or already-running worker status.
   */
  function startEncoder(stream, optionsForStart = {}) {
    const existing = getEncoderStatus(stream.streamId);
    if (existing && existing.running) {
      return existing;
    }

    const command = buildFfmpegCommand(config, stream, optionsForStart);
    const renditions = getRenditionDefinitions(command.renditions);

    ensureStreamOutputDirectories(command.outputDir, renditions);
    if (command.recordingId) {
      fs.mkdirSync(buildRecordingArchiveDir(config, command.recordingId), { recursive: true });
    }
    writeMasterPlaylist(command.outputDir, renditions);

    const child = spawn(command.command, command.args, {
      detached: process.platform !== "win32",
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });

    const worker = {
      archivePath: command.archivePath,
      child,
      commandLine: command.commandLine,
      exitCode: null,
      exitSignal: null,
      exited: false,
      expectedStop: false,
      inputUrl: command.inputUrl,
      outputDir: command.outputDir,
      pid: child.pid || null,
      recordingId: command.recordingId,
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

  /**
   * Stops the encoder worker for one stream and marks it as expected to exit.
   * @param {string} streamId - The stream identifier whose encoder should stop.
   * @returns {object} The resulting stopped status for the worker.
   */
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

  /**
   * Requests shutdown for every tracked encoder worker.
   * @returns {void}
   */
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
  OUTPUT_FRAME_RATE,
  RENDITION_DEFINITIONS,
  appendToTail,
  buildEncoderInputUrl,
  buildFfmpegCommand,
  cleanupStreamOutputDirectory,
  createEncoderWorkerManager,
  ensureStreamOutputDirectories,
  writeMasterPlaylist,
};
