# 🧊 Freezer Tracker

A simple, self-hosted freezer inventory app. Track what's in your freezer, add items with natural language, and share access over Tailscale.

Built with FastAPI + React + SQLite, fully containerized with Docker.

## Features

- **Natural language input** — type "2 lbs of chicken thighs" and it parses automatically
- **Capacity estimate** — visual progress bar based on freezer dimensions, with manual calibration
- **Inline editing** — edit items directly in the table
- **Zero ongoing cost** — runs entirely on your hardware, no cloud services

## Quick Start

```bash
git clone https://github.com/Ryan-Haines/freezer-tracker.git
cd freezer-tracker
docker compose up -d --build
```

- **Frontend:** http://localhost:5174
- **API:** http://localhost:8001

That's it. The database is created automatically on first run with some seed data. Delete the seed items and add your own.

## Customization

### Freezer Dimensions

Edit the constants in `frontend/src/App.jsx`:

```js
const FREEZER_VOLUME_CUBIC_IN = 33 * 20 * 34 // width × depth × height in inches
```

### Volume Estimates

Tune how much space each unit type takes up (in cubic inches):

```js
const VOLUME_ESTIMATES = {
  lbs: 245,
  g: 0.15,
  gallon: 315,
  count: 350,
}
```

Or just use the built-in calibration — click the capacity percentage in the UI and enter what you think the real value is. It scales from there.

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/items` | List all items |
| POST | `/api/items` | Add item (JSON: `name`, `quantity`, `unit`) |
| PUT | `/api/items/:id` | Update item |
| DELETE | `/api/items/:id` | Delete item |
| POST | `/api/parse` | Add item via natural language (JSON: `text`) |
| GET | `/api/last-updated` | Last inventory update timestamp |

## Sharing Over Tailscale

To access the app from other devices on your tailnet:

1. **Install Tailscale** on the host machine and any devices that need access: https://tailscale.com/download

2. **Enable HTTPS (optional):** In the Tailscale admin console, enable MagicDNS and HTTPS certificates.

3. **Set up Tailscale Serve** to proxy traffic to the frontend:

```bash
tailscale serve --bg 5174 http://localhost:5174
```

4. **Add your Tailscale hostname** to the Vite config so it accepts the proxied requests. In `frontend/vite.config.js`, uncomment and edit:

```js
allowedHosts: ['your-machine.your-tailnet.ts.net'],
```

5. **Rebuild the frontend container:**

```bash
docker compose up -d --build frontend
```

6. Access from any device on your tailnet at `https://your-machine.your-tailnet.ts.net:5174`

### Sharing with Guests

To give someone else access (e.g., a family member):

1. Invite them to your tailnet or use Tailscale's node sharing
2. Add an ACL rule restricting their access to just the app port:

```json
{
  "groups": {
    "group:freezer": ["guest@example.com"]
  },
  "hosts": {
    "your-machine": "100.x.x.x"
  },
  "acls": [
    {"action": "accept", "src": ["group:freezer"], "dst": ["your-machine:5174"]}
  ]
}
```

## Data

The SQLite database lives in `data/freezer.db`. It's created automatically on first run. Back it up however you like — it's just a file.

The `data/` directory is gitignored. Your inventory stays local.

## Stack

- **Backend:** Python, FastAPI, SQLAlchemy, SQLite
- **Frontend:** React, Vite
- **Infra:** Docker Compose
- **Networking:** Tailscale (optional)

## License

MIT
