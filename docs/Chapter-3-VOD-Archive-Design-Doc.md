# Chapter 3 Design Doc: VOD Recording and Archive Playback

## Goal

Add recorded video playback to the existing OTT platform without replacing the Chapter 1 live pipeline.

Chapter 3 introduces two new abilities:

- Archive each live stream as an `.mkv` recording.
- Package archived recordings back into HLS so users can watch them on demand.

The current FFmpeg encoder already reads each live stream from MediaMTX and encodes it for playback. Chapter 3 changes the encoder output shape so the same encoded stream goes two ways:

```text
MediaMTX relay
  -> FFmpeg encode
     -> MKV archive file
     -> live HLS packaging
```

The live viewer path remains:

```text
Browser camera
  -> WebRTC
  -> MediaMTX relay
  -> FFmpeg encode/package
  -> live HLS files
  -> nginx cache
  -> player
```

The new recorded playback path is:

```text
MKV archive
  -> VOD HLS packaging
  -> nginx static delivery
  -> home page recorded video player
```

## Scope

Chapter 3 should integrate with the existing project in small steps:

- Keep live streaming working as it works now.
- Keep the backend responsible for orchestration and metadata.
- Keep nginx responsible for serving HLS files.
- Store durable source recordings as `.mkv`.
- Generate VOD HLS output from the archived `.mkv`.
- Show recorded videos at the bottom of the existing home page.
- Let users select one recorded video and play it.
- Add a delete button near each recorded video.
- Delete both the recording metadata and generated media files for that recording.
- Include a simple pre-roll clip before the main recording for the Chapter 3 ad checkpoint.

Chapter 3 does not need a database yet. An in-memory store plus a small JSON metadata file is enough for local learning, as long as the design keeps the future database boundary clear.

## Architecture

```text
Publisher browser camera
  -> WebRTC publish
  -> MediaMTX relay
  -> per-stream FFmpeg worker
     -> live HLS output under backend/media/live/<streamId>/
     -> MKV archive under backend/media/archive/<recordingId>/source.mkv
  -> recording finalization
  -> VOD HLS package under backend/media/vod/<recordingId>/
  -> nginx
  -> viewer browser home page
```

The important change is that FFmpeg is still the one media processing boundary for live streams, but it now produces two outputs from one encoded input:

1. A live HLS output for current viewers.
2. An MKV archive output for future on-demand playback.

The archive file is the durable source of truth for the recording. VOD HLS can be regenerated later from the MKV if needed.

## Recording Model

Every completed recording has a unique `recordingId`.

Example identity:

```text
Live stream ID: stream-abc
Recording ID: rec-20260612-stream-abc
Archive file: backend/media/archive/rec-20260612-stream-abc/source.mkv
VOD output: backend/media/vod/rec-20260612-stream-abc/
Playback URL: http://<server-lan-ip>/vod/rec-20260612-stream-abc/master.m3u8
```

Recommended recording metadata:

```json
{
  "recordingId": "rec-20260612-stream-abc",
  "sourceStreamId": "stream-abc",
  "title": "Desk cam recording",
  "state": "packaged",
  "createdAt": "2026-06-12T10:00:00.000Z",
  "durationSeconds": 624,
  "archivePath": "backend/media/archive/rec-20260612-stream-abc/source.mkv",
  "vodOutputPath": "backend/media/vod/rec-20260612-stream-abc/",
  "playbackUrl": "http://<server-lan-ip>/vod/rec-20260612-stream-abc/master.m3u8"
}
```

Recommended states:

| State | Meaning |
| --- | --- |
| `recording` | Live stream is active and FFmpeg is writing the MKV archive. |
| `finalizing` | Live stream stopped and the archive file is being closed/verified. |
| `packaging` | Backend is running FFmpeg to create VOD HLS from the MKV. |
| `packaged` | VOD HLS exists and the recording can be played. |
| `failed` | Recording or VOD packaging failed. |
| `deleting` | User requested deletion and cleanup is in progress. |
| `deleted` | Metadata is removed or hidden after media cleanup. |

## Directory Layout

Live HLS remains unchanged:

```text
backend/media/live/<streamId>/master.m3u8
backend/media/live/<streamId>/<rendition>/index.m3u8
```

New archive and VOD paths:

```text
backend/media/archive/
  <recordingId>/
    source.mkv
    metadata.json

backend/media/vod/
  <recordingId>/
    master.m3u8
    ad/
      index.m3u8
      000000.ts
    main/
      index.m3u8
      000000.ts
    360p/
      index.m3u8
      000000.ts
    480p/
      index.m3u8
      000000.ts
    720p/
      index.m3u8
      000000.ts
```

