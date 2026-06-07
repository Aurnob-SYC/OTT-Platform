"use strict";

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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function countByState(streams) {
  return streams.reduce((counts, stream) => {
    counts[stream.state] = (counts[stream.state] || 0) + 1;
    return counts;
  }, {});
}

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
