# LifeOS Dashboard

A standalone, mobile-first React dashboard for Life OS.

## What this dashboard does

- Reads canonical markdown notes from `~/my-data`
- Uses a minimal top-level `LifeOS` header with content-type navigation
- Opens on **Home** by default, with Home and Tasks sharing the current task lens for now
- Restores a **Projects** view with active projects, task counts, and inferred next action
- Gives **Notes**, **People**, **Goals**, **Check-ins**, and **Journal** placeholder views so the information architecture is there before the custom lenses are designed
- Lets task buttons act like in-place filters (`Overdue`, `Due soon`, `Recurring`, `In progress`, `Other active`) instead of jump links
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

## Persistent systemd service

The dashboard now runs as a **user-level systemd service** so it survives new chats, restarts on crash, and starts automatically on boot.

Service name:

```bash
lifeos-dashboard.service
```

Important files:

- systemd unit: `~/.config/systemd/user/lifeos-dashboard.service`
- repo copy of the unit: `ops/systemd/lifeos-dashboard.service`
- service runner: `scripts/run-service.sh`
- local deploy helper: `scripts/deploy-service.sh`

Useful commands:

```bash
systemctl --user status lifeos-dashboard.service
systemctl --user restart lifeos-dashboard.service
journalctl --user -u lifeos-dashboard.service -n 100 --no-pager
```

When you make dashboard changes and want the permanent app on `3007` updated:

```bash
cd /home/ilangurudev/projects/lifeos-dashboard
./scripts/deploy-service.sh
```

That rebuilds the app and restarts the service.

## Dev/live reload workflow

For active UI/backend iteration, keep using:

```bash
cd /home/ilangurudev/projects/lifeos-dashboard
npm run dev
```

That gives you:

- Vite with live reload on `http://localhost:5173`
- backend watch mode on `http://localhost:3007`

Rule of thumb:

- `3007` = the stable always-on dashboard service
- `5173` = the live-reload dev UI

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
