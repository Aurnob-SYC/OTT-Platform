"use strict";

/**
 * Creates a JSON logger that stamps every entry with an ISO timestamp.
 * @param {object} [options={}] - Optional logger hooks.
 * @param {(entry: object) => void} [options.write] - Function that receives each log entry.
 * @param {() => string} [options.now] - Clock function that returns the current timestamp.
 * @returns {(entry: object) => void} A logger function that writes timestamped JSON entries.
 */
function createJsonLogger(options = {}) {
  const write = options.write || ((entry) => console.log(JSON.stringify(entry)));
  const now = options.now || (() => new Date().toISOString());

  return function log(entry) {
    write({
      timestamp: now(),
      ...entry,
    });
  };
}

/**
 * Deep-clones a JSON-compatible value.
 * @param {unknown} value - Value to copy.
 * @returns {unknown} A deep copy created through JSON serialization.
 */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Counts streams by their state value.
 * @param {Array<{state: string}>} streams - Stream summaries to count.
 * @returns {Record<string, number>} An object mapping each state to its count.
 */
function countByState(streams) {
  return streams.reduce((counts, stream) => {
    counts[stream.state] = (counts[stream.state] || 0) + 1;
    return counts;
  }, {});
}

/**
 * Converts a stream record into the compact operator-facing summary shape.
 * @param {object} stream - Stream status object from the store.
 * @returns {object} A summary with only the fields needed by the operator snapshot.
 */
function toOperatorStreamSummary(stream) {
  return {
    streamId: stream.streamId,
    title: stream.title,
    state: stream.state,
    mediaMtxPath: stream.relay.mediaMtxPath,
    playbackUrl: stream.output.playbackUrl,
    hlsOutputDir: stream.output.hlsOutputDir,
    outputReady: stream.output.readiness.ready,
    readinessMissing: [...stream.output.readiness.missing],
    encoder: {
      state: stream.encoder.state,
      pid: stream.encoder.pid,
      running: stream.encoder.running === true,
      inputUrl: stream.encoder.inputUrl,
      outputDir: stream.encoder.outputDir,
      renditions: [...stream.encoder.renditions],
      exitCode: stream.encoder.exitCode,
      exitSignal: stream.encoder.exitSignal,
    },
    error: stream.error ? clone(stream.error) : null,
    updatedAt: stream.timestamps.updatedAt,
  };
}

/**
 * Builds the full operator snapshot used by admin and observability endpoints.
 * @param {object} streamStore - Stream store used to list active and recent streams.
 * @param {object} encoderManager - Encoder worker manager used to list encoder processes.
 * @param {object} [options={}] - Optional snapshot controls such as recent-limit and clock hooks.
 * @returns {object} A structured snapshot containing counts, stream summaries, and encoder workers.
 */
function buildOperatorSnapshot(streamStore, encoderManager, options = {}) {
  const listing = streamStore.listStreams({
    recentLimit: options.recentLimit,
  });
  const activeStreams = listing.active.map(toOperatorStreamSummary);
  const recentStreams = listing.recent.map(toOperatorStreamSummary);
  const encoderWorkers =
    typeof encoderManager.listEncoderWorkers === "function"
      ? encoderManager.listEncoderWorkers()
      : [];

  return {
    generatedAt: options.now ? options.now() : new Date().toISOString(),
    counts: {
      activeStreams: activeStreams.length,
      recentStreams: recentStreams.length,
      encoderWorkers: encoderWorkers.length,
      byState: countByState([...listing.active, ...listing.recent]),
    },
    activeStreams,
    recentStreams,
    encoderWorkers,
  };
}

/**
 * Picks the minimal set of stream fields needed for lifecycle logs.
 * @param {object} stream - Full stream status object.
 * @returns {object} A reduced stream representation safe for structured logs.
 */
function pickLifecycleFields(stream) {
  return {
    streamId: stream.streamId,
    title: stream.title,
    state: stream.state,
    mediaMtxPath: stream.relay.mediaMtxPath,
    hlsOutputDir: stream.output.hlsOutputDir,
    playbackUrl: stream.output.playbackUrl,
    outputReady: stream.output.readiness.ready,
    encoder: {
      state: stream.encoder.state,
      pid: stream.encoder.pid,
      inputUrl: stream.encoder.inputUrl,
      outputDir: stream.encoder.outputDir,
      renditions: [...stream.encoder.renditions],
      exitCode: stream.encoder.exitCode,
      exitSignal: stream.encoder.exitSignal,
    },
    error: stream.error ? clone(stream.error) : null,
  };
}

/**
 * Emits a structured lifecycle log entry for a stream event.
 * @param {(entry: object) => void} logger - Logger function returned by `createJsonLogger` or compatible output.
 * @param {string} event - Lifecycle event name such as `stream_created` or `encoder_started`.
 * @param {object} stream - Stream status object to log.
 * @param {object} [details={}] - Extra event-specific metadata to include in the log entry.
 * @returns {void}
 */
function logStreamLifecycle(logger, event, stream, details = {}) {
  logger({
    type: "stream.lifecycle",
    event,
    stream: pickLifecycleFields(stream),
    details,
  });
}

module.exports = {
  buildOperatorSnapshot,
  createJsonLogger,
  logStreamLifecycle,
};
