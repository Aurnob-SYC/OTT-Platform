# Chapter 3 VOD Archive Implementation Breakdown

This document breaks `docs/Chapter-3-VOD-Archive-Design-Doc.md` into a small set of implementation parts. It is a tracking document for building Chapter 3, while the design doc remains the source of truth for behavior and architecture.

Chapter 3 adds this recorded playback path beside the existing live path:

```text
MKV archive -> VOD HLS packaging -> nginx static delivery -> home page recorded video player
```

## Part 1: Recording model and storage roots

Goal: Add the backend state and filesystem boundaries needed for recordings before changing FFmpeg behavior.

Implementation steps:

1. Add recording metadata with `recordingId`, `sourceStreamId`, `title`, `state`, timestamps, archive path, VOD output path, playback URL, duration when available, and error details when needed.
2. Add recording states: `recording`, `finalizing`, `packaging`, `packaged`, `failed`, `deleting`, and `deleted`.
3. Add backend configuration for `backend/media/archive/` and `backend/media/vod/`.
4. Create a recording store that can load and write a small JSON metadata file, while still keeping the current in-memory development flow simple.
5. Add path helpers that build archive and VOD paths from a known `recordingId`.
6. Validate delete and cleanup targets by resolving paths and confirming they stay inside the expected media roots.

Done when:

- The backend can create, update, list, and hide recording records without starting any media jobs.
- Archive paths and VOD paths are always derived from backend-controlled recording IDs.
- The design still has a clear future boundary for replacing JSON metadata with a database.

## Part 2: Live encoder archive output

Goal: Keep the Chapter 1 live HLS path working while saving each live stream as an MKV archive.

Implementation steps:

1. Create a `recordingId` when the encoder worker starts for a stream.
2. Create `backend/media/archive/<recordingId>/source.mkv` as the archive output path.
3. Update the FFmpeg encoder command so the same live input still writes live HLS and also writes the MKV archive.
4. Keep live HLS output under `backend/media/live/<streamId>/`.
5. Track the recording state as `recording` while FFmpeg is writing the MKV.
6. On stream stop, let FFmpeg exit cleanly and move the recording to `finalizing`.
7. If the MKV is missing or empty after stop, mark only that recording as `failed`.

Done when:

- A live stream still plays through `/hls/<streamId>/master.m3u8`.
- The same stream creates a non-empty `source.mkv` under `backend/media/archive/<recordingId>/`.
- One stream's archive failure does not affect other streams.

## Part 3: VOD packaging and pre-roll

Goal: Convert completed MKV archives into stable VOD HLS output, including the Chapter 3 pre-roll checkpoint.

Implementation steps:

1. Add a VOD packaging worker that reads `backend/media/archive/<recordingId>/source.mkv`.
2. Write generated VOD HLS to `backend/media/vod/<recordingId>/`.
3. Generate a `master.m3u8` and rendition playlists that match the live ladder unless resource usage requires a smaller first version.
4. Add support for one shared pre-roll source clip at `backend/media/ads/preroll/source.mp4`.
5. Package the pre-roll so the player loads one recording `master.m3u8` and sees the ad before the main recording.
6. Trigger packaging automatically after normal stream stop and allow retry later from the API.
7. If packaging fails, keep the MKV archive and mark the recording as `failed` with a useful error.

Done when:

- Stopping a stream can produce VOD HLS under `backend/media/vod/<recordingId>/`.
- The recording becomes `packaged` only after a playable VOD manifest exists.
- Missing or invalid pre-roll input fails clearly, unless a no-ad fallback is explicitly configured.

## Part 4: Recording API and nginx delivery

Goal: Expose recordings through backend metadata APIs while nginx serves the actual VOD media files.

Implementation steps:

1. Add `GET /api/recordings` to list visible packaged recordings for the home page.
2. Add `GET /api/recordings/:recordingId` to return one recording and playback URL.
3. Add `POST /api/recordings/:recordingId/package` to retry VOD packaging from the MKV archive.
4. Add `DELETE /api/recordings/:recordingId` to delete archive files, VOD files, and visible metadata.
5. Add nginx `/vod/` delivery that maps to `backend/media/vod/`.
6. Keep live `/hls/` manifest caching conservative, and allow more stable caching for VOD manifests and segments.
7. Confirm backend API responses return playback URLs such as `http://<server-lan-ip>/vod/<recordingId>/master.m3u8`.

