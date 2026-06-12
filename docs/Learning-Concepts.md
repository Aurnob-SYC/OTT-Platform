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

In the publisher flow, `publishing` does not mean HLS output is ready yet. It only means the backend has issued a MediaMTX path and the browser is expected to publish camera media into that path. After the WHIP/WebRTC connection succeeds, the frontend calls the backend encoder endpoint. That backend call starts FFmpeg and moves the stream to `encoding`.

This is why a stream can appear stuck in `publishing`: MediaMTX might already be receiving the browser camera, but FFmpeg has not been started for that stream yet.

The app now asks the backend to wait until the MediaMTX path is `ready` and inbound media bytes are increasing before starting FFmpeg. That small wait prevents a race where FFmpeg tries to read `rtsp://127.0.0.1:8554/live/<streamId>` a moment too early. It also prevents a quieter hang where the WebRTC session exists, but camera media is not actually flowing into MediaMTX yet.

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

In Chapter 2, WebRTC is also the planned low-latency playback path for operations users. Instead of waiting for FFmpeg to create HLS segments, an ops browser can read the live MediaMTX path directly:

```text
Browser camera -> WebRTC -> MediaMTX -> WebRTC -> Ops viewer
```

That path is faster because it skips HLS segment creation, nginx file delivery, and the HLS player's normal buffer.

## Low-Latency Monitoring

Low-latency monitoring means watching a live feed with as little delay as practical.

For this repo, the normal Chapter 1 viewer uses HLS and may be several seconds behind the camera. That delay is acceptable for regular streaming, but not for an operations team that needs to react quickly.

The Chapter 2 design adds a separate ops viewer that reads directly from MediaMTX over WebRTC. This is intended for two or three local operators, not for a large public audience.

## WHEP

WHEP is a standard way for a browser or client to receive WebRTC media from a server.

In this project, WHIP is used for publishing into MediaMTX, while WHEP can be used for low-latency playback from MediaMTX.

For a stream with ID `stream-alpha`, the WHEP playback endpoint would look like:

```text
https://<server-lan-ip>:8889/live/stream-alpha/whep
```

The built-in MediaMTX playback page can be used first to prove the low-latency path before building a custom WHEP player in React.

## ICE Candidate

An ICE candidate is one network address that WebRTC can try when it is building a connection.

In simple terms, the WHIP HTTP request starts the session, but the real media still needs a reachable network path. MediaMTX can answer the WHIP request successfully and the browser can still disconnect a moment later if the browser cannot reach the server's advertised ICE address or port.

In this repo's local MediaMTX config:

- HTTPS handshake happens on `8889`
- WebRTC media uses `8189/UDP`, with `8189/TCP` available as a fallback
- MediaMTX advertises `192.168.80.168` as the reachable LAN host instead of every Windows interface

That is why opening or trusting `https://<server-lan-ip>:8889` is necessary but not always sufficient. The firewall must also allow the ICE media port.

Windows machines often have extra network interfaces, including link-local addresses that begin with `169.254.`. If MediaMTX advertises one of those addresses to the browser, the WebRTC connection can look established while media bytes barely move. In this repo, `webrtcIPsFromInterfaces: false` avoids those accidental candidates and `webrtcAdditionalHosts` provides the LAN IP we actually want browsers to use.

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

## Source Tree Vs Binary

A source tree is the project code used to build a program. A binary is the ready-to-run program file.

For FFmpeg on Windows:

- A source folder contains files like `configure`, `Makefile`, and C source code.
- A runnable install contains `ffmpeg.exe`, usually inside a `bin/` folder.

In this repo, `FFMPEG_BINARY` must point to the real executable path, for example:

```text
D:/tools/ffmpeg/bin/ffmpeg.exe
```

Pointing `FFMPEG_BINARY` at a source folder such as `D:/tools/ffmpeg/ffmpeg-8.1.1` will not work, because the backend needs an executable file it can spawn.

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

## Frame Rate Clamp

Frame rate is how many video frames are shown each second.

When FFmpeg reads a browser-published WebRTC stream through MediaMTX's RTSP output, it can sometimes see the video timing as:

```text
90k fps
```

That does not mean the camera is really sending 90,000 frames every second. It comes from RTP clock timing used by the media protocol.

This matters for HLS because FFmpeg writes new HLS segments after enough media time has passed. If FFmpeg thinks the stream is 90,000 fps, a 2-second segment can take about 180,000 frames before it is flushed. The backend then stays in:

```text
encoding
```

because the rendition playlists, such as `360p/index.m3u8`, have not appeared yet.

The encoder fixes this by adding an explicit 30 fps filter before scaling each rendition. That gives FFmpeg normal camera-like timing, so HLS playlists can be written quickly and the backend can move the stream to:

