import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildTerrainMesh, buildObjectMesh, generateTerrain, flatTerrain, terrainHeightAt, OBJECT_TYPES } from './shared.js';

// ---------- state ----------
const SCALE = 2;
let size = 48;
let terrain = generateTerrain(size, 1234);
let objects = []; // {id, type, x,y,z, sx,sy,sz, ry, color}
let nextId = 1;
let currentTool = 'select';
let placeType = null;
let selectedId = null;

// ---------- three.js setup ----------
const viewport = document.getElementById('viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#05070c');
scene.fog = new THREE.FogExp2('#05070c', 0.008);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
camera.position.set(60, 55, 60);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 4, 0);
controls.enableDamping = true;

const hemi = new THREE.HemisphereLight('#87ceeb', '#22301f', 0.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff4e0', 1.1);
sun.position.set(60, 90, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -80; sun.shadow.camera.right = 80;
sun.shadow.camera.top = 80; sun.shadow.camera.bottom = -80;
scene.add(sun);

let terrainMesh = null;
const objectGroup = new THREE.Group();
scene.add(objectGroup);
const objectMeshes = new Map(); // id -> group

function rebuildTerrain() {
  if (terrainMesh) { scene.remove(terrainMesh); terrainMesh.geometry.dispose(); terrainMesh.material.dispose(); }
  terrainMesh = buildTerrainMesh(terrain, SCALE);
  scene.add(terrainMesh);
}
rebuildTerrain();

function rebuildObject(obj) {
  const old = objectMeshes.get(obj.id);
  if (old) { objectGroup.remove(old); }
  const mesh = buildObjectMesh(obj);
  mesh.userData.id = obj.id;
  objectMeshes.set(obj.id, mesh);
  objectGroup.add(mesh);
}
function rebuildAllObjects() {
  objectGroup.clear();
  objectMeshes.clear();
  objects.forEach(rebuildObject);
}
rebuildAllObjects();

// selection highlight
const selectBox = new THREE.BoxHelper(new THREE.Object3D(), 0xffffff);
selectBox.visible = false;
scene.add(selectBox);

function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  if (selectedId && objectMeshes.has(selectedId)) {
    selectBox.visible = true;
    selectBox.setFromObject(objectMeshes.get(selectedId));
  } else {
    selectBox.visible = false;
  }
  renderer.render(scene, camera);
}
animate();

// ---------- toolbar ----------
document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    currentTool = btn.dataset.tool;
    placeType = null;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('brushLabel').style.display = (currentTool === 'raise' || currentTool === 'lower') ? 'block' : 'none';
  });
});
document.querySelectorAll('.tool-btn[data-place]').forEach(btn => {
  btn.addEventListener('click', () => {
    currentTool = 'place';
    placeType = btn.dataset.place;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('brushLabel').style.display = 'none';
  });
});
const brushSizeInput = document.getElementById('brushSize');
brushSizeInput.addEventListener('input', () => { document.getElementById('brushVal').textContent = brushSizeInput.value; });

document.getElementById('genTerrain').addEventListener('click', () => {
  terrain = generateTerrain(size, Math.floor(Math.random() * 100000), 1);
  rebuildTerrain();
});
document.getElementById('flattenTerrain').addEventListener('click', () => {
  terrain = flatTerrain(size, 1);
  rebuildTerrain();
});
document.getElementById('worldSize').addEventListener('change', e => {
  size = parseInt(e.target.value, 10);
  terrain = generateTerrain(size, 1234);
  objects = [];
  selectedId = null;
  rebuildTerrain();
  rebuildAllObjects();
  renderInspector();
});

// ---------- raycasting / interaction ----------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let sculpting = false;

function setPointer(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

function sculptAt(worldX, worldZ, sign) {
  const gx = (worldX + (size * SCALE) / 2) / SCALE;
  const gz = (worldZ + (size * SCALE) / 2) / SCALE;
  const radius = parseInt(brushSizeInput.value, 10);
  const strength = 0.35 * sign;
  for (let z = Math.max(0, Math.floor(gz - radius)); z <= Math.min(size - 1, Math.ceil(gz + radius)); z++) {
    for (let x = Math.max(0, Math.floor(gx - radius)); x <= Math.min(size - 1, Math.ceil(gx + radius)); x++) {
      const d = Math.hypot(x - gx, z - gz);
      if (d > radius) continue;
      const falloff = 1 - d / radius;
      terrain[z][x] = Math.max(0, terrain[z][x] + strength * falloff);
    }
  }
}

renderer.domElement.addEventListener('pointerdown', e => {
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);

  if (currentTool === 'raise' || currentTool === 'lower') {
    sculpting = true;
    controls.enabled = false;
  } else if (currentTool === 'place' && placeType) {
    const hit = raycaster.intersectObject(terrainMesh)[0];
    if (hit) {
      const obj = makeDefaultObject(placeType, hit.point.x, hit.point.z);
      objects.push(obj);
      rebuildObject(obj);
      selectedId = obj.id;
      renderInspector();
    }
  } else if (currentTool === 'select') {
    const hits = raycaster.intersectObjects(objectGroup.children, true);
    if (hits.length) {
      let o = hits[0].object;
      while (o && !o.userData.id) o = o.parent;
      selectedId = o ? o.userData.id : null;
    } else {
      selectedId = null;
    }
    renderInspector();
  }
});
window.addEventListener('pointerup', () => { sculpting = false; controls.enabled = true; });
renderer.domElement.addEventListener('pointermove', e => {
  if (!sculpting) return;
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(terrainMesh)[0];
  if (hit) {
    sculptAt(hit.point.x, hit.point.z, currentTool === 'raise' ? 1 : -1);
    rebuildTerrain();
  }
});

