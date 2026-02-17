# NoFx Docker Deployment

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Docker Network (nofx-network)                                  │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │  nofx-frontend│    │  nofx        │    │  nofx-adapter    │  │
│  │  (Nginx)      │───▶│  (Go backend)│───▶│  (Node.js)       │  │
│  │  :3000 → :80  │    │  :8080       │    │  :8888           │  │
│  └──────────────┘    └──────────────┘    └────────┬─────────┘  │
│                                                    │            │
└────────────────────────────────────────────────────┼────────────┘
                                                     │ HTTP
                                                     ▼
                                          ┌──────────────────┐
                                          │  OpenClaw Gateway │
                                          │  (Host :18789)    │
                                          │  /v1/responses    │
                                          └──────────────────┘
                                                     │
                                                     ▼
                                              ┌──────────┐
                                              │  Leeloo  │
                                              │  (Claude) │
                                              └──────────┘
```

**Data flow:** User → Frontend → Backend → Adapter → OpenClaw Gateway → AI → Decisions → Backend → Execute trades

## Prerequisites

- **Docker Desktop** with WSL2 backend (Windows) or Docker Engine (Linux)
- **OpenClaw Gateway** running on the host machine on port 18789
- OpenClaw Gateway must have **OpenResponses API** enabled

## Quick Start

```bash
# 1. Clone and enter the repo
cd /home/thomas/nofx

# 2. Configure environment (edit .env with your values)
cp .env.example .env
# Set OPENCLAW_GATEWAY_TOKEN to your gateway auth token

# 3. Start all services
docker compose up -d

# 4. Check health
docker compose ps
curl http://localhost:8888/health   # Adapter
curl http://localhost:8080/api/health  # Backend
curl http://localhost:3000/health   # Frontend
```

## Environment Variables

### Adapter Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_GATEWAY_URL` | `http://host.docker.internal:18789` | OpenClaw Gateway URL |
| `OPENCLAW_GATEWAY_TOKEN` | *(required)* | Gateway authentication token |
| `OPENCLAW_MODEL` | `openclaw:opus` | AI model to use |
| `OPENCLAW_SESSION_KEY` | `agent:opus:trading-main` | Session routing key |
| `NOFX_ADAPTER_PORT` | `8888` | Adapter port mapping on host |
| `THINKING_LEVEL` | *(unset)* | AI thinking level: low/medium/high/off |
| `TIMEOUT_MS` | `120000` | Request timeout in milliseconds |

### NoFx Backend

| Variable | Default | Description |
|----------|---------|-------------|
| `NOFX_BACKEND_PORT` | `8080` | Backend port mapping on host |
| `OPENCLAW_BASE_URL` | `http://nofx-adapter:8888` | Set automatically in docker-compose |
| `DB_TYPE` | `sqlite` | Database type |
| `DB_PATH` | `data/test_data.db` | Database path |

### Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `NOFX_FRONTEND_PORT` | `3000` | Frontend port mapping on host |

## Services

### nofx-adapter (Trading Decision Adapter)
- **Image:** `node:20-alpine`
- **Port:** 8888
- **Zero dependencies** — uses only Node.js built-in modules
- **Endpoints:**
  - `GET /health` — Health check with gateway connectivity status
  - `POST /api/v1/trading/decision` — Trading decision endpoint
- **Volume:** `./data/adapter` — Decision logs and adapter logs

### nofx (Backend)
- **Port:** 8080
- **Depends on:** nofx-adapter (waits for healthy)
- **Volume:** `./data` — Database and application data

### nofx-frontend (Frontend)
- **Port:** 3000
- **Depends on:** nofx

## Troubleshooting

### Adapter can't reach OpenClaw Gateway
```
"status": "degraded", "gateway": { "connected": false }
```
- **Linux Docker:** The `extra_hosts: ["host.docker.internal:host-gateway"]` mapping is included. Verify with: `docker exec nofx-adapter wget -q -O- http://host.docker.internal:18789/`
- **WSL2:** Make sure OpenClaw Gateway is listening on `0.0.0.0:18789`, not just `127.0.0.1`
- Check firewall rules allow connections from Docker bridge network

### Gateway returns 401
- Verify `OPENCLAW_GATEWAY_TOKEN` in `.env` matches your gateway's auth token
- Test manually: `curl -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" http://localhost:18789/v1/responses`

### Trading decisions timing out
- Default timeout is 120s. AI responses typically take 15-30s
- Increase `TIMEOUT_MS` in `.env` if needed
- Check gateway logs for errors

### Strategy file not found
- The strategy file (`nofx-strategy-hybrid-tiers.json`) is baked into the adapter Docker image
- To update it, rebuild: `docker compose build nofx-adapter`

### Rebuilding after changes
```bash
docker compose build nofx-adapter
docker compose up -d nofx-adapter
```

### Viewing logs
```bash
docker compose logs -f nofx-adapter
docker compose logs -f nofx
```
