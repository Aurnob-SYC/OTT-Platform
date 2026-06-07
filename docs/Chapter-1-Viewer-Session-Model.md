# Chapter 1 Viewer Session Model

This document captures the Part 10 viewer session implementation. The backend now tracks one active selected stream per viewer session.

## Purpose

Chapter 1 supports multiple live streams, but each viewer should watch only one stream at a time. The viewer session model keeps that rule on the backend:

```text
viewerId -> one active streamId, or no active stream
```

If the same viewer selects another stream, the backend replaces the old selection instead of creating a second active watch session.

## Backend Module

Viewer session state lives in:

```text
backend/src/viewerSessions.js
```

The store is in memory for Chapter 1. A backend restart clears viewer sessions, which is acceptable for local LAN development.

Each session stores:

- `viewerId`
- selected `streamId`
- nginx `playbackUrl`
- `startedAt`
- `updatedAt`

The backend uses `viewerId` as the browser session identity for now. A future authenticated version can replace this with a real user/session identifier while keeping the same one-active-stream rule.

## API Behavior

### Start Or Replace

Request:

```http
POST /api/viewer/session
```

Body:

```json
{
  "viewerId": "viewer-1",
  "streamId": "stream-alpha"
}
```

The backend validates that:

- `viewerId` is a non-empty string up to 128 characters
- `streamId` has the safe stream ID shape
- the stream exists
- the stream is `live`
- HLS readiness is `ready`

Response:

```json
{
  "success": true,
  "viewerId": "viewer-1",
  "streamId": "stream-alpha",
  "previousStreamId": null,
  "playbackUrl": "http://192.168.1.25/hls/stream-alpha/master.m3u8"
}
```

The playback URL points to nginx. The backend does not serve `master.m3u8` or media segments.

Calling the endpoint again with the same `viewerId` and a different `streamId` replaces the previous selection and returns the old `previousStreamId`.

### Report Current Selection

Request:

```http
GET /api/viewer/session?viewerId=viewer-1
```

Response when a stream is active:

```json
{
  "success": true,
  "viewerId": "viewer-1",
  "streamId": "stream-alpha",
  "playbackUrl": "http://192.168.1.25/hls/stream-alpha/master.m3u8"
}
```

Response when no stream is active:

```json
{
  "success": true,
  "viewerId": "viewer-1",
  "streamId": null,
  "playbackUrl": null,
  "session": null
}
```

### Clear Current Selection

Request:

```http
DELETE /api/viewer/session
```

Body:

```json
{
  "viewerId": "viewer-1"
}
```

Response:

```json
{
  "success": true,
  "viewerId": "viewer-1",
  "stoppedStreamId": "stream-alpha"
}
```

If the viewer did not have an active stream, `stoppedStreamId` is `null`.

## Stream Stop Cleanup

When a stream is stopped through:

```http
POST /api/streams/<streamId>/stop
```

the backend clears any viewer sessions currently watching that stream and returns:

```json
{
  "success": true,
  "clearedViewerSessions": 1
}
```

This keeps stale viewer sessions from pointing at a stream that is no longer active.

## Test Coverage

The behavior is covered in:

```text
backend/test/api.test.js
```

The tests verify:

- a viewer can start a session only for a live, HLS-ready stream
- selecting a different stream replaces the previous selection
- the current selection can be reported by `viewerId`
- clearing a viewer session removes the active stream
- stopping a stream clears viewer sessions watching that stream
- playback URLs point at nginx `/hls/<streamId>/master.m3u8`

Run backend verification with:

```powershell
cd backend
npm test
npm run check
```
