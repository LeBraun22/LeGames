// Shared between studio.js and play.js so a game looks/behaves identically in both.
import * as THREE from 'three';

// ---------- procedural terrain seed (Studio "Generate" button) ----------
export function makeNoise2D(seed) {
  // small deterministic value-noise generator (no external deps)
  function hash(x, y) {
    let h = seed + x * 374761393 + y * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    h = h ^ (h >> 16);
    return ((h >>> 0) % 10000) / 10000;
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  return function noise(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const xf = x - x0, yf = y - y0;
    const v00 = hash(x0, y0), v10 = hash(x0 + 1, y0);
    const v01 = hash(x0, y0 + 1), v11 = hash(x0 + 1, y0 + 1);
    const sx = smooth(xf), sy = smooth(yf);
    const top = v00 + (v10 - v00) * sx;
    const bot = v01 + (v11 - v01) * sx;
    return top + (bot - top) * sy;
  };
}

export function generateTerrain(size, seed = Date.now() % 100000, roughness = 1) {
  const n1 = makeNoise2D(seed);
  const n2 = makeNoise2D(seed + 9999);
  const terrain = [];
  for (let z = 0; z < size; z++) {
    const row = [];
    for (let x = 0; x < size; x++) {
      let h = n1(x * 0.08, z * 0.08) * 6 * roughness;
      h += n2(x * 0.2, z * 0.2) * 2 * roughness;
      row.push(Math.max(0, h));
    }
    terrain.push(row);
  }
  return terrain;
}

export function flatTerrain(size, height = 1) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => height));
}

// ---------- terrain mesh ----------
export function buildTerrainMesh(terrain, scale) {
  const size = terrain.length;
  const geo = new THREE.BufferGeometry();
  const positions = [];
  const colors = [];
  const indices = [];
  const lowColor = new THREE.Color('#2b6b3f');
  const highColor = new THREE.Color('#c9c2a0');

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const h = terrain[z][x];
      positions.push(x * scale - (size * scale) / 2, h, z * scale - (size * scale) / 2);
      const t = Math.min(1, h / 8);
      const c = lowColor.clone().lerp(highColor, t);
      colors.push(c.r, c.g, c.b);
    }
  }
  for (let z = 0; z < size - 1; z++) {
    for (let x = 0; x < size - 1; x++) {
      const a = z * size + x, b = a + 1, c = a + size, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

export function terrainHeightAt(terrain, scale, worldX, worldZ) {
  const size = terrain.length;
  const gx = (worldX + (size * scale) / 2) / scale;
  const gz = (worldZ + (size * scale) / 2) / scale;
  const x0 = Math.floor(gx), z0 = Math.floor(gz);
  if (x0 < 0 || z0 < 0 || x0 >= size - 1 || z0 >= size - 1) return 0;
  const fx = gx - x0, fz = gz - z0;
  const h00 = terrain[z0][x0], h10 = terrain[z0][x0 + 1];
  const h01 = terrain[z0 + 1][x0], h11 = terrain[z0 + 1][x0 + 1];
  const top = h00 + (h10 - h00) * fx;
  const bot = h01 + (h11 - h01) * fx;
  return top + (bot - top) * fz;
}

// ---------- placeable objects ----------
export const OBJECT_TYPES = {
  box:      { label: 'Block',      color: '#4fd1ff' },
  ramp:     { label: 'Ramp',       color: '#ff8a4f' },
  spawn:    { label: 'Spawn Point',color: '#6bffa0' },
  killzone: { label: 'Kill Zone',  color: '#ff4f6d' },
  coin:     { label: 'Coin',       color: '#ffd54f' }
};

export function buildObjectMesh(obj) {
  const group = new THREE.Group();
  const color = obj.color || OBJECT_TYPES[obj.type]?.color || '#ffffff';
  let mesh;
  if (obj.type === 'box' || obj.type === 'ramp' || obj.type === 'killzone') {
    const geo = new THREE.BoxGeometry(obj.sx || 2, obj.sy || 2, obj.sz || 2);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.5,
      metalness: 0.1,
      transparent: obj.type === 'killzone',
      opacity: obj.type === 'killzone' ? 0.55 : 1
    });
    mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = obj.type !== 'killzone';
    mesh.receiveShadow = true;
  } else if (obj.type === 'spawn') {
    const geo = new THREE.CylinderGeometry(1, 1, 0.15, 20);
    mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 }));
  } else if (obj.type === 'coin') {
    const geo = new THREE.CylinderGeometry(0.5, 0.5, 0.12, 18);
    mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3 }));
  } else {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color }));
  }
  group.add(mesh);
  group.position.set(obj.x || 0, obj.y || 0, obj.z || 0);
  if (obj.ry) group.rotation.y = obj.ry;
  if (obj.type === 'ramp') group.rotation.x = -0.35;
  group.userData.gameObject = obj;
  return group;
}
