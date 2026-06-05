# Chapter 1 Implementation Breakdown

This document breaks `docs/Chapter-1-Design-Doc.md` into implementation parts. It is a planning artifact only; it does not change the implementation.

The Chapter 1 target is LAN live streaming with this path:

```text
browser camera -> WebRTC -> MediaMTX relay -> FFmpeg encoder/package -> HLS files -> nginx cache -> player
```

## Implementation Principles

- Keep the backend responsible for orchestration, metadata, process control, and status.
- Keep video segment delivery out of the application server.
- Use `streamId` as the isolation boundary for stream state, relay paths, encoder workers, and HLS output.
- Make every part testable with one stream before adding multi-stream behavior.
- Preserve stream isolation: one failed stream must not stop another.
- Keep the viewer constrained to one active stream per viewer session.

## Part 1: Local Runtime Shape and Configuration

Goal: Establish the local component boundaries and runtime configuration before wiring features together.

Scope:

- Define expected host ports for frontend, backend API, MediaMTX, and nginx.
- Define the server LAN host/IP configuration used to construct publish and playback URLs.
- Confirm `backend/media/live/` as the HLS origin root.
- Decide how local development handles stale HLS output on backend startup.
- Document required external binaries: MediaMTX, FFmpeg, and nginx.

Implementation tasks:

1. Add backend configuration for LAN host, backend port, MediaMTX URL/ports, nginx HLS base URL, and media root.
2. Add startup validation for required directories and configuration values.
3. Add a local runtime checklist for MediaMTX, FFmpeg, nginx, backend, and frontend.
4. Keep config values environment-driven where they depend on the developer machine.

Done when:

- The backend can determine the absolute HLS output root.
- The system can construct publish, WHIP, and playback URLs from configuration.
- Missing required configuration fails clearly before stream creation.

Dependencies:

- None.

## Part 2: MediaMTX Relay Setup

Goal: Make MediaMTX the WebRTC ingest relay and live media boundary.

Scope:

- Configure MediaMTX for LAN WebRTC publishing.
- Use one MediaMTX path per stream: `live/<streamId>`.
- Confirm the browser-facing publish and WHIP endpoints.
- Identify how the backend will observe MediaMTX path/session state.

Implementation tasks:

1. Add or document the MediaMTX configuration needed for WebRTC publishing on the LAN.
2. Verify one manual publish path before backend automation.
3. Decide whether backend status reads MediaMTX API, logs, or a simpler Chapter 1 state model.
4. Normalize MediaMTX path construction in one backend helper.

Done when:

- A publisher can target `live/<streamId>` without colliding with other streams.
- The backend can generate the MediaMTX publish URL and WHIP URL for any stream.
- The implementation has a clear way to know whether a stream has reached publish-ready or live state.

Dependencies:

- Part 1.

## Part 3: Backend Stream Metadata Model

Goal: Represent multiple streams independently in backend state.

Scope:

- Store streams by `streamId`, not in a global singleton.
- Track stream title, publisher/user identity, MediaMTX path, HLS output directory, encoder state, timestamps, and errors.
- Support active and recently active stream listing.
- Keep the first version in memory unless persistence is explicitly needed later.

Implementation tasks:

1. Create a stream store keyed by `streamId`.
2. Define stream states such as `created`, `publishing`, `encoding`, `live`, `stopped`, and `failed`.
3. Add safe stream ID generation and path validation.
4. Add helpers for stream output directories under `backend/media/live/<streamId>/`.
5. Add structured status objects for API responses.

Done when:

- Multiple stream records can exist at the same time.
- Each stream has its own MediaMTX path and HLS output path.
- A failed or stopped stream can be represented without affecting other records.

Dependencies:

- Part 1.

## Part 4: Backend Stream API

Goal: Expose the API contract needed by publishers, viewers, and local testing.

Scope:

- Implement the design doc API contract.
- Keep endpoints focused on metadata, orchestration, and session control.
- Do not serve HLS files or segment data from the backend.

Implementation tasks:

1. `POST /api/streams`: create a stream record and return `streamId` plus `publishPath`.
2. `POST /api/streams/:streamId/publish/start`: authorize/prepare browser publishing and return MediaMTX URLs.
3. `POST /api/streams/:streamId/encoder/start`: start the per-stream encoder worker.
4. `POST /api/streams/:streamId/stop`: stop one stream and its encoder worker.
5. `GET /api/streams`: list active and recently active streams.
6. `GET /api/streams/:streamId/status`: return one stream state.
7. `POST /api/viewer/session`: start or replace one viewer's active stream.
8. `DELETE /api/viewer/session`: stop one viewer's active stream.

Done when:

- API responses match the design doc shape closely enough for the frontend to consume.
- Invalid stream IDs and invalid state transitions return useful errors.
- No endpoint proxies HLS manifests or media segments.

Dependencies:

- Part 3.

