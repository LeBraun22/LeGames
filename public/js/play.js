import * as THREE from 'three';
import { buildTerrainMesh, buildPartMesh, terrainHeightAt, buildPartHeightGrid, queryPartHeight, boundingRadiusXZ } from './shared.js';
import { fetchMe, mountAuthWidget, getUser, openAuthModal } from './auth.js';

const params = new URLSearchParams(location.search);
const gameId = params.get('id');
const lockHint = document.getElementById('lockHint');
const lockTitle = document.getElementById('lockTitle');
const lockDesc = document.getElementById('lockDesc');
const enterBtn = document.getElementById('enterBtn');
const nameInput = document.getElementById('playerName');

mountAuthWidget(document.getElementById('authSlot'));
fetchMe().then(u => { if (u) nameInput.value = u.username; });

if (!gameId) {
  lockTitle.textContent = 'No game selected';
  lockDesc.textContent = 'Go back to Browse and pick a game to play.';
  enterBtn.style.display = 'none';
}

let game = null;
let started = false;

fetch(`/api/games/${gameId}`)
  .then(r => { if (!r.ok) throw new Error('not found'); return r.json(); })
  .then(g => {
    game = g;
    document.getElementById('gameTitle').textContent = g.name;
    lockTitle.textContent = g.name;
    lockDesc.textContent = g.description || 'Jump in and explore this world with other players live.';
    setLikeUI(g.likeCount, g.liked);
    buildWorld(g);
  })
  .catch(() => {
    lockTitle.textContent = 'Could not load this game';
    lockDesc.textContent = 'It may have been removed, or the server is unreachable.';
    enterBtn.style.display = 'none';
  });

// ---------- like button ----------
const likeBtn = document.getElementById('likeBtn');
function setLikeUI(count, liked) {
  likeBtn.textContent = `${liked ? '♥' : '♡'} ${count}`;
  likeBtn.classList.toggle('liked', !!liked);
}
likeBtn.addEventListener('click', async () => {
  if (!gameId) return;
  if (!getUser()) { openAuthModal('login', () => likeBtn.click()); return; }
  const res = await fetch(`/api/games/${gameId}/like`, { method: 'POST' });
  if (!res.ok) return;
  const data = await res.json();
  setLikeUI(data.likeCount, data.liked);
});

