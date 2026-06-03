# Chapter 1 Implementation Breakdown

This document breaks the Chapter 1 live streaming design into small implementation steps. Each step should leave the project in a debuggable state before moving on.

## Guiding Path

Keep the pipeline visible end to end:

1. Source: webcam and microphone.
2. Encode: FFmpeg H.264 video and AAC audio.
3. Package: rolling HLS manifest and TS segments.
4. Cache: HTTP delivery for HLS files initially. Afterwards move to nginx.
5. Player: React playback with HLS.js.
6. Control: backend status, start, stop, cleanup, and logs.

## Phase 0: Baseline Project Check

Goal: confirm the existing app can run before adding streaming pieces.

Tasks:

- Identify current backend entrypoint, frontend entrypoint, and dev scripts.
- Run the backend health or status endpoint if one exists.
- Run the frontend and verify the starter page loads.
- Record expected ports for backend and frontend.

Debug checks:

- Backend starts without missing environment variables.
- Frontend starts without dependency or build errors.
- Browser can reach the frontend from the broadcaster laptop.

Stop before continuing if:

- The existing app does not start.
- Ports conflict and the app cannot be reached.
- Environment setup is unclear.

## Phase 1: Local HLS Output Directory

Goal: create a dedicated place where generated HLS files will live.

Tasks:

- Add a backend configuration value for the HLS output directory.
- Choose a default local path, such as `backend/storage/hls/live`.
- Ensure the directory is created at backend startup or stream startup.
- Add cleanup logic that removes old `.m3u8` and `.ts` files before a new stream starts.
- Add the generated HLS output directory to `.gitignore`.

Debug checks:

- Starting the backend creates the HLS directory.
- Cleanup removes stale stream files without touching unrelated files.
- Git status does not show generated HLS media files.

Stop before continuing if:

- The output path points outside the project unexpectedly.
- Cleanup could delete files outside the intended HLS directory.

## Phase 2: Manual FFmpeg Device Discovery

Goal: find the exact Windows webcam and microphone device names before automating anything.

Tasks:

- Document the FFmpeg command for listing DirectShow devices.
- Run the device-list command on the broadcaster laptop.
- Copy the selected video and audio device names into backend configuration.
- Add example device-name fields to `backend/.env.example`.

Suggested command:

```powershell
ffmpeg -list_devices true -f dshow -i dummy
```

Debug checks:

- FFmpeg is installed and available on `PATH`.
- The expected webcam appears in the device list.
- The expected microphone appears in the device list.

Stop before continuing if:

- FFmpeg is missing.
- Device names are ambiguous.
- The chosen devices are already locked by another app.

## Phase 3: Manual FFmpeg HLS Generation

Goal: prove source, encode, and package before adding backend orchestration.

Tasks:

- Run FFmpeg manually against the selected webcam and microphone.
- Output HLS files into the configured HLS directory.
- Use a short rolling playlist with bounded segment count.
- Confirm that `index.m3u8` and `.ts` segment files are being written.

Suggested starting command shape:

```powershell
ffmpeg -f dshow -i video="YOUR_CAMERA_NAME":audio="YOUR_MIC_NAME" `
  -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p `
  -c:a aac -b:a 128k `
  -f hls -hls_time 3 -hls_list_size 6 -hls_flags delete_segments+append_list `
  backend/storage/hls/live/index.m3u8
```

Debug checks:

- `index.m3u8` updates while FFmpeg is running.
- New segment files appear every few seconds.
- FFmpeg logs do not repeatedly show dropped device reads or encoder failures.
- Opening the manifest in a local media player works from the broadcaster laptop.

Stop before continuing if:

- FFmpeg cannot open the camera or microphone.
- The manifest is generated but segments are missing.
- Segment files grow without old files being deleted.

## Phase 4: Temporary Backend Static HLS Serving

Goal: make generated HLS files reachable over HTTP before introducing Nginx.

Tasks:

- Add a backend static route for the HLS directory.
- Serve the manifest at a predictable URL, such as `/hls/live/index.m3u8`.
- Set appropriate content types for `.m3u8` and `.ts` if the framework does not do so automatically.
- Add simple no-cache headers for the manifest.
- Keep this as an MVP fallback even if Nginx is added later.

Debug checks:

- `http://localhost:<backend-port>/hls/live/index.m3u8` returns the manifest.
- Segment URLs inside the manifest are reachable.
- A different machine on the LAN can reach the manifest using the broadcaster laptop IP address.

Stop before continuing if:

- The manifest only works through `localhost`.
- Segment URLs resolve incorrectly from another machine.
- CORS blocks the frontend from loading the manifest.

## Phase 5: Backend Stream Status Endpoint

Goal: expose enough state for the frontend and for debugging.

Tasks:

- Add a status endpoint, such as `GET /api/stream/status`.
- Return whether the stream appears live.
- Return the manifest URL the frontend should use.
- Return the configured output directory.
- Return basic file observations, such as whether the manifest exists, newest segment timestamp, and segment count.

Suggested response shape:

```json
{
  "live": true,
  "manifestUrl": "http://192.168.1.20:4000/hls/live/index.m3u8",
  "manifestExists": true,
  "segmentCount": 6,
  "lastSegmentUpdatedAt": "2026-06-03T10:00:00.000Z"
}
```

Debug checks:

- Status returns `live: false` when no manifest exists.
- Status returns `live: true` when segments are actively updating.
- The manifest URL uses a LAN-reachable host, not only `localhost`, for viewer devices.

Stop before continuing if:

- The backend cannot determine the correct LAN URL.
- Status says live after FFmpeg has stopped and files are stale.

## Phase 6: Frontend HLS.js Player

Goal: replace the starter UI with a usable live viewer.

