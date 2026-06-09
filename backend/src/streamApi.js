"use strict";

const express = require("express");

const {
  RENDITION_DEFINITIONS,
  cleanupStreamOutputDirectory,
  createEncoderWorkerManager,
} = require("./encoderWorker");
const { inspectHlsReadiness } = require("./hlsReadiness");
const {
  buildOperatorSnapshot,
  createJsonLogger,
  logStreamLifecycle,
} = require("./observability");
const { STREAM_STATES, createStreamStore } = require("./streams");
const { assertStreamId } = require("./urlBuilders");
const {
  assertViewerId,
  createViewerSessionStore,
} = require("./viewerSessions");
const { waitForMediaMtxPathMediaFlow } = require("./mediaMtx");

const DEFAULT_RENDITIONS = Object.freeze(["360p", "480p", "720p"]);
const SUPPORTED_RENDITIONS = new Set(Object.keys(RENDITION_DEFINITIONS));

/**
 * Error type used to carry HTTP status codes and API error codes through the router.
 */
class ApiError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Creates a 400-level API error for invalid client input.
 * @param {string} message - Human-readable explanation of the problem.
 * @param {string} [code="BAD_REQUEST"] - Machine-readable API error code.
 * @returns {ApiError} A ready-to-throw API error instance.
 */
function badRequest(message, code = "BAD_REQUEST") {
  return new ApiError(400, code, message);
}

/**
 * Creates a 404-level API error for missing resources.
 * @param {string} message - Human-readable explanation of the missing resource.
 * @param {string} [code="NOT_FOUND"] - Machine-readable API error code.
 * @returns {ApiError} A ready-to-throw API error instance.
 */
function notFound(message, code = "NOT_FOUND") {
  return new ApiError(404, code, message);
}

/**
 * Creates a 409-level API error for state conflicts and invalid transitions.
 * @param {string} message - Human-readable explanation of the conflict.
 * @param {string} [code="INVALID_STATE"] - Machine-readable API error code.
 * @returns {ApiError} A ready-to-throw API error instance.
 */
function conflict(message, code = "INVALID_STATE") {
  return new ApiError(409, code, message);
}

/**
 * Reads an optional field and coerces it to a string when present.
 * @param {object} body - Request body or query object.
 * @param {string} key - Field name to read.
 * @returns {string | undefined} The string value, or undefined when the field is missing.
 */
function readOptionalString(body, key) {
  const value = body ? body[key] : undefined;
  if (value === undefined || value === null) {
    return undefined;
  }

  return String(value);
}

/**
 * Reads an optional boolean field and validates that it is actually a boolean.
 * @param {object} body - Request body or query object.
 * @param {string} key - Field name to read.
 * @param {boolean} [fallback=false] - Value to return when the field is missing.
 * @returns {boolean} The parsed boolean or the fallback value.
 */
function readOptionalBoolean(body, key, fallback = false) {
  const value = body ? body[key] : undefined;
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  throw badRequest(`${key} must be true or false.`);
}

/**
 * Reads a required string field and rejects empty values.
 * @param {object} body - Request body or query object.
 * @param {string} key - Field name to read.
 * @returns {string} A trimmed, non-empty string.
 */
function readRequiredString(body, key) {
  const value = readOptionalString(body, key);
  if (value === undefined || value.trim() === "") {
    throw badRequest(`${key} is required.`);
  }

  return value.trim();
}

/**
 * Reads and validates the renditions array from an API request.
 * @param {object} body - Request body or query object.
 * @returns {string[]} A validated list of supported rendition names.
 */
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

/**
 * Loads the current stream status and converts missing-stream errors into API errors.
 * @param {object} streamStore - Stream store used to fetch the stream record.
 * @param {string} streamId - Stream identifier to look up.
 * @returns {object} The current stream status.
 */
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

/**
 * Validates that a stream identifier matches the platform's allowed format.
 * @param {string} streamId - The stream identifier to check.
 * @returns {void}
 */
function assertKnownStreamId(streamId) {
  try {
    assertStreamId(streamId);
  } catch (error) {
    throw badRequest(error.message, "INVALID_STREAM_ID");
  }
}

/**
 * Verifies that publishing may start from the stream's current state.
 * @param {object} status - Current stream status.
 * @returns {void}
 */
function ensureCanStartPublishing(status) {
  if (status.state === STREAM_STATES.CREATED || status.state === STREAM_STATES.PUBLISHING) {
    return;
  }

  throw conflict(
    `Cannot start publishing for stream ${status.streamId} while it is ${status.state}.`,
    "STREAM_PUBLISH_NOT_ALLOWED",
  );
}

/**
 * Verifies that the encoder can be started from the stream's current state.
 * @param {object} status - Current stream status.
 * @returns {void}
 */
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

/**
 * Verifies that a viewer session can be opened for the current stream state.
 * @param {object} status - Current stream status.
 * @returns {void}
 */
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

/**
 * Builds a human-readable explanation for why FFmpeg exited.
 * @param {object} event - Encoder exit event emitted by the worker manager.
 * @returns {string} A short message describing the exit reason.
 */
function buildEncoderExitMessage(event) {
  if (event.error && event.error.message) {
    return event.error.message;
  }

  if (event.exitSignal) {
    return `FFmpeg exited from signal ${event.exitSignal}.`;
  }

  return `FFmpeg exited with code ${event.exitCode}.`;
}