The exact rendition folders can match the current live HLS ladder. The key rule is that VOD output must live outside `backend/media/live/` so deleting or repackaging recordings cannot disturb active streams.

## FFmpeg Output Strategy

Chapter 1 FFmpeg reads from MediaMTX and creates live HLS. Chapter 3 keeps that input and encoding work, then adds an archive output.

Conceptual FFmpeg shape:

```text
Input: rtsp://127.0.0.1:8554/live/<streamId>

Output A:
  live multi-resolution HLS
  -> backend/media/live/<streamId>/

Output B:
  archive MKV
  -> backend/media/archive/<recordingId>/source.mkv
```

The backend should still launch one FFmpeg worker per live stream. The worker owns both outputs for that stream.

Recommended behavior:

- Create the `recordingId` when the encoder worker starts.
- Write MKV into `backend/media/archive/<recordingId>/source.mkv`.
- Keep live HLS in `backend/media/live/<streamId>/`.
- On normal stream stop, let FFmpeg exit cleanly so the MKV file finalizes.
- After the MKV exists and has non-zero size, start a separate VOD packaging job.
- If live HLS fails, mark the stream failed and mark the recording failed if the archive is unusable.
- If VOD packaging fails, keep the MKV archive so packaging can be retried.

MKV is useful as the archive container because it is tolerant for long-running recordings and can hold H.264/AAC streams without needing to be the final browser playback format. Browser playback should still use HLS, not raw MKV.

## VOD Packaging

VOD packaging converts the completed MKV archive into HLS playlists and segments.

Unlike live HLS:

- The full input duration is known.
- The playlist can be final and stable.
- Generated segments are not deleted as the video plays.
- nginx can cache VOD manifests and segments more aggressively than live manifests.

Recommended VOD package output:

```text
backend/media/vod/<recordingId>/master.m3u8
backend/media/vod/<recordingId>/360p/index.m3u8
backend/media/vod/<recordingId>/480p/index.m3u8
backend/media/vod/<recordingId>/720p/index.m3u8
```

The VOD rendition ladder should match Chapter 1 unless CPU or disk usage becomes a problem.

## Pre-Roll Ad

Chapter 3 asks for a short promotional clip before the main video starts. The simplest local design is static pre-roll packaging:

```text
Pre-roll source clip
  -> packaged ad HLS
  -> listed before main recording in the VOD manifest
  -> player sees one playback URL
```

Recommended local source path:

```text
backend/media/ads/preroll/source.mp4
```

Recommended generated path:

```text
backend/media/vod/<recordingId>/ad/
```

For the first implementation, use one shared pre-roll clip for all recordings. The backend can package or copy the pre-roll into each recording's VOD output. The player should load only the recording `master.m3u8`; it should not manually play two separate videos.

This is not full SSAI or CSAI. It is a learning-friendly static manifest sequence:

- The ad is chosen before playback starts.
- The main video starts after the ad finishes.
- There is no targeting, tracking, bidding, or mid-roll insertion.

## nginx Delivery

nginx should serve VOD HLS from a separate URL prefix:

```text
http://<server-lan-ip>/vod/<recordingId>/master.m3u8
```

Recommended mapping:

```text
/hls/ -> backend/media/live/
/vod/ -> backend/media/vod/
```

Caching should differ by content type:

- Live `.m3u8` files stay `no-cache`.
- VOD `.m3u8` files can use a short or moderate cache lifetime because they do not change after packaging.
- VOD media segments can use a longer cache lifetime.

The backend still must not serve video segments. It returns metadata and playback URLs only.

## Backend API

Add recording APIs beside the existing stream APIs.

| Method | Path | Request Body | Response | Purpose |
| --- | --- | --- | --- | --- |
| `GET` | `/api/recordings` | none | `{ "recordings": [...] }` | List packaged recordings for the home page. |
| `GET` | `/api/recordings/:recordingId` | none | `{ "recording": {...} }` | Return one recording and playback URL. |
| `POST` | `/api/recordings/:recordingId/package` | none | `{ "success": true, "state": "packaging" }` | Retry VOD packaging from the MKV archive. |
| `DELETE` | `/api/recordings/:recordingId` | none | `{ "success": true }` | Delete one recording's archive, VOD files, and metadata. |

The existing stream stop flow should trigger recording finalization:

```text
POST /api/streams/:streamId/stop
  -> stop live encoder worker
  -> finalize archive MKV
  -> start VOD packaging
  -> expose recording after packaging succeeds
```

The list endpoint should return only recordings that are visible to users. Failed or packaging recordings may be shown later in an operator view, but the bottom of the home page should focus on playable recordings.

## Frontend Home Page

