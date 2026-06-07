# Chapter 1 Design Doc: LAN Multi-Stream Live Streaming

## Goal

Build the first working version of the OTT live streaming pipeline for local LAN use only. Multiple people on the same office network should be able to publish their own live streams at the same time, and viewers should be able to choose one active live stream to watch.

This chapter is focused on proving the live path and the stream-control model:

- Capture camera video in the browser.
- Publish the camera feed over WebRTC.
- Relay each live stream through MediaMTX.
- Keep camera capture decoupled from server-side encoding.
- Encode and package each live stream into multiple playback resolutions.
- Serve the selected stream to viewers on the LAN.
- Ensure one viewer watches only one live stream at a time.
- Trace the full path from browser camera to player.

## Architecture

```text
Publisher browser camera
  -> WebRTC publish
  -> MediaMTX relay
  -> per-stream encoder worker
  -> per-stream multi-resolution HLS output
  -> nginx cache server
  -> viewer browser player
```

The first hop is:

```text
browser -> WebRTC -> relay (MediaMTX)
```

MediaMTX is the live relay. It receives WebRTC streams from multiple publishers, keeps each stream on its own path, and gives backend encoder workers a stable place to read from. This decouples the camera from the encoder: a browser can publish to MediaMTX without knowing whether FFmpeg is currently packaging HLS, and an encoder can restart without changing the browser capture code.

The HLS output remains useful for browser playback , but the live ingest boundary moves from "FFmpeg owns the camera" to "the browser owns the camera, MediaMTX owns live relay, and FFmpeg owns encoding/package output."

## Stream Model

Every live stream has a unique `streamId`.

Example stream identity:

```text
Publisher user: user-123
Stream ID: stream-abc
MediaMTX path: live/stream-abc
Browser publish URL: http://<server-lan-ip>:8889/live/stream-abc/publish
WHIP publish URL: http://<server-lan-ip>:8889/live/stream-abc/whip
HLS output: backend/media/live/stream-abc/
Playback URL: http://<server-lan-ip>/hls/stream-abc/master.m3u8
```

Multiple publishers can be live at the same time because each publisher writes to a different MediaMTX path and each encoder worker writes to a different output directory.

One viewer can only watch one live stream at a time. This is enforced by the frontend and backend session model:

- The viewer page owns one active player instance.
- Selecting a new stream stops the current player before loading the next stream.
- The backend records at most one active viewed `streamId` per viewer session.
- The API rejects a second simultaneous watch session from the same viewer unless the previous one is stopped or replaced.

## Component Responsibilities

### 1. Publisher Browser

The publisher browser owns camera capture.

Responsibilities:

- Request camera and microphone permission with `getUserMedia`.
- Capture video and optional audio.
- Publish the media to MediaMTX over WebRTC.
- Attach the stream to a backend-created `streamId`.
- Show publish status such as connecting, live, stopped, or failed.

The browser should not run the HLS encoder. Its job is capture and WebRTC publishing only.

### 2. MediaMTX Relay

MediaMTX is the relay between browser publishers, encoder workers, and optional low-latency viewers.

Responsibilities:

- Accept WebRTC publish sessions from browser clients.
- Maintain one path per live stream, such as `live/<streamId>`.
- Allow multiple live streams to exist at the same time.
- Provide a stable source endpoint for encoder workers.
- Optionally provide direct WebRTC playback for future low-latency viewing.
- Report path/session state through logs or API where available.

MediaMTX should be treated as the live source of truth for active media paths. The backend owns stream metadata and orchestration, but MediaMTX owns the real-time media relay.

### 3. Encoder and HLS Packager

The encoder is decoupled from camera capture. It reads a stream from MediaMTX and produces browser-playable HLS.

Recommended Chapter 1 encoder behavior:

- Start one encoder worker per active stream.
- Read from the stream's MediaMTX path.
- Encode video as H.264.
- Encode audio as AAC when audio is available.
- Produce a multi-resolution HLS ladder.
- Maintain a master playlist for the stream.
- Delete old segments so disk usage stays bounded.

Recommended starter rendition ladder:

```text
360p: 640x360, 800 kbps video
480p: 854x480, 1400 kbps video
720p: 1280x720, 2800 kbps video
Audio: AAC, 128 kbps
HLS segment length: 2 seconds
Live playlist size: 5 segments
Expected HLS latency: roughly 8-15 seconds
```

The exact latency depends on encoder settings, segment duration, playlist size, player buffering, and LAN conditions.