/**
 * Creates the Express router and supporting managers for stream, encoder, and viewer APIs.
 * @param {object} config - Runtime configuration for the platform.
 * @param {object} [options={}] - Optional dependency injection and store overrides.
 * @returns {{
 *   router: import("express").Router,
 *   encoderManager: object,
 *   streamStore: object,
 *   viewerSessionStore: object
 * }} The API surface used by the HTTP server.
 */
function createStreamApi(config, options = {}) {
  const streamStore = options.streamStore || createStreamStore(config, options.streamStoreOptions);
  const viewerSessionStore =
    options.viewerSessionStore || createViewerSessionStore(options.viewerSessionOptions);
  const logger =
    options.logger === undefined
      ? createJsonLogger()
      : typeof options.logger === "function"
        ? options.logger
        : () => {};
  const encoderManager =
    options.encoderManager ||
    createEncoderWorkerManager(config, {
      ...(options.encoderManagerOptions || {}),
      onEncoderExit: (event) => {
        try {
          const current = streamStore.getStream(event.streamId);

          if (event.expectedStop || current.state === STREAM_STATES.STOPPED) {
            const stopped = streamStore.markStopped(event.streamId, {
              encoder: {
                exitCode: event.exitCode,
                exitSignal: event.exitSignal,
                running: false,
                stderrTail: event.stderrTail,
                stoppedAt: event.stoppedAt,
              },
            });
            logStreamLifecycle(logger, "encoder_stopped", stopped, {
              expectedStop: event.expectedStop,
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

          const failed = streamStore.markFailed(event.streamId, {
            encoder: {
              exitCode: event.exitCode,
              exitSignal: event.exitSignal,
              running: false,
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
          logStreamLifecycle(logger, "encoder_failed", failed, {
            expectedStop: event.expectedStop,
          });
        } catch {
          // If the stream has already disappeared in a future implementation, there is
          // no other stream to update. The failing worker stays isolated to its streamId.
        }
      },
    });
  const mediaMtxPathWaiter = options.mediaMtxPathWaiter || waitForMediaMtxPathMediaFlow;
  const router = express.Router();

  /**
   * Re-checks HLS readiness and promotes an encoding stream to live when playlists appear.
   * @param {object} status - Current stream status to refresh.
   * @returns {object} The original or updated stream status.
   */
  function refreshHlsReadiness(status) {
    if (status.state !== STREAM_STATES.ENCODING && status.state !== STREAM_STATES.LIVE) {
      return status;
    }

    const readiness = inspectHlsReadiness(status);

    if (status.state === STREAM_STATES.ENCODING && readiness.ready) {
      const stream = streamStore.markLive(status.streamId, {
        outputReadiness: readiness,
      });
      logStreamLifecycle(logger, "hls_ready", stream, {
        missing: readiness.missing,
      });
      return stream;
    }

    return streamStore.updateOutputReadiness(status.streamId, readiness);
  }

  /**
   * Reloads a stream by id and refreshes its HLS readiness before returning it.
   * @param {string} streamId - The stream identifier to refresh.
   * @returns {object} The refreshed stream status.
   */
  function refreshStreamStatus(streamId) {
    return refreshHlsReadiness(requireStreamStatus(streamStore, streamId));
  }

  /**
   * Refreshes HLS readiness for every currently active stream.
   * @returns {void}
   */
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
      logStreamLifecycle(logger, "stream_created", stream);

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
      logStreamLifecycle(logger, "publish_started", stream);

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

  router.post("/streams/:streamId/encoder/start", async (request, response, next) => {
    try {
      assertKnownStreamId(request.params.streamId);

      const current = requireStreamStatus(streamStore, request.params.streamId);
      ensureCanStartEncoder(current);

      if (readOptionalBoolean(request.body, "waitForRelayReady", false)) {
        const relayStatus = await mediaMtxPathWaiter(config, request.params.streamId);

        if (!relayStatus.ready) {
          throw conflict(
            `MediaMTX path ${current.relay.mediaMtxPath} did not receive media before the encoder start timeout.`,
            "MEDIAMTX_MEDIA_NOT_FLOWING",
          );
        }
      }

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
          running: startStatus.running === true,
          startedAt: startStatus.startedAt,
          stderrTail: startStatus.stderrTail,
        },
      });
      logStreamLifecycle(logger, "encoder_started", stream, {
        renditions,
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
          running: false,
          stderrTail: stopStatus.stderrTail,
          stoppedAt: stopStatus.stoppedAt,
        },
      });
      const clearedViewerSessions = viewerSessionStore.clearStreamSessions(request.params.streamId);
      logStreamLifecycle(logger, "stream_stopped", stream, {
        clearedViewerSessions,
      });

      response.status(200).json({
        success: true,
        clearedViewerSessions,
        stream,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/operator/status", (request, response, next) => {
    try {
      refreshActiveStreamReadiness();
      response.status(200).json({
        ok: true,
        operator: buildOperatorSnapshot(streamStore, encoderManager),
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

/**
 * Converts backend errors into consistent JSON HTTP responses.
 * @param {unknown} error - Error thrown from a route handler.
 * @param {import("express").Response} response - Express response object used to send the error.
 * @returns {void}
 */
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