The existing home page should keep live stream controls as the primary experience. Recorded videos should appear below the live stream area.

Recommended layout:

```text
Home page
  - Publisher controls
  - Live stream viewer
  - Active stream list
  - Recorded videos section
      - Recording title
      - Duration or creation time
      - Play button
      - Delete button
```

Playback rules:

- Selecting a recorded video stops any currently playing recorded video.
- If the live viewer is using the same video element, stop the live player before loading VOD.
- A recorded video uses the existing HLS player service because VOD playback is still HLS.
- The UI should clearly separate active live streams from recorded videos.
- A delete button should be near each recorded video item.
- Deleting a recording should stop playback first if that recording is currently selected.
- After deletion succeeds, remove the recording from the list.

The viewer session rule from Chapter 1 applies to live streams. Recorded VOD playback does not need a live viewer session, but the frontend should still keep one active media player instance to avoid confusing browser playback behavior.

## Delete Behavior

Deleting a recording must be guarded carefully because media files live on disk.

Delete sequence:

1. Frontend calls `DELETE /api/recordings/:recordingId`.
2. Backend validates that the recording exists.
3. Backend marks the recording `deleting`.
4. Backend stops playback only by returning success to the frontend; it does not control the browser player directly.
5. Backend deletes only:

```text
backend/media/archive/<recordingId>/
backend/media/vod/<recordingId>/
```

6. Backend removes the recording from the visible recording list.
7. Frontend refreshes the recording list and clears the selected recording if needed.

The backend must never delete paths built from raw user input alone. It should resolve the expected recording directory from the known `recordingId` and verify the final path is inside the media root before deleting.

## Failure Handling

Recording failures should not affect other streams or recordings.

Rules:

- One stream's archive failure must not stop other stream encoders.
- VOD packaging failure must not delete the MKV archive.
- Delete failure should leave the recording marked with an error so the user can retry.
- A missing VOD directory should not crash the home page; the recording can be hidden or shown as unavailable.
- If the pre-roll clip is missing, packaging should fail clearly or package the main recording without an ad only if that behavior is explicitly configured.

## Success Criteria

Chapter 3 is complete when:

- A live stream still plays through the Chapter 1 HLS path.
- The same live stream is archived as an `.mkv` file.
- Stopping a live stream finalizes the archive.
- The archive is packaged into VOD HLS under `backend/media/vod/<recordingId>/`.
- The VOD playback URL is served by nginx at `/vod/<recordingId>/master.m3u8`.
- A pre-roll clip plays before the main recording with a clean transition.
- The home page lists recorded videos below the existing live experience.
- A user can choose one recorded video and play it.
- A delete button near each recording deletes that recording from the home page.
- Deleting a recording removes its archive files, VOD HLS files, and visible metadata.
- The backend remains an orchestrator and does not serve HLS segments.

## Implementation Breakdown

Detailed implementation tracking lives in `docs/Chapter-3-VOD-Archive-Implementation-Breakdown.md`.

1. Add recording metadata types and an in-memory recording store.
2. Add media roots for `archive` and `vod` in backend config.
3. Update the encoder worker so encoded output goes to live HLS and MKV archive.
4. Create recording metadata when a live encoder starts.
5. Finalize recording metadata when the stream stops.
6. Add a VOD packaging worker that reads `source.mkv` and writes VOD HLS.
7. Add support for the shared pre-roll clip in the VOD package.
8. Add recording list, detail, retry-package, and delete APIs.
9. Add nginx `/vod/` delivery config.
10. Add a recorded videos section to the bottom of the home page.
11. Reuse the HLS player service for recorded playback.
12. Add guarded delete behavior in backend and frontend.
13. Document local test steps and expected output files.

## Key Design Decisions

1. **Archive as MKV, play as HLS.** MKV is the durable recording format, but HLS remains the browser playback format. This keeps playback compatible with the current frontend player and nginx delivery path.

2. **Split FFmpeg output after encoding.** The live worker already does the expensive media processing. Chapter 3 extends that worker so one encoded stream feeds both live HLS and archive output.

3. **Package VOD after the stream stops.** Live HLS is temporary and rolling; VOD HLS is stable and complete. Packaging after the MKV is finalized keeps those two jobs easier to reason about.

4. **Keep VOD separate from live output.** `backend/media/live/` is for active streams. `backend/media/archive/` and `backend/media/vod/` are for recordings. This prevents cleanup for one feature from damaging the other.

5. **Use nginx for VOD delivery.** The backend returns recording metadata and playback URLs, but nginx serves manifests and segments.

6. **Put recordings on the existing home page.** Chapter 3 should feel integrated with the project users already see. The recorded videos section belongs below the live stream area, not as a separate disconnected app.
