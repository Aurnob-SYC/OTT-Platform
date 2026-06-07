# Chapter 1 Encoder Failure and Cleanup Handling

This document captures the Part 7 encoder failure implementation. The backend now treats an unexpected FFmpeg exit as a failure for exactly one stream, records the recent FFmpeg error output, and removes only that stream's partial HLS output.

## Purpose

Each stream has its own encoder process and HLS directory:

```text
backend/media/live/<streamId>/
```

If one FFmpeg process crashes, the backend must not change unrelated stream records or delete unrelated HLS files. A failed stream stays failed until the user or operator explicitly restarts the encoder or stops the stream. Chapter 1 does not auto-restart encoders.

## Failure Detection

Encoder orchestration lives in:

```text
backend/src/encoderWorker.js
```

Every started child process listens for:

- `stderr` data, stored as a bounded tail.
- `error`, for spawn-level failures.
- `close`, for process exits.

The encoder manager emits one exit event with the affected `streamId`, PID, exit code or signal, stopped time, output directory, and stderr tail.

## Status Update

The API wiring in:

```text
backend/src/streamApi.js
```

handles encoder exit events:

- Expected stops mark the stream `stopped`.
- Unexpected exits mark the stream `failed`.
- The failed stream stores `exitCode`, `exitSignal`, `stderrTail`, and an `ENCODER_EXITED` error.
- No other stream record is updated.
- A later manual `POST /api/streams/:streamId/encoder/start` can move that same stream back to `encoding` and clear the old error.

Example failed status shape:

```json
{
  "streamId": "stream-alpha",
  "state": "failed",
  "encoder": {
    "state": "failed",
    "exitCode": 1,
    "exitSignal": null,
    "stderrTail": "ffmpeg could not read input"
  },
  "error": {
    "code": "ENCODER_EXITED",
    "message": "FFmpeg exited with code 1."
  }
}
```

## Cleanup Safety

Failed encoder cleanup uses:

```text
cleanupStreamOutputDirectory(config, streamId, outputDir)
```

Before deleting anything, the helper rebuilds the expected stream output path from the backend config and `streamId`. The provided output directory must match:

```text
backend/media/live/<streamId>/
```

Cleanup removes the contents inside that directory, such as `master.m3u8`, rendition playlists, and partial segment files. It leaves the stream directory itself in place and refuses to clean a directory belonging to another stream.

This protects important boundaries:

- `stream-alpha` cleanup cannot delete `stream-beta`.
- A bad or tampered output path cannot escape the HLS media root.
- Cleanup errors are recorded on the failed stream instead of affecting other streams.

## Test Coverage

The behavior is covered in:

```text
backend/test/encoderWorker.test.js
backend/test/api.test.js
```

The tests verify:

- Cleanup deletes only the failed stream's output contents.
- Cleanup refuses a mismatched stream output directory.
- Simulating one FFmpeg crash marks only that stream as `failed`.
- A second active stream remains `encoding`.
- The second stream's HLS output remains on disk.
- A failed stream does not restart automatically, but can be restarted manually through the encoder start endpoint.

Run backend verification with:

```powershell
cd backend
npm test
npm run check
```
