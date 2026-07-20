const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e6 });

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const GAMES_FILE = path.join(DATA_DIR, 'games.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSION_SECRET = process.env.SESSION_SECRET || 'legames-dev-secret-change-me';

// ---------- persistence ----------
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(GAMES_FILE)) fs.writeFileSync(GAMES_FILE, '[]');
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');

function loadGames() { try { return JSON.parse(fs.readFileSync(GAMES_FILE, 'utf8')); } catch { return []; } }
function saveGames(g) { fs.writeFileSync(GAMES_FILE, JSON.stringify(g)); }
function loadUsers() { try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; } }
function saveUsers(u) { fs.writeFileSync(USERS_FILE, JSON.stringify(u)); }

// seed a starter game the first time the server ever runs
(function seed() {
  const games = loadGames();
  if (games.length === 0) {
    const size = 48;
    const terrain = [];
    for (let z = 0; z < size; z++) {
      const row = [];
      for (let x = 0; x < size; x++) {
        const dx = x - size / 2, dz = z - size / 2;
        const h = Math.sin(dx / 6) * 1.5 + Math.cos(dz / 7) * 1.5 + Math.sin((dx + dz) / 10) * 2;
        row.push(Math.max(0, h + 2));
      }
      terrain.push(row);
    }
    games.push({
      id: nanoid(8),
      name: 'Rolling Hills',
      description: 'A starter world with gentle hills, a working door switch, and a checkpoint. Open Studio to remix it.',
      ownerId: null,
      ownerName: 'LeGames',
      createdAt: Date.now(),
      plays: 0,
      likes: [],
      terrainSize: size,
      terrainScale: 2,
      terrain,
      objects: [
        { id: 1, type: 'spawn', x: 0, y: 6, z: 0 },
        { id: 2, type: 'box', x: 6, y: 3, z: -4, sx: 2, sy: 2, sz: 2, color: '#4fd1ff' },
        { id: 3, type: 'ramp', x: -10, y: 2, z: 5, sx: 4, sy: 2, sz: 8, ry: 0, color: '#ff8a4f' },
        { id: 4, type: 'killzone', x: 14, y: 0.2, z: 10, sx: 4, sy: 0.4, sz: 4, color: '#ff4f6d' },
        { id: 5, type: 'coin', x: -10, y: 5, z: 5, color: '#ffd54f' },
        { id: 6, type: 'box', x: 0, y: 3, z: 12, sx: 3, sy: 3, sz: 1, color: '#a892ff', script: { action: 'toggle_door' } },
        { id: 7, type: 'box', x: -4, y: 1, z: -8, sx: 2, sy: 2, sz: 2, color: '#6bffa0', script: { action: 'checkpoint' } }
      ]
    });
    saveGames(games);
  }
})();

// ---------- middleware ----------
app.use(express.json({ limit: '5mb' }));
const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, color: u.color, accessory: u.accessory };
}
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'log in first' });
  next();
}

// ---------- auth ----------
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body || {};
  const name = String(username || '').trim();
  if (name.length < 3 || name.length > 20) return res.status(400).json({ error: 'username must be 3-20 characters' });
  if (!/^[a-zA-Z0-9_]+$/.test(name)) return res.status(400).json({ error: 'username can only use letters, numbers, underscore' });
  if (!password || password.length < 4) return res.status(400).json({ error: 'password must be at least 4 characters' });
  const users = loadUsers();
  if (users.some(u => u.username.toLowerCase() === name.toLowerCase())) {
    return res.status(400).json({ error: 'that username is taken' });
  }
  const hue = Math.floor(Math.random() * 360);
  const user = {
    id: nanoid(10),
    username: name,
    passwordHash: await bcrypt.hash(password, 10),
    color: `hsl(${hue}, 75%, 60%)`,
    accessory: 'none',
    createdAt: Date.now()
  };
  users.push(user);
  saveUsers(users);
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  const users = loadUsers();
  const user = users.find(u => u.username.toLowerCase() === String(username || '').toLowerCase());
  if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) {
    return res.status(400).json({ error: 'wrong username or password' });
  }
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = loadUsers().find(u => u.id === req.session.userId);
  res.json({ user: publicUser(user) });
});

app.put('/api/auth/avatar', requireAuth, (req, res) => {
  const { color, accessory } = req.body || {};
  const users = loadUsers();
  const user = users.find(u => u.id === req.session.userId);
  if (!user) return res.status(404).json({ error: 'not found' });
  if (color) user.color = String(color).slice(0, 30);
  if (accessory) user.accessory = String(accessory).slice(0, 20);
  saveUsers(users);
  res.json({ user: publicUser(user) });
});