Example output layout:

```text
backend/media/live/
  stream-abc/
    master.m3u8
    360p/
      index.m3u8
      000000.ts
    480p/
      index.m3u8
      000000.ts
    720p/
      index.m3u8
      000000.ts
  stream-def/
    master.m3u8
    360p/
    480p/
    720p/
```

### 4. Application Server

The application server should not proxy every video segment. Its job is orchestration, stream metadata, and observability.

Responsibilities:

- Create stream records.
- Authorize a publisher to publish to a specific `streamId`.
- Start and stop per-stream encoder workers.
- Track MediaMTX path names and HLS output paths.
- Expose live stream lists and per-stream status.
- Enforce one active watched stream per viewer session.
- Keep logs for publisher setup, encoder startup, MediaMTX state, and failures.

Video files should be served by nginx, not by the application server.

#### API Contract

The backend exposes the following endpoints for the frontend and CLI:

| Method | Path | Request Body | Response | Purpose |
|---|---|---|---|---|
| `POST` | `/api/streams` | `{ "title": "Desk cam" }` | `{ "streamId": "stream-abc", "publishPath": "live/stream-abc" }` | Create a stream record and publish target |
| `POST` | `/api/streams/:streamId/publish/start` | `{ "userId": "user-123" }` | `{ "success": true, "publishUrl": "http://<server-lan-ip>:8889/live/stream-abc/publish", "whipUrl": "http://<server-lan-ip>:8889/live/stream-abc/whip" }` | Prepare browser WebRTC publishing through MediaMTX |
| `POST` | `/api/streams/:streamId/encoder/start` | `{ "renditions": ["360p", "480p", "720p"] }` | `{ "success": true, "pid": 1234 }` | Start the encoder worker for one stream |
| `POST` | `/api/streams/:streamId/stop` | none | `{ "success": true }` | Stop publishing metadata and the encoder worker for one stream |
| `GET` | `/api/streams` | none | `{ "streams": [...] }` | List active and recently active streams |
| `GET` | `/api/streams/:streamId/status` | none | `{ "streamId": "stream-abc", "state": "live", "renditions": [...], "output": "..." }` | Return one stream's state |
| `POST` | `/api/viewer/session` | `{ "viewerId": "viewer-1", "streamId": "stream-abc" }` | `{ "success": true, "playbackUrl": "http://<server-lan-ip>/hls/stream-abc/master.m3u8" }` | Start or replace the viewer's single active stream |
| `DELETE` | `/api/viewer/session` | `{ "viewerId": "viewer-1" }` | `{ "success": true }` | Stop the viewer's active stream |

The backend stores stream state by `streamId`, not as one global stream. A crashed encoder for `stream-abc` must not stop `stream-def`.

#### Crash Handling

The backend monitors each encoder worker independently:

1. **Detection** - register a `close` or `exit` event on every encoder child process. When one exits with a non-zero code, capture the exit code and stderr tail.
2. **Status reflection** - the affected stream returns `state: "failed"` with the captured exit code and a truncated error message.
3. **Stream isolation** - other streams continue running when one stream fails.
4. **Stale segment cleanup** - on crash, remove partial files only inside that stream's output directory.
5. **No auto-restart** - do not automatically restart encoders in Chapter 1. A failed stream stays failed until the publisher or operator starts it again.
6. **Process group** - launch each encoder in its own process group so shutdown does not orphan encoder processes.

## Startup and Teardown Protocol

**Startup sequence:**

1. On backend launch, ensure `backend/media/live/` exists. If creation fails, log the error and refuse stream creation.
2. Start MediaMTX and confirm its WebRTC publish endpoint is reachable.
3. Clear stale HLS files from previous runs only during local development, or mark old stream directories as expired before deleting them.
4. Start the HTTP server.
5. On `POST /api/streams`, create a stream record and assign a unique MediaMTX path.
6. When the browser publisher starts, publish WebRTC to MediaMTX at that path.
7. Start the per-stream encoder worker and point it at the MediaMTX path.
8. Wait for the encoder to produce the first rendition playlists and `master.m3u8`.
9. Mark the stream `live` only after MediaMTX has a publisher and the HLS master playlist exists.

**Teardown sequence:**

1. On `POST /api/streams/:streamId/stop`, stop that stream's encoder worker.
2. Mark the stream as stopped in backend metadata.
3. End the browser publish session if it is still connected.
4. Remove or expire that stream's HLS files without touching other stream directories.
5. On backend shutdown, stop all encoder workers first, then stop or detach from MediaMTX.

