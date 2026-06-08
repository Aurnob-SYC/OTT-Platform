# Chapter 1 Publisher Browser Flow

This document captures the browser publisher implementation. The publisher page creates stream records through the backend, captures local camera media in the browser, publishes that media to MediaMTX with WHIP, and then asks the backend to start the per-stream FFmpeg encoder.

## Purpose

The publisher flow keeps the Chapter 1 ingest boundary intact:

```text
browser camera -> WebRTC/WHIP -> MediaMTX relay -> backend encoder start -> FFmpeg HLS output
```

The frontend does not run FFmpeg and does not write HLS files. It only triggers the backend encoder endpoint after the MediaMTX WHIP session is established.

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

The frontend dev server also serves over HTTPS so browser camera capture works from a LAN IP such as `https://192.168.0.102:5173`.

## Flow

1. The publisher creates a backend stream with `POST /api/streams`.
2. The backend returns a unique `streamId`, MediaMTX path, browser publish URL, and WHIP URL.
3. The browser requests camera and optional microphone permissions with `getUserMedia`.
4. The frontend calls `POST /api/streams/<streamId>/publish/start`.
5. The frontend creates an `RTCPeerConnection`, adds local media tracks, creates an SDP offer, and posts it to the stream WHIP URL.
6. MediaMTX returns an SDP answer, which the browser applies as the remote description.
7. The WHIP helper waits until the browser reports the WebRTC peer connection as `connected`.
8. After WHIP succeeds, the frontend calls `POST /api/streams/<streamId>/encoder/start` with `waitForRelayReady: true`.
9. The backend polls the MediaMTX API until that stream path reports `ready` and inbound media bytes are increasing.
10. The backend starts one FFmpeg worker for that stream and moves the stream from `publishing` to `encoding`.
11. The publisher state moves through `idle`, `requesting-permissions`, `connecting`, `live`, `stopped`, or `failed`.
12. Stopping publishing closes the peer connection, sends WHIP `DELETE` when MediaMTX provides a session resource, stops local tracks, and calls `POST /api/streams/<streamId>/stop`.

## Runtime Notes

Camera capture from another LAN device requires a secure browser context. For LAN testing, run MediaMTX with HTTPS WebRTC enabled and set the backend:

```text
MEDIAMTX_WEBRTC_BASE_URL=https://<server-lan-ip>:8889
```

For local same-machine smoke testing, browser secure-context rules usually allow:

```text
http://localhost:5173
```

For another device on the same Wi-Fi, the React app at `http://<server-lan-ip>:5173` will not allow camera capture unless it is served over HTTPS. The quickest cross-device publishing path is often the React app at `https://<server-lan-ip>:5173` or MediaMTX's own browser publish page:

```text
https://<server-lan-ip>:8889/live/<streamId>/publish
```

Use the stream's actual `streamId`, not the placeholder text. The browser must trust the MediaMTX certificate for camera access to work on a LAN IP.

When the frontend is served by Vite, `/api` is proxied to the backend. When the built frontend is served by nginx, add an nginx `/api/` proxy to the backend or build with an API base URL strategy that points to the backend without moving video delivery into the application server.

If the camera preview appears and then the publisher fails with a network error, the browser reached the capture step but could not complete the WHIP request to MediaMTX. Check that `mediamtx.exe mediamtx.yml` is running, that port `8889` is reachable, that the browser has accepted or trusted the HTTPS certificate for `MEDIAMTX_WEBRTC_BASE_URL`, and that the MediaMTX ICE media port `8189` is not blocked by the firewall.

The publisher UI now treats a brief WebRTC `disconnected` state as temporary instead of failing immediately. That matters because browsers can enter `disconnected` for a short moment during ICE checks or Wi-Fi jitter. A stream is only marked failed if the connection reaches `failed` or stays disconnected for several seconds.

The encoder start call also asks the backend to wait for the MediaMTX path to be ready and to show increasing inbound media bytes before launching FFmpeg. This avoids two failure modes: FFmpeg connecting over RTSP just before MediaMTX marks the WebRTC-published path as available, and FFmpeg hanging while the path exists but browser media is not actually flowing yet.

For LAN publishing on Windows, keep MediaMTX from advertising link-local `169.254.x.x` ICE candidates. The repo MediaMTX config disables automatic interface IP advertising with `webrtcIPsFromInterfaces: false` and explicitly advertises the reachable LAN host with `webrtcAdditionalHosts: [192.168.80.168]`.

## Boundaries

- One publisher flow targets one backend-created `streamId`.
- Separate browser sessions create separate stream records and MediaMTX paths.
- Stopping capture releases every local media track.
- Browser-side errors are surfaced for denied permissions, unsupported capture/WebRTC APIs, WHIP failures, and relay disconnects.
- HLS encoding is started by the backend after WHIP succeeds; the browser still does not encode or serve video.
- Rendition readiness and nginx HLS playback remain backend/nginx responsibilities.
