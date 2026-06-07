# Learning Concepts

This document explains the concepts introduced by this project in simple language. It should grow as the project grows.

The goal is not to be a textbook. The goal is to make each new idea feel familiar enough that you can keep building with confidence.

## Big Picture

OTT-Platform is a streaming platform. In Chapter 1, the target is live streaming on a local network.

The planned media path is:

```text
Browser camera -> WebRTC -> MediaMTX relay -> FFmpeg -> HLS files -> nginx -> Player
```

In plain English:

1. A publisher opens the browser and gives camera access.
2. The browser sends live audio/video to MediaMTX.
3. FFmpeg reads that live feed and converts it into HLS files.
4. nginx serves those HLS files to viewers.
5. A viewer opens the player and watches one selected stream.

## Full-Stack Engineering

Full-stack engineering means working across the frontend, backend, infrastructure, and data flow of an application.

In this project:

- Frontend means the React app in `frontend/`.
- Backend means the Node.js API in `backend/`.
- Infrastructure means tools like MediaMTX, FFmpeg, and nginx.
- Data flow means how stream IDs, URLs, state, and media files move between those parts.

## Frontend

The frontend is the part of the app users interact with in the browser.

This project uses:

- React for building UI components.
- TypeScript for adding types to JavaScript.
- Vite for running and building the frontend during development.

Examples in this project:

- A publisher page asks for camera and microphone access.
- A viewer page will list active streams and play one stream at a time.
- Frontend API calls go through `/api` during development.

## Backend

The backend is the server-side application code.

This project uses Node.js with CommonJS modules in `backend/`.

The backend should orchestrate streams. That means it creates stream records, returns publish URLs, tracks stream state, and starts or stops workers later.

The backend should not serve video files. HLS video delivery belongs to nginx.

## API

An API is a set of URLs that other parts of the system can call.

In this project, the frontend calls backend API routes such as:

- `POST /api/streams` to create a stream.
- `POST /api/streams/:streamId/publish/start` to prepare publishing.
- `GET /api/streams` to list streams.
- `GET /api/streams/:streamId/status` to inspect one stream.

The API returns JSON, which is a common data format for web apps.

## JSON

JSON is a text format for structured data.

Example:

```json
{
  "streamId": "stream-alpha",
  "state": "publishing"
}
```

Frontend and backend code commonly exchange data in this shape.

## Stream ID

A `streamId` is the unique name for one live stream.

Example:

```text
stream-alpha
```

The `streamId` is important because it keeps each stream isolated. Each stream gets its own:

- backend record
- MediaMTX path
- encoder worker
- HLS output folder
- playback URL

This prevents one stream failure from breaking every other stream.

## State

State means the current condition of something.

For streams, this project uses states such as:

- `created`: the stream record exists.
- `publishing`: the browser is expected to connect to MediaMTX.
- `encoding`: FFmpeg is expected to create HLS output.
- `live`: the stream should be playable.
- `stopped`: the stream was intentionally stopped.
- `failed`: something went wrong for this stream.

State helps the frontend show useful UI and helps the backend reject unsafe actions.

## LAN

LAN means local area network.

For this project, LAN usually means devices on the same Wi-Fi or local router. A phone, laptop, and desktop can all be on the same LAN.

LAN testing matters because camera publishing from another device needs URLs that other devices can reach, such as:

```text
https://192.168.0.102:8889/live/stream-alpha/publish
```

## Environment Variables

Environment variables are settings that can change between machines without changing code.

Examples in `backend/.env`:

- `LAN_HOST`
- `MEDIAMTX_WEBRTC_BASE_URL`
- `NGINX_HLS_BASE_URL`
- `HLS_MEDIA_ROOT`

These values help the backend build correct publish and playback URLs for your machine.

## Port

A port is a numbered doorway into a running service on a computer.

Chapter 1 uses these default ports:

- `5173` for the frontend dev server.
- `4000` for the backend API.
- `8889` for MediaMTX WebRTC and WHIP.
- `9997` for the MediaMTX Control API.
- `80` for nginx HLS playback.

