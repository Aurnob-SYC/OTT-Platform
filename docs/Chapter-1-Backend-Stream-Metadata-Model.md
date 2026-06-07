# Chapter 1 Backend Stream Metadata Model

This document captures the Part 3 backend stream metadata model. The backend owns stream identity, lifecycle state, orchestration metadata, and status output. MediaMTX owns the live relay, FFmpeg owns encoding, and nginx owns HLS delivery.

## Purpose

The backend must represent multiple streams independently. A stream failure, stop, encoder exit, or future cleanup operation must affect only the matching `streamId`.

Each stream record is keyed by `streamId` and carries the paths and URLs needed by later API, publisher, encoder, and viewer work.

## Stream ID Rules

Stream IDs use the same validation as the MediaMTX path rule:

```text
[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}
```

Examples:

```text
stream-alpha
stream_2026_01
camera1
```

Invalid stream IDs are rejected before building filesystem paths or relay paths. This keeps HLS output under:

```text
backend/media/live/<streamId>/
```

Generated backend stream IDs use this shape:

```text
stream-<24 lowercase hex characters>
```

## Stream States

The in-memory model uses these lifecycle states:

| State | Meaning |
| --- | --- |
| `created` | Stream record exists and has a MediaMTX path, but publishing has not started. |
| `publishing` | Publisher start has been accepted and the browser is expected to connect to MediaMTX. |
| `encoding` | A per-stream encoder worker is expected to be reading from MediaMTX and writing HLS output. |
| `live` | HLS output is expected to be playable through nginx. Later readiness checks will make this stricter. |
| `stopped` | The stream was stopped intentionally. |
| `failed` | Publisher, encoder, or readiness work failed for this stream only. |

Active stream listing includes:

```text
created
publishing
encoding
live
```

Recently active listing includes terminal records:

```text
stopped
failed
```

## Record Shape

The store returns structured status objects shaped for future API responses:

```json
{
  "streamId": "stream-alpha",
  "title": "Desk cam",
  "state": "created",
  "publisher": {
    "userId": "user-1"
  },
  "relay": {
    "mediaMtxPath": "live/stream-alpha",
    "publishUrl": "https://192.168.0.102:8889/live/stream-alpha/publish",
    "whipUrl": "https://192.168.0.102:8889/live/stream-alpha/whip"
  },
  "output": {
    "hlsOutputDir": "D:\\Work\\OTT-Platform\\backend\\media\\live\\stream-alpha",
    "playbackUrl": "http://192.168.0.102/hls/stream-alpha/master.m3u8"
  },
  "encoder": {
    "state": "idle",
    "pid": null,
    "startedAt": null,
    "stoppedAt": null,
    "exitCode": null,
    "stderrTail": ""
  },
  "error": null,
  "timestamps": {
    "createdAt": "2026-01-01T00:00:01.000Z",
    "updatedAt": "2026-01-01T00:00:01.000Z",
    "publishingStartedAt": null,
    "encodingStartedAt": null,
    "liveAt": null,
    "stoppedAt": null,
    "failedAt": null
  }
}
```

## Backend Module

The stream store lives in:

```text
backend/src/streams.js
```

It provides:

- `createStreamStore(config)`: create an in-memory registry for one backend process.
- `createStream(input)`: create one stream record.
- `getStream(streamId)`: return one structured stream status.
- `hasStream(streamId)`: check for an existing stream record.
- `listStreams(options)`: return active and recently active streams.
- `markPublishing(streamId, details)`: move one stream to `publishing`.
- `markEncoding(streamId, details)`: move one stream to `encoding`.
- `markLive(streamId, details)`: move one stream to `live`.
- `markStopped(streamId, details)`: move one stream to `stopped`.
- `markFailed(streamId, details)`: move one stream to `failed`.

The store is intentionally in memory for Chapter 1. Persistence can be added in a later chapter without changing the stream identity or path model.

## Isolation Rules

Each stream record has its own:

- `streamId`
- MediaMTX path: `live/<streamId>`
- browser publish URL
- WHIP URL
- nginx playback URL
- HLS output directory
- encoder status object
- error object
- lifecycle timestamps

Marking `stream-alpha` as `failed` must not change `stream-beta`. Stopping one stream must not remove or mutate any other stream record.

## Test Coverage

The behavior is covered in:

```text
backend/test/streams.test.js
```

The tests verify:

- Multiple stream records can exist at the same time.
- Each stream gets a unique MediaMTX path and HLS output directory.
- Invalid and duplicate stream IDs are rejected.
- Generated stream IDs match the backend validation rules.
- Failed and stopped streams are represented without affecting unrelated streams.
- Active and recently active lists are separated.

Run backend verification with:

```powershell
cd backend
npm test
npm run check
```

## Later Parts

Part 4 should use this store when exposing stream APIs:

- `POST /api/streams`
- `POST /api/streams/:streamId/publish/start`
- `POST /api/streams/:streamId/encoder/start`
- `POST /api/streams/:streamId/stop`
- `GET /api/streams`
- `GET /api/streams/:streamId/status`

Part 6 and Part 7 should update the per-stream encoder status and error fields rather than introducing global encoder state.