## HLS Origin Directory

FFmpeg writes generated HLS files to per-stream directories:

```text
backend/media/live/<streamId>/master.m3u8
backend/media/live/<streamId>/<rendition>/index.m3u8
backend/media/live/<streamId>/<rendition>/000000.ts
```

This structure prevents concurrent streams from overwriting each other's manifests and segments. It also lets nginx serve all streams through one stable `/hls/` URL prefix.

## nginx Cache Server

nginx is the local HLS delivery layer for viewers. Even on a LAN, the cache layer matters because multiple viewers may repeatedly request the same manifest and segment files for the same selected stream.

Recommended behavior:

- Serve `.m3u8` manifests with a very short cache lifetime or no cache.
- Serve media segments with a short cache lifetime.
- Add CORS headers if the frontend is hosted on a different port.
- Expose all stream outputs under a stable LAN URL prefix.
- Do not expose directory listings.

Example playback URL:

```text
http://<server-lan-ip>/hls/<streamId>/master.m3u8
```

The checked-in Chapter 1 nginx config lives at:

```text
config/nginx/chapter-1-hls.conf
```

#### Recommended nginx Config

```nginx
server {
    listen 80;
    server_name _;

    location /hls/ {
        alias D:/Work/OTT-Platform/backend/media/live/;
        autoindex off;

        location ~ \.m3u8$ {
            add_header Cache-Control "no-cache, no-store, must-revalidate";
            add_header Access-Control-Allow-Origin "*";
        }

        location ~ \.ts$ {
            add_header Cache-Control "public, max-age=10";
            add_header Access-Control-Allow-Origin "*";
        }
    }

    location / {
        root frontend/dist;
        try_files $uri /index.html;
    }
}
```

This config assumes nginx is running on the same machine as MediaMTX, FFmpeg, and the backend. Adjust the `alias` path to match the actual absolute path on the machine.

## Viewer

The viewer is a browser page that can list active streams and play one selected stream.

Responsibilities:

- Fetch active streams from the backend.
- Start one viewer session for the selected stream.
- Load that stream's HLS `master.m3u8`.
- Allow the player to choose from the available renditions automatically, or expose a manual quality selector later.
- Stop the current player before loading another stream.

The Chapter 1 viewer should not show two live players at the same time. This keeps the browser resource profile predictable and makes the viewer session model simple.

## End-to-End Data Flow

```text
1. Publisher creates a stream in the backend.
2. Backend assigns a streamId and MediaMTX path.
3. Publisher browser captures camera media.
4. Publisher browser publishes media over WebRTC to MediaMTX.
5. MediaMTX relays the stream on live/<streamId>.
6. Encoder worker reads that stream from MediaMTX.
7. Encoder worker creates 360p, 480p, and 720p HLS renditions.
8. Encoder worker writes HLS files under backend/media/live/<streamId>/.
9. nginx serves the stream at /hls/<streamId>/master.m3u8.
10. Viewer selects one stream.
11. Backend creates or replaces the viewer's single active watch session.
12. Viewer player loads and plays the selected stream.
```

## LAN Deployment Shape

For the first milestone, all server-side components can run on one machine:

```text
Developer/server machine
  - Backend process
  - MediaMTX relay
  - One encoder worker per active stream
  - Per-stream HLS output directories
  - nginx
  - Frontend dev server or built frontend

Publisher devices on same LAN
  - Browser
  - Camera and microphone
  - Publish to MediaMTX over WebRTC

Viewer devices on same LAN
  - Browser
  - Watch one selected stream at a time
```

The server machine must allow inbound LAN traffic on the chosen ports. For example:

- Frontend: `http://<server-lan-ip>:5173`
- Backend API: `http://<server-lan-ip>:4000`
- HLS through nginx: `http://<server-lan-ip>/hls/<streamId>/master.m3u8`
- MediaMTX browser publish endpoint: `http://<server-lan-ip>:8889/live/<streamId>/publish`
- MediaMTX WHIP publish endpoint: `http://<server-lan-ip>:8889/live/<streamId>/whip`

In production-like local testing, prefer serving the built frontend and HLS through nginx so viewers need one base host. MediaMTX still remains the relay for publisher WebRTC ingest.

## Key Design Decisions

1. **Use MediaMTX as the relay.** MediaMTX gives the system a dedicated live media layer. It can accept browser WebRTC publishing, keep streams separated by path, and provide encoder workers with stable inputs.

