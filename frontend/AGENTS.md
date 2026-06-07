# AGENTS.md

This file gives frontend-specific guidance for agents working under `frontend/`.

## Frontend Role

The frontend is the Chapter 1 browser surface for publishers, viewers, and local runtime visibility. It should make the streaming model clear while respecting the system boundary:

```text
Publisher camera -> WebRTC to MediaMTX -> FFmpeg HLS output -> nginx -> viewer player
```

The frontend should never pretend that the application server serves video segments.

## Current Scope

- The app uses React, Vite, TypeScript, and CSS modules/files in `src/`.
- Current UI uses mock stream/session data while backend stream APIs are still pending.
- Types shared across components live in `src/types.ts`.
- Static Chapter 1 display data lives in `src/data/`.

## Commands

```bash
npm install
npm run dev
npm run build
npm run lint
npm run preview
```

Run `npm run build` and `npm run lint` after TypeScript or UI changes when feasible.

## Architecture Rules

- Keep module-boundary TypeScript types explicit.
- Maintain the one-active-stream viewer model: selecting a new stream should stop or replace the previous session.
- Use backend APIs for stream metadata and viewer sessions once available.
- Load playback from nginx HLS URLs such as `/hls/<streamId>/master.m3u8`.
- Do not render multiple active live players for Chapter 1 unless the design doc changes.
- Keep publisher capture/WebRTC logic separate from viewer playback logic.
- Avoid hard-coding LAN addresses in components; use config or API-provided URLs.

## UI Guidance

- Build the usable streaming interface first, not a marketing landing page.
- Keep operational screens dense, readable, and consistent with the existing app style.
- Use clear controls for stream selection, session start/stop, publish state, and runtime status.
- Avoid decorative UI that obscures the actual stream state, path, session, or playback URL.
- Ensure text fits in panels and controls on mobile and desktop.

## Testing Guidance

- Prefer focused component or utility tests when test tooling is added.
- For HLS playback changes, verify that switching streams tears down the previous player instance before loading the next URL.
- Keep mock data shaped like the backend API contract in `docs/Chapter-1-Design-Doc.md`.