// ---------- games ----------
function gameSummary(g, currentUserId) {
  const { terrain, objects, ...meta } = g;
  return {
    ...meta,
    likeCount: (g.likes || []).length,
    liked: currentUserId ? (g.likes || []).includes(currentUserId) : false,
    livePlayers: Object.keys(roomState[g.id] || {}).length
  };
}

app.get('/api/games', (req, res) => {
  const games = loadGames().map(g => gameSummary(g, req.session.userId));
  res.json(games);
});

app.get('/api/games/mine', requireAuth, (req, res) => {
  const games = loadGames().filter(g => g.ownerId === req.session.userId).map(g => gameSummary(g, req.session.userId));
  res.json(games);
});

app.get('/api/games/:id', (req, res) => {
  const game = loadGames().find(g => g.id === req.params.id);
  if (!game) return res.status(404).json({ error: 'not found' });
  res.json({ ...game, likeCount: (game.likes || []).length, liked: req.session.userId ? (game.likes || []).includes(req.session.userId) : false });
});

app.post('/api/games', requireAuth, (req, res) => {
  const { name, description, terrain, objects, terrainSize, terrainScale } = req.body || {};
  if (!name || !Array.isArray(terrain) || !Array.isArray(objects)) {
    return res.status(400).json({ error: 'missing name, terrain, or objects' });
  }
  const user = loadUsers().find(u => u.id === req.session.userId);
  const games = loadGames();
  const game = {
    id: nanoid(8),
    name: String(name).slice(0, 60),
    description: String(description || '').slice(0, 240),
    ownerId: user.id,
    ownerName: user.username,
    createdAt: Date.now(),
    plays: 0,
    likes: [],
    terrainSize: terrainSize || terrain.length,
    terrainScale: terrainScale || 2,
    terrain,
    objects
  };
  games.push(game);
  saveGames(games);
  res.json({ id: game.id });
});

app.post('/api/games/:id/play', (req, res) => {
  const games = loadGames();
  const game = games.find(g => g.id === req.params.id);
  if (!game) return res.status(404).json({ error: 'not found' });
  game.plays = (game.plays || 0) + 1;
  saveGames(games);
  res.json({ plays: game.plays });
});

app.post('/api/games/:id/like', requireAuth, (req, res) => {
  const games = loadGames();
  const game = games.find(g => g.id === req.params.id);
  if (!game) return res.status(404).json({ error: 'not found' });
  game.likes = game.likes || [];
  const i = game.likes.indexOf(req.session.userId);
  if (i === -1) game.likes.push(req.session.userId); else game.likes.splice(i, 1);
  saveGames(games);
  res.json({ likeCount: game.likes.length, liked: i === -1 });
});

// ---------- live multiplayer ----------
// roomState[gameId] = { socketId: { name, x, y, z, ry, color, accessory } }
const roomState = {};
const doorState = {}; // doorState[gameId] = { objectId: boolean(open) }

io.on('connection', socket => {
  let currentRoom = null;

  socket.on('join', ({ gameId, name, color, accessory }) => {
    currentRoom = gameId;
    socket.join(gameId);
    if (!roomState[gameId]) roomState[gameId] = {};
    roomState[gameId][socket.id] = {
      name: String(name || 'Player').slice(0, 20),
      x: 0, y: 8, z: 0, ry: 0,
      color: color || colorForId(socket.id),
      accessory: accessory || 'none'
    };
    socket.emit('roster', roomState[gameId]);
    socket.emit('doors', doorState[gameId] || {});
    socket.to(gameId).emit('player-joined', { id: socket.id, ...roomState[gameId][socket.id] });
  });

  socket.on('move', state => {
    if (!currentRoom || !roomState[currentRoom] || !roomState[currentRoom][socket.id]) return;
    Object.assign(roomState[currentRoom][socket.id], state);
    socket.to(currentRoom).emit('player-moved', { id: socket.id, ...state });
  });

  socket.on('toggle-door', objectId => {
    if (!currentRoom) return;
    if (!doorState[currentRoom]) doorState[currentRoom] = {};
    doorState[currentRoom][objectId] = !doorState[currentRoom][objectId];
    io.to(currentRoom).emit('door-toggled', { objectId, open: doorState[currentRoom][objectId] });
  });

  socket.on('chat', text => {
    if (!currentRoom) return;
    const name = roomState[currentRoom]?.[socket.id]?.name || 'Player';
    io.to(currentRoom).emit('chat', { id: socket.id, name, text: String(text).slice(0, 200) });
  });

  socket.on('disconnect', () => {
    if (currentRoom && roomState[currentRoom]) {
      delete roomState[currentRoom][socket.id];
      socket.to(currentRoom).emit('player-left', { id: socket.id });
    }
  });
});

function colorForId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 75%, 60%)`;
}

server.listen(PORT, () => console.log(`LeGames running on port ${PORT}`));
