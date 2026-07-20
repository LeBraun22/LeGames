import * as THREE from 'three';
import { buildTerrainMesh, buildObjectMesh, terrainHeightAt } from './shared.js';

const params = new URLSearchParams(location.search);
const gameId = params.get('id');
const lockHint = document.getElementById('lockHint');
const lockTitle = document.getElementById('lockTitle');
const lockDesc = document.getElementById('lockDesc');
const enterBtn = document.getElementById('enterBtn');
const nameInput = document.getElementById('playerName');

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
    buildWorld(g);
  })
  .catch(() => {
    lockTitle.textContent = 'Could not load this game';
    lockDesc.textContent = 'It may have been removed, or the server is unreachable.';
    enterBtn.style.display = 'none';
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
const colliders = []; // {x,z,sx,sz,y,sy,type,obj,mesh}
let coins = []; // live coin objects {obj,mesh,taken}
const spawns = [];

function buildWorld(g) {
  terrain = g.terrain;
  terrainScale = g.terrainScale || 2;
  const terrainMesh = buildTerrainMesh(terrain, terrainScale);
  scene.add(terrainMesh);

  g.objects.forEach(obj => {
    if (obj.type === 'spawn') { spawns.push(obj); }
    const mesh = buildObjectMesh(obj);
    scene.add(mesh);
    if (obj.type === 'box' || obj.type === 'ramp') {
      colliders.push({ ...boxOf(obj), type: obj.type });
    } else if (obj.type === 'killzone') {
      colliders.push({ ...boxOf(obj), type: 'killzone' });
    } else if (obj.type === 'coin') {
      coins.push({ obj, mesh, taken: false });
    }
  });
}
function boxOf(obj) {
  return { x: obj.x, z: obj.z, y: obj.y, sx: obj.sx || 2, sy: obj.sy || 2, sz: obj.sz || 2 };
}

// ---------- player avatar (local) ----------
function makeAvatarMesh(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.5, 1.0, 4, 8),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
  );
  body.position.y = 1.05;
  body.castShadow = true;
  g.add(body);
  return g;
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

const localAvatar = makeAvatarMesh('#4fd1ff');
scene.add(localAvatar);

// ---------- character state ----------
const player = { x: 0, y: 10, z: 0, vy: 0, yaw: 0, grounded: false };
let coinScore = 0;
const RADIUS = 0.5;
const GRAVITY = -28;
const JUMP_SPEED = 9.5;
const MOVE_SPEED = 7.5;

function respawn() {
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
function logChat(name, text, self = false) {
  const div = document.createElement('div');
  div.innerHTML = `<span>${escapeHtml(name)}:</span> ${escapeHtml(text)}`;
  chatLog.prepend(div);
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

// ---------- multiplayer ----------
const socket = io();
const remotePlayers = new Map(); // id -> {mesh, nameSprite, target:{x,y,z,ry}, name}
const playersListEl = document.getElementById('playersList');

function refreshPlayersList() {
  const names = [document.querySelector('#playersList')];
  playersListEl.innerHTML = `<div class="player-chip"><span class="dot" style="background:#4fd1ff"></span>you</div>` +
    Array.from(remotePlayers.values()).map(p => `<div class="player-chip"><span class="dot" style="background:${p.color}"></span>${escapeHtml(p.name)}</div>`).join('');
}

socket.on('roster', roster => {
  Object.entries(roster).forEach(([id, p]) => { if (id !== socket.id) addRemote(id, p); });
  refreshPlayersList();
});
socket.on('player-joined', p => { addRemote(p.id, p); refreshPlayersList(); logChat('LeGames', `${p.name} joined`); });
socket.on('player-moved', p => {
  const rp = remotePlayers.get(p.id);
  if (rp) rp.target = p;
});
socket.on('player-left', ({ id }) => {
  const rp = remotePlayers.get(id);
  if (rp) { scene.remove(rp.mesh); }
  remotePlayers.delete(id);
  refreshPlayersList();
});
socket.on('chat', ({ name, text }) => logChat(name, text));

function addRemote(id, p) {
  if (remotePlayers.has(id)) return;
  const mesh = makeAvatarMesh(p.color || '#ff8a4f');
  mesh.add(makeNameSprite(p.name || 'Player'));
  scene.add(mesh);
  remotePlayers.set(id, { mesh, target: p, name: p.name, color: p.color || '#ff8a4f' });
}

// ---------- start ----------
enterBtn.addEventListener('click', () => {
  if (!game) return;
  started = true;
  document.getElementById('gameTitle').textContent = game.name;
  respawn();
  camYaw = player.yaw;
  lockHint.style.display = 'none';
  renderer.domElement.requestPointerLock();
  socket.emit('join', { gameId, name: nameInput.value.trim() || 'Player' });
});

// ---------- collision helpers ----------
function collidesXZ(x, z, box) {
  const half = RADIUS;
  return Math.abs(x - box.x) < box.sx / 2 + half && Math.abs(z - box.z) < box.sz / 2 + half;
}
function topOf(box) { return box.y + box.sy / 2; }
function bottomOf(box) { return box.y - box.sy / 2; }

// ---------- main loop ----------
const clock = new THREE.Clock();
let moveSendTimer = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());

  if (started && terrain) {
    updatePlayer(dt);
    updateCoins();
  }

  // remote interpolation
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

  // block movement into solid colliders (box/ramp), ignore killzone (handled as trigger)
  for (const c of colliders) {
    if (c.type === 'killzone') continue;
    if (collidesXZ(nx, nz, c) && player.y < topOf(c) + 0.05 && player.y > bottomOf(c) - 1.5) {
      nx = player.x; nz = player.z;
      break;
    }
  }
  player.x = nx; player.z = nz;

  // gravity + ground collision against terrain heightfield
  player.vy += GRAVITY * dt;
  let ny = player.y + player.vy * dt;
  const groundH = terrainHeightAt(terrain, terrainScale, player.x, player.z) + RADIUS;
  if (ny <= groundH) {
    ny = groundH;
    player.vy = 0;
    player.grounded = true;
  } else {
    player.grounded = false;
  }
  // standing on top of a box collider
  for (const c of colliders) {
    if (c.type === 'killzone') continue;
    if (collidesXZ(player.x, player.z, c)) {
      const top = topOf(c);
      if (ny <= top + 0.15 && ny >= top - 0.5 && player.vy <= 0) {
        ny = top;
        player.vy = 0;
        player.grounded = true;
      }
    }
  }
  player.y = ny;

  if (player.grounded && keys['Space']) {
    player.vy = JUMP_SPEED;
    player.grounded = false;
  }

  // killzones + falling off world
  for (const c of colliders) {
    if (c.type !== 'killzone') continue;
    if (collidesXZ(player.x, player.z, c) && player.y < topOf(c) + 1 && player.y > bottomOf(c) - 1) {
      respawn();
    }
  }
  if (player.y < -30) respawn();

  // apply to mesh + camera
  localAvatar.position.set(player.x, player.y - RADIUS, player.z);
  localAvatar.rotation.y = player.yaw;

  const camX = player.x - Math.sin(camYaw) * Math.cos(camPitch) * CAM_DIST;
  const camZ = player.z - Math.cos(camYaw) * Math.cos(camPitch) * CAM_DIST;
  const camY = player.y + 1.6 + Math.sin(camPitch) * CAM_DIST;
  camera.position.set(camX, camY, camZ);
  camera.lookAt(player.x, player.y + 1.1, player.z);

  // send network update
  moveSendTimer += dt;
  if (moveSendTimer > 0.08) {
    moveSendTimer = 0;
    socket.emit('move', { x: player.x, y: player.y - RADIUS, z: player.z, ry: player.yaw });
  }
}

function updateCoins() {
  let changed = false;
  coins.forEach(c => {
    if (c.taken) return;
    const d = Math.hypot(player.x - c.obj.x, player.z - c.obj.z) + Math.abs((player.y) - c.obj.y);
    c.mesh.rotation.y += 0.03;
    if (d < 1.4) {
      c.taken = true;
      c.mesh.visible = false;
      coinScore++;
      changed = true;
    }
  });
  if (changed) document.getElementById('coinCount').textContent = `◆ ${coinScore}`;
}
