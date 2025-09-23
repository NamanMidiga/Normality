import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import leoProfanity from 'leo-profanity';

const PORT = process.env.PORT || 3001;
const app = express();
app.use(cors());
app.use(express.json());

// Simple health endpoint
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Grid size ~100 meters (approx degrees). 1 degree ~ 111,000 meters.
const GRID_METERS = 100;
const GRID_DEGREES = GRID_METERS / 111000;

// Ban store: { deviceId: { strikes, bannedUntilMs } }
const bansByDevice = new Map();

// In-memory rooms: key -> Set of client objects
const rooms = new Map();

function getRoomKeyFromLocation(lat, lon) {
  const latKey = Math.floor(lat / GRID_DEGREES);
  const lonKey = Math.floor(lon / GRID_DEGREES);
  return `${latKey}:${lonKey}`;
}

function isBanned(deviceId) {
  const record = bansByDevice.get(deviceId);
  if (!record) return false;
  return Date.now() < record.bannedUntilMs;
}

function escalateBan(deviceId) {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const record = bansByDevice.get(deviceId) || { strikes: 0, bannedUntilMs: 0 };
  record.strikes += 1;
  // 1st -> 1 day, 2nd -> 5 days, 3rd -> 10 days, then 30 days
  const days = record.strikes === 1 ? 1 : record.strikes === 2 ? 5 : record.strikes === 3 ? 10 : 30;
  record.bannedUntilMs = Date.now() + days * ONE_DAY;
  bansByDevice.set(deviceId, record);
  return record;
}

leoProfanity.loadDictionary('en');

function broadcastToRoom(roomKey, data, excludeWs) {
  const set = rooms.get(roomKey);
  if (!set) return;
  for (const client of set) {
    if (client.ws.readyState === 1 && client.ws !== excludeWs) {
      try {
        client.ws.send(JSON.stringify(data));
      } catch (_) {}
    }
  }
}

// Client object shape: { id, ws, username, spectate, roomKey, deviceId }
wss.on('connection', (ws) => {
  const client = { id: uuidv4(), ws, username: null, spectate: false, roomKey: null, deviceId: null };

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (_) {
      return ws.send(JSON.stringify({ type: 'error', error: 'invalid_json' }));
    }

    if (msg.type === 'hello') {
      // { type: 'hello', username, spectate, lat, lon, deviceId }
      const { username, spectate, lat, lon, deviceId } = msg;
      if (typeof lat !== 'number' || typeof lon !== 'number') {
        return ws.send(JSON.stringify({ type: 'error', error: 'invalid_location' }));
      }
      client.username = String(username || 'Anon');
      client.spectate = !!spectate;
      client.deviceId = String(deviceId || client.id);

      if (isBanned(client.deviceId)) {
        return ws.send(JSON.stringify({ type: 'banned', until: bansByDevice.get(client.deviceId).bannedUntilMs }));
      }

      const roomKey = getRoomKeyFromLocation(lat, lon);
      client.roomKey = roomKey;
      if (!rooms.has(roomKey)) rooms.set(roomKey, new Set());
      rooms.get(roomKey).add(client);

      ws.send(JSON.stringify({ type: 'joined', roomKey, clientId: client.id }));
      broadcastToRoom(roomKey, { type: 'system', text: `${client.username} joined`, ts: Date.now() }, ws);
      return;
    }

    if (msg.type === 'chat') {
      // { type: 'chat', text }
      if (!client.roomKey) {
        return ws.send(JSON.stringify({ type: 'error', error: 'not_joined' }));
      }
      if (client.spectate) {
        return ws.send(JSON.stringify({ type: 'error', error: 'spectator_cannot_send' }));
      }
      const text = String(msg.text || '').slice(0, 500);
      const ts = Date.now();

      if (isBanned(client.deviceId)) {
        return ws.send(JSON.stringify({ type: 'banned', until: bansByDevice.get(client.deviceId).bannedUntilMs }));
      }

      // Check for profanity; if found, escalate and notify client
      if (leoProfanity.check(text)) {
        const rec = escalateBan(client.deviceId);
        return ws.send(JSON.stringify({ type: 'ban_applied', strikes: rec.strikes, until: rec.bannedUntilMs }));
      }

      const payload = { type: 'chat', id: uuidv4(), from: client.username, text, ts };
      broadcastToRoom(client.roomKey, payload);
      return;
    }

    if (msg.type === 'leave') {
      if (client.roomKey && rooms.has(client.roomKey)) {
        rooms.get(client.roomKey).delete(client);
        broadcastToRoom(client.roomKey, { type: 'system', text: `${client.username} left`, ts: Date.now() }, ws);
        client.roomKey = null;
      }
      ws.close();
      return;
    }

    ws.send(JSON.stringify({ type: 'error', error: 'unknown_type' }));
  });

  ws.on('close', () => {
    if (client.roomKey && rooms.has(client.roomKey)) {
      rooms.get(client.roomKey).delete(client);
      broadcastToRoom(client.roomKey, { type: 'system', text: `${client.username || 'Anon'} disconnected`, ts: Date.now() });
      if (rooms.get(client.roomKey).size === 0) rooms.delete(client.roomKey);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Normality backend listening on http://localhost:${PORT}`);
});