// ---------- three.js world ----------
const root = document.getElementById('game-root');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#7fc7ff');
scene.fog = new THREE.Fog('#bfe3ff', 60, 220);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 2000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.setSize(window.innerWidth, window.innerHeight);
root.appendChild(renderer.domElement);
renderer.domElement.style.position = 'absolute';
renderer.domElement.style.inset = '0';
renderer.domElement.style.zIndex = '1';

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const hemi = new THREE.HemisphereLight('#bfe3ff', '#2b3a22', 0.8);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff6e6', 1.15);
sun.position.set(80, 120, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -100; sun.shadow.camera.right = 100;
sun.shadow.camera.top = 100; sun.shadow.camera.bottom = -100;
scene.add(sun);

let terrain = null, terrainScale = 2;
const spawns = [];
let checkpoint = null;

// colliders: Map<partId, { obj, mesh, grid, boundingRadius, canCollide }>
const colliders = new Map();
// scripts: Map<partId, { worker, ready, lastPong, missedPongs, errorCount }>
const scripts = new Map();
const MAX_SCRIPTED_PARTS = 24;

function buildWorld(g) {
  terrain = g.terrain;
  terrainScale = g.terrainScale || 2;
  const terrainMesh = buildTerrainMesh(terrain, terrainScale);
  scene.add(terrainMesh);

  let scriptCount = 0;
  g.objects.forEach(obj => {
    if (obj.type === 'spawn') { spawns.push(obj); return; }
    if (obj.type !== 'part') return;

    const mesh = buildPartMesh(obj);
    scene.add(mesh);
    const grid = buildPartHeightGrid(obj);
    colliders.set(obj.id, {
      obj, mesh, grid,
      boundingRadius: boundingRadiusXZ(obj),
      canCollide: obj.canCollide !== false
    });

    if (obj.script && obj.script.trim()) {
      if (scriptCount >= MAX_SCRIPTED_PARTS) {
        console.warn(`LeGames: skipping script on part ${obj.id} — this world has more than ${MAX_SCRIPTED_PARTS} scripted parts.`);
        return;
      }
      scriptCount++;
      startScriptWorker(obj);
    }
  });
}

// ---------- script worker management ----------
function startScriptWorker(obj) {
  const worker = new Worker('/js/part-worker.js');
  const entry = { worker, ready: false, lastPong: Date.now(), missedPongs: 0, errorCount: 0 };
  scripts.set(obj.id, entry);

  worker.onmessage = ({ data }) => handleWorkerMessage(obj.id, data);
  worker.onerror = e => {
    console.warn(`LeGames: script error on part ${obj.id}:`, e.message);
    entry.errorCount++;
  };

  worker.postMessage({
    type: 'init',
    part: { id: obj.id, shape: obj.shape, x: obj.x, y: obj.y, z: obj.z, sx: obj.sx, sy: obj.sy, sz: obj.sz, rx: obj.rx, ry: obj.ry, rz: obj.rz, color: obj.color, canCollide: obj.canCollide !== false, visible: true },
    script: obj.script,
    playerCoins: coinScore,
    replayEvents: []
  });
}

function handleWorkerMessage(partId, data) {
  const entry = scripts.get(partId);
  const c = colliders.get(partId);
  if (data.type === 'ready') { if (entry) entry.ready = true; return; }
  if (data.type === 'pong') { if (entry) { entry.lastPong = Date.now(); entry.missedPongs = 0; } return; }
  if (data.type === 'error') {
    if (entry) entry.errorCount++;
    console.warn(`LeGames: script error on part ${partId}:`, data.message);
    return;
  }
  if (!c) return;

  if (data.type === 'set') {
    if (data.prop === 'position') { c.obj.x = data.value.x; c.obj.y = data.value.y; c.obj.z = data.value.z; c.mesh.position.set(data.value.x, data.value.y, data.value.z); c.grid = buildPartHeightGrid(c.obj); }
    else if (data.prop === 'rotation') { c.obj.rx = data.value.x; c.obj.ry = data.value.y; c.obj.rz = data.value.z; c.mesh.rotation.set(data.value.x, data.value.y, data.value.z); c.grid = buildPartHeightGrid(c.obj); }
    else if (data.prop === 'color') { c.obj.color = data.value; c.mesh.material.color.set(data.value); }
    else if (data.prop === 'visible') { c.mesh.visible = data.value; }
    else if (data.prop === 'collidable') { c.canCollide = data.value; }
  } else if (data.type === 'destroy') {
    scene.remove(c.mesh);
    colliders.delete(partId);
    const e = scripts.get(partId);
    if (e) { e.worker.terminate(); scripts.delete(partId); }
  } else if (data.type === 'player-cmd') {
    applyPlayerCmd(data.cmd, data.args, c);
  } else if (data.type === 'broadcast') {
    socket.emit('part-event', { objectId: partId, name: data.name, data: data.data });
  }
}

function applyPlayerCmd(cmd, args, c) {
  if (cmd === 'giveCoin') {
    coinScore += (args[0] ?? 1);
    document.getElementById('coinCount').textContent = `◆ ${coinScore}`;
    scripts.forEach(e => { if (e.ready) e.worker.postMessage({ type: 'coins-sync', coins: coinScore }); });
  } else if (cmd === 'teleport') {
    player.x = args[0]; player.y = args[1]; player.z = args[2]; player.vy = 0;
  } else if (cmd === 'respawn') {
    respawn();
  } else if (cmd === 'setCheckpoint') {
    const box = c || { obj: { x: player.x, y: player.y, z: player.z } };
    checkpoint = { x: box.obj.x, y: box.obj.y + (box.obj.sy ? box.obj.sy / 2 : 0), z: box.obj.z };
    logChat('LeGames', 'Checkpoint saved');
  }
}

// heartbeat: kill scripts that stop responding instead of letting them hang forever
setInterval(() => {
  scripts.forEach((entry, partId) => {
    if (!entry.ready) return;
    entry.missedPongs++;
    if (entry.missedPongs > 2) {
      console.warn(`LeGames: script on part ${partId} stopped responding — disabling it.`);
      entry.worker.terminate();
      scripts.delete(partId);
      return;
    }
    entry.worker.postMessage({ type: 'ping' });
  });
}, 2500);

// ---------- player avatar ----------
function makeAvatarMesh(color, accessory) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.5, 1.0, 4, 8),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
  );
  body.position.y = 1.05;
  body.castShadow = true;
  g.add(body);
  addAccessory(g, accessory);
  return g;
}
function addAccessory(g, accessory) {
  if (accessory === 'hat') {
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.6, 12), new THREE.MeshStandardMaterial({ color: '#2b2b2b' }));
    hat.position.y = 2.15;
    g.add(hat);
  } else if (accessory === 'visor') {
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.15, 0.15), new THREE.MeshStandardMaterial({ color: '#111', emissive: '#4fd1ff', emissiveIntensity: 0.6 }));
    visor.position.set(0, 1.85, 0.35);
    g.add(visor);
  } else if (accessory === 'halo') {
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.05, 8, 20), new THREE.MeshStandardMaterial({ color: '#ffd54f', emissive: '#ffd54f', emissiveIntensity: 0.8 }));
    halo.position.y = 2.25;
    halo.rotation.x = Math.PI / 2;
    g.add(halo);
  }
}

function makeNameSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = '600 32px Space Grotesk, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(10,12,18,.55)';
  roundRect(ctx, 8, 8, 240, 48, 12); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 128, 40);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2, 0.5, 1);
  sprite.position.y = 2.3;
  return sprite;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

let myColor = '#4fd1ff', myAccessory = 'none';
let localAvatar = makeAvatarMesh(myColor, myAccessory);
scene.add(localAvatar);
fetchMe().then(u => {
  if (u) {
    myColor = u.color; myAccessory = u.accessory || 'none';
    scene.remove(localAvatar);
    localAvatar = makeAvatarMesh(myColor, myAccessory);
    scene.add(localAvatar);
  }
});

// ---------- character state ----------
const player = { x: 0, y: 10, z: 0, vy: 0, yaw: 0, grounded: false };
let coinScore = 0;
const RADIUS = 0.5;
const GRAVITY = -28;
const JUMP_SPEED = 9.5;
const MOVE_SPEED = 7.5;

function respawn() {
  if (checkpoint) { player.x = checkpoint.x; player.z = checkpoint.z; player.y = checkpoint.y + 2; player.vy = 0; return; }
  const s = spawns[Math.floor(Math.random() * spawns.length)];
  if (s) { player.x = s.x; player.z = s.z; player.y = (terrain ? terrainHeightAt(terrain, terrainScale, s.x, s.z) : 0) + 3; }
  else { player.x = 0; player.z = 0; player.y = 10; }
  player.vy = 0;
}

// ---------- input ----------
const keys = {};
let pointerLocked = false;
let camYaw = 0, camPitch = 0.35;
const CAM_DIST = 7;

