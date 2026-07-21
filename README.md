# LeGames

A tiny browser-native game engine: browse published worlds, play them with live
multiplayer, and build your own in the Studio editor — no installs, no plugins.

- **Browse** (`/`) — grid of published games, sortable by newest/most liked/most
  played, with live "N playing now" badges
- **Studio** (`/studio.html`) — sculpt terrain, place and rotate **parts**
  (block / sphere / cylinder / wedge) in any orientation, attach real JavaScript
  behavior to any part, customize your avatar, publish
- **Play** (`/play.html?id=...`) — third-person WASD movement over real terrain
  and part-surface collision (including sloped/rotated parts), live multiplayer
  (see other players, chat), likes

Everything is a normal Express + Socket.io app — no build step. Three.js is loaded
straight from a CDN in the browser.

## Parts and rotation

Every placeable object is a **part**: a box, sphere, cylinder, or wedge, at any
position, size, and full XYZ rotation. In Studio, select a part, pick the
**Rotate** tool, and drag — plain drag spins yaw, Shift+drag pitches, Alt+drag
rolls. (Numeric degree fields in the inspector work too, for precision.)
Collision uses the same rotation matrix as rendering, sampled into a small
walkable-surface grid per part, so what you see is genuinely what you walk on
— verified this is correct for a rotated sphere, cylinder, and wedge, not just
approximated.

## Scripting: real JavaScript, sandboxed

Instead of a fixed menu of behaviors, any part can carry a JavaScript script
that runs when a player touches it:

```js
part.onTouch(() => {
  game.player.giveCoin(1);
  part.setVisible(false);
  game.broadcast('taken', true);   // sync to everyone in the room
});
game.on('taken', v => {            // catches up late joiners too
  if (v) part.setVisible(false);
});
```

API surface: `part.moveTo/rotateTo/setColor/setVisible/setCollidable/destroy/onTouch`,
`game.player.giveCoin/teleport/respawn/setCheckpoint`, `game.broadcast/on`,
`game.wait(seconds, fn)`. The Studio script editor has a template picker and a
cheatsheet, plus inline syntax-error checking before you can publish.

### How the sandbox actually works (read this before treating it as safe)

Every scripted part runs in its **own dedicated Web Worker**, not the main
page. That gets you two real guarantees for free: a worker has no access to
`document`, `window`, `localStorage`, or (since the session cookie is
`httpOnly`) the login cookie. On top of that, `server.js`/`part-worker.js`
strip `fetch`, `XMLHttpRequest`, `WebSocket`, `Worker`, `importScripts`, and a
few others from the worker's global scope before running any user code. A
heartbeat (ping every 2.5s) terminates any worker that stops responding, so a
`while(true){}` script gets killed instead of hanging the tab forever.

**What this does not do:** it is not a formal, audited sandbox. A worker can
still burn CPU/battery until the heartbeat catches it, and dynamic `import()`
inside worker-scoped code isn't something this blocks. Treat this as
defense-in-depth suitable for a demo/portfolio project where you trust the
people publishing games, not as something to expose to the open internet with
strangers uploading scripts. If you want to harden this further, look at
running scripts through a real sandboxing layer (e.g. `vm2`'s successor,
isolated-vm, or moving execution server-side with a proper resource-limited
runtime) before treating creator scripts as fully untrusted.

## Accounts

Sign in from the top-right of any page. Accounts are username + password
(bcrypt-hashed, session-based) — enough for a persistent identity, a
customizable avatar (color + hat/visor/halo), a "My published games" list, and
likes tied to you. Demo-grade auth: no password reset, no email verification,
no login rate-limiting.

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
4. Render auto-sets `PORT`; `server.js` already reads `process.env.PORT`.
5. **Set a real `SESSION_SECRET` environment variable** in Render's dashboard —
   the code falls back to a hardcoded dev secret otherwise.
6. Deploy. Socket.io's WebSocket transport works on Render's web services out of
   the box.

**One thing to know:** published games, users, and likes are stored in
`data/*.json` on disk. Render's free-tier filesystem is **not persistent across
deploys**. For a demo that's fine; for anything long-term, swap the
`load*()`/`save*()` functions in `server.js` for a real database.

## How it's built

- `server.js` — Express static server + REST API (`/api/games`, `/api/auth/*`)
  + Socket.io rooms (position/rotation/chat relay, and a **generic** pub/sub
  relay for part scripts — the server doesn't interpret script payloads at
  all, it just relays them and remembers the latest one per part so late
  joiners can catch up)
- `public/js/shared.js` — terrain mesh, part mesh (box/sphere/cylinder/wedge),
  and the rotation-aware collision-grid builder, used identically by Studio
  and Play
- `public/js/part-worker.js` — the sandboxed script runtime (see above)
- `public/js/auth.js` — shared login/register modal + topbar widget
- `public/js/studio.js` — terrain sculpting, part placement/rotation/inspector,
  script editor with templates + live syntax checking, avatar customizer, publish
- `public/js/play.js` — character controller (gravity + terrain + rotated-part
  collision), third-person camera, multiplayer sync, per-part worker lifecycle
  (spawn/heartbeat/teardown), touch-event detection (rising-edge, like
  Roblox's `Touched`), likes

## Known scope limits (still an honest MVP, not a Roblox competitor)

- **Scripts run per-client, not on an authoritative server.** Each player's
  browser runs its own copy of every scripted part. `game.broadcast`/`game.on`
  let creators explicitly sync state (and late joiners replay the last event
  per part), but there's no server-side authority resolving conflicts — two
  players touching a toggle at the same instant could see it flip twice.
  Real multiplayer games need authoritative server logic for anything that
  matters (scoring, economy); this doesn't have that.
- **No asset marketplace or economy**, no uploaded models/textures.
- **No mobile/console clients**, no moderation/content-review pipeline.
- Rotated-part collision uses a sampled height grid (verified correct for all
  four shapes), but two parts overlapping, or a part embedded inside terrain,
  aren't specially resolved.
- Max 24 scripted parts per game (a hard cap to bound worker count) — plenty
  for a demo world, not for something sprawling.
- Games are stored as flat JSON files — fine for dozens of games, not millions.
