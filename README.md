# LifeOS Dashboard

A standalone, mobile-first React dashboard for Life OS.

## What this MVP does

- Reads canonical markdown notes from `~/my-data`
- Shows a **Tasks** view grouped into overdue, due soon, in progress, blocked, and other active tasks
- Shows a **Projects** view with active projects, open-task counts, overdue counts, and an inferred next action
- Runs as a local web app on port `3007` and can be reached over Tailscale
- Links back to the underlying Obsidian notes using the existing obsidian-links applet

## Stack

- React + Vite + TypeScript
- Express + TypeScript backend
- `gray-matter` for frontmatter parsing
- `fast-glob` for vault scanning
- `chrono-node` for loose date parsing

## Local development

```bash
cd /home/ilangurudev/projects/lifeos-dashboard
npm install
npm run dev
```

That starts:
- Vite on `http://localhost:5173`
- API server on `http://localhost:3007`

Vite proxies `/api` requests to the backend.

## Production-ish local run

```bash
cd /home/ilangurudev/projects/lifeos-dashboard
npm run build
npm run serve
```

The backend serves the built frontend from `dist/` on port `3007`.

## Tailscale access

If Tailscale is running on the host machine, open:

```text
http://<tailscale-ip>:3007
```

For this machine right now, the Tailscale IPv4 address is:

```text
http://100.117.177.89:3007
```

## Config

Environment variables:

- `PORT` — defaults to `3007`
- `LIFEOS_ROOT` — defaults to `/home/ilangurudev/my-data`

Example:

```bash
PORT=3007 LIFEOS_ROOT=/home/ilangurudev/my-data npm run serve
```

## Notes

This MVP is intentionally read-only. Markdown in `~/my-data` remains the source of truth.

Good next upgrades:
- Today view
- quick actions (done / snooze)
- better filtering
- stale project detection
- people/review tabs