window.addEventListener('keydown', e => {
  if (chatOpen) return;
  keys[e.code] = true;
  if (e.code === 'KeyT') openChat();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

renderer.domElement.addEventListener('click', () => {
  if (started) renderer.domElement.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
});
window.addEventListener('mousemove', e => {
  if (!pointerLocked) return;
  camYaw -= e.movementX * 0.0025;
  camPitch = Math.min(1.1, Math.max(-0.2, camPitch - e.movementY * 0.0025));
});

// ---------- chat ----------
let chatOpen = false;
const chatInputBox = document.getElementById('chatInput');
const chatText = document.getElementById('chatText');
const chatLog = document.getElementById('chatLog');
function openChat() {
  chatOpen = true;
  chatInputBox.classList.add('show');
  chatText.focus();
  document.exitPointerLock();
}
chatText.addEventListener('keydown', e => {
  if (e.code === 'Escape') { closeChat(); }
  if (e.code === 'Enter') {
    const text = chatText.value.trim();
    if (text) socket.emit('chat', text);
    chatText.value = '';
    closeChat();
  }
  e.stopPropagation();
});
function closeChat() {
  chatOpen = false;
  chatInputBox.classList.remove('show');
  chatText.blur();
}
function logChat(name, text) {
  const div = document.createElement('div');
  div.innerHTML = `<span>${escapeHtml(name)}:</span> ${escapeHtml(text)}`;
  chatLog.prepend(div);
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

// ---------- multiplayer ----------
const socket = io();
const remotePlayers = new Map();
const playersListEl = document.getElementById('playersList');

function refreshPlayersList() {
  playersListEl.innerHTML = `<div class="player-chip"><span class="dot" style="background:${myColor}"></span>you</div>` +
    Array.from(remotePlayers.values()).map(p => `<div class="player-chip"><span class="dot" style="background:${p.color}"></span>${escapeHtml(p.name)}</div>`).join('');
}

socket.on('roster', roster => {
  Object.entries(roster).forEach(([id, p]) => { if (id !== socket.id) addRemote(id, p); });
  refreshPlayersList();
});
socket.on('part-events-replay', map => {
  Object.entries(map).forEach(([objId, ev]) => deliverToWorker(Number(objId), { type: 'event', name: ev.name, data: ev.data }));
});
socket.on('part-event', ({ objectId, name, data }) => deliverToWorker(objectId, { type: 'event', name, data }));
socket.on('player-joined', p => { addRemote(p.id, p); refreshPlayersList(); logChat('LeGames', `${p.name} joined`); });
socket.on('player-moved', p => {
  const rp = remotePlayers.get(p.id);
  if (rp) rp.target = p;
});
socket.on('player-left', ({ id }) => {
  const rp = remotePlayers.get(id);
  if (rp) scene.remove(rp.mesh);
  remotePlayers.delete(id);
  refreshPlayersList();
});
socket.on('chat', ({ name, text }) => logChat(name, text));

function deliverToWorker(partId, msg) {
  const entry = scripts.get(partId);
  if (entry && entry.ready) entry.worker.postMessage(msg);
}

function addRemote(id, p) {
  if (remotePlayers.has(id)) return;
  const mesh = makeAvatarMesh(p.color || '#ff8a4f', p.accessory);
  mesh.add(makeNameSprite(p.name || 'Player'));
  scene.add(mesh);
  remotePlayers.set(id, { mesh, target: p, name: p.name, color: p.color || '#ff8a4f' });
}

// ---------- start ----------
enterBtn.addEventListener('click', async () => {
  if (!game) return;
  started = true;
  document.getElementById('gameTitle').textContent = game.name;
  respawn();
  camYaw = player.yaw;
  lockHint.style.display = 'none';
  renderer.domElement.requestPointerLock();
  socket.emit('join', { gameId, name: nameInput.value.trim() || 'Player', color: myColor, accessory: myAccessory });
  fetch(`/api/games/${gameId}/play`, { method: 'POST' }).catch(() => {});
});

// ---------- collision + touch ----------
function collidesXZ(x, z, c) {
  return Math.hypot(x - c.obj.x, z - c.obj.z) < c.boundingRadius + RADIUS;
}
function topOf(c) { return c.obj.y + (c.obj.sy || 2) / 2; }
function bottomOf(c) { return c.obj.y - (c.obj.sy || 2) / 2; }

let touchingSet = new Set();

// ---------- main loop ----------
const clock = new THREE.Clock();
let moveSendTimer = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());

  if (started && terrain) updatePlayer(dt);

  remotePlayers.forEach(rp => {
    const t = rp.target;
    rp.mesh.position.lerp(new THREE.Vector3(t.x, t.y, t.z), Math.min(1, dt * 10));
    if (t.ry !== undefined) {
      let d = t.ry - rp.mesh.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      rp.mesh.rotation.y += d * Math.min(1, dt * 10);
    }
  });

  renderer.render(scene, camera);
}
animate();

function updatePlayer(dt) {
  const forward = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
  const strafe = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);

  let moveX = 0, moveZ = 0;
  if (forward || strafe) {
    const mag = Math.hypot(forward, strafe) || 1;
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const rx = Math.sin(camYaw + Math.PI / 2), rz = Math.cos(camYaw + Math.PI / 2);
    moveX = ((fx * forward + rx * strafe) / mag) * MOVE_SPEED * dt;
    moveZ = ((fz * forward + rz * strafe) / mag) * MOVE_SPEED * dt;
    player.yaw = Math.atan2(fx * forward + rx * strafe, fz * forward + rz * strafe);
  }

  let nx = player.x + moveX;
  let nz = player.z + moveZ;

  // horizontal blocking (solid, non-passthrough parts only)
  colliders.forEach(c => {
    if (!c.canCollide) return;
    if (collidesXZ(nx, nz, c) && player.y < topOf(c) + 0.05 && player.y > bottomOf(c) - 1.5) {
      nx = player.x; nz = player.z;
    }
  });
  player.x = nx; player.z = nz;

  // gravity + ground resolution: highest of terrain / any part surface under the player
  player.vy += GRAVITY * dt;
  let ny = player.y + player.vy * dt;
  let groundH = terrainHeightAt(terrain, terrainScale, player.x, player.z) + RADIUS;

  colliders.forEach(c => {
    if (!c.canCollide) return;
    const h = queryPartHeight(c.grid, player.x, player.z);
    if (h !== null && ny <= h + RADIUS + 0.2 && player.vy <= 0) groundH = Math.max(groundH, h + RADIUS);
  });

  if (ny <= groundH) { ny = groundH; player.vy = 0; player.grounded = true; }
  else player.grounded = false;
  player.y = ny;

  if (player.grounded && keys['Space']) { player.vy = JUMP_SPEED; player.grounded = false; }

  // touch detection (rising-edge only, like Roblox's Touched event)
  const newTouching = new Set();
  colliders.forEach((c, partId) => {
    if (!scripts.has(partId)) return; // only scripted parts care about touch
    const near = Math.hypot(player.x - c.obj.x, player.z - c.obj.z) < c.boundingRadius + RADIUS + 0.3
      && player.y < topOf(c) + 1.8 && player.y > bottomOf(c) - 1.2;
    if (near) {
      newTouching.add(partId);
      if (!touchingSet.has(partId)) deliverToWorker(partId, { type: 'touch', player: { name: nameInput.value || 'Player' } });
    }
  });
  touchingSet = newTouching;

  if (player.y < -30) respawn();

  // apply to mesh + camera
  localAvatar.position.set(player.x, player.y - RADIUS, player.z);
  localAvatar.rotation.y = player.yaw;

  const camX = player.x - Math.sin(camYaw) * Math.cos(camPitch) * CAM_DIST;
  const camZ = player.z - Math.cos(camYaw) * Math.cos(camPitch) * CAM_DIST;
  const camY = player.y + 1.6 + Math.sin(camPitch) * CAM_DIST;
  camera.position.set(camX, camY, camZ);
  camera.lookAt(player.x, player.y + 1.1, player.z);

  moveSendTimer += dt;
  if (moveSendTimer > 0.08) {
    moveSendTimer = 0;
    socket.emit('move', { x: player.x, y: player.y - RADIUS, z: player.z, ry: player.yaw });
  }
}
