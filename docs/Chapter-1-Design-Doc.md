# Chapter 1 Design Doc: LAN Live Streaming With HLS

## Goal

Build the first working version of the OTT live streaming pipeline for local LAN use only. A small group of viewers on the same office network should be able to open a browser player or media player and watch the same live stream at the same time.

This chapter is intentionally focused on the HLS delivery path:

- Encode a live video source.
- Package the encoded stream into HLS segments and a manifest.
- Serve HLS through a local cache layer.
- Play the stream from another device on the LAN.
- Trace the full path from source to player.

## Architecture

```text
Camera or test source
  -> FFmpeg encoder / HLS packager
  -> HLS origin directory
  -> nginx cache server
  -> browser or media player viewers
```

This architecture is optimized for the Chapter 1 milestone: reliable local-network live playback for multiple viewers using HLS. Each viewer requests the same manifest and segment files through nginx, which keeps video delivery cacheable, simple to test, and close to the delivery pattern used by larger OTT systems.

## Component Responsibilities

### 1. Source

The source can be one of these during Chapter 1:

- A webcam or capture device.
- A local video file looped by FFmpeg.
- FFmpeg's built-in test source for repeatable development.

The first implementation should support a deterministic test source or looped local file so the pipeline can be tested without depending on a physical camera.

### 2. FFmpeg Encoder and HLS Packager

FFmpeg is responsible for turning the source into browser-playable HLS:

- Decode the incoming source.
- Encode video as H.264.
- Encode audio as AAC when audio is available.
- Produce `.ts` or fragmented MP4 segments.
- Maintain a live `.m3u8` manifest.
- Delete old segments so disk usage stays bounded.

Recommended starter profile:

```text
Video codec: H.264
Audio codec: AAC
Resolution: 720p for LAN testing
Frame rate: 25 or 30 fps
HLS segment length: 2 seconds
Live playlist size: 5 segments
Expected latency: roughly 8-15 seconds
```

The exact latency depends on encoder settings, segment duration, playlist size, player buffering, and LAN conditions.

### 3. Application Server

The application server should not proxy every video segment in Chapter 1. Its job is orchestration and observability:

- Start and stop the FFmpeg process.
- Expose stream status such as running, stopped, source type, uptime, and output path.
- Optionally expose a simple control API for the frontend.
- Keep logs for FFmpeg startup and failures.

Video files should be served by nginx, not by the application server, because static segment delivery is exactly what nginx is good at.

#### API Contract

The backend exposes the following endpoints for the frontend and CLI:

| Method | Path | Request Body | Response | Purpose |
|---|---|---|---|---|
| `POST` | `/api/stream/start` | `{ "source": "test" \| "file" \| "camera" }` | `{ "success": true, "pid": 1234 }` | Start FFmpeg with the given source type |
| `POST` | `/api/stream/stop` | — | `{ "success": true }` | Stop the running FFmpeg process |
| `GET` | `/api/stream/status` | — | `{ "running": bool, "source": string, "uptime": number, "output": string }` | Return current stream state |

The `status` endpoint is the most important — the frontend polls it for display. `uptime` is in seconds since FFmpeg started; `output` is the HLS directory path. `running: false` with no PID means the stream was never started or has been stopped cleanly; `running: false` with a non-null `pid` signals a crash (FFmpeg exited unexpectedly).

#### Crash Handling

The backend monitors the FFmpeg child process and handles failures:

1. **Detection** — register a `close` / `exit` event on the child process. When FFmpeg exits with a non-zero code, capture the exit code and stderr tail.
2. **Status reflection** — the `status` endpoint returns `running: false` with the captured exit code and a truncated error message so the frontend can display a failure state.
3. **Stale segment cleanup** — on crash, the backend removes any partial `.ts` segment and rewrites `index.m3u8` to an empty manifest (or a status placeholder). This prevents players from fetching a manifest that lists missing segments.
4. **No auto-restart** — do not automatically restart FFmpeg in Chapter 1. A crashed stream stays stopped until the user explicitly calls `POST /api/stream/start` again. Auto-restart masks the failure without fixing it and complicates state management.
5. **Process group** — launch FFmpeg in its own process group so killing the backend does not orphan the encoder.

