# Chapter 1 Local Runtime Checklist

This checklist captures the local component boundaries for Chapter 1 LAN live streaming.

## Ports

| Component | Default | Purpose |
| --- | ---: | --- |
| Frontend dev server | `5173` | Publisher and viewer React app |
| Backend API | `4000` | Stream metadata, orchestration, and status |
| MediaMTX WebRTC/WHIP | `8889` | Browser publishing endpoints |
| MediaMTX API | `9997` | Relay status checks in later parts |
| nginx | `80` | HLS playback under `/hls/` |

## Backend Configuration

Copy `backend/.env.example` to `backend/.env` when local values differ from the defaults.

Required machine-specific values:

- `LAN_HOST`: hostname or LAN IP publisher and viewer devices use to reach this machine.
- `MEDIAMTX_WEBRTC_BASE_URL`: base URL for MediaMTX browser publishing.
- `NGINX_HLS_BASE_URL`: base URL where nginx exposes `/hls/`.
- `HLS_MEDIA_ROOT`: HLS origin root. Defaults to `backend/media/live/`.

The backend constructs:

- MediaMTX publish path: `live/<streamId>`
- Browser publish URL: `<MEDIAMTX_WEBRTC_BASE_URL>/live/<streamId>/publish`
- WHIP URL: `<MEDIAMTX_WEBRTC_BASE_URL>/live/<streamId>/whip`
- Playback URL: `<NGINX_HLS_BASE_URL>/<streamId>/master.m3u8`
- HLS output directory: `<HLS_MEDIA_ROOT>/<streamId>/`

## HLS Output

FFmpeg output belongs under:

```text
backend/media/live/<streamId>/
```

The backend ensures `backend/media/live/` exists at startup. It does not serve manifests or segments; nginx must alias `/hls/` to this directory.

Stale HLS output is preserved by default so a backend restart never deletes media unexpectedly. For local throwaway runs, set:

```text
HLS_CLEAN_STALE_OUTPUT_ON_START=true
```

Cleanup is limited to direct contents of the configured HLS media root.

## External Binaries

Install these on the host machine or set the matching environment variable to an absolute executable path:

| Binary | Env override |
| --- | --- |
| MediaMTX | `MEDIAMTX_BINARY` |
| FFmpeg | `FFMPEG_BINARY` |
| nginx | `NGINX_BINARY` |

Part 1 records these binary names for later orchestration. Later parts will add reachability and process checks.

## MediaMTX Relay

Use `docs/Chapter-1-MediaMTX-Relay-Setup.md` for the Chapter 1 MediaMTX configuration and manual publish check.

The expected LAN publish targets are:

- Browser publish page: `https://<server-lan-ip>:8889/live/<streamId>/publish`
- WHIP endpoint: `https://<server-lan-ip>:8889/live/<streamId>/whip`

The backend treats `live/<streamId>` as the relay boundary and can reference the local MediaMTX Control API at `/v3/paths/list` when relay observation is needed.

## Startup Order

1. Start MediaMTX with WebRTC publishing enabled on the LAN.
2. Start nginx with `/hls/` aliased to `backend/media/live/`.
3. Start the backend with `npm start` from `backend/`.
4. Start the frontend with `npm run dev` from `frontend/`.
5. Open `GET /api/runtime/status` on the backend to confirm URL construction and the absolute HLS root.

## Frontend Publisher Flow

The React publisher UI calls backend APIs through `/api`. During Vite development, `frontend/vite.config.ts` proxies `/api` to:

```text
http://127.0.0.1:4000
```

Override the proxy target when the backend runs elsewhere:

```powershell
$env:VITE_BACKEND_PROXY_TARGET="http://<server-lan-ip>:4000"
npm run dev
```

For built frontend hosting behind nginx, keep HLS under `/hls/` and add a separate `/api/` proxy to the backend. Do not serve HLS manifests or segments through the backend.