Done when:

- The backend never serves VOD manifests or segments itself.
- `/vod/<recordingId>/master.m3u8` is reachable through nginx.
- Deleting a recording removes only `backend/media/archive/<recordingId>/` and `backend/media/vod/<recordingId>/`.

## Part 5: Home page recorded playback

Goal: Add recorded videos below the existing live experience without replacing the Chapter 1 viewer flow.

Implementation steps:

1. Fetch packaged recordings from `GET /api/recordings`.
2. Add a recorded videos section below publisher controls, live viewer, and active stream list.
3. Show each recording's title, creation time or duration, play action, and delete action.
4. Reuse the existing HLS player service for VOD playback.
5. Keep only one active media player instance: stop live playback before starting VOD if they share the player surface.
6. Stop current VOD playback before selecting another recording.
7. When deleting the selected recording, stop playback first, then refresh the list after the backend confirms deletion.

Done when:

- Users can select one recorded video and play it from the home page.
- Recorded playback is visually separate from active live streams.
- Deleting a recording removes it from the UI and clears the selected recording when needed.

## Part 6: End-to-end verification and documentation

Goal: Prove Chapter 3 works without regressing Chapter 1 live streaming.

Implementation steps:

1. Test a live stream from browser publishing through live HLS playback.
2. Stop the stream and confirm a non-empty MKV archive exists.
3. Confirm VOD packaging creates the expected `backend/media/vod/<recordingId>/` files.
4. Confirm nginx serves the VOD manifest and segments through `/vod/`.
5. Confirm the pre-roll plays before the main recording.
6. Confirm the home page can play one recorded video at a time.
7. Confirm deleting a recording removes archive files, VOD files, and visible metadata.
8. Confirm a failed packaging job keeps the MKV archive for retry.
9. Update docs with local test steps and any operational notes learned during implementation.

Done when:

- Every success criterion in the Chapter 3 design doc has been manually verified.
- Chapter 1 live streaming still works after Chapter 3 changes.
- Known limitations are documented instead of hidden in code.

## Suggested Build Order

1. Recording model, storage roots, and guarded path helpers.
2. Encoder MKV archive output while preserving live HLS.
3. VOD packaging from MKV, first without pre-roll, then with pre-roll.
4. Recording APIs and nginx `/vod/` delivery.
5. Home page recorded video list, playback, and delete flow.
6. End-to-end validation and documentation cleanup.

## Suggested Test Matrix

| Area | Test |
| --- | --- |
| Live regression | A stream still publishes, encodes, and plays through `/hls/<streamId>/master.m3u8`. |
| Archive output | Stopping a stream creates `backend/media/archive/<recordingId>/source.mkv` with non-zero size. |
| VOD packaging | Packaging creates `backend/media/vod/<recordingId>/master.m3u8` and rendition playlists. |
| Pre-roll | Playback starts with the shared pre-roll and then continues into the main recording. |
| API listing | `GET /api/recordings` returns only visible playable recordings for the home page. |
| Retry packaging | A failed or missing VOD package can be regenerated from the MKV when the archive exists. |
| nginx delivery | VOD playback requests go to `/vod/`, while live playback still goes to `/hls/`. |
| Frontend playback | Selecting a recording stops any previous recorded playback and uses one player instance. |
| Delete safety | Delete removes only the expected archive and VOD folders for the selected `recordingId`. |
| Failure isolation | A recording or packaging failure does not stop unrelated live streams or recordings. |

## Deferred Beyond Chapter 3

- Database-backed recording metadata.
- User accounts, ownership, and authorization.
- Cloud object storage or CDN delivery.
- Adaptive VOD packaging policies.
- Full SSAI or CSAI ad decisioning.
- Recording search, tags, thumbnails, and playlists.
