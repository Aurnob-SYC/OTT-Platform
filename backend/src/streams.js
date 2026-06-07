"use strict";

const crypto = require("node:crypto");

const { assertStreamId, buildStreamUrls } = require("./urlBuilders");

const STREAM_STATES = Object.freeze({
  CREATED: "created",
  PUBLISHING: "publishing",
  ENCODING: "encoding",
  LIVE: "live",
  STOPPED: "stopped",
  FAILED: "failed",
});

const ACTIVE_STREAM_STATES = new Set([
  STREAM_STATES.CREATED,
  STREAM_STATES.PUBLISHING,
  STREAM_STATES.ENCODING,
  STREAM_STATES.LIVE,
]);

const TERMINAL_STREAM_STATES = new Set([
  STREAM_STATES.STOPPED,
  STREAM_STATES.FAILED,
]);

const DEFAULT_RECENT_LIMIT = 20;
const MAX_GENERATE_ATTEMPTS = 10;

function nowIso() {
  return new Date().toISOString();
}

function generateStreamId() {
  return `stream-${crypto.randomBytes(12).toString("hex")}`;
}

function assertKnownState(state) {
  if (!Object.values(STREAM_STATES).includes(state)) {
    throw new Error(`Unknown stream state: ${state}`);
  }
}

function normalizeTitle(title) {
  if (title === undefined || title === null) {
    return "Untitled stream";
  }

  const value = String(title).trim();
  return value === "" ? "Untitled stream" : value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortByUpdatedAtDescending(left, right) {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function createInitialEncoderStatus() {
  return {
    state: "idle",
    pid: null,
    startedAt: null,
    stoppedAt: null,
    exitCode: null,
    exitSignal: null,
    stderrTail: "",
    inputUrl: null,
    outputDir: null,
    renditions: [],
    commandLine: null,
  };
}

function createStreamRecord(config, input, timestamp) {
  const streamUrls = buildStreamUrls(config, input.streamId);

  return {
    streamId: input.streamId,
    title: normalizeTitle(input.title),
    publisher: {
      userId: input.publisherUserId || null,
    },
    state: STREAM_STATES.CREATED,
    mediaMtxPath: streamUrls.publishPath,
    publishUrl: streamUrls.publishUrl,
    whipUrl: streamUrls.whipUrl,
    playbackUrl: streamUrls.playbackUrl,
    hlsOutputDir: streamUrls.hlsOutputDir,
    encoder: createInitialEncoderStatus(),
    error: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    publishingStartedAt: null,
    encodingStartedAt: null,
    liveAt: null,
    stoppedAt: null,
    failedAt: null,
  };
}

function toStreamStatus(record) {
  return {
    streamId: record.streamId,
    title: record.title,
    state: record.state,
    publisher: clone(record.publisher),
    relay: {
      mediaMtxPath: record.mediaMtxPath,
      publishUrl: record.publishUrl,
      whipUrl: record.whipUrl,
    },
    output: {
      hlsOutputDir: record.hlsOutputDir,
      playbackUrl: record.playbackUrl,
    },
    encoder: clone(record.encoder),
    error: record.error ? clone(record.error) : null,
    timestamps: {
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      publishingStartedAt: record.publishingStartedAt,
      encodingStartedAt: record.encodingStartedAt,
      liveAt: record.liveAt,
      stoppedAt: record.stoppedAt,
      failedAt: record.failedAt,
    },
  };
}

function createStreamStore(config, options = {}) {
  const records = new Map();
  const idGenerator = options.idGenerator || generateStreamId;
  const getNow = options.now || nowIso;

  function requireStream(streamId) {
    assertStreamId(streamId);

    const record = records.get(streamId);
    if (!record) {
      throw new Error(`Stream not found: ${streamId}`);
    }

    return record;
  }

  function createStream(input = {}) {
    let streamId = input.streamId;

    if (streamId !== undefined) {
      assertStreamId(streamId);
      if (records.has(streamId)) {
        throw new Error(`Stream already exists: ${streamId}`);
      }
    } else {
      for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt += 1) {
        const candidate = idGenerator();
        assertStreamId(candidate);

        if (!records.has(candidate)) {
          streamId = candidate;
          break;
        }
      }

      if (!streamId) {
        throw new Error("Could not generate a unique streamId.");
      }
    }

    const timestamp = getNow();
    const record = createStreamRecord(config, { ...input, streamId }, timestamp);
    records.set(streamId, record);

    return toStreamStatus(record);
  }

  function getStream(streamId) {
    return toStreamStatus(requireStream(streamId));
  }

  function hasStream(streamId) {
    assertStreamId(streamId);
    return records.has(streamId);
  }

  function updateStream(streamId, updater) {
    const record = requireStream(streamId);
    updater(record);
    record.updatedAt = getNow();
    return toStreamStatus(record);
  }

  function setStreamState(streamId, state, details = {}) {
    assertKnownState(state);

    return updateStream(streamId, (record) => {
      record.state = state;

      if (details.publisherUserId !== undefined) {
        record.publisher.userId = details.publisherUserId;
      }

      if (details.encoder !== undefined) {
        record.encoder = {
          ...record.encoder,
          ...details.encoder,
        };
      }

      if (details.error !== undefined) {
        record.error = details.error;
      }

      const timestamp = getNow();
      if (state === STREAM_STATES.PUBLISHING) record.publishingStartedAt = timestamp;
      if (state === STREAM_STATES.ENCODING) record.encodingStartedAt = timestamp;
      if (state === STREAM_STATES.LIVE) record.liveAt = timestamp;
      if (state === STREAM_STATES.STOPPED) record.stoppedAt = timestamp;
      if (state === STREAM_STATES.FAILED) record.failedAt = timestamp;
    });
  }

  function markPublishing(streamId, details = {}) {
    return setStreamState(streamId, STREAM_STATES.PUBLISHING, details);
  }

  function markEncoding(streamId, details = {}) {
    return setStreamState(streamId, STREAM_STATES.ENCODING, {
      ...details,
      encoder: {
        state: STREAM_STATES.ENCODING,
        startedAt: getNow(),
        ...(details.encoder || {}),
      },
    });
  }

  function markLive(streamId, details = {}) {
    return setStreamState(streamId, STREAM_STATES.LIVE, details);
  }

  function markStopped(streamId, details = {}) {
    return setStreamState(streamId, STREAM_STATES.STOPPED, {
      ...details,
      encoder: {
        state: STREAM_STATES.STOPPED,
        stoppedAt: getNow(),
        ...(details.encoder || {}),
      },
      error: details.error === undefined ? null : details.error,
    });
  }

  function markFailed(streamId, details = {}) {
    return setStreamState(streamId, STREAM_STATES.FAILED, {
      ...details,
      encoder: {
        state: STREAM_STATES.FAILED,
        stoppedAt: getNow(),
        ...(details.encoder || {}),
      },
      error: details.error || {
        message: "Stream failed.",
      },
    });
  }

  function listStreams(optionsForList = {}) {
    const includeRecentlyActive = optionsForList.includeRecentlyActive !== false;
    const recentLimit = optionsForList.recentLimit || DEFAULT_RECENT_LIMIT;
    const sortedRecords = Array.from(records.values()).sort(sortByUpdatedAtDescending);
    const active = sortedRecords
      .filter((record) => ACTIVE_STREAM_STATES.has(record.state))
      .map(toStreamStatus);

    if (!includeRecentlyActive) {
      return {
        active,
        recent: [],
      };
    }

    const recent = sortedRecords
      .filter((record) => TERMINAL_STREAM_STATES.has(record.state))
      .slice(0, recentLimit)
      .map(toStreamStatus);

    return {
      active,
      recent,
    };
  }

  function clear() {
    records.clear();
  }

  return {
    clear,
    createStream,
    getStream,
    hasStream,
    listStreams,
    markEncoding,
    markFailed,
    markLive,
    markPublishing,
    markStopped,
    setStreamState,
  };
}

module.exports = {
  ACTIVE_STREAM_STATES,
  STREAM_STATES,
  TERMINAL_STREAM_STATES,
  createStreamStore,
  generateStreamId,
  toStreamStatus,
};
