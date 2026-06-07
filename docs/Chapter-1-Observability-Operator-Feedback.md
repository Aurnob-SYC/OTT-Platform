# Chapter 1 Observability and Operator Feedback

This document captures the Part 12 observability implementation. The backend now emits structured lifecycle logs and exposes a compact operator status endpoint for local Chapter 1 debugging.

## Purpose

Chapter 1 has several moving parts:

```text
publisher browser -> MediaMTX path -> FFmpeg worker -> HLS output -> nginx playback URL
```

When something fails, the developer needs to trace one stream across those parts without guessing which process, path, or output directory belongs to it.

The trace key is always:

```text
streamId
```

## Structured Lifecycle Logs

The backend emits JSON log entries for stream lifecycle events:

- `stream_created`
- `publish_started`
- `encoder_started`
- `hls_ready`
- `stream_stopped`
- `encoder_stopped`
- `encoder_failed`

Each lifecycle log includes:

- `streamId`
- current stream `state`
- MediaMTX path
- HLS output directory
- nginx playback URL
- encoder PID and state when available
- recent error details when a stream failed

Example shape:

```json
{
  "timestamp": "2026-01-01T00:00:00.000Z",
  "type": "stream.lifecycle",
  "event": "encoder_started",
  "stream": {
    "streamId": "stream-alpha",
    "state": "encoding",
    "mediaMtxPath": "live/stream-alpha",
    "hlsOutputDir": "D:\\Work\\OTT-Platform\\backend\\media\\live\\stream-alpha",
    "playbackUrl": "http://192.168.1.25/hls/stream-alpha/master.m3u8",
    "encoder": {
      "pid": 4321,
      "state": "encoding"
    }
  }
}
```

The implementation lives in:

```text
backend/src/observability.js
```

## Operator Status Endpoint

The backend exposes:

```http
GET /api/operator/status
```

This endpoint is for local operators and developers. It does not serve video files. It summarizes stream and worker state in JSON:

```json
{
  "ok": true,
  "operator": {
    "counts": {
      "activeStreams": 1,
      "recentStreams": 0,
      "encoderWorkers": 1
    },
    "activeStreams": [
      {
        "streamId": "stream-alpha",
        "state": "encoding",
        "mediaMtxPath": "live/stream-alpha",
        "hlsOutputDir": "D:\\Work\\OTT-Platform\\backend\\media\\live\\stream-alpha",
        "outputReady": false,
        "encoder": {
          "pid": 4321,
          "running": true
        }
      }
    ],
    "encoderWorkers": [
      {
        "streamId": "stream-alpha",
        "pid": 4321,
        "running": true
      }
    ]
  }
}
```

The endpoint refreshes HLS readiness before returning the snapshot, so an encoding stream can become `live` when the expected playlists exist.

## Status Responses

The normal stream status endpoint remains the detailed per-stream debug view:

```http
GET /api/streams/<streamId>/status
```

It includes:

- `relay.mediaMtxPath`
- `output.hlsOutputDir`
- `output.playbackUrl`
- `output.readiness`
- `encoder.pid`
- `encoder.inputUrl`
- `encoder.outputDir`
- `encoder.stderrTail`
- `error`

This is enough to trace one stream from relay path to FFmpeg process to HLS output.

## Stderr Tail Bound

FFmpeg can produce a lot of stderr output. The backend keeps only a bounded tail per encoder worker instead of keeping every line forever.

The limit is defined in:

```text
backend/src/encoderWorker.js
```

Current value:

```text
8 KiB per encoder worker
```

This keeps recent errors available while preventing unbounded memory growth.

## Test Coverage

The behavior is covered in:

```text
backend/test/api.test.js
backend/test/encoderWorker.test.js
```

The tests verify:

- lifecycle logs include `streamId`
- the operator endpoint reports active streams and encoder workers
- encoder failure logs and status are isolated to the affected stream
- stderr tails stay bounded

Run backend verification with:

```powershell
cd backend
npm test
npm run check
```
