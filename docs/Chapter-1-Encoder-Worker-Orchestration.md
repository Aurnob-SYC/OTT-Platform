# Chapter 1 Encoder Worker Orchestration

This document captures the Part 6 encoder worker implementation. The backend now starts one FFmpeg process for one stream and keeps the process status on that stream record.

## Purpose

FFmpeg is the bridge between the MediaMTX live relay and browser-playable HLS files.

For one stream:

```text
MediaMTX RTSP path -> FFmpeg worker -> backend/media/live/<streamId>/
```

The backend still does not serve HLS files. nginx remains responsible for serving:

```text
/hls/<streamId>/master.m3u8
```

## Backend Module

Encoder orchestration lives in:

```text
backend/src/encoderWorker.js
```

It provides:

- `createEncoderWorkerManager(config)`: create a process manager for one backend process.
- `startEncoder(stream, options)`: start one FFmpeg worker for one stream.
- `stopEncoder(streamId)`: stop one stream's FFmpeg worker.
- `stopAllEncoders()`: stop every active worker during backend shutdown.
- `buildFfmpegCommand(config, stream, options)`: build the FFmpeg command for tests and debugging.
- `buildEncoderInputUrl(config, streamId)`: build the MediaMTX read URL.

## Encoder Input

The browser publisher still sends WebRTC to MediaMTX:

```text
https://<server-lan-ip>:8889/live/<streamId>/publish
```

FFmpeg reads the same MediaMTX path over RTSP from the backend machine:

```text
rtsp://127.0.0.1:8554/live/<streamId>
```

The base URL comes from:

```text
MEDIAMTX_RTSP_BASE_URL=rtsp://127.0.0.1:8554
```

This is separate from `MEDIAMTX_WEBRTC_BASE_URL` because browser publishing and backend encoding use different protocols.

## HLS Output

Before FFmpeg starts, the backend creates:

```text
backend/media/live/<streamId>/
backend/media/live/<streamId>/360p/
backend/media/live/<streamId>/480p/
backend/media/live/<streamId>/720p/
```

FFmpeg writes each rendition to its own directory:

```text
backend/media/live/<streamId>/360p/index.m3u8
backend/media/live/<streamId>/480p/index.m3u8
backend/media/live/<streamId>/720p/index.m3u8
```

The backend writes a master playlist at:

```text
backend/media/live/<streamId>/master.m3u8
```

## Renditions

The default Chapter 1 ladder is:

| Rendition | Resolution | Video bitrate |
| --- | ---: | ---: |
| `360p` | 640x360 | 800 kbps |
| `480p` | 854x480 | 1400 kbps |
| `720p` | 1280x720 | 2800 kbps |

FFmpeg encodes video with H.264 through `libx264`.

Each output maps the first audio track with optional mapping:

```text
0:a:0?
```

The question mark means FFmpeg should include audio when it exists and continue when the publisher has no audio track. When audio is present, FFmpeg encodes it as AAC at 128 kbps.

## HLS Settings

The worker starts with conservative live HLS settings:

```text
segment length: 2 seconds
live playlist size: 5 segments
segment type: MPEG-TS
flags: delete old segments, independent segments, program date time
```

This keeps disk usage bounded and gives the viewer a normal HLS output shape.

## Process Status

The stream status object records encoder details per stream:

```json
{
  "encoder": {
    "state": "encoding",
    "pid": 4321,
    "startedAt": "2026-01-01T00:00:00.000Z",
    "stoppedAt": null,
    "exitCode": null,
    "exitSignal": null,
    "stderrTail": "",
    "inputUrl": "rtsp://127.0.0.1:8554/live/stream-alpha",
    "outputDir": "D:\\Work\\OTT-Platform\\backend\\media\\live\\stream-alpha",
    "renditions": ["360p", "480p", "720p"],
    "commandLine": "ffmpeg ..."
  }
}
```

`stderrTail` is bounded so FFmpeg logs cannot grow memory forever.

## Isolation Rules

Each active stream has its own:

- FFmpeg child process.
- process PID.
- stderr tail.
- RTSP input URL.
- HLS output directory.
- rendition directories.

Stopping `stream-alpha` calls `stopEncoder("stream-alpha")` and does not touch `stream-beta`.

## Backend Shutdown

When the backend receives `SIGINT` or `SIGTERM`, it asks the encoder manager to stop all active workers before the HTTP server exits. On POSIX systems the worker is launched as a detached process group so group termination can stop children cleanly. On Windows the backend sends `SIGTERM` to the FFmpeg child process.

## Test Coverage

The behavior is covered in:

```text
backend/test/encoderWorker.test.js
backend/test/api.test.js
```

The tests verify:

- FFmpeg input URLs point at MediaMTX RTSP paths.
- The command includes H.264, AAC, 2 second segments, and a playlist size of 5.
- Each stream writes to its own HLS directory.
- Stopping one fake worker does not stop another fake worker.
- The API returns the real encoder PID/status shape through the existing endpoint.

Run backend verification with:

```powershell
cd backend
npm test
npm run check
```