Tasks:

- Install and import HLS.js.
- Build a viewer page with a video element and standard controls.
- Fetch backend stream status on page load and on a polling interval.
- Attach HLS.js to the manifest URL when the stream is live.
- Support native HLS playback as a fallback for browsers that support it.
- Show clear states for loading, offline, playing, and playback error.
- Add a small diagnostics panel with manifest URL, live status, and recent player errors.

Debug checks:

- The page shows offline when FFmpeg is not running.
- The page attaches to the manifest when FFmpeg is running.
- Playback begins on the broadcaster laptop.
- Playback begins from another device on the LAN.
- HLS.js errors appear in the diagnostics panel.

Stop before continuing if:

- The video element never requests the manifest.
- The manifest loads but segment requests fail.
- Browser autoplay rules prevent playback and the UI does not make that clear.

## Phase 7: Backend FFmpeg Process Control

Goal: let the backend own stream start and stop.

Tasks:

- Add backend configuration for FFmpeg path, video device, audio device, segment duration, playlist size, and output manifest path.
- Add `POST /api/stream/start`.
- Add `POST /api/stream/stop`.
- Spawn FFmpeg as a child process on start.
- Capture FFmpeg stdout and stderr logs.
- Prevent duplicate FFmpeg processes for the same live channel.
- Stop the FFmpeg process cleanly when requested.
- Update status to include process state and recent FFmpeg log lines.

Debug checks:

- Starting the stream creates a single FFmpeg process.
- Starting twice does not create two encoders.
- Stopping the stream ends FFmpeg and leaves the backend running.
- FFmpeg errors are visible through backend logs or status.

Stop before continuing if:

- FFmpeg remains running after stop.
- Backend crashes when FFmpeg exits unexpectedly.
- Logs are not captured anywhere useful.

## Phase 8: Nginx Static Cache Layer

Goal: separate HLS file delivery from the application server.

Tasks:

- Install or locate a Windows-native Nginx binary.
- Add an Nginx config that serves the HLS output directory.
- Expose the manifest at a stable LAN URL.
- Add HLS-specific MIME types if needed.
- Add cache headers suitable for live HLS:
  - Manifest: no-cache or very short cache.
  - Segments: short-lived cache.
- Update backend configuration so `manifestUrl` points to Nginx instead of the backend static route.
- Keep backend static serving available as a documented fallback.

Debug checks:

- Nginx serves `index.m3u8`.
- Nginx serves segment files.
- Another LAN device can reach Nginx using the broadcaster laptop IP.
- Frontend playback still works after switching the manifest URL to Nginx.

Stop before continuing if:

- Nginx cannot read the HLS output directory.
- MIME types cause the browser or HLS.js to reject the manifest.
- The Nginx URL works locally but not from another LAN device.

## Phase 9: Multi-Viewer Test

Goal: verify the Chapter 1 requirement that several viewers can watch at the same time.

Tasks:

- Start one live stream.
- Open the frontend from multiple browser tabs and devices.
- Watch for a sustained period, such as 10 to 15 minutes.
- Track buffering, player errors, missing segments, CPU usage, and network behavior.
- Compare backend static serving versus Nginx serving if both are available.

Debug checks:

- Each viewer requests the same manifest and segment files.
- No viewer repeatedly fails on missing segments.
- FFmpeg continues generating segments at a stable pace.
- CPU and disk usage remain reasonable on the broadcaster laptop.

Stop before continuing if:

- Viewers frequently buffer or stall.
- Segment deletion is too aggressive for slower clients.
- The broadcaster laptop cannot encode and serve at the chosen settings.

## Phase 10: Documentation and Runbook

Goal: leave the implementation explainable and repeatable.

Tasks:

- Document required software: FFmpeg, Node dependencies, and optionally Nginx.
- Document environment variables and example values.
- Document how to list webcam and microphone devices.
- Document how to start backend, frontend, FFmpeg, and Nginx.
- Document the expected source -> encode -> package -> cache -> player path.
- Add troubleshooting notes for common failures:
  - Device not found.
  - Camera already in use.
  - Manifest reachable but segments fail.
  - Frontend blocked by CORS.
  - LAN device cannot connect.
  - Player stays offline.

Debug checks:

- A fresh reader can follow the runbook without guessing command order.
- Each troubleshooting note names the pipeline stage most likely at fault.
- The docs clearly state whether the current delivery path uses backend static serving or Nginx.

## Suggested Implementation Order

Use this order unless a blocker forces a detour:

1. Baseline project check.
2. HLS output directory and cleanup.
3. FFmpeg device discovery.
4. Manual FFmpeg HLS generation.
5. Backend static HLS serving.
6. Stream status endpoint.
7. Frontend HLS.js player.
8. Backend FFmpeg start and stop.
9. Nginx cache layer.
10. Multi-viewer test.
11. Final runbook and troubleshooting docs.

## Completion Checklist

- [ ] Existing backend and frontend run.
- [ ] HLS output directory is configured and ignored by Git.
- [ ] Webcam and microphone device names are known.
- [ ] Manual FFmpeg command generates a rolling HLS stream.
- [ ] Manifest and segments are reachable over HTTP.
- [ ] Backend status endpoint reports live/offline state.
- [ ] Frontend plays the live manifest with HLS.js.
- [ ] Frontend shows useful offline and error states.
- [ ] Backend can start and stop FFmpeg.
- [ ] FFmpeg logs are captured.
- [ ] Nginx serves HLS files, or backend static serving is documented as the MVP fallback.
- [ ] LAN playback works from another device.
- [ ] Several simultaneous viewers can watch without repeated buffering.
- [ ] Runbook explains setup, startup, verification, and troubleshooting.
