# Chapter 1 Backend Stream API

This document captures the Part 4 backend API surface. The backend exposes stream metadata, lifecycle orchestration, status, and viewer session control. It does not serve HLS manifests or media segments.

## Purpose

The API gives publishers, viewers, and local tests a stable contract around the Part 3 stream metadata model.

The backend owns:

- Stream record creation.
- MediaMTX publish URL preparation.
- Per-stream encoder lifecycle metadata.
- Stream status and active/recent listing.
- One active stream per viewer session.

nginx remains responsible for serving HLS output from:

```text
backend/media/live/<streamId>/
```

The backend only returns playback URLs such as:

```text
http://<server-lan-ip>/hls/<streamId>/master.m3u8
```

## Backend Modules

The API routing lives in:

```text
backend/src/streamApi.js
```

It is mounted from:

```text
backend/src/index.js
```

Viewer session state lives in:

```text
backend/src/viewerSessions.js
```

The API uses the in-memory stream store from:

```text
backend/src/streams.js
```

This keeps API routing separate from the stream metadata model. Part 6 connects the encoder start and stop routes to the FFmpeg worker manager in `backend/src/encoderWorker.js`.

## Endpoint Summary

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/streams` | Create a stream record and return its MediaMTX publish path. |
| `POST` | `/api/streams/:streamId/publish/start` | Prepare browser publishing and return MediaMTX publish URLs. |
| `POST` | `/api/streams/:streamId/encoder/start` | Start the encoder worker for one stream. |
| `POST` | `/api/streams/:streamId/stop` | Stop one stream record, stop its encoder worker, and clear viewer sessions watching it. |
| `GET` | `/api/streams` | List active and recently active streams. |
| `GET` | `/api/streams/:streamId/status` | Return one stream status object. |
| `POST` | `/api/viewer/session` | Start or replace one viewer's active stream. |
| `DELETE` | `/api/viewer/session` | Clear one viewer's active stream. |

## Stream Creation

Request:

```http
POST /api/streams
```

Body:

```json
{
  "title": "Desk cam"
}
```

Response:

```json
{
  "streamId": "stream-alpha",
  "publishPath": "live/stream-alpha",
  "stream": {
    "streamId": "stream-alpha",
    "state": "created"
  }
}
```

The full `stream` value follows the structured status shape from `docs/Chapter-1-Backend-Stream-Metadata-Model.md`.

## Publisher Start

Request:

```http
POST /api/streams/stream-alpha/publish/start
```

Body:

```json
{
  "userId": "user-123"
}
```

Response:

```json
{
  "success": true,
  "publishPath": "live/stream-alpha",
  "publishUrl": "http://192.168.1.25:8889/live/stream-alpha/publish",
  "whipUrl": "http://192.168.1.25:8889/live/stream-alpha/whip",
  "stream": {
    "streamId": "stream-alpha",
    "state": "publishing"
  }
}
```

Allowed source states:

```text
created
publishing
```

Stopped and failed streams cannot be moved back to publishing through this endpoint in the Part 4 implementation.

## Encoder Start

Request:

```http
POST /api/streams/stream-alpha/encoder/start
```

Body:

```json
{
  "renditions": ["360p", "480p", "720p"]
}
```

Response:

```json
{
  "success": true,
  "pid": 4321,
  "renditions": ["360p", "480p", "720p"],
  "stream": {
    "streamId": "stream-alpha",
    "state": "encoding"
  }
}
```

Part 6 starts a real per-stream FFmpeg worker. The encoder status includes the process PID, MediaMTX RTSP input URL, HLS output directory, selected renditions, command line, and bounded stderr tail.

Allowed source states:

```text
publishing
encoding
live
```

Starting an encoder from `created`, `stopped`, or `failed` returns an invalid-state error.

## Stream Stop

Request:

```http
POST /api/streams/stream-alpha/stop
```

Response:

```json
{
  "success": true,
  "clearedViewerSessions": 1,
  "stream": {
    "streamId": "stream-alpha",
    "state": "stopped"
  }
}
```

Stopping one stream stops only that stream's encoder worker and updates only that stream record. If any viewer sessions are currently watching it, those sessions are cleared. HLS files are not deleted by this endpoint.

## Stream Listing

Request:

```http
GET /api/streams
```

Response:

```json
{
  "streams": [],
  "active": [],
  "recent": []
}
```

`active` contains streams in:

```text
created
publishing
encoding
live
```

`recent` contains terminal streams in:

```text
stopped
failed
```

`streams` is a combined array for clients that only need one list.

## Stream Status

Request:

```http
GET /api/streams/stream-alpha/status
```

Response:

```json
{
  "streamId": "stream-alpha",
  "title": "Desk cam",
  "state": "encoding",
  "relay": {
    "mediaMtxPath": "live/stream-alpha",
    "publishUrl": "http://192.168.1.25:8889/live/stream-alpha/publish",
    "whipUrl": "http://192.168.1.25:8889/live/stream-alpha/whip"
  },
  "output": {
    "hlsOutputDir": "D:\\Work\\OTT-Platform\\backend\\media\\live\\stream-alpha",
    "playbackUrl": "http://192.168.1.25/hls/stream-alpha/master.m3u8"
  }
}
```

The status endpoint returns the same structured object as the stream store.

## Viewer Sessions

Viewer sessions enforce one active selected stream per `viewerId`.

Start or replace request:

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

Calling the same endpoint again for the same `viewerId` replaces the previous stream and returns the old `previousStreamId`.

Clear request:

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

In Part 4, viewer sessions can start only for streams in `live` state. Part 8 will make the `live` state stricter by checking HLS output readiness.

## Error Responses

API errors use JSON responses:

```json
{
  "error": "STREAM_NOT_FOUND",
  "message": "Stream not found: stream-alpha"
}
```

Common error codes:

| Status | Code | Meaning |
| ---: | --- | --- |
| `400` | `BAD_JSON` | Request body was not valid JSON. |
| `400` | `BAD_REQUEST` | Required request data is missing or malformed. |
| `400` | `INVALID_STREAM_ID` | `streamId` failed the backend validation rule. |
| `400` | `INVALID_VIEWER_ID` | `viewerId` is empty or too long. |
| `404` | `STREAM_NOT_FOUND` | No stream record exists for the requested `streamId`. |
| `409` | `STREAM_PUBLISH_NOT_ALLOWED` | The stream cannot enter publishing from its current state. |
| `409` | `ENCODER_START_NOT_ALLOWED` | The encoder cannot start from the stream's current state. |
| `409` | `STREAM_NOT_PLAYABLE` | A viewer requested a stream that is not currently live. |

Unknown backend API routes return JSON `404` responses. No route proxies `/hls/`, `.m3u8`, or media segment requests.

## Test Coverage

The behavior is covered in:

```text
backend/test/api.test.js
```

The tests verify:

- Stream creation returns `streamId`, `publishPath`, and a status object.
- Publishing start returns MediaMTX publish and WHIP URLs.
- Encoder start records real worker metadata through an injected fake encoder manager.
- Status and listing endpoints return active and recently active streams.
- Invalid stream IDs and missing streams return useful JSON errors.
- One viewer session can start, replace its active stream, and clear it.
- Viewer sessions cannot start against a non-live stream.

Run backend verification with:

```powershell
cd backend
npm test
npm run check
```

Part 8 should mark streams `live` only after HLS readiness checks pass.

Part 10 can expand viewer sessions if the backend needs stronger browser session identity, but the one-active-stream-per-`viewerId` rule should stay intact.