### 4. Startup and Teardown Protocol

**Startup sequence:**

1. On backend launch, ensure `backend/media/live/` exists (create if missing). If creation fails, log the error and refuse API requests.
2. Clear any stale HLS files from a previous run — remove all `.ts`, `.m3u8`, and `.mp4` files in the directory so players never serve stale segments.
3. Start the HTTP server. The `/api/stream/start` endpoint is now reachable.
4. On `POST /api/stream/start`, spawn FFmpeg as a child process, record the PID and start time, and write HLS output to the media directory.
5. Wait several seconds for FFmpeg to produce the first segment, then confirm the manifest exists. If it does not, set status to `failed` and log FFmpeg stderr.

**Teardown sequence:**

1. On `POST /api/stream/stop`, send `SIGTERM` to the FFmpeg child process.
2. Wait up to 5 seconds for graceful exit. If FFmpeg has not exited, send `SIGKILL`.
3. Reset status to `running: false`, clear PID and uptime.
4. On backend shutdown (`SIGTERM` / `SIGINT`), kill the FFmpeg child process first, then exit.

### 5. HLS Origin Directory

FFmpeg writes generated HLS files to a local directory, for example:

```text
backend/media/live/
  index.m3u8
  segment_00001.ts
  segment_00002.ts
  segment_00003.ts
```

This directory acts as the local origin for nginx. It should be writable by the backend or FFmpeg process and readable by nginx.

### 5. nginx Cache Server

nginx is the local delivery layer for viewers. Even on a LAN, the cache layer matters because multiple viewers will repeatedly request the same manifest and segment files. nginx can handle those static requests more efficiently than the application server and keeps the future architecture closer to a real OTT origin/cache/CDN model.

Recommended behavior:

- Serve `.m3u8` manifests with a very short cache lifetime or no cache.
- Serve media segments with a short cache lifetime.
- Add CORS headers if the frontend is hosted on a different port.
- Expose the stream at a stable LAN URL.

Example playback URL:

```text
http://<server-lan-ip>/hls/index.m3u8
```

#### Recommended nginx Config

```nginx
server {
    listen 80;
    server_name _;

    # HLS stream — media segments
    location /hls/ {
        alias backend/media/live/;

        # m3u8 manifest: no caching so players always fetch the latest
        location ~ \.m3u8$ {
            add_header Cache-Control "no-cache, no-store, must-revalidate";
            add_header Access-Control-Allow-Origin "*";
        }

        # ts segments: brief cache for repeated viewer requests
        location ~ \.ts$ {
            add_header Cache-Control "public, max-age=10";
            add_header Access-Control-Allow-Origin "*";
        }
    }

    # Optional — serve built frontend from nginx in production-like testing
    location / {
        root frontend/dist;
        try_files $uri /index.html;
    }
}
```

This config assumes nginx is running on the same machine as FFmpeg and the backend, and that the `backend/media/live/` path is relative to the nginx working directory or adjusted with an absolute path. The CORS `Access-Control-Allow-Origin: *` headers ensure the player can fetch segments when the frontend is served from a different port (e.g., Vite dev server on `:5173`).

### 6. Viewer

The viewer can be:

- A browser page using `hls.js` for browsers that do not support HLS natively.
- Safari or another browser with native HLS support.
- VLC or another media player pointed directly at the `.m3u8` URL.

The frontend should keep Chapter 1 simple: one player page, a visible stream URL, and basic status information from the application server.

## End-to-End Data Flow

```text
1. Source produces live video.
2. FFmpeg reads the source.
3. FFmpeg encodes the stream into H.264/AAC.
4. FFmpeg writes live HLS manifest and segment files.
5. nginx reads the HLS files from disk.
6. Viewers request the manifest from nginx.
7. Viewers repeatedly request the listed media segments.
8. The player buffers a few segments and plays the live stream.
```

