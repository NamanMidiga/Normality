import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import leoProfanity from 'leo-profanity';
import path from 'path';
import { fileURLToPath } from 'url';
import { startTrendScheduler, getTrendPool, getTrendStatus } from './trends.js';

const PORT = process.env.PORT || 4322;
const app = express();
app.use(cors());
app.use(express.json());

// Trends status (for debugging/visibility)
app.get('/trends/status', (_req, res) => {
  res.json(getTrendStatus());
});

// Trend handles: extract short meme/movie tokens for username generation
app.get('/trends/handles', (_req, res) => {
  try {
    const pool = getTrendPool();
    const text = Array.isArray(pool) ? pool.join(' ') : '';
    const stop = new Set([
      'the','a','an','and','or','vs','of','to','in','on','for','with','is','are','was','were','be','been','it','that','this','those','these','at','by','from','as','into','than','then','out','off','over','under','today','right','now','you','your','me','my','our','we','they','them','their','his','her','he','she','i'
    ]);
    const raw = (text || '')
      .replace(/[\[\]{}()"'’“”~^`*:+|<>/\\]/g, ' ')
      .split(/\s+/)
      .map((w) => w.trim())
      .filter(Boolean)
      .filter((w) => w.length >= 3 && w.length <= 16)
      .filter((w) => !/^[0-9]+$/.test(w))
      .filter((w) => !stop.has(w.toLowerCase()))
      .slice(0, 500);
    // Normalize and capitalize tokens
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const uniq = Array.from(new Set(raw.map((w) => w.toLowerCase())));
    const tokens = uniq.map(cap).slice(0, 80);
    const fallback = ['Skibidi','Sigma','Rizz','NPC','Ohio','Fanum','Gyatt','Mewing','Kai','Cenat','MrBeast','Ayo','Goofy','Wiggle','Womp','Aesthetic'];
    res.json({ handles: (tokens.length ? tokens : fallback) });
  } catch (e) {
    res.json({ handles: ['Skibidi','Sigma','Rizz','NPC','Ohio','Fanum','Gyatt','Mewing'] });
  }
});

// Simple health endpoint
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Grid size ~100 meters (approx degrees). 1 degree ~ 111,000 meters.
const GRID_METERS = 100;
const GRID_DEGREES = GRID_METERS / 111000;

// Pinned topic rotation per room (focus: Indian cinema only)
const PIN_SLOT_MS = 5 * 60 * 1000; // rotate every 5 minutes
const pinnedByRoom = new Map(); // roomKey -> { slot, text, until }
const sentimentByRoom = new Map(); // roomKey -> { uid, negatives: Set<deviceId> }

// Curated Indian cinema prompts (kept for guaranteed presence in the pool)
const INDIAN_CINEMA_TOPICS = [
  'Hot take: Pushpa 2 — overrated or all‑time banger? 🔥',
  'RRR vs Baahubali: pick a winner — right now. ⚔️',
  'Kalki 2898 AD: plot > spectacle or spectacle > plot? 🎬',
  'Allu Arjun vs Ram Charan: who runs the country’s hype meter? 📈',
  'NTR Jr vs Prabhas: W or L today? 🏆💀',
  'Pathaan + Jawan era: peak SRK or just warm‑up? 💫',
  'Animal: bold cinema or red flags? Say it. 🚩',
  'Devara or Game Changer: hotter drop this month? 🔥',
  'Pan‑India tag: legit cross‑culture or pure marketing? 🧰',
  'One scene to rule them all — RRR Komaram Bheemudo / Vikram climax / KGF rampage? 🎥',
  'Kantara: rooted masterpiece or overhyped? 🌿',
  'Pick one dialogue energy: “Thaggede Le” / “Flower nahi fire” / “Violence, violence, violence” — which hits harder? ⚡',
  'Best on‑screen pair lately: SRK–Deepika, Ranbir–Alia, or Prabhas–Deepika — no fence‑sitting. ❤️‍🔥',
  'All‑rounder superstar: Hrithik, Allu Arjun, or NTR Jr — who actually has the range? 🧠',
  'Cameo universes (LCU/Kalki crossovers): more hype or more heart? 🧩',
  'Top villain performance: Vijay Sethupathi vs Bobby Deol vs Fahadh — crown one. 👑',
  'Numbers vs originality: what are we chasing? Be honest. 📊',
  'Hook step that owns your feed: Pushpa 2 / Devara / new Tollywood banger — vote. 🕺',
  'Should Indian cinema double down on VFX world‑building post‑Kalki? 🛰️',
  'North vs South “mass”: are the lines blurring or sharpening? 🧭',
  'Recent meme moment: “Pushpa flower nahi fire” / “Devara storm” / “Jai Balayya” — which lived rent‑free? 🧠',
  'Nepotism vs breakout talent: where’s the tide right now? 🌊',
  'Underrated gem (last 2 years): drop one film that deserved more hype. 💎'
];

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return h >>> 0;
}

function getTopicPool(roomKey) {
  // Combine dynamic worldwide pool (English movies + memes + Indian) with curated Indian topics
  const dynamic = getTrendPool();
  const pool = Array.isArray(dynamic) && dynamic.length ? [...dynamic, ...INDIAN_CINEMA_TOPICS] : INDIAN_CINEMA_TOPICS;
  return pool;
}

function selectPinnedTopic(slot, roomKey) {
  const pool = getTopicPool(roomKey);
  const seed = hashCode(`${roomKey}:${slot}`);
  const idx = pool.length ? (seed % pool.length) : 0;
  return pool[idx] || 'Debate: movies and memes — what’s trending today?';
}

function getPinned(roomKey) {
  const now = Date.now();
  const slot = Math.floor(now / PIN_SLOT_MS);
  let rec = pinnedByRoom.get(roomKey);
  let fresh = false;
  if (!rec || rec.slot !== slot || now >= rec.until) {
    const text = selectPinnedTopic(slot, roomKey);
    rec = { slot, text, until: (slot + 1) * PIN_SLOT_MS, uid: 0 };
    pinnedByRoom.set(roomKey, rec);
    fresh = true;
  }
  return { ...rec, fresh };
}

function ensureSentiment(roomKey, uid) {
  const s = sentimentByRoom.get(roomKey);
  if (!s || s.uid !== uid) {
    sentimentByRoom.set(roomKey, { uid, negatives: new Set() });
    return sentimentByRoom.get(roomKey);
  }
  return s;
}

function selectNewTopicDifferent(roomKey, currentText) {
  const pool = getTopicPool(roomKey);
  if (!pool.length) return 'Debate: movies and memes — what’s trending today?';
  const base = hashCode(`${roomKey}:${Date.now()}`);
  let idx = base % pool.length;
  if (pool[idx] === currentText) {
    idx = (idx + 1) % pool.length;
  }
  return pool[idx];
}

// Categorize a topic into broad buckets for diversity rotation
function categorizeTopic(text) {
  try {
    const t = String(text || '').toLowerCase();
    const indian = [
      'tollywood','bollywood','kollywood','mollywood','sandalwood','pan-india','pan india','indian cinema',
      'rrr','baahubali','kalki','animal','devara','game changer','kgf','vikram','kantara','jawan','pathaan','salaar','pushpa',
      'allu arjun','ram charan','ntr','jr ntr','mahesh babu','prabhas','srk','shah rukh','salman','aamir','rajini','rajinikanth','chiranjeevi','balayya','pawan kalyan','trivikram','lokesh','rajamouli','prashanth neel'
    ];
    const english = [
      'barbie','oppenheimer','dune','deadpool','wolverine','top gun','avatar','joker','the batman','mission: impossible','john wick','fast & furious','marvel','mcu','dc','spider-man','avengers','guardians of the galaxy',
      'netflix','prime video','amazon prime','disney+','hulu','max','hbo','apple tv','paramount+','peacock'
    ];
    const meme = [
      'meme','memes','viral','trend','trending','instagram','reels','tiktok','reddit','youtube shorts','template','caption'
    ];
    const has = (arr) => arr.some((k) => t.includes(k));
    if (has(indian)) return 'indian';
    if (has(english) || t.includes('movie') || t.includes('film') || t.includes('cinema') || t.includes('box office')) return 'english';
    if (has(meme) || /\bw\s*or\s*l\b/.test(t) || /0\s*[–-]\s*10/.test(t)) return 'meme';
    return 'other';
  } catch (_) {
    return 'other';
  }
}

function getCategoryBuckets(pool) {
  const buckets = { indian: [], english: [], meme: [], other: [] };
  for (let i = 0; i < pool.length; i++) {
    const cat = categorizeTopic(pool[i]);
    (buckets[cat] || buckets.other).push(i);
  }
  return buckets;
}

function rotatePinnedNow(roomKey, opts = {}) {
  const { forceDifferentCategory } = opts;
  const cur = getPinned(roomKey); // ensures a rec exists
  const pool = getTopicPool(roomKey);
  let nextText = null;
  if (forceDifferentCategory && pool.length) {
    const curCat = categorizeTopic(cur.text);
    const buckets = getCategoryBuckets(pool);
    const otherCats = Object.keys(buckets).filter((c) => c !== curCat && (buckets[c] && buckets[c].length));
    if (otherCats.length) {
      const base = hashCode(`${roomKey}:${Date.now()}:${cur.uid}`);
      const cat = otherCats[base % otherCats.length];
      const list = buckets[cat];
      let idx = list[base % list.length];
      // Avoid identical text if possible
      if (pool[idx] === cur.text) idx = list[(base + 1) % list.length];
      nextText = pool[idx];
    }
  }
  if (!nextText) {
    nextText = selectNewTopicDifferent(roomKey, cur.text);
  }
  const rec = { slot: cur.slot, text: nextText, until: cur.until, uid: (cur.uid || 0) + 1 };
  pinnedByRoom.set(roomKey, rec);
  // reset sentiment for new topic
  sentimentByRoom.set(roomKey, { uid: rec.uid, negatives: new Set() });
  // broadcast new pinned immediately
  broadcastToRoom(roomKey, { type: 'pinned', text: rec.text, ts: Date.now(), until: rec.until });
}

// Detect negative feedback about the current question/topic with flexible phrasing
function isNegativeSentiment(text) {
  try {
    const t = String(text || '').toLowerCase();
    const normalized = t.replace(/\s+/g, ' ').trim();
    // guard for explicit negations like "not boring"
    if (/\bnot\s+(boring|lame|bad|stupid|dumb|garbage|trash|awful|terrible|suck|sucks)\b/.test(normalized)) {
      return false;
    }
    const patterns = [
      /\bboring\b/,
      /\buninteresting\b/,
      /\bnot\s+(really\s+)?(engaging|interesting|good|relevant)\b/,
      /\bnot engaging\b/,
      /\bnot interesting\b/,
      /\bmeh\b/,
      /\bbo{2,}\b/, // boooo
      /\bno{2,}\b/, // nooo
      /\bugh{1,}\b/,
      /\bsucks?\b/,
      /\blame\b/,
      /\bdumb question\b/,
      /\bstupid question\b/,
      /\bbad question\b/,
      /\bweak topic\b/,
      /\bchange (the )?topic\b/,
      /\bskip topic\b/,
      /\bnext (question|topic)\b/,
      /\bnew question\b/,
      /\bno interest\b/,
      /don'?t care/,
      /\btrash\b|\bgarbage\b|\bawful\b|\bterrible\b/,
      /👎|😴|💤|\bzzz+\b/
    ];
    return patterns.some((re) => re.test(normalized));
  } catch (_) {
    return false;
  }
}

// Loose but targeted global movies + memes (English) + Indian cinema check for discussion rooms
function isOnTopic(text) {
  try {
    const t = String(text || '').toLowerCase();
    if (t.length < 6) return true; // allow short affirmations
    const keywords = [
      // Global movie/cinema terms
      'movie','film','cinema','box office','ticket','trailer','teaser','poster','sequel','prequel','franchise','studio','director','actor','actress','cast','screenplay','script','soundtrack','bgm','score','imax','3d','review','rating','rotten tomatoes','metacritic','oscars','academy awards','golden globes',
      // Platforms / distribution
      'netflix','prime video','amazon prime','disney+','hulu','max','hbo','apple tv','paramount+','peacock',
      // Memes / internet culture
      'meme','memes','viral','trend','trending','instagram','reels','tiktok','reddit','youtube shorts','template',
      // English-language popular IP / films (examples)
      'barbie','oppenheimer','dune','deadpool','wolverine','top gun','avatar','joker','the batman','mission: impossible','john wick','fast & furious','marvel','mcu','dc','dceu','dcu','spider-man','avengers','guardians of the galaxy',
      // Keep Indian coverage too
      'tollywood','bollywood','kollywood','mollywood','sandalwood','pan-india','pan india','indian cinema','rrr','baahubali','kalki','animal','devara','game changer','kgf','vikram','kantara','jawan','pathaan','salaar','pushpa','thaggede le','flower nahi fire','goosebumps'
    ];
    for (const k of keywords) {
      if (t.includes(k)) return true;
    }
    return false;
  } catch (_) {
    return true;
  }
}

// Multi-language profanity detector (English with 'shit' excluded) + Hindi/Telugu lexicon
function isProfane(text) {
  try {
    const t = String(text || '');
    // Exclude 'shit' (gen-z slang). Keep other words intact.
    const cleaned = t.replace(/\bshit+\b/gi, '');
    const englishBad = leoProfanity.check(cleaned);

    // Hindi/Devanagari and romanized (non-exhaustive)
    const hindi = [
      'मादरचोद','बहनचोद','चूतिया','गांड','हरामी','रंडी','भोसडीके','कमीना','लौड़ा','लवड़ा',
      'madarchod','bhenchod','chutiya','gaand','harami','randi','bh0sdike','bosdike','kamina','lauda','lavda','gandu'
    ];
    // Telugu script and romanized (non-exhaustive)
    const telugu = [
      'లాంజా','గాండు','పోరు','చెత్త','దొంగ','బొక్కా','దెంగుడు','పుక్కు',
      'lanja','gandu','bokka','dengudu','pukka','puku','puka','chetta','donga'
    ];

    const makeWordRegex = (w) => new RegExp(`(^|[^a-zA-Z0-9])${w.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?=$|[^a-zA-Z0-9])`, 'i');
    const checkList = (list) => list.some((w) => makeWordRegex(w).test(t));

    return englishBad || checkList(hindi) || checkList(telugu);
  } catch (_) {
    return false;
  }
}

// Ban store: { deviceId: { strikes, bannedUntilMs } }
const bansByDevice = new Map();

// In-memory rooms: key -> Set of client objects
const rooms = new Map();

function getRoomKeyFromLocation(lat, lon) {
  // Convert lat/lon to meters relative to origin, adjust longitude by latitude
  const metersPerDegLat = 111000; // approx
  const metersPerDegLon = 111000 * Math.cos((lat * Math.PI) / 180);
  const latMeters = lat * metersPerDegLat;
  const lonMeters = lon * metersPerDegLon;
  const cellSize = 100; // meters
  const latKey = Math.round(latMeters / cellSize);
  const lonKey = Math.round(lonMeters / cellSize);
  return `${latKey}:${lonKey}`;
}

// Compute the center lat/lon (degrees) for a given grid cell key
function getCellCenterLatLon(latKey, lonKey) {
  const metersPerDegLat = 111000;
  const latMeters = latKey * 100; // cell center by rounding quantizer
  const lat = latMeters / metersPerDegLat;
  const metersPerDegLon = 111000 * Math.cos((lat * Math.PI) / 180);
  const lonMeters = lonKey * 100;
  const lon = metersPerDegLon ? (lonMeters / metersPerDegLon) : 0;
  return { lat, lon };
}

function distanceMeters(a, b) {
  try {
    const metersPerDegLat = 111000;
    const midLat = (a.lat + b.lat) / 2;
    const metersPerDegLon = 111000 * Math.cos((midLat * Math.PI) / 180);
    const dLat = (a.lat - b.lat) * metersPerDegLat;
    const dLon = (a.lon - b.lon) * metersPerDegLon;
    return Math.sqrt(dLat * dLat + dLon * dLon);
  } catch (_) {
    return Number.POSITIVE_INFINITY;
  }
}

// Prefer an existing nearby room (<=100m) to avoid boundary splits for Join
function selectPreferredRoomKey(lat, lon, discussion) {
  const metersPerDegLat = 111000;
  const metersPerDegLon = 111000 * Math.cos((lat * Math.PI) / 180);
  const latMeters = lat * metersPerDegLat;
  const lonMeters = lon * metersPerDegLon;
  const cellSize = 100;
  const baseLatKey = Math.round(latMeters / cellSize);
  const baseLonKey = Math.round(lonMeters / cellSize);

  let best = null; // { key, dist }
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const latKey = baseLatKey + dy;
      const lonKey = baseLonKey + dx;
      const k = `${latKey}:${lonKey}${discussion ? '|discussion' : ''}`;
      const set = rooms.get(k);
      if (!set || set.size === 0) continue;
      // Ensure there is at least one active participant (not just spectators)
      const hasActive = Array.from(set).some((c) => c.ws && c.ws.readyState === 1 && !c.spectate);
      if (!hasActive) continue;
      const center = getCellCenterLatLon(latKey, lonKey);
      const d = distanceMeters({ lat, lon }, center);
      if (d <= 100 && (!best || d < best.dist)) {
        best = { key: k, dist: d };
      }
    }
  }

  if (best) return best.key;
  // Fall back to base cell
  return `${baseLatKey}:${baseLonKey}${discussion ? '|discussion' : ''}`;
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

