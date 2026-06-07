"use strict";

const express = require("express");

const {
  RENDITION_DEFINITIONS,
  cleanupStreamOutputDirectory,
  createEncoderWorkerManager,
} = require("./encoderWorker");
const { inspectHlsReadiness } = require("./hlsReadiness");
const { STREAM_STATES, createStreamStore } = require("./streams");
const { assertStreamId } = require("./urlBuilders");
const {
  assertViewerId,
  createViewerSessionStore,
} = require("./viewerSessions");

const DEFAULT_RENDITIONS = Object.freeze(["360p", "480p", "720p"]);
const SUPPORTED_RENDITIONS = new Set(Object.keys(RENDITION_DEFINITIONS));

class ApiError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function badRequest(message, code = "BAD_REQUEST") {
  return new ApiError(400, code, message);
}

function notFound(message, code = "NOT_FOUND") {
  return new ApiError(404, code, message);
}

function conflict(message, code = "INVALID_STATE") {
  return new ApiError(409, code, message);
}

function readOptionalString(body, key) {
  const value = body ? body[key] : undefined;
  if (value === undefined || value === null) {
    return undefined;
  }

  return String(value);
}

function readRequiredString(body, key) {
  const value = readOptionalString(body, key);
  if (value === undefined || value.trim() === "") {
    throw badRequest(`${key} is required.`);
  }

  return value.trim();
}

function readRenditions(body) {
  const value = body ? body.renditions : undefined;
  if (value === undefined) {
    return [...DEFAULT_RENDITIONS];
  }

  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((rendition) => typeof rendition !== "string" || rendition.trim() === "")
  ) {
    throw badRequest("renditions must be a non-empty array of strings.");
  }

  const renditions = value.map((rendition) => rendition.trim());
  const unsupported = renditions.filter((rendition) => !SUPPORTED_RENDITIONS.has(rendition));

  if (unsupported.length > 0) {
    throw badRequest(`Unsupported renditions: ${unsupported.join(", ")}.`);
  }

  return renditions;
}

function requireStreamStatus(streamStore, streamId) {
  try {
    return streamStore.getStream(streamId);
  } catch (error) {
    if (error.message.startsWith("Stream not found:")) {
      throw notFound(error.message, "STREAM_NOT_FOUND");
    }

    throw error;
  }
}

function assertKnownStreamId(streamId) {
  try {
    assertStreamId(streamId);
  } catch (error) {
    throw badRequest(error.message, "INVALID_STREAM_ID");
  }
}

function ensureCanStartPublishing(status) {
  if (status.state === STREAM_STATES.CREATED || status.state === STREAM_STATES.PUBLISHING) {
    return;
  }

  throw conflict(
    `Cannot start publishing for stream ${status.streamId} while it is ${status.state}.`,
    "STREAM_PUBLISH_NOT_ALLOWED",
  );
}

function ensureCanStartEncoder(status) {
  if (
    status.state === STREAM_STATES.PUBLISHING ||
    status.state === STREAM_STATES.ENCODING ||
    status.state === STREAM_STATES.LIVE ||
    status.state === STREAM_STATES.FAILED
  ) {
    return;
  }

  throw conflict(
    `Cannot start encoder for stream ${status.streamId} while it is ${status.state}.`,
    "ENCODER_START_NOT_ALLOWED",
  );
}

function ensureCanView(status) {
  if (status.state === STREAM_STATES.LIVE && status.output.readiness.ready) {
    return;
  }

  if (status.state === STREAM_STATES.LIVE) {
    throw conflict(
      `Cannot start viewer session for stream ${status.streamId} before HLS output is ready.`,
      "STREAM_NOT_PLAYABLE",
    );
  }

  throw conflict(
    `Cannot start viewer session for stream ${status.streamId} while it is ${status.state}.`,
    "STREAM_NOT_PLAYABLE",
  );
}

function buildEncoderExitMessage(event) {
  if (event.error && event.error.message) {
    return event.error.message;
  }

  if (event.exitSignal) {
    return `FFmpeg exited from signal ${event.exitSignal}.`;
  }

  return `FFmpeg exited with code ${event.exitCode}.`;
}

