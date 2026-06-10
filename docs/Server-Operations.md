# Chapter 1 Server Operations

This guide shows the fastest way to start, restart, stop, and check the local Chapter 1 servers from the repo root.

## What The Commands Control

The root command wrapper manages these local processes in order:

1. MediaMTX
2. nginx
3. backend
4. frontend

That matches the Chapter 1 runtime layout:

- MediaMTX receives browser WebRTC publishing.
- nginx serves HLS files from `backend/media/live/`.
- the backend orchestrates stream metadata and FFmpeg workers.
- the frontend provides the publisher and viewer UI.

## Commands

Run these from the repository root:

```powershell
npm run servers:start
npm run servers:restart
npm run servers:stop
npm run servers:status
```

## What Each Command Does

- `npm run servers:start` launches MediaMTX, nginx, the backend, and the frontend.
- `npm run servers:restart` stops the current processes and starts them again.
- `npm run servers:stop` stops the managed processes in reverse order.
- `npm run servers:status` prints whether each managed process is running and shows its PID.

## Runtime Files

The command wrapper writes local process data under `.runtime/`:

- `.runtime/logs/` stores stdout and stderr logs for each process.
- `.runtime/pids/` stores the tracked process IDs.
- `.runtime/nginx/` is used as the nginx prefix directory.

These files are ignored by git, so they stay local to your machine.

## Configuration Notes

- MediaMTX starts from `mediamtx.exe` in the repo root by default, or from `MEDIAMTX_BINARY` if you set it.
- nginx starts from `NGINX_BINARY` if you set it, and uses `config/nginx/runtime-nginx.conf`.
- the backend still reads its own `backend/.env` file.
- the frontend still uses the Vite backend proxy target from `frontend/vite.config.ts`.
- the server wrapper also reads `backend/.env` so binary paths and local runtime settings stay aligned with the backend.
- on Windows, the wrapper creates the nginx prefix directories it needs under `.runtime/nginx/`.

If your nginx install uses a different `mime.types` path, update `config/nginx/runtime-nginx.conf` before using the server wrapper.

## Manual Startup Order

If you want to start the components by hand instead of using the wrapper, use this order:

1. Start MediaMTX.
2. Start nginx.
3. Start the backend from `backend/` with `npm start`.
4. Start the frontend from `frontend/` with `npm run dev`.

For day-to-day work, the root npm scripts are faster because they keep the process list, logs, and restart order in one place.