## Part 5: Publisher Browser Flow

Goal: Let a publisher create a stream, capture local media, and publish it to MediaMTX over WebRTC.

Scope:

- Browser owns camera and microphone capture.
- Backend owns stream identity and publish URL generation.
- MediaMTX owns the live relay path.

Implementation tasks:

1. Add a publisher view that creates or selects a stream record.
2. Request camera and optional microphone permissions with `getUserMedia`.
3. Publish media to the stream's MediaMTX WebRTC or WHIP endpoint.
4. Show publish state: idle, requesting permissions, connecting, live, stopped, failed.
5. Stop local tracks and release capture when publishing stops.
6. Surface useful browser-side errors for denied permissions, relay connection failure, and unsupported browser features.

Done when:

- A browser publisher can publish to a backend-created stream path.
- Two publisher browser sessions can target different `streamId` paths.
- The publisher page does not run HLS encoding logic.

Dependencies:

- Part 2.
- Part 4.

## Part 6: Encoder Worker Orchestration

Goal: Start one FFmpeg encoder process per active stream and keep process state isolated.

Scope:

- FFmpeg reads from MediaMTX.
- FFmpeg writes multi-resolution HLS under one stream output directory.
- The backend starts, stops, and monitors each encoder independently.

Implementation tasks:

1. Create an encoder worker module that builds the FFmpeg command for one stream.
2. Ensure the stream output directory exists before process launch.
3. Generate 360p, 480p, and 720p renditions plus a master playlist.
4. Encode video as H.264 and audio as AAC when audio is available.
5. Use 2 second HLS segments and a live playlist size of 5 to start.
6. Track process PID, start time, stderr tail, and exit status per stream.
7. Start each encoder in a way that supports clean shutdown without orphaned processes.

Done when:

- Starting an encoder for `stream-abc` writes only to `backend/media/live/stream-abc/`.
- Starting another encoder for `stream-def` writes only to `backend/media/live/stream-def/`.
- Stopping one encoder does not stop other encoders.

Dependencies:

- Part 2.
- Part 3.
- Part 4.

## Part 7: Encoder Failure and Cleanup Handling

Goal: Reflect encoder failures accurately and prevent one stream's failure from leaking into another stream.

Scope:

- Monitor child process `exit` or `close` events.
- Mark only the affected stream as failed.
- Clean up only inside the affected stream output directory.
- Avoid auto-restart in Chapter 1.

Implementation tasks:

1. Capture non-zero FFmpeg exit codes.
2. Store a truncated stderr tail on the stream status.
3. Mark the affected stream as `failed`.
4. Leave unrelated streams running.
5. Delete partial files only after validating the target path is inside that stream directory.
6. Keep failed streams failed until manually restarted or stopped.

Done when:

- Killing one encoder updates only that stream's status.
- Other active streams continue to report their previous state.
- Cleanup cannot remove files outside `backend/media/live/<streamId>/`.

Dependencies:

- Part 6.

## Part 8: HLS Output Readiness

Goal: Mark streams live only after usable HLS output exists.

Scope:

- Detect `master.m3u8`.
- Detect expected rendition playlists.
- Keep stream state honest while FFmpeg is still warming up.

Implementation tasks:

1. Add readiness checks for `master.m3u8`.
2. Add optional readiness checks for `360p/index.m3u8`, `480p/index.m3u8`, and `720p/index.m3u8`.
3. Transition stream state from `encoding` to `live` only after the expected output is present.
4. Return output readiness details from status endpoints.

Done when:

- The viewer stream list does not advertise a stream as playable before HLS output exists.
- Status output can show where each stream's HLS files are written.

Dependencies:

- Part 6.

## Part 9: nginx HLS Delivery

Goal: Serve generated HLS files through nginx using the stable `/hls/` prefix.

Scope:

- nginx serves manifests and segments from `backend/media/live/`.
- Manifests stay fresh.
- Segments can be cached briefly.
- Directory listing remains disabled.

Implementation tasks:

1. Add or document nginx config for `/hls/` aliasing to the media root.
2. Add no-cache headers for `.m3u8` manifests.
3. Add short cache headers for `.ts` segments.
4. Add CORS headers if frontend and nginx use different origins.
5. Verify playback URL shape: `http://<server-lan-ip>/hls/<streamId>/master.m3u8`.

Done when:

- A generated `master.m3u8` is reachable through nginx.
- Segment requests are served by nginx, not the backend.
- Directory browsing is not exposed.

Dependencies:

- Part 1.
- Part 6.

## Part 10: Viewer Session Model

Goal: Enforce one active viewed stream per viewer session.

Scope:

- Backend records at most one active `streamId` per viewer.
- Starting a new viewer session replaces the previous one.
- Stopping a viewer session clears the active stream.

Implementation tasks:

1. Add a viewer session store keyed by `viewerId` or browser session identity.
2. Validate requested streams before creating viewer sessions.
3. Return the nginx playback URL for the selected stream.
4. Replace the previous active stream when the same viewer selects a different stream.
5. Reject unsupported simultaneous watch attempts if the session model can identify them.

Done when:

- One viewer session maps to no more than one active stream.
- The backend can report or clear a viewer's current selected stream.
- Playback URLs point to nginx HLS, not backend segment routes.

Dependencies:

- Part 4.
- Part 8.
- Part 9.

## Part 11: Viewer Browser Flow

Goal: Let a viewer list active streams and watch one selected stream at a time.

Scope:

- Fetch stream list from the backend.
- Start or replace viewer session before playback.
- Use one active player instance.
- Stop the current player before loading another stream.

Implementation tasks:

1. Add a viewer view that polls or refreshes active streams.
2. Add stream selection.
3. Call `POST /api/viewer/session` for the selected stream.
4. Load the returned HLS `master.m3u8` URL into the player.
5. Stop and dispose the current player before switching streams.
6. Call `DELETE /api/viewer/session` when the viewer stops playback or leaves.
7. Show clear states for loading, playing, stopped, stream unavailable, and playback error.

Done when:

- The viewer can play one selected stream.
- Switching streams stops the previous playback path before starting the next one.
- The page does not render multiple live players at the same time.

Dependencies:

- Part 10.

## Part 12: Observability and Operator Feedback

Goal: Make the live path traceable from publisher to player.

Scope:

- Backend logs stream creation, publish start, encoder start, readiness, stop, and failure.
- Status endpoints expose enough information to debug Chapter 1 locally.
- Errors identify the affected `streamId`.

Implementation tasks:

1. Add structured logs with `streamId` on stream lifecycle events.
2. Include MediaMTX path, output directory, encoder PID, state, and recent error details in status responses.
3. Add simple operator-facing output for active streams and encoder workers.
4. Keep stderr tails bounded to avoid unbounded memory growth.

Done when:

- A developer can trace one stream through stream ID, relay path, encoder process, output directory, and playback URL.
- A failed stream explains what failed without hiding other streams.

Dependencies:

- Part 3.
- Part 6.
- Part 8.

## Part 13: End-to-End LAN Validation

Goal: Prove the Chapter 1 success criteria on the LAN.

Scope:

- Validate one stream first.
- Validate two simultaneous publishers.
- Validate one viewer switching streams.
- Validate multiple viewers requesting the same stream through nginx.

Implementation tasks:

1. Test one publisher from stream creation through playback.
2. Test two browser publishers with different stream IDs.
3. Confirm each stream has its own MediaMTX path, encoder process, and HLS directory.
4. Confirm 360p, 480p, and 720p outputs exist for each stream.
5. Confirm `/hls/<streamId>/master.m3u8` works through nginx.
6. Confirm viewer switching stops the previous player before starting the next one.
7. Kill one encoder and confirm the other stream continues.
8. Check logs and status output for traceability.

Done when:

- All Chapter 1 success criteria from the design doc are demonstrated.
- Known risks are either mitigated or documented for the next chapter.

Dependencies:

- Parts 1 through 12.

## Suggested Milestone Order

1. Runtime configuration and MediaMTX manual publish proof.
2. Backend stream model and API without FFmpeg automation.
3. Publisher browser publishing to MediaMTX.
4. Per-stream FFmpeg orchestration and HLS output readiness.
5. nginx HLS delivery.
6. Viewer session API and single-player viewer UI.
7. Failure handling, cleanup, and observability.
8. LAN end-to-end validation with two publishers.

## Suggested Test Matrix

| Area | Test |
| --- | --- |
| Stream creation | Creating two streams returns two unique `streamId` values and two unique MediaMTX paths. |
| Publisher | Browser can publish to one stream path and stop cleanly. |
| Multi-publisher | Two browser publishers can publish to different paths at the same time. |
| Encoder | Each stream starts one encoder worker and writes to its own HLS directory. |
| HLS output | `master.m3u8`, `360p/index.m3u8`, `480p/index.m3u8`, and `720p/index.m3u8` exist per stream. |
| nginx | `/hls/<streamId>/master.m3u8` is served by nginx with fresh manifest headers. |
| Viewer session | One viewer can replace its selected stream, and the old stream is cleared from the session. |
| Viewer UI | Switching streams stops the current player before loading another stream. |
| Failure isolation | Killing one encoder marks only that stream failed. |
| Cleanup safety | Stopping a stream only removes or expires files inside that stream's output directory. |

## Deferred Beyond Chapter 1

- Production authentication and authorization.
- Persistent database storage.
- Auto-restart policies for failed encoders.
- Adaptive bitrate controls in the viewer UI.
- Direct WebRTC low-latency viewing.
- Cloud object storage or CDN delivery.
- Multi-camera viewer walls.
- Advanced capacity management and stream admission control.