## WebRTC

WebRTC is browser technology for sending real-time audio and video.

In this project, the publisher browser uses WebRTC to send camera media to MediaMTX.

WebRTC is useful for live capture because it is designed for low-latency media from browsers.

## WHIP

WHIP is a standard way for a browser or client to publish WebRTC media to a server.

In this project, custom publisher code can send media to:

```text
/<path>/whip
```

For a stream with ID `stream-alpha`, that becomes:

```text
/live/stream-alpha/whip
```

MediaMTX also provides a built-in browser publishing page at:

```text
/live/stream-alpha/publish
```

## MediaMTX

MediaMTX is the live media relay in Chapter 1.

The browser publishes media to MediaMTX. Later, FFmpeg reads from MediaMTX.

MediaMTX is not the backend. It is a separate media server. The backend creates stream records and URLs, but MediaMTX handles the live media connection.

## FFmpeg

FFmpeg is a command-line media tool.

In this project, FFmpeg reads a live stream from MediaMTX and creates HLS files.

FFmpeg is responsible for media processing work such as:

- encoding video as H.264
- encoding audio as AAC
- creating multiple quality levels
- writing playlist and segment files

The backend starts FFmpeg as a separate worker process for each stream.

## RTSP

RTSP is a media protocol that FFmpeg can use to read a live stream from MediaMTX.

In this repo, browser publishing uses WebRTC, but FFmpeg reads the same stream path with RTSP:

```text
rtsp://127.0.0.1:8554/live/<streamId>
```

For `stream-alpha`, that becomes:

```text
rtsp://127.0.0.1:8554/live/stream-alpha
```

This keeps the browser-facing publishing URL separate from the backend's encoder input URL.

## Encoding

Encoding means converting media into a format that players can understand.

For Chapter 1:

- Video should become H.264.
- Audio should become AAC when audio exists.

These formats are common for browser playback.

## Renditions

A rendition is one quality version of the same stream.

Examples:

- `360p`
- `480p`
- `720p`

Multiple renditions let viewers choose or automatically receive a quality level that fits their device and network.

## HLS

HLS means HTTP Live Streaming.

HLS turns a live stream into small files that can be served over normal HTTP.

An HLS stream usually includes:

- a manifest file, often ending in `.m3u8`
- media segment files, often ending in `.ts`

In this project, HLS output belongs under:

```text
backend/media/live/<streamId>/
```

## Manifest

A manifest is a playlist file that tells the player what media files exist.

In this project, the main manifest is:

```text
master.m3u8
```

The viewer playback URL should look like:

```text
http://<server-lan-ip>/hls/<streamId>/master.m3u8
```

Manifests need to stay fresh because live streams keep changing as new segments are created.

## HLS Output Readiness

HLS output readiness means the backend has checked that a stream has enough playlist files to be playable.

An encoder can be running before the viewer can play anything. In this project, that stream should stay in:

```text
encoding
```

until the HLS output exists, such as:

```text
backend/media/live/stream-alpha/master.m3u8
backend/media/live/stream-alpha/360p/index.m3u8
backend/media/live/stream-alpha/480p/index.m3u8
backend/media/live/stream-alpha/720p/index.m3u8
```

After those expected playlists exist and are not empty, the backend can mark the stream:

```text
live
```

This matters because a viewer should not receive a playback URL for a stream that FFmpeg is still warming up.

## Segment

A segment is a small chunk of video or audio.

For Chapter 1, HLS segments are planned to be about 2 seconds long.

Segments are easier to serve and cache than one giant video file.

## nginx

nginx is the web server that should serve HLS files.

In this project, nginx exposes:

```text
/hls/<streamId>/master.m3u8
```

nginx should read from:

```text
backend/media/live/<streamId>/
```

The backend should not proxy these files. This keeps video delivery separate from application orchestration.

## Proxy

A proxy forwards a request from one server to another.

During frontend development, Vite can proxy frontend `/api` calls to the backend:

