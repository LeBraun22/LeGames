const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 5e6 // allow reasonably large game exports over the socket if ever needed
});

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const GAMES_FILE = path.join(DATA_DIR, 'games.json');

// ---------- persistence ----------
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(GAMES_FILE)) fs.writeFileSync(GAMES_FILE, '[]');

function loadGames() {
  try {
    return JSON.parse(fs.readFileSync(GAMES_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}
function saveGames(games) {
  fs.writeFileSync(GAMES_FILE, JSON.stringify(games));
}

// seed a starter game the first time the server ever runs, so Browse isn't empty
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
      description: 'A starter world with gentle hills. Open Studio to remix it, or jump in and explore.',
      author: 'LeGames',
      createdAt: Date.now(),
      terrainSize: size,
      terrainScale: 2,
      terrain,
      objects: [
        { type: 'spawn', x: 0, y: 6, z: 0 },
        { type: 'box', x: 6, y: 3, z: -4, sx: 2, sy: 2, sz: 2, color: '#4fd1ff' },
        { type: 'ramp', x: -8, y: 2, z: 5, sx: 4, sy: 2, sz: 6, ry: 0.4, color: '#ff8a4f' },
        { type: 'killzone', x: 14, y: 0.2, z: 10, sx: 4, sy: 0.4, sz: 4, color: '#ff4f6d' }
      ]
    });
    saveGames(games);
  }
})();

// ---------- API ----------
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/games', (req, res) => {
  const games = loadGames().map(({ terrain, objects, ...meta }) => meta);
  res.json(games);
});

app.get('/api/games/:id', (req, res) => {
  const game = loadGames().find(g => g.id === req.params.id);
  if (!game) return res.status(404).json({ error: 'not found' });
  res.json(game);
});

app.post('/api/games', (req, res) => {
  const { name, description, author, terrain, objects, terrainSize, terrainScale } = req.body || {};
  if (!name || !Array.isArray(terrain) || !Array.isArray(objects)) {
    return res.status(400).json({ error: 'missing name, terrain, or objects' });
  }
  const games = loadGames();
  const game = {
    id: nanoid(8),
    name: String(name).slice(0, 60),
    description: String(description || '').slice(0, 240),
    author: String(author || 'Anonymous').slice(0, 40),
    createdAt: Date.now(),
    terrainSize: terrainSize || terrain.length,
    terrainScale: terrainScale || 2,
    terrain,
    objects
  };
  games.push(game);
  saveGames(games);
  res.json({ id: game.id });
});

// ---------- live multiplayer ----------
// roomState[gameId] = { socketId: { name, x, y, z, ry, anim } }
const roomState = {};

io.on('connection', socket => {
  let currentRoom = null;

  socket.on('join', ({ gameId, name }) => {
    currentRoom = gameId;
    socket.join(gameId);
    if (!roomState[gameId]) roomState[gameId] = {};
    roomState[gameId][socket.id] = {
      name: String(name || 'Player').slice(0, 20),
      x: 0, y: 8, z: 0, ry: 0, color: colorForId(socket.id)
    };
    // send the new player the current roster, then tell everyone else about the new player
    socket.emit('roster', roomState[gameId]);
    socket.to(gameId).emit('player-joined', { id: socket.id, ...roomState[gameId][socket.id] });
  });

  socket.on('move', state => {
    if (!currentRoom || !roomState[currentRoom] || !roomState[currentRoom][socket.id]) return;
    Object.assign(roomState[currentRoom][socket.id], state);
    socket.to(currentRoom).emit('player-moved', { id: socket.id, ...state });
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
  const hue = hash % 360;
  return `hsl(${hue}, 75%, 60%)`;
}

server.listen(PORT, () => console.log(`LeGames running on port ${PORT}`));
