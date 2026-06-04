# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OTT-Platform is a multi-chapter streaming platform built from scratch. Currently on **Chapter 1**: LAN live streaming with HLS.

Pipeline: `Source → FFmpeg encode/package (H.264/AAC) → HLS files → nginx cache → Player (hls.js/VLC)`

## Build & Dev Commands

```bash
# Frontend (React + Vite + TypeScript)
cd frontend
npm install
npm run dev          # start dev server (localhost:5173)
npm run build        # tsc + vite build (full type check)
npm run lint         # eslint
npm run preview      # vite preview (serve built app)

# Backend (Node.js)
cd backend
npm install
npm test             # placeholder until server tests exist
```

When editing TypeScript, write out types explicitly at module boundaries. The project uses strict TypeScript 6 with `tsc -b` for builds.

## Architecture

### Component Responsibility

| Component | Role |
|---|---|
| **FFmpeg** | Encodes source (test pattern / looped file / webcam) to H.264 + AAC, writes HLS segments + `.m3u8` manifest |
| **Backend** | Orchestrates FFmpeg (start/stop/status), exposes a control API. Does NOT serve video segments |
| **nginx** | Serves HLS files from the media directory. Manifests get short TTL, segments get brief cache. Future origin/cache layer |
| **Frontend** | Player page using hls.js, shows stream URL and backend status |

### LAN Deployment (Chapter 1)

All server components run on one machine. Viewers access via LAN IP:
- Frontend: `http://<lan-ip>:5173`
- Backend API: `http://<lan-ip>:4000`
- HLS via nginx: `http://<lan-ip>/hls/index.m3u8`

### HLS Output Path

```
backend/media/live/
  index.m3u8
  segment_00001.ts
  segment_00002.ts
  ...
```

## Current State

- **Chapter 1 design doc** committed at `docs/Chapter-1-Design-Doc.md`
- **Frontend** scaffolded (React 19 + Vite 8 + TypeScript 6). Only has a welcome placeholder.
- **Backend** scaffolded (Node.js, CommonJS). Only `package.json` and `.env.example`.
- **No backend dependencies installed yet.** Backend uses CommonJS (`type: "commonjs"`).
- FFmpeg and nginx are assumed to be available on the host machine (not configured in code yet).
