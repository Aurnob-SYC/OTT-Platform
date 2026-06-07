"use strict";

const VIEWER_ID_MAX_LENGTH = 128;

function nowIso() {
  return new Date().toISOString();
}

function assertViewerId(viewerId) {
  if (
    typeof viewerId !== "string" ||
    viewerId.trim() === "" ||
    viewerId.length > VIEWER_ID_MAX_LENGTH
  ) {
    throw new Error("viewerId must be a non-empty string up to 128 characters.");
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createViewerSessionStore(options = {}) {
  const sessions = new Map();
  const getNow = options.now || nowIso;

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

  function stopSession(viewerId) {
    assertViewerId(viewerId);

    const session = sessions.get(viewerId) || null;
    sessions.delete(viewerId);

    return session ? clone(session) : null;
  }

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

  function getSession(viewerId) {
    assertViewerId(viewerId);

    const session = sessions.get(viewerId);
    return session ? clone(session) : null;
  }

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
