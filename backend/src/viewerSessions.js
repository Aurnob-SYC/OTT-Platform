"use strict";

const VIEWER_ID_MAX_LENGTH = 128;

/**
 * Returns the current time in ISO-8601 format.
 * @returns {string} The current timestamp string.
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * Validates that a viewer id is a short, non-empty string.
 * @param {string} viewerId - Viewer identifier to validate.
 * @returns {void}
 */
function assertViewerId(viewerId) {
  if (
    typeof viewerId !== "string" ||
    viewerId.trim() === "" ||
    viewerId.length > VIEWER_ID_MAX_LENGTH
  ) {
    throw new Error("viewerId must be a non-empty string up to 128 characters.");
  }
}

/**
 * Deep-clones a JSON-compatible value.
 * @param {unknown} value - Value to duplicate.
 * @returns {unknown} A deep copy created through JSON serialization.
 */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Creates an in-memory store for viewer playback sessions.
 * @param {object} [options={}] - Optional hooks for time control.
 * @returns {object} A session store with create, lookup, and removal helpers.
 */
function createViewerSessionStore(options = {}) {
  const sessions = new Map();
  const getNow = options.now || nowIso;

  /**
   * Starts a new session for a viewer or replaces the viewer's current session.
   * @param {object} input - Session input containing viewer id, stream id, and playback URL.
   * @returns {{session: object, previous: object | null}} The new session and any replaced prior session.
   */
  function startOrReplaceSession(input) {
    assertViewerId(input.viewerId);

    const timestamp = getNow();
    const previous = sessions.get(input.viewerId) || null;
    const session = {
      viewerId: input.viewerId,
      streamId: input.streamId,
      playbackUrl: input.playbackUrl,
      startedAt: previous ? previous.startedAt : timestamp,
      updatedAt: timestamp,
    };

    sessions.set(input.viewerId, session);

    return {
      session: clone(session),
      previous: previous ? clone(previous) : null,
    };
  }

  /**
   * Stops and removes one viewer session.
   * @param {string} viewerId - Viewer identifier whose session should end.
   * @returns {object | null} The removed session, or null if none existed.
   */
  function stopSession(viewerId) {
    assertViewerId(viewerId);

    const session = sessions.get(viewerId) || null;
    sessions.delete(viewerId);

    return session ? clone(session) : null;
  }

  /**
   * Removes every session that points at a specific stream.
   * @param {string} streamId - Stream identifier used to select sessions for removal.
   * @returns {number} The number of cleared viewer sessions.
   */
  function clearStreamSessions(streamId) {
    let cleared = 0;

    for (const [viewerId, session] of sessions.entries()) {
      if (session.streamId === streamId) {
        sessions.delete(viewerId);
        cleared += 1;
      }
    }

    return cleared;
  }

  /**
   * Looks up the current session for one viewer.
   * @param {string} viewerId - Viewer identifier to inspect.
   * @returns {object | null} The current session, or null when none exists.
   */
  function getSession(viewerId) {
    assertViewerId(viewerId);

    const session = sessions.get(viewerId);
    return session ? clone(session) : null;
  }

  /**
   * Removes every viewer session from the store.
   * @returns {void}
   */
  function clear() {
    sessions.clear();
  }

  return {
    clear,
    clearStreamSessions,
    getSession,
    startOrReplaceSession,
    stopSession,
  };
}

module.exports = {
  assertViewerId,
  createViewerSessionStore,
};
