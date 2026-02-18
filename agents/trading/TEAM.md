# Trading Team — Overview

## Members
| Agent | Navn | Workspace | Personlighed |
|-------|------|-----------|--------------|
| 📊 Analyst | **Nova** | `teams/trading/analyst/` | Data nørd. Tal med sjæl. "Dataen viser..." |
| ⚠️ Risk Manager | **Sentinel** | `teams/trading/risk-manager/` | Professionelt paranoid. Læser flyvragsrapporter. |
| 🎯 Strategist | **Edge** | `teams/trading/strategist/` | Pokerspilleren. "Hvad nu hvis vi..." |
| 🤖 Trader | **Leeloo** | `clawd/` (main) | Orkestrator + eksekvering |
| 👑 CEO | **Thomas** | — | Mennesket. Har veto. |

## Discord Server: NoFx HQ
- **Server ID:** 1473344231820234762
- **Category:** Trading Team

### Channels
| Channel | ID | Formål |
|---------|-----|--------|
| #general | 1473344233204224228 | Frit forum |
| #daily-briefing | 1473346494638850239 | Morgen-ritual (08:00) |
| #strategy-lab | 1473346496521965598 | Strategi-diskussioner |
| #risk-alerts | 1473346498157740178 | Risk Manager advarsler |
| #trade-log | 1473346499818684457 | Auto-feed af beslutninger |

## Workflow: Morning Ritual (08:00)
1. **Analyst** reads yesterday's data → posts summary in #daily-briefing
2. **Risk Manager** analyzes risk exposure → posts concerns
3. **Strategist** finds patterns → proposes adjustments in #strategy-lab
4. **Discussion** in #strategy-lab → consensus or disagreement
5. **Thomas** approves/vetoes → Leeloo updates NoFx DB if approved

## Workflow: Strategy Change
1. Strategist proposes in #strategy-lab (with data)
2. Risk Manager challenges (pokes holes)
3. Analyst provides supporting/contradicting data
4. Thomas decides
5. If approved: Leeloo stops trader → updates DB → starts trader

## Rules
- **No agent can change strategy directly** — Thomas approves all changes
- **Data > opinions** — back everything with numbers
- **Disagree openly** — that's the whole point of having a team
- **Risk Manager can call STOP** — escalates to Thomas immediately

## Status
- [x] Discord server + channels created
- [x] Agent workspace structure created
- [x] Agent personalities designed (with Thomas) ✅
- [x] OpenClaw agent config (per-agent workspace) ✅
- [x] Strategy management tool (`strategy-tool.sh`) ✅
- [ ] Morning ritual cron job (venter på Sonnet kvote-reset torsdag)
- [ ] Test-briefing med reelle data → Discord
- [ ] Trade-log auto-feed
