// server/trends.js
// Dynamic trending question synthesis for worldwide cinema (English) + memes, plus Indian movies.
// External sources (optional): TMDB (movies), Reddit (memes). Instagram requires tokens; we provide a stub.

let globalTrendPool = [];
let lastRefreshAt = 0;
let lastSources = { tmdb: 0, reddit: 0, instagram: 0, curated: 0 };

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function hasFetch() {
  try {
    return typeof fetch === 'function';
  } catch (_) {
    return false;
  }
}

async function fetchJSON(url, options) {
  if (!hasFetch()) return null;
  try {
    const res = await fetch(url, options);
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

function uniqueStrings(arr) {
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    const k = String(s).trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

// --- Providers ---
async function fetchTrendingMoviesTMDB() {
  const key = process.env.TMDB_API_KEY || '';
  if (!key) return [];
  // Daily trending movies (English prominent). We keep titles; TMDB data is global and often includes English and Indian titles.
  const url = `https://api.themoviedb.org/3/trending/movie/day?language=en-US&api_key=${encodeURIComponent(key)}`;
  const data = await fetchJSON(url);
  if (!data || !Array.isArray(data.results)) return [];
  const titles = data.results
    .map((m) => (m && (m.title || m.original_title || '').trim()))
    .filter(Boolean)
    .slice(0, 20);
  return uniqueStrings(titles);
}

async function fetchTopMemesReddit() {
  // Public, no key. Approximation for global meme trends.
  const data = await fetchJSON('https://www.reddit.com/r/memes/top.json?limit=10&t=day');
  if (!data || !data.data || !Array.isArray(data.data.children)) return [];
  const titles = data.data.children
    .map((p) => p && p.data && (p.data.title || '').trim())
    .filter(Boolean)
    .slice(0, 15);
  return uniqueStrings(titles);
}

async function fetchInstagramTrends() {
  const token = process.env.IG_ACCESS_TOKEN || '';
  const userId = process.env.IG_BUSINESS_USER_ID || '';
  if (!token || !userId) return [];
  const hashtags = (process.env.IG_HASHTAGS || 'movies,cinema,memes,viral,trending').split(',').map((s) => s.trim()).filter(Boolean);

  const results = [];
  for (const tag of hashtags.slice(0, 5)) {
    // 1) Find hashtag ID
    const searchUrl = `https://graph.facebook.com/v20.0/ig_hashtag_search?user_id=${encodeURIComponent(userId)}&q=${encodeURIComponent(tag)}&access_token=${encodeURIComponent(token)}`;
    const search = await fetchJSON(searchUrl);
    const id = search && Array.isArray(search.data) && search.data[0] && search.data[0].id;
    if (!id) continue;

    // 2) Fetch top media captions for this hashtag
    const mediaUrl = `https://graph.facebook.com/v20.0/${id}/top_media?user_id=${encodeURIComponent(userId)}&fields=caption,like_count,comments_count,permalink&limit=10&access_token=${encodeURIComponent(token)}`;
    const media = await fetchJSON(mediaUrl);
    if (!media || !Array.isArray(media.data)) continue;
    for (const m of media.data) {
      const cap = (m && m.caption) ? String(m.caption).trim() : '';
      if (cap) results.push(cap);
    }
  }
  return uniqueStrings(results).slice(0, 30);
}

// --- Question synthesis ---
function makeMovieQuestions(movieTitles) {
  const qs = [];
  const MOVIE_TEMPLATES = [
    (t) => `Hot take: ${t} — overrated or all‑time banger? 🔥`,
    (t) => `${t}: plot > vibes or vibes > plot? 🎬`,
    (t) => `Rate ${t} out of 10 right now — no fence‑sitting. 📈`,
    (t) => `Unpopular opinion about ${t} — drop it. 😈`,
    (t) => `Sell me ${t} in 7 words. Go. 🧨`,
    (t) => `One scene from ${t} that lives rent‑free in your head? 👀`,
    (t) => `W or L: ${t}? 🏆💀`,
  ];

  for (let i = 0; i < movieTitles.length; i++) {
    const title = movieTitles[i];
    // deterministically pick 2 templates per title
    const a = MOVIE_TEMPLATES[i % MOVIE_TEMPLATES.length](title);
    const b = MOVIE_TEMPLATES[(i + 3) % MOVIE_TEMPLATES.length](title);
    qs.push(a, b);
  }
  // Pairwise debates (hook‑style) for the first few
  for (let i = 0; i < Math.min(6, movieTitles.length - 1); i++) {
    const a = movieTitles[i];
    const b = movieTitles[i + 1];
    const pairs = [
      `${a} vs ${b}: pick a winner — right now. ⚔️`,
      `Hotter drop today: ${a} or ${b}? 🔥`,
      `${a} or ${b}: which one actually sticks with you? 🧠`,
    ];
    qs.push(pairs[i % pairs.length]);
  }
  return qs;
}

function makeMemeQuestions(memeTitles) {
  const qs = [];
  const MEME_TEMPLATES = [
    (s) => `W or L: “${s}”? 🧢`,
    (s) => `Still peak or dead joke: “${s}”? 🤡🔥`,
    (s) => `Your spiciest take on “${s}” in 6 words. 🌶️`,
    (s) => `Rate the meme “${s}” 0–10. 📊`,
    (s) => `Caption this energy: “${s}” — go. ✍️`,
    (s) => `Is “${s}” spam or still gold? 🥇🗑️`,
  ];
  for (let i = 0; i < memeTitles.length; i++) {
    const raw = memeTitles[i] || '';
    const short = raw.length > 90 ? raw.slice(0, 87) + '…' : raw;
    // deterministically pick 2 templates per meme
    const a = MEME_TEMPLATES[i % MEME_TEMPLATES.length](short);
    const b = MEME_TEMPLATES[(i + 2) % MEME_TEMPLATES.length](short);
    qs.push(a, b);
  }
  return qs;
}

// Curated fallback topics (English + Indian movies and global memes)
const CURATED_FALLBACK = [
  'Barbie vs Oppenheimer: which defined 2023 more and why?',
  'Dune: Part Two — epic worldbuilding or slow burn?',
  'Deadpool & Wolverine: best Marvel phase moment or overhyped?',
  'Top Gun: Maverick — timeless thrill or nostalgia play?',
  'Avatar: The Way of Water — tech milestone or thin plot?',
  'Joker vs The Batman — better modern take on Gotham?',
  'Salaar vs Animal — who delivered the grittier action?',
  'Pushpa 2 hook step — iconic or just viral?',
  'Kalki 2898 AD — does myth + sci‑fi work for you?',
  'RRR vs Baahubali — bigger cultural wave?',
  'Meme debate: Skibidi Toilets — funny or done?',
  'Meme debate: NPC livestreams — satire or cringe?'
];

function trimPool(arr, max = 200) {
  return arr.slice(0, max);
}

async function refreshTrends() {
  const [movies, memes, ig] = await Promise.all([
    fetchTrendingMoviesTMDB().catch(() => []),
    fetchTopMemesReddit().catch(() => []),
    fetchInstagramTrends().catch(() => []),
  ]);

  const movieQs = makeMovieQuestions(movies);
  const memeQs = makeMemeQuestions(memes);

  // Turn Instagram captions into meme-like questions
  const igQs = makeMemeQuestions(ig);

  const synthesized = uniqueStrings([...movieQs, ...memeQs, ...igQs, ...CURATED_FALLBACK]);
  globalTrendPool = trimPool(synthesized, 300);
  lastRefreshAt = Date.now();
  lastSources = { tmdb: movies.length, reddit: memes.length, instagram: ig.length, curated: CURATED_FALLBACK.length };
  return { size: globalTrendPool.length, lastRefreshAt, lastSources };
}

function getTrendPool() {
  return globalTrendPool.length ? globalTrendPool : CURATED_FALLBACK;
}

function getTrendStatus() {
  return { lastRefreshAt, size: globalTrendPool.length, lastSources };
}

function startTrendScheduler(intervalMs = ONE_DAY_MS) {
  // Initial async refresh
  refreshTrends().catch(() => {});
  // Periodic refresh
  setInterval(() => {
    refreshTrends().catch(() => {});
  }, Math.max(60_000, intervalMs));
}

export { refreshTrends, getTrendPool, getTrendStatus, startTrendScheduler };