function makeDefaultObject(type, x, z) {
  const h = terrainHeightAt(terrain, SCALE, x, z);
  const base = { id: nextId++, type, x, z, ry: 0, color: OBJECT_TYPES[type]?.color };
  if (type === 'box') return { ...base, y: h + 1, sx: 2, sy: 2, sz: 2 };
  if (type === 'ramp') return { ...base, y: h + 1, sx: 4, sy: 1.5, sz: 6 };
  if (type === 'spawn') return { ...base, y: h + 0.1 };
  if (type === 'coin') return { ...base, y: h + 1 };
  if (type === 'killzone') return { ...base, y: h + 0.2, sx: 4, sy: 0.4, sz: 4 };
  return { ...base, y: h + 1, sx: 2, sy: 2, sz: 2 };
}

// ---------- inspector ----------
function renderInspector() {
  const el = document.getElementById('inspector');
  const obj = objects.find(o => o.id === selectedId);
  if (!obj) { el.innerHTML = '<div class="no-select-msg">Nothing selected</div>'; return; }
  const hasSize = obj.sx !== undefined;
  el.innerHTML = `
    <div class="prop-title"><span class="swatch" style="background:${obj.color}"></span> ${OBJECT_TYPES[obj.type]?.label || obj.type}</div>
    <div class="field"><label>Position (x, y, z)</label>
      <div class="row3">
        <input type="number" step="0.5" id="px" value="${obj.x.toFixed(1)}">
        <input type="number" step="0.5" id="py" value="${obj.y.toFixed(1)}">
        <input type="number" step="0.5" id="pz" value="${obj.z.toFixed(1)}">
      </div>
    </div>
    ${hasSize ? `
    <div class="field"><label>Scale (x, y, z)</label>
      <div class="row3">
        <input type="number" step="0.5" min="0.2" id="sx" value="${obj.sx.toFixed(1)}">
        <input type="number" step="0.5" min="0.2" id="sy" value="${obj.sy.toFixed(1)}">
        <input type="number" step="0.5" min="0.2" id="sz" value="${obj.sz.toFixed(1)}">
      </div>
    </div>` : ''}
    <div class="field"><label>Rotation Y (radians)</label><input type="number" step="0.1" id="ry" value="${(obj.ry || 0).toFixed(2)}"></div>
    <div class="field"><label>Color</label><input type="color" id="color" value="${obj.color}" style="width:100%;height:34px;padding:2px;"></div>
    <button class="delete-btn" id="deleteObj">Delete object</button>
  `;
  const apply = () => {
    obj.x = parseFloat(document.getElementById('px').value);
    obj.y = parseFloat(document.getElementById('py').value);
    obj.z = parseFloat(document.getElementById('pz').value);
    if (hasSize) {
      obj.sx = parseFloat(document.getElementById('sx').value);
      obj.sy = parseFloat(document.getElementById('sy').value);
      obj.sz = parseFloat(document.getElementById('sz').value);
    }
    obj.ry = parseFloat(document.getElementById('ry').value);
    obj.color = document.getElementById('color').value;
    rebuildObject(obj);
  };
  ['px','py','pz','sx','sy','sz','ry','color'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.addEventListener('input', apply);
  });
  document.getElementById('deleteObj').addEventListener('click', () => {
    objects = objects.filter(o => o.id !== obj.id);
    const mesh = objectMeshes.get(obj.id);
    if (mesh) objectGroup.remove(mesh);
    objectMeshes.delete(obj.id);
    selectedId = null;
    renderInspector();
  });
}

// ---------- publish ----------
function showToast(msg, ok = true) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.style.borderColor = ok ? 'var(--ok)' : 'var(--danger)';
  toast.style.color = ok ? 'var(--ok)' : 'var(--danger)';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3200);
}

document.getElementById('publishBtn').addEventListener('click', async () => {
  const name = document.getElementById('gameName').value.trim();
  if (!name) { showToast('Give your game a name first', false); return; }
  if (!objects.some(o => o.type === 'spawn')) { showToast('Add at least one Spawn Point', false); return; }
  const payload = {
    name,
    description: document.getElementById('gameDesc').value.trim(),
    author: document.getElementById('gameAuthor').value.trim(),
    terrain, terrainSize: size, terrainScale: SCALE,
    objects
  };
  try {
    const res = await fetch('/api/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.id) {
      showToast('Published! Opening game…');
      setTimeout(() => { window.location.href = `/play.html?id=${data.id}`; }, 900);
    } else {
      showToast(data.error || 'Publish failed', false);
    }
  } catch (e) {
    showToast('Could not reach server', false);
  }
});
