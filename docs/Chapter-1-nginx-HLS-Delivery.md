# Chapter 1 nginx HLS Delivery

This document captures the Part 9 nginx HLS delivery implementation. nginx is the LAN-facing web server for generated HLS manifests and media segments.

## Purpose

FFmpeg writes HLS output to the backend media directory:

```text
backend/media/live/<streamId>/
```

nginx serves those files under one stable URL prefix:

```text
http://<server-lan-ip>/hls/<streamId>/master.m3u8
```

The backend still does not serve HLS manifests or segments. It only returns playback URLs that point at nginx.

## Config File

The checked-in nginx server block lives at:

```text
config/nginx/chapter-1-hls.conf
```

For this workspace it aliases:

```text
/hls/ -> D:/Work/OTT-Platform/backend/media/live/
```

If the repo is cloned somewhere else, update the `alias` path before starting nginx. Keep the trailing slash on the alias path because nginx uses it to map:

```text
/hls/stream-alpha/master.m3u8
```

to:

```text
D:/Work/OTT-Platform/backend/media/live/stream-alpha/master.m3u8
```

## Cache Rules

Live HLS manifests change often, so `.m3u8` files use:

```text
Cache-Control: no-cache, no-store, must-revalidate
```

Media segments are immutable enough for a short LAN cache, so `.ts` files use:

```text
Cache-Control: public, max-age=10
```

This keeps players from getting stale playlists while still allowing repeated segment requests to be handled efficiently by nginx.

## CORS

The config adds CORS headers because the frontend dev server usually runs on a different origin:

```text
http://<server-lan-ip>:5173
```

while nginx serves HLS from:

```text
http://<server-lan-ip>
```

The config also allows the `Range` request header because browsers and media players may request byte ranges while loading media.

## Directory Listing

Directory browsing stays disabled with:

```text
autoindex off;
```

Requests should target known files such as:

```text
/hls/<streamId>/master.m3u8
/hls/<streamId>/360p/index.m3u8
/hls/<streamId>/360p/000000.ts
```

Opening `/hls/` or `/hls/<streamId>/` should not expose a directory listing.

## Local Verification

After FFmpeg has generated HLS output for a stream, check:

```powershell
curl.exe -I http://127.0.0.1/hls/<streamId>/master.m3u8
curl.exe -I http://127.0.0.1/hls/<streamId>/360p/000000.ts
```

Expected results:

- `master.m3u8` returns from nginx with no-cache headers.
- `.ts` segments return from nginx with `max-age=10`.
- Directory URLs do not show file listings.
- No backend `/api` route is involved in manifest or segment delivery.

## Test Coverage

The static delivery rules are covered in:

```text
backend/test/nginxDeliveryConfig.test.js
```

The tests verify:

- `/hls/` aliases to the generated HLS media root.
- the config does not use `proxy_pass` for HLS delivery.
- `.m3u8` manifests use no-cache headers.
- `.ts` segments use short cache headers.
- CORS headers are present for cross-origin frontend playback.

Run backend verification with:

```powershell
cd backend
npm test
npm run check
```