## LAN Deployment Shape

For the first milestone, all server-side components can run on one machine:

```text
Developer/server machine
  - Backend process
  - FFmpeg process
  - HLS output directory
  - nginx
  - Frontend dev server or built frontend

Viewer devices on same LAN
  - Browser or VLC
  - Access stream by server LAN IP
```

The server machine must allow inbound LAN traffic on the chosen ports. For example:

- Frontend: `http://<server-lan-ip>:5173`
- Backend API: `http://<server-lan-ip>:4000`
- HLS through nginx: `http://<server-lan-ip>/hls/index.m3u8`

In production-like local testing, prefer serving the built frontend and HLS through nginx so viewers need one base host.

## Key Design Decisions

1. **Use HLS for Chapter 1 delivery.** HLS is segment-based, widely supported, and naturally supports many viewers requesting the same content. It is a good fit for reliable LAN playback where several viewers need to watch the same live feed.

2. **Use FFmpeg for encode and packaging.** Encoding is required because browsers and media players need predictable codecs and container formats. FFmpeg is the standard local tool for this stage because it can ingest many source types, encode H.264/AAC, and write HLS output directly.

3. **Put nginx in front of the HLS files.** The application server should not spend its time serving every media segment. nginx is better suited to static file delivery and short-lived caching. This also mirrors the later OTT pattern where an origin/cache layer sits between packaging and viewers.

4. **Run locally first, but keep boundaries clear.** FFmpeg, backend, HLS storage, nginx, and frontend can all run on one LAN machine for now. The design still separates responsibilities so each component can be replaced or scaled later.

## Success Criteria

Chapter 1 is complete when:

- A live `.m3u8` URL is available on the LAN.
- A browser or VLC can play the stream from another device.
- Several viewers can watch at the same time without the backend becoming the bottleneck.
- The stream path can be traced as:

```text
source -> FFmpeg encode/package -> HLS files -> nginx cache -> player
```

- Logs or status output can show whether FFmpeg is running and where the HLS output is being written.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Browser cannot play the stream | Viewers see a blank player | Use `hls.js` in the frontend and test with VLC as a control |
| FFmpeg source differs by machine | Stream startup fails | Start with a test source or looped file before adding webcam capture |
| Manifest is cached too aggressively | Player falls behind or stalls | Configure nginx to avoid long caching for `.m3u8` files |
| Segments are deleted too quickly | Player requests missing files | Keep enough live playlist segments for player buffering |
| Firewall blocks LAN access | Other devices cannot connect | Open only the required local ports on the server machine |

## Initial Implementation Plan

1. Create an FFmpeg command that generates a live HLS stream from a test source or looped file.
2. Add backend controls to start, stop, and inspect the FFmpeg process.
3. Write HLS output into a known local media directory.
4. Configure nginx to serve `/hls/` from that directory with correct content types and cache behavior.
5. Build a simple frontend player page that loads the nginx HLS URL.
6. Test with at least three simultaneous viewers on the LAN.

## Decision Write-Up

For the first chapter I chose an HLS-based live streaming architecture. The goal is to prove that a live stream can be encoded, packaged, cached, and watched by several people on the local network. HLS fits that goal because it turns the live stream into a manifest plus small media segments. Each viewer can independently request the same files, and nginx can serve those files efficiently from a local cache layer.

FFmpeg is the encoder and packager because raw camera or browser video is not enough for reliable playback. The stream needs predictable codecs, a stable segment format, and a live playlist that players understand. The application server stays focused on process control and status reporting rather than serving every video segment. That keeps the video delivery path simple and avoids making the backend the bottleneck when multiple viewers join.

nginx sits in front of the generated HLS files because even a small LAN stream benefits from a dedicated static delivery layer. The manifest should remain fresh, while media segments can be cached briefly. This design is small enough to run on one machine but still teaches the same basic path used by larger OTT systems: source, encode, package, cache, and player.