```text
live
```

Segments are easier to serve and cache than one giant video file.

## Archive Recording

An archive recording is the saved source copy of a live stream.

In Chapter 3, a live stream should still produce live HLS for current viewers, but FFmpeg should also save the stream as an `.mkv` file:

```text
backend/media/archive/<recordingId>/source.mkv
```

That MKV file is the durable recording. If the VOD HLS files are deleted or need different settings later, the backend can package the MKV again.

## Live Archive Output

In Chapter 3, starting the live encoder also creates a recording metadata record.

That record gets a `recordingId`, and the encoder uses that ID to write:

```text
backend/media/archive/<recordingId>/source.mkv
```

The same FFmpeg worker still writes live HLS files for current viewers:

```text
backend/media/live/<streamId>/master.m3u8
```

This means live playback and archive storage happen beside each other. The live files stay organized by `streamId`, while the saved recording is organized by `recordingId`.

When a stream stops, the recording moves to `finalizing`. That means FFmpeg has been asked to stop and the backend is waiting for the archive file to be complete. After FFmpeg exits, the backend checks the MKV. If `source.mkv` is missing or empty, only that recording becomes `failed`; other streams and recordings are left alone.

## MKV

MKV is a media container format. A container is like a box that holds video, audio, and timing information.

For this repo, MKV is useful for archives because it can store the encoded H.264/AAC stream without being the final browser playback format.

Browsers should not be expected to play the raw MKV file directly. The platform should package the MKV into HLS first.

## VOD

VOD means video on demand.

Live video is watched while it is happening. VOD is recorded video that can be watched later.

In Chapter 3, the planned VOD path is:

```text
MKV archive -> FFmpeg VOD packaging -> HLS files -> nginx -> browser player
```

The home page should list recorded videos below the live stream area so a user can choose a recording and play it.

## VOD Packaging

VOD packaging means turning a completed media file into playback files.

For this project, FFmpeg reads:

```text
backend/media/archive/<recordingId>/source.mkv
```

and writes:

```text
backend/media/vod/<recordingId>/master.m3u8
backend/media/vod/<recordingId>/<rendition>/index.m3u8
backend/media/vod/<recordingId>/<rendition>/000000.ts
```

This is different from live HLS because the whole recording already exists. The VOD manifest can be final and stable instead of changing every few seconds.

## Pre-Roll

A pre-roll is a short ad or promotional clip that plays before the main video.

In Chapter 3, the simple version is to package a shared pre-roll clip before the recorded stream. The viewer opens one VOD playback URL, and the manifest makes the ad play first and the recording play after it.

This is enough to understand the basic idea without building a full ad platform.

## SSAI And CSAI

SSAI means server-side ad insertion. The server prepares the stream so ads and content look like one continuous playback item to the player.

CSAI means client-side ad insertion. The browser player decides when to request and play the ad separately from the main content.

Chapter 3 is not a full SSAI or CSAI system. It is closer to a static server-side sequence because the pre-roll is prepared before playback and the player receives one HLS URL.

## Recording Delete

Deleting a recording means removing more than one thing.

For one `recordingId`, the backend should remove:

```text
backend/media/archive/<recordingId>/
backend/media/vod/<recordingId>/
```

It should also remove or hide the recording metadata so the home page no longer lists it.

This delete operation needs a guard: the backend should only delete paths that are safely inside the expected media folders. A bad `recordingId` should never be able to delete unrelated files.

## Recording Metadata Store

Recording metadata is the small JSON-friendly record that describes one saved stream.

In Chapter 3, the backend keeps recording records in memory while it is running and writes the list to:

```text
backend/media/archive/recordings.json
```

That file stores facts like:

- the `recordingId`
- the source `streamId`
- the current recording state
- the archive MKV path
- the generated VOD HLS path
- the nginx playback URL

The media files are still separate. The JSON file does not contain video. It only tells the backend what recordings exist and where their backend-controlled files should be.

This is a learning-friendly step before using a database. Later, the JSON store can be replaced with a database table while keeping the rest of the backend mostly focused on the same create, update, list, and hide operations.

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

The Chapter 1 nginx config lives at:

```text
config/nginx/chapter-1-hls.conf
```

It maps the public `/hls/` URL prefix to the generated files on disk.

## nginx Alias

An nginx alias maps a URL path to a folder on disk.

In this project:

```text
/hls/ -> backend/media/live/
```

That means this browser URL:

```text
http://127.0.0.1/hls/stream-alpha/master.m3u8
```

serves this file:

```text
backend/media/live/stream-alpha/master.m3u8
```

