"use strict";

const { spawn: defaultSpawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {
  HLS_SEGMENT_SECONDS,
  MAX_STDERR_TAIL_LENGTH,
  OUTPUT_FRAME_RATE,
  RENDITION_DEFINITIONS,
  appendToTail,
  writeMasterPlaylist,
} = require("./encoderWorker");
const { buildRecordingVodOutputDir } = require("./recordingPaths");

/**
 * Returns the highest-resolution rendition from a set of rendition definitions.
 * @param {Array<{width: number, height: number}>} renditions - Renditions to inspect.
 * @returns {{width: number, height: number}} The largest rendition by pixel count.
 */
function getLargestRendition(renditions) {
  return renditions.reduce((largest, rendition) =>
    rendition.width * rendition.height > largest.width * largest.height ? rendition : largest,
  );
}

/**
 * Resolves requested rendition names into encoding definitions.
 * @param {string[]} renditionNames - Rendition names such as `360p`.
 * @returns {Array<object>} Matching rendition definitions.
 */
function getRenditionDefinitions(renditionNames) {
  return renditionNames.map((name) => {
    const definition = RENDITION_DEFINITIONS[name];
    if (!definition) {
      throw new Error(`Unsupported rendition: ${name}`);
    }

    return definition;
  });
}

/**
 * Quotes a command fragment for human-readable command lines.
 * @param {string} value - Command fragment to quote when needed.
 * @returns {string} Original or quoted fragment.
 */
function quoteCommandPart(value) {
  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Builds a video normalization filter for one concat input.
 * @param {number} inputIndex - FFmpeg input index.
 * @param {string} outputLabel - Output video label.
 * @param {{width: number, height: number}} canvas - Shared concat canvas.
 * @returns {string} Filter graph fragment.
 */
function buildVideoInputFilter(inputIndex, outputLabel, canvas) {
  return `[${inputIndex}:v:0]fps=${OUTPUT_FRAME_RATE},scale=w=${canvas.width}:h=${canvas.height}:force_original_aspect_ratio=decrease,pad=${canvas.width}:${canvas.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[${outputLabel}]`;
}

/**
 * Builds the filter graph that joins pre-roll and main content, then creates ABR renditions.
 * @param {Array<object>} renditions - Rendition definitions.
 * @returns {string} FFmpeg filter_complex value.
 */
function buildVodFilterComplex(renditions) {
  const canvas = getLargestRendition(renditions);
  const videoSplits = renditions.map((rendition) => `[v${rendition.name}in]`).join("");
  const audioSplits = renditions.map((rendition) => `[a${rendition.name}]`).join("");
  const filters = [
    buildVideoInputFilter(0, "vad", canvas),
    "[0:a:0]aformat=sample_rates=48000:channel_layouts=stereo[aad]",
    buildVideoInputFilter(1, "vmain", canvas),
    "[1:a:0]aformat=sample_rates=48000:channel_layouts=stereo[amain]",
    "[vad][aad][vmain][amain]concat=n=2:v=1:a=1[vcat][acat]",
    `[vcat]split=${renditions.length}${videoSplits}`,
    `[acat]asplit=${renditions.length}${audioSplits}`,
  ];

  for (const rendition of renditions) {
    filters.push(
      `[v${rendition.name}in]scale=w=${rendition.width}:h=${rendition.height}:force_original_aspect_ratio=decrease,pad=${rendition.width}:${rendition.height}:(ow-iw)/2:(oh-ih)/2:color=black[v${rendition.name}]`,
    );
  }

  return filters.join(";");
}

/**
 * Verifies a media source exists and has bytes.
 * @param {string} filePath - File path to inspect.
 * @param {string} code - Error code to use when invalid.
 * @param {string} label - Human-readable file label.
 * @returns {void}
 */
function assertNonEmptyFile(filePath, code, label) {
  let stats;

  try {
    stats = fs.statSync(filePath);
  } catch (error) {
    const wrapped = new Error(`${label} is missing: ${error.message}`);
    wrapped.code = code;
    throw wrapped;
  }

  if (!stats.isFile() || stats.size <= 0) {
    const error = new Error(`${label} exists but is not a non-empty file.`);
    error.code = code;
    throw error;
  }
}

/**
 * Removes any previous VOD package and recreates the rendition directories.
 * @param {string} outputDir - Validated VOD output directory.
 * @param {Array<object>} renditions - Renditions that need directories.
 * @returns {void}
 */
function prepareVodOutputDirectory(outputDir, renditions) {
  fs.rmSync(outputDir, { force: true, recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  for (const rendition of renditions) {
    fs.mkdirSync(path.join(outputDir, rendition.name), { recursive: true });
  }
}

/**
 * Builds the FFmpeg command for VOD HLS packaging with a shared pre-roll.
 * @param {object} config - Runtime configuration.
 * @param {object} recording - Recording metadata.
 * @param {object} [options={}] - Packaging options.
 * @returns {{args: string[], archivePath: string, command: string, commandLine: string, outputDir: string, prerollPath: string, recordingId: string, renditions: string[]}} Command description.
 */
function buildVodPackagingCommand(config, recording, options = {}) {
  const renditionNames = options.renditions || Object.keys(RENDITION_DEFINITIONS);
  const renditions = getRenditionDefinitions(renditionNames);
  const outputDir = buildRecordingVodOutputDir(config, recording.recordingId);
  const prerollPath = options.prerollPath || config.recordings.prerollSourcePath;
  const archivePath = recording.archivePath;
  const command = config.externalBinaries.ffmpeg;
  const args = [
    "-hide_banner",
    "-loglevel",
    "info",
    "-fflags",
    "+genpts",
    "-i",
    prerollPath,
    "-i",
    archivePath,
    "-filter_complex",
    buildVodFilterComplex(renditions),
  ];

  for (const rendition of renditions) {
    const renditionDir = path.join(outputDir, rendition.name);

    args.push(
      "-map",
      `[v${rendition.name}]`,
      "-map",
      `[a${rendition.name}]`,
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
      "0",
      "-hls_playlist_type",
      "vod",
      "-hls_flags",
      "independent_segments",
      "-hls_segment_type",
      "mpegts",
      "-hls_segment_filename",
      path.join(renditionDir, "%06d.ts"),
      path.join(renditionDir, "index.m3u8"),
    );
  }

  return {
    archivePath,
    command,
    args,
    commandLine: [command, ...args].map(quoteCommandPart).join(" "),
    outputDir,
    prerollPath,
    recordingId: recording.recordingId,
    renditions: renditions.map((rendition) => rendition.name),
  };
}

/**
 * Creates a small FFmpeg worker manager for completed VOD packaging jobs.
 * @param {object} config - Runtime configuration.
 * @param {object} [options={}] - Dependency injection hooks.
 * @returns {{getPackagingStatus: (recordingId: string) => object | null, listPackagingJobs: () => object[], startPackaging: (recording: object, optionsForStart?: object) => object}} Packager manager.
 */
function createVodPackagerManager(config, options = {}) {
  const spawn = options.spawn || defaultSpawn;
  const getNow = options.now || (() => new Date().toISOString());
  const onPackagingExit = options.onPackagingExit || (() => {});
  const jobs = new Map();

  /**
   * Converts an internal job to public status.
   * @param {object} job - Internal job record.
   * @returns {object} Public job status.
   */
  function toStatus(job) {
    return {
      archivePath: job.archivePath,
      commandLine: job.commandLine,
      exitCode: job.exitCode,
      exitSignal: job.exitSignal,
      outputDir: job.outputDir,
      pid: job.pid,
      prerollPath: job.prerollPath,
      recordingId: job.recordingId,
      renditions: [...job.renditions],
      running: !job.exited,
      startedAt: job.startedAt,
      stderrTail: job.stderrTail,
      stoppedAt: job.stoppedAt,
    };
  }

  function getPackagingStatus(recordingId) {
    const job = jobs.get(recordingId);
    return job ? toStatus(job) : null;
  }

  function listPackagingJobs() {
    return Array.from(jobs.values()).map(toStatus);
  }

  function startPackaging(recording, optionsForStart = {}) {
    const existing = getPackagingStatus(recording.recordingId);
    if (existing && existing.running) {
      return existing;
    }

    const command = buildVodPackagingCommand(config, recording, optionsForStart);
    const renditions = getRenditionDefinitions(command.renditions);

    assertNonEmptyFile(command.archivePath, "ARCHIVE_MISSING", "Recording archive file");
    assertNonEmptyFile(command.prerollPath, "PREROLL_MISSING", "Pre-roll source clip");
    prepareVodOutputDirectory(command.outputDir, renditions);
    writeMasterPlaylist(command.outputDir, renditions);

    const child = spawn(command.command, command.args, {
      detached: process.platform !== "win32",
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });

    const job = {
      archivePath: command.archivePath,
      child,
      commandLine: command.commandLine,
      exitCode: null,
      exitSignal: null,
      exited: false,
      outputDir: command.outputDir,
      pid: child.pid || null,
      prerollPath: command.prerollPath,
      recordingId: recording.recordingId,
      renditions: command.renditions,
      startedAt: getNow(),
      stderrTail: "",
      stoppedAt: null,
    };

    jobs.set(recording.recordingId, job);

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        job.stderrTail = appendToTail(job.stderrTail, chunk.toString("utf8"));
      });
    }

    child.on("error", (error) => {
      if (job.exited) {
        return;
      }

      job.exited = true;
      job.stoppedAt = getNow();
      job.stderrTail = appendToTail(job.stderrTail, error.message);
      jobs.delete(recording.recordingId);
      onPackagingExit({
        ...toStatus(job),
        error,
      });
    });

    child.on("close", (exitCode, exitSignal) => {
      if (job.exited) {
        return;
      }

      job.exited = true;
      job.exitCode = exitCode;
      job.exitSignal = exitSignal;
      job.stoppedAt = getNow();
      jobs.delete(recording.recordingId);
      onPackagingExit(toStatus(job));
    });

    return toStatus(job);
  }

  return {
    getPackagingStatus,
    listPackagingJobs,
    startPackaging,
  };
}

module.exports = {
  buildVodFilterComplex,
  buildVodPackagingCommand,
  createVodPackagerManager,
};
