# Chapter 2 Ops Mode Implementation Breakdown

This document breaks `docs/Chapter-2-Ops-Mode-Design-Doc.md` into a small set of implementation parts. It stays focused on how to build the feature, not on changing the design.

## Part 1: Backend viewer response

Goal: Return both the normal HLS playback URL and the ops WebRTC playback URL for the selected stream.

Implementation steps:

1. Update the viewer session routes in `backend/src/streamApi.js` so `POST /api/viewer/session` and `GET /api/viewer/session` return a `playback` object instead of a single `playbackUrl`.
2. Keep the existing HLS URL under `playback.normal.url` and label it with `playback.normal.type: "hls"`.
3. Build the ops playback URL from the same `streamId` under `playback.ops.url` and label it with `playback.ops.type: "webrtc"`.
4. Preserve the existing session fields that identify the viewer and selected stream, including `viewerId`, `streamId`, `previousStreamId`, and `session`.
5. Update the viewer session store only as needed to keep session state coherent; the backend should continue to construct URLs and store session state, not proxy HLS or WebRTC media.
6. Keep the normal playback URL format aligned with Chapter 1: `http://<server-lan-ip>/hls/<streamId>/master.m3u8`.
7. Keep the ops playback URL format aligned with Chapter 2: `https://<server-lan-ip>:8889/live/<streamId>/whep`.

Example response:

```json
{
  "success": true,
  "viewerId": "viewer-1",
  "streamId": "stream-abc",
  "previousStreamId": null,
  "playback": {
    "normal": {
      "type": "hls",
      "url": "http://<server-lan-ip>/hls/stream-abc/master.m3u8"
    },
    "ops": {
      "type": "webrtc",
      "url": "https://<server-lan-ip>:8889/live/stream-abc/whep"
    }
  }
}
```

Done when:

- The viewer session API returns both URLs for the same stream in the `playback` object.
- The backend still does not proxy HLS or WebRTC media.

## Part 2: Viewer mode toggle

Goal: Add a simple mode switch in the viewer page and keep the selected mode in frontend state.

Implementation steps:

1. Add a small `Normal | Ops` toggle near the viewer player.
2. Store the active mode in component state.
3. Keep the selected `streamId` separate from the active mode.
4. Reuse the current stream selection flow when the user changes mode.

Done when:

- The viewer can switch between normal and ops mode from the same page.
- The selected stream does not change just because the mode changes.

## Part 3: Player switching

Goal: Use the right player for the selected mode and cleanly stop the previous player before starting the next one.

Implementation steps:

1. Keep the existing HLS player for normal mode.
2. Add a WebRTC/WHEP player path for ops mode.
3. Stop and destroy the current player before creating the next one.
4. Reuse the same viewer session and stream selection state for both modes.
5. Show a simple error state if WebRTC playback fails to connect.

Done when:

- Only one active player exists at a time.
- Switching modes does not leave the old player running.

## Part 4: Basic verification

Goal: Confirm the feature works without changing the Chapter 1 HLS behavior.

Implementation steps:

1. Test one live stream in normal mode and confirm HLS playback still works.
2. Switch that same stream to ops mode and confirm WebRTC playback starts.
3. Switch back to normal mode and confirm the HLS player is restored.
4. Confirm toggling modes does not break the existing Chapter 1 path.

Done when:

- Both modes work for one stream on the LAN.
- The original HLS flow still behaves exactly as Chapter 1 expects.