The backend does not read and return that file. nginx reads it directly.

## Cache-Control

`Cache-Control` is an HTTP header that tells browsers and proxies how long they can reuse a response.

For live HLS, manifests need to stay fresh because they keep changing as new segments are created. This project serves `.m3u8` files with no-cache headers.

Segments are small video chunks that do not change after FFmpeg writes them. This project lets nginx cache `.ts` segments briefly, for example 10 seconds.

## Directory Listing

Directory listing means a web server shows the files inside a folder when someone opens the folder URL.

For this project, directory listing should stay off. A viewer can request known HLS files like:

```text
/hls/stream-alpha/master.m3u8
```

but opening a folder like this should not show a list of files:

```text
/hls/stream-alpha/
```

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

In this repo, that means the frontend dev server should also run over HTTPS when you open it from another device on the LAN, for example:

```text
https://192.168.0.102:5173
```

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

## Observability

Observability means making a system easy to inspect while it is running.

In this project, observability means you can follow one stream through the live path by using its `streamId`.

For example, a lifecycle log for `stream-alpha` can show:

- the MediaMTX path: `live/stream-alpha`
- the FFmpeg PID
- the HLS output folder
- the nginx playback URL
- the latest error if that stream failed

This matters because several streams can run at the same time. If `stream-alpha` fails, the logs and status should explain `stream-alpha` without making `stream-beta` look broken.

## Operator Status

Operator status is a small backend report for the person running the local system.

In this repo, the route is:

```text
GET /api/operator/status
```

It returns active streams, recent stopped or failed streams, and currently running encoder workers. It is not a viewer playback route and it does not serve video files.

The goal is quick local debugging. For example, an operator can check whether `stream-alpha` has:

- a MediaMTX path
- an encoder PID
- a ready HLS output
- a playback URL
- a recent error message

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

In the backend, the viewer session API uses a `viewerId` to remember the current choice:

- `POST /api/viewer/session` starts or replaces the selected stream.
- `GET /api/viewer/session?viewerId=viewer-1` reports the current selected stream.
- `DELETE /api/viewer/session` clears the selected stream.

The playback URL returned by a viewer session points to nginx, for example:

```text
http://127.0.0.1/hls/stream-alpha/master.m3u8
```

That means the backend remembers what the viewer selected, but nginx still serves the actual HLS files.

## Viewer Playback Mode

A viewer playback mode is the choice between two ways of watching the same live stream.

In Chapter 2, the viewer page keeps the selected `streamId` separate from the playback mode:

- `normal` mode uses the existing HLS path.
- `ops` mode will later use the lower-latency WebRTC path.

This separation matters because the viewer should be able to change how it watches a stream without accidentally selecting a different stream.

For example, if the viewer is already watching `stream-alpha`, switching from normal to ops mode should keep `stream-alpha` selected. Only the playback method changes.

## Browser HLS Player

A browser HLS player is the frontend code that loads a `master.m3u8` URL and asks the browser to play it.

Some browsers can play HLS directly in a `<video>` element. Other browsers need a JavaScript helper such as `hls.js`, which reads the HLS manifest and feeds media into the same video element.

In this repo, the viewer player setup lives in:

```text
frontend/src/services/hlsPlayer.ts
```

The important rule is that one viewer session uses one player instance. When the viewer switches from `stream-alpha` to `stream-beta`, the frontend stops and destroys the old HLS player before loading the new playback URL.

## WHEP Player

A WHEP player is the frontend code that reads a WebRTC stream from a URL instead of from an HLS manifest.

In Chapter 2, the ops viewer uses the same selected stream but connects to:

```text
https://<server-lan-ip>:8889/live/<streamId>/whep
```

The frontend creates a browser `RTCPeerConnection`, sends a WebRTC offer to MediaMTX, and then attaches the received tracks to the same `<video>` element.

The important rule is still the same: one active player at a time. If the viewer switches from normal mode to ops mode, the HLS player must stop before the WHEP player starts.

## Player Lifecycle

A player lifecycle is the set of steps for starting, using, and cleaning up a media player.

For Chapter 1, the viewer lifecycle is:

1. Select a live stream.
2. Ask the backend to start or replace the viewer session.
3. Load the returned nginx HLS URL into the video player.
4. Show whether playback is loading, ready, playing, unavailable, or failed.
5. Stop the player and clear the backend viewer session when the viewer stops watching.

This matters because a live player uses browser memory, network bandwidth, and media buffers. Cleaning up the previous player before switching streams helps enforce the one-active-stream rule.

In Chapter 2, the same idea applies when changing playback mode. The selected stream stays the same, but the player implementation changes from HLS to WHEP or back again.

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
