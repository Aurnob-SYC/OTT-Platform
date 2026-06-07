# Chapter 1 Publisher Browser Flow

This document captures the Part 5 browser publisher implementation. The publisher page creates stream records through the backend, captures local camera media in the browser, and publishes that media to MediaMTX with WHIP.

## Purpose

The publisher flow keeps the Chapter 1 ingest boundary intact:

```text
browser camera -> WebRTC/WHIP -> MediaMTX relay
```

The frontend does not run FFmpeg and does not write HLS files. Encoder orchestration remains a later backend part.

## Frontend Modules

The publisher UI lives in:

```text
frontend/src/components/PublisherPanel.tsx
```

Backend API calls live in:

```text
frontend/src/services/backendApi.ts
```

The WHIP/WebRTC handshake lives in:

```text
frontend/src/services/whipPublisher.ts
```

The Vite dev server proxies frontend `/api` calls to the backend target from `VITE_BACKEND_PROXY_TARGET`, defaulting to:

```text
http://127.0.0.1:4000
```

## Flow

1. The publisher creates a backend stream with `POST /api/streams`.
2. The backend returns a unique `streamId`, MediaMTX path, browser publish URL, and WHIP URL.
3. The browser requests camera and optional microphone permissions with `getUserMedia`.
4. The frontend calls `POST /api/streams/<streamId>/publish/start`.
5. The frontend creates an `RTCPeerConnection`, adds local media tracks, creates an SDP offer, and posts it to the stream WHIP URL.
6. MediaMTX returns an SDP answer, which the browser applies as the remote description.
7. The publisher state moves through `idle`, `requesting-permissions`, `connecting`, `live`, `stopped`, or `failed`.
8. Stopping publishing closes the peer connection, sends WHIP `DELETE` when MediaMTX provides a session resource, stops local tracks, and calls `POST /api/streams/<streamId>/stop`.

## Runtime Notes

Camera capture from another LAN device requires a secure browser context. For LAN testing, run MediaMTX with HTTPS WebRTC enabled and set the backend:

```text
MEDIAMTX_WEBRTC_BASE_URL=https://<server-lan-ip>:8889
```

For local same-machine smoke testing, browser secure-context rules usually allow:

```text
http://localhost:5173
```

For another device on the same Wi-Fi, the React app at `http://<server-lan-ip>:5173` will not allow camera capture unless it is served over HTTPS. The quickest cross-device publishing path is often MediaMTX's own browser publish page:

```text
https://<server-lan-ip>:8889/live/<streamId>/publish
```

Use the stream's actual `streamId`, not the placeholder text. The browser must trust the MediaMTX certificate for camera access to work on a LAN IP.

When the frontend is served by Vite, `/api` is proxied to the backend. When the built frontend is served by nginx, add an nginx `/api/` proxy to the backend or build with an API base URL strategy that points to the backend without moving video delivery into the application server.

If the camera preview appears and then the publisher fails with a network error, the browser reached the capture step but could not complete the WHIP request to MediaMTX. Check that `mediamtx.exe mediamtx.yml` is running, that port `8889` is reachable, and that the browser has accepted or trusted the HTTPS certificate for `MEDIAMTX_WEBRTC_BASE_URL`.

## Boundaries

- One publisher flow targets one backend-created `streamId`.
- Separate browser sessions create separate stream records and MediaMTX paths.
- Stopping capture releases every local media track.
- Browser-side errors are surfaced for denied permissions, unsupported capture/WebRTC APIs, WHIP failures, and relay disconnects.
- HLS encoding, rendition readiness, and nginx HLS playback are intentionally outside this part.