// Client object shape: { id, ws, username, spectate, roomKey, deviceId, discussion }
wss.on('connection', (ws) => {
  const client = { id: uuidv4(), ws, username: null, spectate: false, roomKey: null, deviceId: null, discussion: false };

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (_) {
      return ws.send(JSON.stringify({ type: 'error', error: 'invalid_json' }));
    }

    if (msg.type === 'hello') {
      // { type: 'hello', username, spectate, lat, lon, deviceId, discussion }
      const { username, spectate, lat, lon, deviceId, discussion } = msg;
      if (typeof lat !== 'number' || typeof lon !== 'number') {
        return ws.send(JSON.stringify({ type: 'error', error: 'invalid_location' }));
      }
      client.username = String(username || 'Anon');
      client.spectate = !!spectate;
      client.deviceId = String(deviceId || client.id);
      client.discussion = !!discussion;
      client.lat = lat;
      client.lon = lon;

      if (isBanned(client.deviceId)) {
        return ws.send(JSON.stringify({ type: 'banned', until: bansByDevice.get(client.deviceId).bannedUntilMs }));
      }

      // Spectators can roam anywhere based on URL; joiners prefer a nearby existing room
      const roomKey = client.spectate
        ? (client.discussion ? `${getRoomKeyFromLocation(lat, lon)}|discussion` : getRoomKeyFromLocation(lat, lon))
        : selectPreferredRoomKey(lat, lon, client.discussion);
      client.roomKey = roomKey;
      if (!rooms.has(roomKey)) rooms.set(roomKey, new Set());
      rooms.get(roomKey).add(client);

      ws.send(JSON.stringify({ type: 'joined', roomKey, clientId: client.id }));

      // Send/rotate pinned discussion topic only in discussion rooms
      if (client.discussion) {
        const pinned = getPinned(roomKey);
        ensureSentiment(roomKey, pinned.uid);
        if (pinned.fresh) {
          // Notify existing members about the refreshed topic (exclude the new joiner here)
          broadcastToRoom(
            roomKey,
            { type: 'pinned', text: pinned.text, ts: Date.now(), until: pinned.until },
            ws
          );
        }
        // Always send pinned to the new user
        try {
          ws.send(JSON.stringify({ type: 'pinned', text: pinned.text, ts: Date.now(), until: pinned.until }));
        } catch (_) {}
      }

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

      // Profanity moderation: first offense -> private warning; repeat -> ban
      if (isProfane(text)) {
        const rec = bansByDevice.get(client.deviceId) || { strikes: 0, bannedUntilMs: 0, warned: false };
        if (!rec.warned) {
          rec.warned = true;
          bansByDevice.set(client.deviceId, rec);
          try {
            ws.send(JSON.stringify({ type: 'warning', text: 'Keep it chill. First warning: avoid slurs/abuse. Movies, cinema and memes are welcome. Next offense may lead to a ban.', ts: Date.now() }));
          } catch (_) {}
        } else {
          const updated = escalateBan(client.deviceId);
          try { ws.send(JSON.stringify({ type: 'banned', until: updated.bannedUntilMs })); } catch (_) {}
        }
        return;
      }

      // Discussion rooms: track sentiment only (no off-topic warnings)
      let negative = false;
      if (client.discussion) {
        negative = isNegativeSentiment(text);
      }

      const payload = { type: 'chat', id: uuidv4(), from: client.username, text, ts };
      broadcastToRoom(client.roomKey, payload);

      // After broadcasting, update discussion sentiment and auto-rotate if threshold exceeded
      if (client.discussion) {
        const pinned = getPinned(client.roomKey);
        const sent = ensureSentiment(client.roomKey, pinned.uid);
        if (negative) {
          sent.negatives.add(client.deviceId);
        }
        const set = rooms.get(client.roomKey);
        const active = set ? Array.from(set).filter(c => c.ws.readyState === 1 && !c.spectate).length : 0;
        const negCount = sent.negatives.size;
        const ratio = active > 0 ? (negCount / active) : 0;
        if (ratio > 0.6) {
          rotatePinnedNow(client.roomKey, { forceDifferentCategory: true });
        }
      }
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
      // Remove their negative vote for the current topic, if any
      const pinned = pinnedByRoom.get(client.roomKey);
      const s = sentimentByRoom.get(client.roomKey);
      if (pinned && s && s.uid !== undefined) {
        try { s.negatives.delete(client.deviceId); } catch (_) {}
      }
    }
  });
});

// Serve production frontend (dist) on the same origin as backend
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Normality backend listening on http://localhost:${PORT} (WS at /ws)`);
});

// Start daily trend refresh (uses TMDB + Reddit + curated; Instagram stubbed until token provided)
try {
  startTrendScheduler(process.env.TRENDS_REFRESH_MS ? parseInt(process.env.TRENDS_REFRESH_MS, 10) : undefined);
} catch (_) {}


