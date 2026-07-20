# LeGames

A tiny browser-native game engine: browse published worlds, play them with live
multiplayer, and build your own in the Studio editor — no installs, no plugins.

- **Browse** (`/`) — grid of published games, sortable by newest/most liked/most
  played, with live "N playing now" badges
- **Studio** (`/studio.html`) — sculpt terrain, place blocks/ramps/spawns/coins/kill
  zones, attach touch-triggered behavior to objects, customize your avatar, publish
- **Play** (`/play.html?id=...`) — third-person WASD movement over real terrain and
  ramp-slope collision, live multiplayer (see other players, chat), likes

Everything is a normal Express + Socket.io app — no build step. Three.js is loaded
straight from a CDN in the browser.

## Accounts

Sign in from the top-right of any page. Accounts are username + password
(bcrypt-hashed, session-based) — enough to have a persistent identity, a
customizable avatar (color + hat/visor/halo), a "My published games" list, and
likes tied to you. This is a demo-grade auth system, not something to reuse
as-is for a real product (no password reset, no email verification, no rate
limiting on login attempts).

## Object scripting

Any Block or Ramp in Studio can get a **touch script**:
- **Give a coin** — adds to the player's coin count on touch
- **Set as checkpoint** — future respawns happen here instead of a random spawn
- **Teleport player** — sends the player to a chosen x/y/z
- **Toggle door** — the object disappears/reappears (and stops/starts blocking)
  for everyone in the room, synced live over the socket

This is a fixed menu of behaviors, not a general scripting language — see
"scope limits" below.

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
5. **Set a real `SESSION_SECRET` environment variable** in Render's dashboard —
   the code falls back to a hardcoded dev secret if you don't, which is fine for
   testing but not for anything real (anyone with the source can forge sessions).
6. Deploy. Socket.io's WebSocket transport works on Render's web services out of
   the box — no special proxy config required.

**One thing to know:** published games, users, and likes are stored in
`data/*.json` on disk. Render's free-tier filesystem is **not persistent across
deploys** (it resets whenever the service redeploys or spins down after
inactivity). For a portfolio demo that's fine. For anything you want to keep
long-term, swap the `load*()`/`save*()` functions in `server.js` for a real
database (Render Postgres is a one-click add-on) — the rest of the app doesn't
need to change.

## How it's built

- `server.js` — Express static server + REST API (`/api/games`, `/api/auth/*`)
  + Socket.io rooms (one room per game, relays position/rotation/chat/door-state
    between players)
- `public/js/shared.js` — terrain mesh, object mesh, and ramp-collision-grid
  builders used identically by both Studio and Play, so what you build is what
  you play
- `public/js/auth.js` — shared login/register modal + topbar widget, used on
  all three pages
- `public/js/studio.js` — the editor: brush-based terrain sculpting, object
  placement/inspector, touch-script assignment, avatar customizer, publish
- `public/js/play.js` — the player: custom lightweight character controller
  (gravity + terrain-heightfield collision + walkable ramp slopes + box
  collision), third-person camera, multiplayer sync at ~12Hz, script execution,
  live door sync, likes

## Known scope limits (this is a solid MVP, not a Roblox competitor)

Being upfront about the size of the actual gap:

- **No real scripting language.** Roblox's core is Lua — arbitrary
  creator-written code. LeGames instead has a fixed menu of touch-script
  behaviors (coin/checkpoint/teleport/door). Building a safe, sandboxed
  scripting language creators can write freely is a project of its own, not an
  incremental add-on.
- **No asset marketplace or economy.** No uploaded models/textures, no virtual
  currency, no purchases — everything is built from a handful of primitives.
- **No mobile/console clients**, no built-in moderation or content review
  pipeline, no chat filtering.
- **Auth is intentionally minimal** (see above) — fine for a demo, not
  production-hardened.
- Games are stored as flat JSON files, fine for dozens of games, not the
  millions Roblox serves.
- Ramp collision is solid (verified against the actual render transform, walks
  correctly at any yaw), but two ramps meeting at an angle, or a ramp under
  another object, aren't specially handled.

