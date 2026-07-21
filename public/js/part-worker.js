// Runs inside a dedicated Web Worker per scripted part. Workers have no access
// to `document`, `window`, `localStorage`, or cookies by design — that's the
// baseline isolation this relies on. On top of that we strip networking
// primitives below so a script can't phone home or ride the player's session.
// This is defense-in-depth, not a formal sandbox: a script can still burn CPU
// (mitigated by the heartbeat/terminate below) and dynamic `import()` cannot
// be fully blocked from inside the worker itself. Don't run scripts from
// creators you don't trust.

self.fetch = undefined;
self.XMLHttpRequest = undefined;
self.WebSocket = undefined;
self.EventSource = undefined;
self.Worker = undefined;
self.SharedWorker = undefined;
self.importScripts = undefined;
self.indexedDB = undefined;
self.caches = undefined;
if (self.navigator) { try { self.navigator.sendBeacon = undefined; } catch (e) {} }

let touchHandlers = [];
let eventHandlers = {};
let state = null; // { id, shape, x,y,z, sx,sy,sz, rx,ry,rz, color, canCollide, visible }
let playerCoins = 0;

function post(msg) { self.postMessage(msg); }

const part = {
  get id() { return state.id; },
  get position() { return { x: state.x, y: state.y, z: state.z }; },
  get size() { return { x: state.sx, y: state.sy, z: state.sz }; },
  get rotation() { return { x: state.rx, y: state.ry, z: state.rz }; },
  get color() { return state.color; },
  get visible() { return state.visible !== false; },
  get collidable() { return state.canCollide !== false; },
  moveTo(x, y, z) {
    state.x = x; state.y = y; state.z = z;
    post({ type: 'set', prop: 'position', value: { x, y, z } });
  },
  rotateTo(rx, ry, rz) {
    state.rx = rx; state.ry = ry; state.rz = rz;
    post({ type: 'set', prop: 'rotation', value: { x: rx, y: ry, z: rz } });
  },
  setColor(hex) { state.color = hex; post({ type: 'set', prop: 'color', value: hex }); },
  setVisible(v) { state.visible = !!v; post({ type: 'set', prop: 'visible', value: !!v }); },
  setCollidable(v) { state.canCollide = !!v; post({ type: 'set', prop: 'collidable', value: !!v }); },
  destroy() { post({ type: 'destroy' }); },
  onTouch(fn) { if (typeof fn === 'function') touchHandlers.push(fn); }
};

const game = {
  player: {
    get coins() { return playerCoins; },
    giveCoin(n) { post({ type: 'player-cmd', cmd: 'giveCoin', args: [n ?? 1] }); },
    teleport(x, y, z) { post({ type: 'player-cmd', cmd: 'teleport', args: [x, y, z] }); },
    respawn() { post({ type: 'player-cmd', cmd: 'respawn', args: [] }); },
    setCheckpoint() { post({ type: 'player-cmd', cmd: 'setCheckpoint', args: [] }); }
  },
  broadcast(name, data) { post({ type: 'broadcast', name: String(name), data: data ?? null }); },
  on(name, fn) {
    if (typeof fn !== 'function') return;
    (eventHandlers[name] = eventHandlers[name] || []).push(fn);
  },
  wait(seconds, fn) { setTimeout(() => safeCall(fn), Math.max(0, (seconds || 0) * 1000)); }
};

function safeCall(fn, ...args) {
  try { fn(...args); }
  catch (e) { post({ type: 'error', message: String(e && e.message || e) }); }
}

self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    touchHandlers = [];
    eventHandlers = {};
    state = data.part;
    playerCoins = data.playerCoins || 0;
    try {
      const run = new Function('part', 'game', data.script);
      run(part, game);
      // replay any last-known custom events (e.g. a door's current open state)
      (data.replayEvents || []).forEach(ev => {
        (eventHandlers[ev.name] || []).forEach(fn => safeCall(fn, ev.data));
      });
      post({ type: 'ready' });
    } catch (e) {
      post({ type: 'error', message: String(e && e.message || e) });
    }
  } else if (data.type === 'touch') {
    touchHandlers.forEach(fn => safeCall(fn, data.player));
  } else if (data.type === 'event') {
    (eventHandlers[data.name] || []).forEach(fn => safeCall(fn, data.data));
  } else if (data.type === 'coins-sync') {
    playerCoins = data.coins;
  } else if (data.type === 'ping') {
    post({ type: 'pong' });
  }
};
