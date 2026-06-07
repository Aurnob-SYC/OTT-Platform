# Chapter 1 HLS Output Readiness

This document captures the Part 8 readiness implementation. The backend now keeps a stream in `encoding` until usable HLS playlists exist on disk.

## Purpose

FFmpeg needs a short warmup period before the HLS output is playable. During that time, the encoder process can be running, but the viewer should not treat the stream as ready.

For Chapter 1, a stream becomes playable only after the expected HLS playlists exist:

```text
backend/media/live/<streamId>/master.m3u8
backend/media/live/<streamId>/<rendition>/index.m3u8
```

For the default ladder, the rendition playlists are:

```text
360p/index.m3u8
480p/index.m3u8
720p/index.m3u8
```

## Backend Module

Readiness checks live in:

```text
backend/src/hlsReadiness.js
```

The helper inspects the stream output directory and returns:

- whether the output is ready
- when the check ran
- the master playlist path and file status
- each expected rendition playlist path and file status
- a list of missing or unusable playlist files

Playlist files must exist and be non-empty before they count as usable.

## State Transition

Starting an encoder still marks the stream as:

```text
encoding
```

The stream changes to:

```text
live
```

only after readiness passes.

The API refreshes readiness when:

- `GET /api/streams` lists streams
- `GET /api/streams/:streamId/status` reads one stream
- `POST /api/streams/:streamId/encoder/start` starts or reuses an encoder
- `POST /api/viewer/session` tries to watch a stream

This keeps the viewer from receiving a playback URL for a stream that is still warming up.

## Status Shape

Stream status now includes readiness details under `output.readiness`:

```json
{
  "state": "encoding",
  "output": {
    "hlsOutputDir": "D:\\Work\\OTT-Platform\\backend\\media\\live\\stream-alpha",
    "playbackUrl": "http://192.168.1.25/hls/stream-alpha/master.m3u8",
    "readiness": {
      "ready": false,
      "missing": [
        "360p/index.m3u8",
        "480p/index.m3u8",
        "720p/index.m3u8"
      ]
    }
  }
}
```

When `ready` becomes `true`, the backend marks the stream `live`.

## Test Coverage

The behavior is covered in:

```text
backend/test/hlsReadiness.test.js
backend/test/api.test.js
backend/test/streams.test.js
```

The tests verify:

- initial stream status includes readiness details
- master playlist alone is not enough when rendition playlists are expected
- the stream stays `encoding` while HLS output is missing
- viewer sessions reject streams that are not HLS-ready
- status/listing refresh can move an encoding stream to `live` after output appears

Run backend verification with:

```powershell
cd backend
npm test
npm run check
```
