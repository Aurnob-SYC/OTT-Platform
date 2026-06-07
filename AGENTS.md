# AGENTS.md

This file gives working guidance to agents operating in this repository.

## Project Snapshot

OTT-Platform is a multi-chapter streaming platform built from scratch. The current focus is **Chapter 1: LAN live streaming with HLS**.

Pipeline:

`Browser camera -> WebRTC -> MediaMTX relay -> FFmpeg encode/package (H.264/AAC) -> HLS files -> nginx cache -> Player`

## Current State

- Chapter 1 design doc lives at `docs/Chapter-1-Design-Doc.md`.
- Frontend is scaffolded with React, Vite, and TypeScript.
- Backend is scaffolded with Node.js and CommonJS.
- FFmpeg and nginx are assumed to be installed on the host machine, but they are not configured in code yet.
- There is no production streaming path yet; changes should keep the repo aligned with the Chapter 1 design.

## Build And Dev Commands

### Frontend

```bash
cd frontend
npm install
npm run dev
npm run build
npm run lint
npm run preview
```

### Backend

```bash
cd backend
npm install
npm test
```

`npm test` is currently a placeholder until real backend tests are added.

## Architecture Rules

- The backend should orchestrate streaming, not serve video segments.
- nginx should serve HLS files from the media directory.
- Each live stream should have its own `streamId`, MediaMTX path, encoder worker, and HLS output directory.
- Viewer playback should be limited to one active stream per session.
- If one stream fails, other streams should keep running.
- Keep any cache or proxy layer in front of HLS conservative so manifests stay fresh.

## Chapter 1 Design Notes

- Browser publishers capture camera media and publish over WebRTC directly to MediaMTX.
- MediaMTX is the live relay between browser publishers and encoder workers.
- The built-in browser publish page uses `/<path>/publish`, while custom ingest clients can use `/<path>/whip`.
- FFmpeg reads from the relay and writes multi-resolution HLS output.
- HLS output should be written under `backend/media/live/<streamId>/`.
- nginx should expose playback at `/hls/<streamId>/master.m3u8`.
- The viewer should list active streams and play only one selected stream at a time.

## Working Conventions

- Prefer small, isolated changes that keep the Chapter 1 path working.
- Do not move video delivery into the application server.
- When changing TypeScript, keep types explicit at module boundaries.
- Avoid deleting or rewriting unrelated user work.
- Use the design doc as the source of truth when implementation details are unclear.
