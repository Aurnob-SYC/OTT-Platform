# Chapter 1 Add-On Design Doc: Viewer Ops Mode

## Goal

Keep the current Chapter 1 HLS viewer as the normal playback mode, and add an optional ops mode for low-latency viewing over WebRTC.

The viewer should be able to toggle between:

- **Normal mode:** play the selected stream through the existing Chapter 1 HLS path.
- **Ops mode:** play the same selected stream directly from MediaMTX over WebRTC.

This is an add-on to Chapter 1. It does not replace the existing HLS pipeline.

## Playback Modes

### Normal Mode

Normal mode uses the current Chapter 1 path:

```text
Publisher browser camera
  -> WebRTC publish
  -> MediaMTX relay
  -> per-stream encoder worker
  -> per-stream HLS output
  -> nginx cache server
  -> viewer browser player
```

The viewer receives:

```text
http://<server-lan-ip>/hls/<streamId>/master.m3u8
```

This mode is for regular viewers. It supports the multi-resolution HLS output from Chapter 1.

### Ops Mode

Ops mode uses the same published stream, but skips FFmpeg, HLS files, and nginx:

```text
Publisher browser camera
  -> WebRTC publish
  -> MediaMTX relay
  -> WebRTC playback
  -> viewer browser player
```

The viewer receives:

```text
https://<server-lan-ip>:8889/live/<streamId>/whep
```

This mode is for local operations monitoring where lower delay matters more than scalable delivery.

## Viewer Behavior

The viewer page still shows one selected stream at a time.

Rules:

- Selecting a stream starts or replaces the viewer session.
- Normal mode loads the HLS playback URL.
- Ops mode loads the WebRTC playback URL for the same `streamId`.
- Toggling modes stops the current player before starting the other player.
- The viewer cannot play HLS and WebRTC for the same stream at the same time.
- If ops mode fails, the viewer can toggle back to normal mode.

## Backend API Change

Update the viewer session response so it returns both playback URLs.

Current response:

```json
{
  "success": true,
  "playbackUrl": "http://<server-lan-ip>/hls/stream-abc/master.m3u8"
}
```

New response:

```json
{
  "success": true,
  "streamId": "stream-abc",
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

The backend still does not serve video segments or relay media. It only returns the correct URLs for the selected stream.

## Frontend Change

The viewer page adds one toggle:

```text
Normal | Ops
```

Frontend responsibilities:

- Keep one selected `streamId`.
- Keep one active playback mode.
- Use the existing HLS player in normal mode.
- Add a WebRTC/WHEP player for ops mode.
- Destroy the active player before switching modes or streams.
- Show a simple error if WebRTC playback cannot connect.

## MediaMTX Requirement

MediaMTX must allow WebRTC playback from the same stream path used for publishing:

```text
live/<streamId>
```

For `stream-abc`, MediaMTX should expose:

```text
https://<server-lan-ip>:8889/live/stream-abc/whep
```

## Success Criteria

This add-on is complete when:

- A viewer can select one live stream.
- Normal mode plays the stream through the existing HLS path.
- Ops mode plays the same stream through MediaMTX WebRTC playback.
- Toggling modes stops the previous player before starting the next one.
- The existing Chapter 1 HLS path still works unchanged.

## Implementation Breakdown

See `docs/Chapter-2-Ops-Mode-Implementation-Breakdown.md` for the implementation steps.
