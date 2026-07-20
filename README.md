# LeGames

A tiny browser-native game engine: browse published worlds, play them with live
multiplayer, and build your own in the Studio editor — no installs, no plugins.

- **Browse** (`/`) — grid of published games
- **Studio** (`/studio.html`) — sculpt terrain, place blocks/ramps/spawns/coins/kill
  zones, then publish
- **Play** (`/play.html?id=...`) — third-person WASD movement over real terrain
  collision, live multiplayer via WebSockets (see other players move, chat)

Everything is a normal Express + Socket.io app — no build step. Three.js is loaded
straight from a CDN in the browser.

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Deploy to Render

1. Push this folder to a GitHub repo.
2. In Render: **New +** → **Web Service** → connect the repo.
3. Settings:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: any (the free tier works for testing)
4. Render auto-sets `PORT`; `server.js` already reads `process.env.PORT`, so no
   extra config is needed.
5. Deploy. Socket.io's WebSocket transport works on Render's web services out of
   the box — no special proxy config required.

**One thing to know:** published games are stored in `data/games.json` on disk.
Render's free-tier filesystem is **not persistent across deploys** (it resets
whenever the service redeploys or spins down after inactivity). For a portfolio
demo that's fine. For anything you want to keep long-term, swap `loadGames()` /
`saveGames()` in `server.js` for a real database (Render Postgres is a one-click
add-on) — the rest of the app doesn't need to change.

## How it's built

- `server.js` — Express static server + REST API (`/api/games`) + Socket.io rooms
  (one room per game, relays position/rotation/chat between players)
- `public/js/shared.js` — terrain mesh + object mesh builders used identically by
  both Studio and Play, so what you build is what you play
- `public/js/studio.js` — the editor: brush-based terrain sculpting, object
  placement/inspector, publish
- `public/js/play.js` — the player: custom lightweight character controller
  (gravity + heightfield collision + simple box collision), third-person camera,
  multiplayer sync at ~12Hz, proximity-based coins/kill zones

## Known scope limits (this is a basic MVP, not a Roblox competitor)

- No accounts/auth — anyone can publish, all games are public
- No scripting language in Studio — behavior is limited to the built-in object
  types (block, ramp, spawn, coin, kill zone)
- Ramps are visual/blocking only (not slope-walkable yet)
- Games are stored as flat JSON, fine for dozens of games, not thousands
- No asset uploads (models/textures) — everything is built from primitives
