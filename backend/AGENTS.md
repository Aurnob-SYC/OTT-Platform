# AGENTS.md

This file gives backend-specific guidance for agents working under `backend/`.

## Backend Role

The backend is the Chapter 1 orchestration service. It should manage stream metadata, runtime configuration, viewer sessions, and encoder worker lifecycle. It should not serve HLS manifests or media segments.

Keep video delivery in nginx:

```text
FFmpeg -> backend/media/live/<streamId>/ -> nginx /hls/<streamId>/master.m3u8
```

## Current Scope

- The backend uses Node.js, CommonJS, Express, and the built-in `node:test` runner.
- The current implementation exposes runtime configuration/status only.
- Stream creation, publisher start, encoder start/stop, and viewer session APIs should be added incrementally according to `docs/Chapter-1-Design-Doc.md`.
- Runtime config lives in `src/config.js`; URL/path construction lives in `src/urlBuilders.js`.

## Commands

```bash
npm install
npm test
npm run check
npm start
```

Run `npm test` after behavior changes. Run `npm run check` after editing backend JavaScript.

## Architecture Rules

- Store stream state by `streamId`; do not introduce a single global live stream.
- Each stream must have its own MediaMTX path, encoder worker, and HLS output directory.
- Keep HLS output under `backend/media/live/<streamId>/`.
- Validate stream IDs before building filesystem paths or spawning FFmpeg.
- Do not proxy HLS files through Express.
- If one stream or encoder fails, reflect that stream as failed without stopping other streams.
- Enforce one active viewed stream per viewer session when viewer APIs are implemented.
- Keep manifest caching conservative when generating nginx examples or runtime URLs.

## Implementation Notes

- Preserve CommonJS style unless the backend package changes deliberately.
- Use explicit helper functions for URL and path construction rather than duplicating string templates.
- Prefer small modules for stream registry, viewer sessions, encoder workers, and MediaMTX integration as those features land.
- When spawning external binaries, keep process ownership per stream and capture enough stderr/status to diagnose failures.
- Do not assume FFmpeg, nginx, or MediaMTX are managed by the app unless the design doc or task explicitly asks for that.

## Testing Guidance

- Add `node:test` coverage for config parsing, URL/path builders, stream registry behavior, viewer session replacement, and encoder failure handling.
- Use temporary directories for filesystem tests.
- Avoid tests that require real FFmpeg, nginx, or MediaMTX unless they are clearly marked as local integration checks.
