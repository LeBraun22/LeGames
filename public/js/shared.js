// Shared between studio.js and play.js so a game looks/behaves identically in both.
import * as THREE from 'three';

// ---------- procedural terrain seed (Studio "Generate" button) ----------
export function makeNoise2D(seed) {
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

// ============================================================
// PARTS — unified shape system (box / sphere / cylinder / wedge),
// fully rotatable (rx, ry, rz euler radians), scriptable.
// ============================================================

export const SHAPES = {
  box:      { label: 'Block' },
  sphere:   { label: 'Sphere' },
  cylinder: { label: 'Cylinder' },
  wedge:    { label: 'Wedge (ramp)' }
};
export const DEFAULT_PART_COLOR = '#4fd1ff';

// A wedge is a right-triangular prism: flat rectangular base, one vertical
// face at local z = -sz/2 (the "back"), sloping down to a knife-edge at
// z = +sz/2 (the "front"). Walking from back to front goes downhill.
function buildWedgeGeometry(sx, sy, sz) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  // 6 vertices: back face is a full rectangle (4 verts), front edge is a line (2 verts)
  const v = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz], // back rectangle (0-3)
    [-hx, -hy, hz], [hx, -hy, hz]                                   // front bottom edge (4-5)
  ];
  const positions = [];
  function tri(a, b, c) { [a, b, c].forEach(i => positions.push(...v[i])); }
  // back face
  tri(0, 1, 2); tri(0, 2, 3);
  // bottom face
  tri(0, 4, 5); tri(0, 5, 1);
  // slope (top) face
  tri(3, 2, 5); tri(3, 5, 4);
  // left face
  tri(0, 3, 4);
  // right face
  tri(1, 5, 2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

export function buildPartMesh(part) {
  const color = part.color || DEFAULT_PART_COLOR;
  const sx = part.sx ?? 2, sy = part.sy ?? 2, sz = part.sz ?? 2;
  let geo;
  if (part.shape === 'sphere') geo = new THREE.SphereGeometry(sx / 2, 20, 16);
  else if (part.shape === 'cylinder') geo = new THREE.CylinderGeometry(sx / 2, sx / 2, sy, 20);
  else if (part.shape === 'wedge') geo = buildWedgeGeometry(sx, sy, sz);
  else geo = new THREE.BoxGeometry(sx, sy, sz);

  const mat = new THREE.MeshStandardMaterial({
    color, roughness: 0.55, metalness: 0.1,
    transparent: part.canCollide === false, opacity: part.canCollide === false ? 0.5 : 1
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(part.x || 0, part.y || 0, part.z || 0);
  mesh.rotation.set(part.rx || 0, part.ry || 0, part.rz || 0);
  mesh.userData.part = part;
  mesh.visible = part.visible !== false;
  return mesh;
}

export function buildSpawnMesh(obj) {
  const geo = new THREE.CylinderGeometry(1, 1, 0.15, 20);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#6bffa0', emissive: '#6bffa0', emissiveIntensity: 0.4 }));
  mesh.position.set(obj.x || 0, obj.y || 0, obj.z || 0);
  return mesh;
}

// Local-space top-surface height sampler, per shape. Returns null where the
// shape has no surface at that local (lx, lz) (e.g. outside a cylinder's
// circular footprint).
function localTopHeight(shape, lx, lz, sx, sy, sz) {
  if (shape === 'sphere') {
    const r = sx / 2;
    const d2 = lx * lx + lz * lz;
    if (d2 > r * r) return null;
    return Math.sqrt(Math.max(0, r * r - d2));
  }
  if (shape === 'cylinder') {
    const r = sx / 2;
    if (lx * lx + lz * lz > r * r) return null;
    return sy / 2;
  }
  if (shape === 'wedge') {
    if (Math.abs(lx) > sx / 2 || lz < -sz / 2 || lz > sz / 2) return null;
    const t = (lz + sz / 2) / sz; // 0 at back(high) .. 1 at front(low)
    return sy / 2 - t * sy;
  }
  // box
  if (Math.abs(lx) > sx / 2 || Math.abs(lz) > sz / 2) return null;
  return sy / 2;
}

// Builds a world-space height grid for a part's top surface using the exact
// same transform (position + full XYZ rotation) as buildPartMesh, so walking
// collision matches what's rendered exactly instead of approximating it.
export function buildPartHeightGrid(part, res) {
  const sx = part.sx ?? 2, sy = part.sy ?? 2, sz = part.sz ?? 2;
  res = res || (part.shape === 'sphere' || part.shape === 'cylinder' ? 9 : 5);
  const temp = new THREE.Object3D();
  temp.position.set(part.x || 0, part.y || 0, part.z || 0);
  temp.rotation.set(part.rx || 0, part.ry || 0, part.rz || 0);
  temp.updateMatrixWorld(true);

  const grid = [];
  for (let j = 0; j < res; j++) {
    const row = [];
    for (let i = 0; i < res; i++) {
      const lx = -sx / 2 + (sx * i) / (res - 1);
      const lz = -sz / 2 + (sz * j) / (res - 1);
      const ly = localTopHeight(part.shape, lx, lz, sx, sy, sz);
      if (ly === null) { row.push(null); continue; }
      const p = new THREE.Vector3(lx, ly, lz);
      temp.localToWorld(p);
      row.push(p);
    }
    grid.push(row);
  }
  return grid;
}

function pointInTriangleBary(px, pz, a, b, c) {
  const v0x = c.x - a.x, v0z = c.z - a.z;
  const v1x = b.x - a.x, v1z = b.z - a.z;
  const v2x = px - a.x, v2z = pz - a.z;
  const dot00 = v0x * v0x + v0z * v0z;
  const dot01 = v0x * v1x + v0z * v1z;
  const dot02 = v0x * v2x + v0z * v2z;
  const dot11 = v1x * v1x + v1z * v1z;
  const dot12 = v1x * v2x + v1z * v2z;
  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-9) return null;
  const u = (dot11 * dot02 - dot01 * dot12) / denom;
  const v = (dot00 * dot12 - dot01 * dot02) / denom;
  if (u >= -0.01 && v >= -0.01 && u + v <= 1.01) {
    const w0 = 1 - u - v;
    return a.y * w0 + c.y * u + b.y * v;
  }
  return null;
}

// Returns the part's surface height at (worldX, worldZ), or null if outside its footprint.
export function queryPartHeight(grid, worldX, worldZ) {
  for (let j = 0; j < grid.length - 1; j++) {
    for (let i = 0; i < grid[j].length - 1; i++) {
      const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i], d = grid[j + 1][i + 1];
      if (a && b && d) { const h = pointInTriangleBary(worldX, worldZ, a, d, b); if (h !== null) return h; }
      if (a && c && d) { const h = pointInTriangleBary(worldX, worldZ, a, c, d); if (h !== null) return h; }
    }
  }
  return null;
}

// Rotation-aware horizontal half-extent, used for the simple AABB side-blocking
// check (approximation: uses the largest possible footprint radius so a
// rotated part never lets you clip through a corner).
export function boundingRadiusXZ(part) {
  const sx = part.sx ?? 2, sy = part.sy ?? 2, sz = part.sz ?? 2;
  return Math.sqrt(sx * sx + sy * sy + sz * sz) / 2;
}
