# Chapter 1 Viewer Browser Flow

This document captures the Part 11 viewer browser implementation. The React app now lists backend streams and plays one selected HLS stream through a single viewer session.

## Purpose

The viewer page proves the final Chapter 1 playback path:

```text
backend stream list -> viewer session API -> nginx HLS URL -> browser player
```

The frontend does not serve video files and does not open more than one live player at a time.

## Frontend Behavior

The viewer flow lives in:

```text
frontend/src/App.tsx
frontend/src/components/StreamsPanel.tsx
frontend/src/components/SessionPanel.tsx
frontend/src/services/hlsPlayer.ts
frontend/src/services/backendApi.ts
```

The app polls:

```http
GET /api/streams
```

and maps the backend stream status into stream cards. Only streams in the `live` state are selectable for viewing.

When a viewer selects a live stream, the frontend calls:

```http
POST /api/viewer/session
```

with:

```json
{
  "viewerId": "viewer-1",
  "streamId": "stream-alpha"
}
```

The backend validates the stream and returns the nginx playback URL:

```text
http://<server-lan-ip>/hls/<streamId>/master.m3u8
```

The session panel loads that URL into one video element. When the viewer switches streams, React tears down the previous HLS player instance before attaching the next URL.

## Player Lifecycle

The HLS player setup is isolated in:

```text
frontend/src/services/hlsPlayer.ts
```

The service uses native HLS playback when the browser supports it. For browsers such as Chrome, Edge, and Firefox, it uses `hls.js`.

Each player handle supports:

- `play()` to retry playback after browser autoplay restrictions.
- `stop()` to pause video, remove the source URL, and destroy the HLS instance.

This keeps the one-player rule concrete: one session panel, one video element, and one active HLS adapter.

## Viewer States

The viewer session can show:

- `loading`: the backend session is being started or HLS is being attached.
- `ready`: the manifest loaded, but playback may need a user click.
- `playing`: the video element is actively playing.
- `stream-unavailable`: the selected stream cannot be watched.
- `playback-error`: the player or manifest load failed.
- `stopped`: reserved for stopped playback state.

The Stop button calls:

```http
DELETE /api/viewer/session
```

and clears the local player. The app also attempts to clear the viewer session on `pagehide` when the browser leaves the page.

## Test Notes

Run frontend verification with:

```powershell
cd frontend
npm run build
npm run lint
```

Manual validation still needs the Chapter 1 runtime stack:

1. Start MediaMTX.
2. Start nginx with the Chapter 1 HLS config.
3. Start the backend.
4. Start the frontend.
5. Publish and encode a stream until it becomes `live`.
6. Select the live stream in the viewer and confirm only one video player is active.