2. **Decouple camera capture from encoding.** The browser captures and publishes media. FFmpeg reads from the relay and handles encoding/package output. This keeps camera permissions, browser capture, relay state, and encoding failures from being tangled together.

3. **Support multiple concurrent streams by streamId.** Every stream has its own MediaMTX path, encoder worker, status record, and HLS output directory. A failure in one stream should not affect another stream.

4. **Generate multiple resolutions per stream.** A small rendition ladder makes the design closer to real OTT delivery and lets viewers on weaker devices or weaker Wi-Fi choose a lower bitrate.

5. **Limit each viewer to one active stream.** Chapter 1 should prove multi-stream publishing without turning the viewer into a multi-camera wall. One active stream per viewer keeps playback behavior, bandwidth use, and session tracking simpler.

6. **Keep nginx in front of HLS files.** The application server should not serve video segments. nginx is better suited to static file delivery and short-lived caching.

## Success Criteria

Chapter 1 is complete when:

- Two or more browser publishers can live stream at the same time.
- Each publisher sends camera media through `browser -> WebRTC -> MediaMTX`.
- Each live stream has its own `streamId`, MediaMTX path, encoder worker, and HLS output directory.
- A stream is available on the LAN at `/hls/<streamId>/master.m3u8`.
- At least 360p, 480p, and 720p renditions are generated for each live stream.
- A viewer can select and watch one live stream at a time.
- Switching streams stops the previous player before starting the next one.
- The stream path can be traced as:

```text
browser camera -> WebRTC -> MediaMTX relay -> encoder/package -> HLS files -> nginx cache -> player
```

- Logs or status output can show which streams are live, which encoder processes are running, and where each stream's HLS output is written.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Browser cannot publish WebRTC to MediaMTX | Publisher cannot go live | Start with one browser and one MediaMTX path before adding multi-stream orchestration |
| Encoder cannot read from MediaMTX | HLS output is never produced | Test MediaMTX ingest and encoder input independently before wiring backend automation |
| Two streams write to the same output path | Manifests and segments overwrite each other | Require unique `streamId` directories and validate paths before starting encoders |
| One stream crash affects all streams | Other publishers are interrupted | Track one process and status record per stream |
| CPU is overloaded by multiple encoders | Streams stutter or fail | Start with a small rendition ladder and cap concurrent streams based on machine capacity |
| Manifest is cached too aggressively | Player falls behind or stalls | Configure nginx to avoid long caching for `.m3u8` files |
| Segments are deleted too quickly | Player requests missing files | Keep enough live playlist segments for player buffering |
| Viewer opens multiple streams at once | Browser and LAN bandwidth spike | Enforce one active viewer session and one player instance |
| Firewall blocks LAN access | Other devices cannot publish or view | Open only the required local ports on the server machine |

## Initial Implementation Plan

1. Install and configure MediaMTX for LAN WebRTC publishing.
2. Add backend stream records keyed by `streamId`.
3. Build a publisher page that captures camera media and publishes WebRTC to MediaMTX.
4. Add per-stream encoder orchestration that reads from MediaMTX and writes multi-resolution HLS.
5. Write HLS output into `backend/media/live/<streamId>/`.
6. Configure nginx to serve `/hls/<streamId>/master.m3u8`.
7. Build a viewer page that lists live streams and plays one selected stream.
8. Enforce one active viewed stream per viewer session.
9. Test with at least two simultaneous publishers and multiple viewers on the LAN.

## Decision Write-Up

For the first chapter I chose a MediaMTX-centered live architecture because the platform now needs to support multiple people publishing at the same time. A single FFmpeg process attached directly to a camera is too tightly coupled for that requirement. Instead, each publisher browser captures camera media and publishes it over WebRTC to a unique MediaMTX path.

MediaMTX acts as the relay and live source boundary. That lets the backend manage stream metadata while MediaMTX handles real-time media sessions. FFmpeg is still used where it is strongest: reading a stable live input, encoding predictable H.264/AAC outputs, and producing HLS playlists and segments for browser playback.

Each stream gets its own identity, relay path, encoder process, and HLS output directory. That isolation is what allows two publishers to be live at the same time without overwriting manifests or sharing process state. The viewer experience is intentionally constrained to one selected stream at a time, which keeps Chapter 1 focused on multi-stream publishing and reliable playback instead of building a multi-view monitoring wall.
