# OTT-Platform
A live streaming pipeline, a low-latency monitoring feed, an on-demand video service, ad capabilities, and a cloud-ready architecture.

## Quick Setup

### All Servers

```bash
npm run servers:start
npm run servers:restart
npm run servers:stop
npm run servers:status
```

See [docs/Chapter-1-Server-Operations.md](docs/Chapter-1-Server-Operations.md) for the runtime details and startup order.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Backend

```bash
cd backend
npm install
npm test
```

The backend is currently a scaffold, so `npm test` is a placeholder until real server tests are added.