function createStreamApi(config, options = {}) {
  const streamStore = options.streamStore || createStreamStore(config, options.streamStoreOptions);
  const viewerSessionStore =
    options.viewerSessionStore || createViewerSessionStore(options.viewerSessionOptions);
  const encoderManager =
    options.encoderManager ||
    createEncoderWorkerManager(config, {
      ...(options.encoderManagerOptions || {}),
      onEncoderExit: (event) => {
        try {
          const current = streamStore.getStream(event.streamId);

          if (event.expectedStop || current.state === STREAM_STATES.STOPPED) {
            streamStore.markStopped(event.streamId, {
              encoder: {
                exitCode: event.exitCode,
                exitSignal: event.exitSignal,
                stderrTail: event.stderrTail,
                stoppedAt: event.stoppedAt,
              },
            });
            return;
          }

          let cleanup = null;
          let cleanupError = null;

          try {
            cleanup = cleanupStreamOutputDirectory(
              config,
              event.streamId,
              event.outputDir || current.output.hlsOutputDir,
            );
          } catch (error) {
            cleanupError = {
              message: error.message,
            };
          }

          streamStore.markFailed(event.streamId, {
            encoder: {
              exitCode: event.exitCode,
              exitSignal: event.exitSignal,
              stderrTail: event.stderrTail,
              stoppedAt: event.stoppedAt,
            },
            error: {
              code: "ENCODER_EXITED",
              message: buildEncoderExitMessage(event),
              cleanup,
              cleanupError,
            },
          });
        } catch {
          // If the stream has already disappeared in a future implementation, there is
          // no other stream to update. The failing worker stays isolated to its streamId.
        }
      },
    });
  const router = express.Router();

  function refreshHlsReadiness(status) {
    if (status.state !== STREAM_STATES.ENCODING && status.state !== STREAM_STATES.LIVE) {
      return status;
    }

    const readiness = inspectHlsReadiness(status);

    if (status.state === STREAM_STATES.ENCODING && readiness.ready) {
      return streamStore.markLive(status.streamId, {
        outputReadiness: readiness,
      });
    }

    return streamStore.updateOutputReadiness(status.streamId, readiness);
  }

  function refreshStreamStatus(streamId) {
    return refreshHlsReadiness(requireStreamStatus(streamStore, streamId));
  }

  function refreshActiveStreamReadiness() {
    const listing = streamStore.listStreams({ includeRecentlyActive: false });

    for (const stream of listing.active) {
      refreshHlsReadiness(stream);
    }
  }

  router.post("/streams", (request, response, next) => {
    try {
      const stream = streamStore.createStream({
        title: readOptionalString(request.body, "title"),
        publisherUserId: readOptionalString(request.body, "publisherUserId"),
      });

      response.status(201).json({
        streamId: stream.streamId,
        publishPath: stream.relay.mediaMtxPath,
        stream,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/streams", (request, response, next) => {
    try {
      refreshActiveStreamReadiness();
      const listing = streamStore.listStreams();

      response.status(200).json({
        streams: [...listing.active, ...listing.recent],
        active: listing.active,
        recent: listing.recent,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/streams/:streamId/status", (request, response, next) => {
    try {
      assertKnownStreamId(request.params.streamId);
      response.status(200).json(refreshStreamStatus(request.params.streamId));
    } catch (error) {
      next(error);
    }
  });

  router.post("/streams/:streamId/publish/start", (request, response, next) => {
    try {
      assertKnownStreamId(request.params.streamId);

      const current = requireStreamStatus(streamStore, request.params.streamId);
      ensureCanStartPublishing(current);

      const stream = streamStore.markPublishing(request.params.streamId, {
        publisherUserId: readOptionalString(request.body, "userId"),
      });

      response.status(200).json({
        success: true,
        publishPath: stream.relay.mediaMtxPath,
        publishUrl: stream.relay.publishUrl,
        whipUrl: stream.relay.whipUrl,
        stream,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/streams/:streamId/encoder/start", (request, response, next) => {
    try {
      assertKnownStreamId(request.params.streamId);

      const current = requireStreamStatus(streamStore, request.params.streamId);
      ensureCanStartEncoder(current);

      const renditions = readRenditions(request.body);
      const startStatus = encoderManager.startEncoder(current, { renditions });
      const markEncoderStarted =
        current.state === STREAM_STATES.LIVE ? streamStore.markLive : streamStore.markEncoding;
      const stream = markEncoderStarted(request.params.streamId, {
        encoder: {
          commandLine: startStatus.commandLine,
          exitCode: startStatus.exitCode,
          exitSignal: startStatus.exitSignal,
          inputUrl: startStatus.inputUrl,
          outputDir: startStatus.outputDir,
          pid: startStatus.pid,
          renditions: startStatus.renditions || renditions,
          startedAt: startStatus.startedAt,
          stderrTail: startStatus.stderrTail,
        },
      });
      const refreshedStream = refreshHlsReadiness(stream);

      response.status(200).json({
        success: true,
        pid: refreshedStream.encoder.pid,
        renditions: refreshedStream.encoder.renditions || renditions,
        stream: refreshedStream,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/streams/:streamId/stop", (request, response, next) => {
    try {
      assertKnownStreamId(request.params.streamId);

      requireStreamStatus(streamStore, request.params.streamId);
      const stopStatus = encoderManager.stopEncoder(request.params.streamId);
      const stream = streamStore.markStopped(request.params.streamId, {
        encoder: {
          exitCode: stopStatus.exitCode,
          exitSignal: stopStatus.exitSignal,
          stderrTail: stopStatus.stderrTail,
          stoppedAt: stopStatus.stoppedAt,
        },
      });
      const clearedViewerSessions = viewerSessionStore.clearStreamSessions(request.params.streamId);

      response.status(200).json({
        success: true,
        clearedViewerSessions,
        stream,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/viewer/session", (request, response, next) => {
    try {
      const viewerId = readRequiredString(request.body, "viewerId");
      const streamId = readRequiredString(request.body, "streamId");

      try {
        assertViewerId(viewerId);
      } catch (error) {
        throw badRequest(error.message, "INVALID_VIEWER_ID");
      }

      assertKnownStreamId(streamId);

      const stream = refreshStreamStatus(streamId);
      ensureCanView(stream);

      const result = viewerSessionStore.startOrReplaceSession({
        viewerId,
        streamId,
        playbackUrl: stream.output.playbackUrl,
      });

      response.status(200).json({
        success: true,
        viewerId,
        streamId,
        previousStreamId: result.previous ? result.previous.streamId : null,
        playbackUrl: stream.output.playbackUrl,
        session: result.session,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/viewer/session", (request, response, next) => {
    try {
      const viewerId = readRequiredString(request.query, "viewerId");

      try {
        assertViewerId(viewerId);
      } catch (error) {
        throw badRequest(error.message, "INVALID_VIEWER_ID");
      }

      const session = viewerSessionStore.getSession(viewerId);

      response.status(200).json({
        success: true,
        viewerId,
        streamId: session ? session.streamId : null,
        playbackUrl: session ? session.playbackUrl : null,
        session,
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/viewer/session", (request, response, next) => {
    try {
      const viewerId = readRequiredString(request.body, "viewerId");

      try {
        assertViewerId(viewerId);
      } catch (error) {
        throw badRequest(error.message, "INVALID_VIEWER_ID");
      }

      const stopped = viewerSessionStore.stopSession(viewerId);

      response.status(200).json({
        success: true,
        viewerId,
        stoppedStreamId: stopped ? stopped.streamId : null,
      });
    } catch (error) {
      next(error);
    }
  });

  return {
    router,
    encoderManager,
    streamStore,
    viewerSessionStore,
  };
}

function sendApiError(error, response) {
  if (error instanceof ApiError) {
    response.status(error.statusCode).json({
      error: error.code,
      message: error.message,
    });
    return;
  }

  if (error.message && error.message.startsWith("streamId must be")) {
    response.status(400).json({
      error: "INVALID_STREAM_ID",
      message: error.message,
    });
    return;
  }

  response.status(500).json({
    error: "INTERNAL_SERVER_ERROR",
    message: "Unexpected backend error.",
  });
}

module.exports = {
  ApiError,
  DEFAULT_RENDITIONS,
  createStreamApi,
  sendApiError,
};