```text
frontend /api -> backend http://127.0.0.1:4000
```

This makes frontend code simpler because it can call `/api/streams` instead of hard-coding the backend host.

For HLS, the project should not proxy video through the backend.

## Secure Context

A secure context means the browser considers the page safe enough for sensitive features.

Camera and microphone access usually require a secure context. `localhost` is usually allowed for local testing, but a LAN IP usually needs HTTPS.

That is why LAN publishing often uses:

```text
https://<server-lan-ip>:8889
```

instead of plain HTTP.

## Certificate

A certificate helps enable HTTPS.

For local LAN development, MediaMTX can use local certificate files such as:

```text
server.crt
server.key
```

Browsers may ask you to trust the certificate before camera publishing works from a LAN IP.

## CORS

CORS is a browser security rule for requests between different origins.

An origin includes protocol, host, and port. These are different origins:

```text
http://localhost:5173
http://localhost:4000
```

If the frontend, backend, MediaMTX, and nginx run on different origins, CORS may need to be configured so browser requests are allowed.

## In-Memory Store

An in-memory store keeps data inside the running backend process.

In Chapter 1, stream records are stored in memory. This is simpler than using a database.

The tradeoff is that records disappear when the backend restarts. That is acceptable for the current chapter.

## Worker Process

A worker process is a separate process started to do a specific job.

In this project, each active stream gets one FFmpeg encoder worker.

This keeps work isolated:

- stopping one stream stops only its worker
- one failed worker should not stop other streams
- each worker writes to its own HLS folder

## PID

A PID is a process ID. It is the operating system's number for one running process.

When the backend starts FFmpeg for a stream, it stores the FFmpeg PID on that stream's status:

```json
{
  "streamId": "stream-alpha",
  "encoder": {
    "pid": 4321
  }
}
```

The PID helps you confirm which FFmpeg process belongs to which stream.

## Stderr Tail

`stderr` is where command-line tools usually write logs and error messages.

A tail is the most recent part of a longer text.

The backend stores a bounded `stderrTail` for each encoder worker. That means it keeps the newest FFmpeg messages for one stream without letting logs grow forever in memory.

## Encoder Failure

An encoder failure means one FFmpeg worker stopped unexpectedly.

In this repo, each stream has its own FFmpeg worker. If the worker for `stream-alpha` exits with an error, the backend marks only `stream-alpha` as `failed` and stores details like the exit code and `stderrTail`.

The backend does not automatically restart failed encoders in Chapter 1. A user or operator must choose to restart the encoder or stop the stream.

The important idea is isolation:

- `stream-alpha` can fail.
- `stream-beta` can keep encoding.
- The frontend can show the failed stream without pretending every stream is broken.

## Cleanup Guard

A cleanup guard is a safety check before deleting generated files.

When an encoder fails, it may leave partial HLS files such as:

```text
backend/media/live/stream-alpha/master.m3u8
backend/media/live/stream-alpha/360p/index.m3u8
```

Before deleting those files, the backend rebuilds the expected directory from the stream ID:

```text
backend/media/live/<streamId>/
```

For `stream-alpha`, cleanup is allowed only inside:

```text
backend/media/live/stream-alpha/
```

That prevents a bug or bad path from deleting another stream's files.

## Viewer Session

A viewer session tracks what one viewer is currently watching.

Chapter 1 has a simple rule:

```text
one viewer session -> one active stream
```

If the viewer switches streams, the previous stream selection is replaced.

## Separation Of Concerns

Separation of concerns means each part of the system has a clear job.

In this project:

- Browser captures and plays media.
- Backend manages stream records and orchestration.
- MediaMTX relays live WebRTC media.
- FFmpeg encodes and packages media.
- nginx serves HLS files.

This makes the system easier to debug because each component has a boundary.

## Where To Learn Next

When a new feature introduces a new concept, add it here with:

- a short definition
- why it matters in this project
- one concrete example from the repo

Good future additions may include databases, authentication, authorization, CDN delivery, adaptive bitrate playback, observability, and deployment.
