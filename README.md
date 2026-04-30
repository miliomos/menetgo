# Útvonal

Modern Hungarian public transit route planner with real-time departure boards, built on GTFS data from BKK and Volánbusz.

> This project was **vibe coded** — every line written in real-time through conversation with an AI coding assistant. No prior code, no boilerplate, no scaffolding. Just ideas flowing directly into a working application.

## Features

- **Instant route planning** — search by station name with autocomplete, find direct routes and 1-transfer connections
- **Whole-day schedule** — toggle to see departures spread across 24 hours
- **Real-time departure boards** — live updates for major Budapest hubs
- **District-aware search** — filter results by Budapest districts
- **Route history** — frequently searched routes saved locally for quick access
- **Clean, minimal UI** — modern glassmorphism design with teal/green palette

## Tech Stack

- **Backend**: Node.js + Express with custom GTFS parser
- **Frontend**: Vanilla HTML/CSS/JS, no frameworks
- **Data**: BKK GTFS + Volánbusz GTFS (real Hungarian transit feeds)
- **Memory**: ~4GB heap for ~68k stops and 6M+ stop_times

## Quick Start

```bash
npm install
npm start
```

Server runs on `http://localhost:5500`. First cold start takes ~60–90s to parse and index GTFS data.

## Project Structure

```
index.html          # Landing page + search form
styles.css          # Modern glassmorphism UI
script.js           # Frontend logic, autocomplete, real-time board
server.js           # Express server, API endpoints
gtfs/
  loader.js         # GTFS download & CSV parsing
  graph.js          # Transit graph & spatial index
  router.js         # Route finding (direct + 1-transfer)
```

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/stations?q=` | GET | Station autocomplete search |
| `/api/routes` | POST | Route planning (from/to, time, transfers) |
| `/api/departures` | GET | Station departure board |
| `/api/status` | GET | Server readiness check |

## Why "Vibe Coded"?

Most projects start with scaffolding, boilerplate, and days of setup. This one started with a blank file and a conversation. Every feature — the GTFS parser, the routing algorithm, the real-time board, the responsive UI — emerged organically through iterative dialogue. The result is a functional, production-capable transit planner built in hours, not weeks.
