# Chapter 1 MediaMTX Relay Setup

MediaMTX is the LAN WebRTC ingest relay for Chapter 1. The backend creates stream identity and URLs, while MediaMTX owns the live media sessions.

## Local Config

Create a local `mediamtx.yml` beside the MediaMTX binary, or adapt an existing one with these Chapter 1 settings:

```yaml
api: yes
apiAddress: 127.0.0.1:9997

webrtc: yes
webrtcAddress: :8889
webrtcEncryption: true
webrtcServerKey: server.key
webrtcServerCert: server.crt

pathDefaults:
  source: publisher
  overridePublisher: false

paths:
  "~^live/[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$": {}
```

Notes:

- `webrtcAddress: :8889` exposes browser WebRTC and WHIP publishing on the LAN-facing host port.
- `webrtcEncryption: true` is required for browser camera and microphone access from a non-localhost address.
- When `webrtcEncryption` is enabled, set `MEDIAMTX_WEBRTC_BASE_URL=https://<server-lan-ip>:8889` in `backend/.env`.
- Open the publish page with `https://<server-lan-ip>:8889/live/<streamId>/publish`.
- `apiAddress: 127.0.0.1:9997` keeps the Control API local to the server machine for Chapter 1.
- The `live/<streamId>` path rule matches the backend stream ID validation.
- `overridePublisher: false` prevents a second publisher from silently replacing an active publisher on the same path.

If MediaMTX runs on another host or port, update `MEDIAMTX_WEBRTC_BASE_URL` and `MEDIAMTX_API_BASE_URL` in `backend/.env`.

If you are only testing on the same machine and want to avoid certificate setup temporarily, you can also open the publish page on `http://localhost:8889/live/stream-manual/publish`. The moment you switch to a LAN IP, the browser will expect a secure context.

## Manual Publish Check

Before backend automation, verify one path manually:

1. Start MediaMTX:

   ```powershell
   mediamtx mediamtx.yml
   ```

2. Open the browser-facing publish page from a LAN browser:

   ```text
   https://192.168.0.102:8889/live/stream-manual/publish
   ```

3. Allow camera and microphone access. MediaMTX should report a publisher on `live/stream-manual`.

4. Optionally check the Control API from the server machine:

   ```powershell
   curl http://127.0.0.1:9997/v3/paths/list
   ```

MediaMTX also exposes a WHIP ingest endpoint for custom publisher code:

```text
https://<server-lan-ip>:8889/live/stream-manual/whip
```

The MediaMTX docs confirm the built-in WebRTC browser publisher uses `/<path>/publish`, WHIP publishing uses `/<path>/whip`, and the Control API can list paths at `/v3/paths/list`.

## Troubleshooting

If the browser says `localhost refused to connect`, the issue is usually not camera permission yet. It usually means MediaMTX is not reachable on port `8889`.

Check these first:

- Make sure the MediaMTX process is still running and did not exit with a config error.
- Confirm `server.key` and `server.crt` exist if `webrtcEncryption: true` is enabled.
- On Windows, a local self-signed PEM pair works fine here too. The important part is that both files sit beside `mediamtx.yml` and are PEM-formatted, not PFX.
- From the server machine, test the port with `Test-NetConnection 192.168.0.102 -Port 8889`.
- From the same machine, try `https://localhost:8889/live/stream-manual/publish` if you are only doing a local smoke test.
- If you are connecting from another device, make sure Windows Firewall allows inbound traffic to port `8889`.

If the port is reachable but the page still fails, the next thing to inspect is the MediaMTX startup log. The browser page can only work after MediaMTX is actually serving the WebRTC endpoint.

## Backend Status Model

For Chapter 1, backend stream status is the primary application model:

- `publish-ready`: backend stream record exists and publish URLs have been issued.
- `publishing`: publisher start has been accepted and the browser is attempting to connect.
- `encoding`: FFmpeg is reading the MediaMTX path and writing HLS output.
- `live`: MediaMTX has an active publisher and HLS readiness checks pass.
- `failed`: publisher, encoder, or readiness checks fail for this stream only.

MediaMTX API reads are optional relay observations, not the only source of application state. The backend now normalizes each stream relay descriptor with:

- MediaMTX path: `live/<streamId>`
- browser publish URL: `<MEDIAMTX_WEBRTC_BASE_URL>/live/<streamId>/publish`
- WHIP URL: `<MEDIAMTX_WEBRTC_BASE_URL>/live/<streamId>/whip`
- Control API list URL: `<MEDIAMTX_API_BASE_URL>/v3/paths/list`
- Control API path detail URL: `<MEDIAMTX_API_BASE_URL>/v3/paths/get/live%2F<streamId>`

This keeps stream path construction in one backend helper and gives later stream APIs a consistent publish-ready/live decision point.
