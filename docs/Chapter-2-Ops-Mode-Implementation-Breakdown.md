# Chapter 2 Ops Mode Implementation Breakdown

This document breaks `docs/Chapter-2-Ops-Mode-Design-Doc.md` into a small set of implementation parts. It stays focused on how to build the feature, not on changing the design.

## Part 1: Backend viewer response

Goal: Return both the normal HLS playback URL and the ops WebRTC playback URL for the selected stream.

Implementation steps:

1. Update the viewer session response shape to include a `playback` object with `normal` and `ops` entries.
2. Keep the existing HLS URL under `playback.normal.url`.
3. Build the WHEP URL from the same `streamId` under `playback.ops.url`.
4. Keep the backend responsible only for URL construction and session state, not media delivery.

Done when:

- The viewer session API returns both URLs for the same stream.
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
