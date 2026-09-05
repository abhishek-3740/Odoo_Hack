# DealFlow360 frontend

React + Vite application. This is the active frontend in the repository; the matching Spring Boot backend is in `../backend`.

## Start from VS Code

Use two terminals. `npm run dev` starts Vite only; it does not start Spring Boot.

Terminal 1, from the repository root:

```powershell
cd backend
# JAVA_HOME must point to your installed JDK 21.
.\mvnw.cmd spring-boot:run
```

Wait for Spring Boot to report that it started on port **8080**. It loads your ignored `backend/.env`, including hosted Supabase, demo authentication and Sarvam settings.

Terminal 2, from the repository root:

```powershell
cd frontend
npm ci
npm run dev
```

Open **http://127.0.0.1:3000**. Vite prints its API proxy target at startup. Both `/api` and WebSocket `/ws` target **http://127.0.0.1:8080** by default.

## Different backend port

Set `PORT` in `backend/.env`. Then set the matching URL in `frontend/.env.local`:

```dotenv
API_PROXY_TARGET=http://127.0.0.1:8080
```

Restart both processes after changing environment files. A terminal-level `API_PROXY_TARGET` overrides the file; remove an old override with `Remove-Item Env:API_PROXY_TARGET -ErrorAction SilentlyContinue`.

Never copy backend database credentials or the Sarvam key into frontend configuration. The Vite proxy target is the backend address, not the Supabase URL.

## Why the earlier preview worked while VS Code failed

The earlier test preview used a process-only proxy override to **8082**, backed by a disposable test database. A new VS Code terminal did not inherit that override and used the old default **8081**, but the saved backend configuration used **8080**. `ECONNREFUSED 127.0.0.1:8081` meant no backend was listening there. An outdated backend process on 8080 also needed restarting.

The implementation was already in this repository's `frontend` and `backend` folders. The differences were runtime configuration and running processes, not another source-code directory. Defaults are now aligned at 8080; the old test preview is no longer the normal product environment.

## Checks and troubleshooting

- Backend health: `http://127.0.0.1:8080/actuator/health`.
- Public catalog through Vite: `http://127.0.0.1:3000/api/v1/public/catalog`.
- Vite uses a strict port: if 3000 is occupied, stop the existing frontend before starting another. This prevents accidentally running two different portals.
- Vite warns when the configured backend cannot be reached. Read the backend terminal for database or startup errors.
- `npm run build` builds `dist`. Production needs SPA fallback and a reverse proxy for `/api` and `/ws`.
- `npm run lint` checks source.
- `npm run test:e2e` uses a separately configured disposable backend at port 8082. These tests create and modify demo quotations; do not point them at hosted/shared data.

See [the feature and verification guide](../docs/DealFlow360-Intelligence-Guide.md).
