import React, { useEffect, useMemo, useRef, useState } from 'react';
 
 const WS_URL = (() => {
   if (typeof window === 'undefined') return 'ws://localhost:4322/ws';
   const isHttps = window.location.protocol === 'https:';
   const protocol = isHttps ? 'wss' : 'ws';
   // Use same-origin host:port so Vite proxy forwards /ws to backend
   return `${protocol}://${window.location.host}/ws`;
 })();

  // Match server grid math so a shared room key can compute a stable lat/lon
  const GRID_METERS = 100;
  const GRID_DEGREES = GRID_METERS / 111000;
  
  function generateUsername() {
    const titles = ['Captain','Professor','Doctor','Agent','Chief','Sir','Duke','Baron','Count','Major','Admiral','Sultan','Mayor','Sheriff','Wizard','Ninja','Pirate','Cowboy','Goblin','Gremlin','Robot','Catlord','Doggo','Grandma','Grandpa','Auntie','Uncle'];
    const adjs = ['Wobbly','Spicy','Chaotic','Sneaky','Fluffy','Toasty','Saucy','Glittery','Cosmic','Crunchy','Sassy','Bouncy','Noisy','Wonky','Zesty','Turbo','Mega','Micro','Fuzzy','Sparkly','Giga','Loopy','Soggy','Thundering','Jelly','Quantum','Neon','Invisible','Curious','Sleepy'];
    const nouns = ['Pickle','Goose','Banana','Toaster','Penguin','Narwhal','Potato','Muffin','Noodle','Waffle','Squirrel','Taco','Unicorn','Sloth','Hamster','Otter','Llama','Bagel','Dumpling','Burrito','Marshmallow','Pancake','Cupcake','Pumpkin','Avocado','Kiwi','Broccoli','Cucumber','Trombone','Kazoo'];
    const title = titles[Math.floor(Math.random()*titles.length)];
    const adj = adjs[Math.floor(Math.random()*adjs.length)];
    const noun = nouns[Math.floor(Math.random()*nouns.length)];
    const n = Math.floor(100 + Math.random()*900);
    return `${title} ${adj} ${noun} ${n}`;
  }
  
  function getLocation() {
    return new Promise((resolve) => {
      try {
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        // 1) Explicit lat/lon override
        const latParam = params.get('lat');
        const lonParam = params.get('lon');
        if (latParam && lonParam) {
          const lat = parseFloat(latParam);
          const lon = parseFloat(lonParam);
          if (Number.isFinite(lat) && Number.isFinite(lon)) return resolve({ lat, lon });
        }
        // 2) Room key override (?room=latKey:lonKey)
        const room = params.get('room');
        if (room && room.includes(':')) {
          const [a, b] = room.split(':').map((v) => parseInt(v, 10));
          if (Number.isFinite(a) && Number.isFinite(b)) {
            const lat = (a + 0.5) * GRID_DEGREES;
            const lon = (b + 0.5) * GRID_DEGREES;
            return resolve({ lat, lon });
          }
        }
      }
    } catch (_) {}

    // 3) Geolocation (may be blocked on iOS over HTTP)
    try {
      if (!navigator.geolocation) return resolve({ lat: 0, lon: 0 });
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => resolve({ lat: 0, lon: 0 }),
        { enableHighAccuracy: true, timeout: 5000 }
      );
    } catch (_) {
      return resolve({ lat: 0, lon: 0 });
    }
  });
}

export default function App() {
  const [screen, setScreen] = useState('home');
  const [username, setUsername] = useState(generateUsername());
  const [messages, setMessages] = useState([]);
  const [inputCommitted, setInputCommitted] = useState('');
  const [inputInterim, setInputInterim] = useState('');
  const [spectate, setSpectate] = useState(false);
  const wsRef = useRef(null);
  const [status, setStatus] = useState('disconnected');
  const [roomKey, setRoomKey] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isDiscussion, setIsDiscussion] = useState(false);
  const [pinned, setPinned] = useState({ text: '', until: null });
  const textAreaRef = useRef(null);
  const [trendingHandles, setTrendingHandles] = useState([]);
  const [isSmallScreen, setIsSmallScreen] = useState(() => {
    try {
      return typeof window !== 'undefined' ? window.innerWidth <= 480 : false;
    } catch (_) {
      return false;
    }
  });
  const [kbOffset, setKbOffset] = useState(0);

  // Track small screens to apply edge-to-edge mobile styles
  useEffect(() => {
    const update = () => {
      try {
        setIsSmallScreen(window.innerWidth <= 480);
      } catch (_) {
        setIsSmallScreen(false);
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Track virtual keyboard to lift input row (fallback for browsers without interaction-widget)
  useEffect(() => {
    if (screen !== 'chat') { setKbOffset(0); return; }
    const vv = window.visualViewport;
    if (!vv) { setKbOffset(0); return; }
    const apply = () => {
      try {
        const keyboard = Math.max(0, window.innerHeight - vv.height - (vv.offsetTop || 0));
        setKbOffset(keyboard);
      } catch (_) { setKbOffset(0); }
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
    };
  }, [screen]);

  const deviceId = useMemo(() => {
    const key = 'normality_device_id';
    const makeId = () => {
      try {
        if (typeof window !== 'undefined' && window.crypto && typeof window.crypto.randomUUID === 'function') {
          return window.crypto.randomUUID();
        }
        if (typeof window !== 'undefined' && window.crypto && typeof window.crypto.getRandomValues === 'function') {
          const arr = new Uint8Array(16);
          window.crypto.getRandomValues(arr);
          return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
        }
      } catch (_) {}
      return 'id-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    };
    try {
      const storage = typeof window !== 'undefined' ? window.localStorage : null;
      let id = storage ? storage.getItem(key) : null;
      if (!id) {
        id = makeId();
        if (storage) storage.setItem(key, id);
      }
      return id;
    } catch (_) {
      return makeId();
    }
  }, []);

  // Removed Copy Room Link UI per request

  async function connect(spectateMode, discussionMode = false) {
    setSpectate(!!spectateMode);
    setIsDiscussion(!!discussionMode);
    setScreen('chat');
    const { lat, lon } = await getLocation();
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      ws.send(JSON.stringify({ type: 'hello', username, spectate: !!spectateMode, lat, lon, deviceId, discussion: !!discussionMode }));
    };
    ws.onclose = () => setStatus('disconnected');
    ws.onerror = () => setStatus('error');
    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.type === 'joined') setRoomKey(data.roomKey);
      if (data.type === 'pinned') {
        setPinned({ text: data.text, until: data.until || null });
        return;
      }
      setMessages((prev) => [...prev, data]);
    };
  }

  function sendMessage() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    const text = (inputCommitted + inputInterim).trim();
    if (!text) return;
    ws.send(JSON.stringify({ type: 'chat', text }));
    setInputCommitted('');
    setInputInterim('');
  }

  // Auto-resize textarea like WhatsApp
  function adjustTextareaHeight() {
    const el = textAreaRef.current;
    if (!el) return;
    // Defer to next frame to ensure layout reflects latest value
    requestAnimationFrame(() => {
      if (!textAreaRef.current) return;
      const max = Math.round(window.innerHeight * 0.4);
      textAreaRef.current.style.height = 'auto';
      textAreaRef.current.style.height = Math.min(textAreaRef.current.scrollHeight, max) + 'px';
    });
  }

  useEffect(() => {
    adjustTextareaHeight();
  }, [inputCommitted, inputInterim, screen]);

  // Fetch trending meme/movie tokens for username generation
  useEffect(() => {
    let alive = true;
    fetch('/trends/handles')
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((d) => {
        if (!alive) return;
        const list = (d && Array.isArray(d.handles)) ? d.handles : [];
        setTrendingHandles(list);
      })
      .catch(() => {
        if (!alive) return;
        setTrendingHandles(['Skibidi','Sigma','Rizz','NPC','Ohio','Fanum','Gyatt','Mewing']);
      });
    return () => { alive = false; };
  }, []);

  function generateFunnyUsername() {
    try {
      const base = generateUsername();
      const t = trendingHandles && trendingHandles.length ? trendingHandles : [];
      if (!t.length) return base;
      const titles = ['Captain','Professor','Doctor','Agent','Chief','Sir','Duke','Baron','Count','Major','Admiral','Sultan','Wizard','Ninja','Pirate'];
      const connectors = ['','', '', ' the ', ' of ', ' x ', ' '];
      const pick = (arr) => arr[Math.floor(Math.random()*arr.length)];
      const tokA = pick(t);
      const tokB = pick(t);
      const pattern = Math.floor(Math.random()*4);
      const n = Math.floor(10 + Math.random()*90);
      if (pattern === 0) return `${pick(titles)} ${tokA} ${n}`;
      if (pattern === 1) return `${tokA}${pick(connectors)}${tokB} ${n}`.replace(/\s+/g,' ').trim();
      if (pattern === 2) return `${tokA} ${pick(['Goblin','Gremlin','Rizzler','MemeLord','NPC','Sigma'])} ${n}`;
      return base.includes(' ') ? `${tokA} ${base.split(' ').slice(-1)[0]}` : `${tokA} ${base}`;
    } catch (_) {
      return generateUsername();
    }
  }

  // Speech-to-text (browser Web Speech API) with permission prompt and robust handlers
  const recRef = useRef(null);
  async function ensureMicPermission() {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Immediately stop tracks; we only needed the permission prompt
        stream.getTracks().forEach((t) => t.stop());
      }
      return true;
    } catch (e) {
      setIsRecording(false);
      alert('Microphone permission is required for speech-to-text. You can enable it in your browser settings.');
      return false;
    }
  }

  async function startDictation() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser. Try Safari on iOS or Chrome on Android.');
      return;
    }
    if (isRecording) return;
    const ok = await ensureMicPermission();
    if (!ok) return;
    if (!recRef.current) {
      recRef.current = new SpeechRecognition();
      recRef.current.lang = (navigator.language || 'en-US');
      recRef.current.interimResults = true;
      recRef.current.continuous = true;
      recRef.current.maxAlternatives = 1;
      recRef.current.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const chunk = e.results[i][0].transcript;
          if (e.results[i].isFinal) {
            setInputCommitted((prev) => (prev + (prev && !prev.endsWith(' ') ? ' ' : '') + chunk).trimStart());
            setInputInterim('');
          } else {
            interim += chunk;
          }
        }
        if (interim) setInputInterim(interim);
      };
      recRef.current.onstart = () => setIsRecording(true);
      recRef.current.onend = () => setIsRecording(false);
      recRef.current.onerror = (ev) => {
        setIsRecording(false);
        const err = ev && ev.error ? String(ev.error) : 'unknown';
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          alert('Microphone access was blocked. Please allow microphone access to use speech-to-text.');
        }
      };
      recRef.current.onnomatch = () => {};
    }
    try {
      recRef.current.start();
    } catch (_) {
      // If already started or failed, ensure UI state is consistent
      setIsRecording(true);
    }
  }

  function stopDictation() {
    if (recRef.current) recRef.current.stop();
  }

  function leave() {
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'leave' }));
      wsRef.current.close();
    }
    setMessages([]);
    setRoomKey(null);
    setPinned({ text: '', until: null });
    setIsDiscussion(false);
    setScreen('home');
  }

  return (
    <div style={isSmallScreen ? { ...styles.app, ...styles.appMobile } : styles.app}>
      {screen === 'home' && (
        <div style={isSmallScreen ? { ...styles.home, ...styles.homeMobile } : styles.home}>
          <div style={styles.homeHeader}>
            <div style={styles.title}>Normality</div>
            <div style={styles.subtitle}>Anonymous, hyperlocal, real-time group chat within ~100 meters.</div>
          </div>
          <div style={styles.homeActionsCol}>
            <div style={styles.usernameLabel}>Your Username</div>
            <div style={styles.username}>{username}</div>
            <button style={{ ...styles.shuffle, ...styles.shuffleSmall }} onClick={() => setUsername(generateFunnyUsername())}>Shuffle</button>
            <button style={{ ...styles.btn, ...styles.btnPrimary, ...styles.btnWide }} onClick={() => connect(false, true)}>
              <DiscussionIcon />
              <span style={styles.btnLabel}>Join Discussion</span>
            </button>
            <button style={{ ...styles.btn, ...styles.btnNeutral, ...styles.btnNarrow }} onClick={() => connect(false, false)}>
              <ChatIcon />
              <span style={styles.btnLabel}>Join Chat</span>
            </button>
            <button style={{ ...styles.btn, ...styles.btnGhost, ...styles.btnNarrow }} onClick={() => connect(true, false)}>
              <EyeIcon />
              <span style={styles.btnLabel}>Spectate</span>
            </button>
          </div>
          <div style={styles.footer}>Built by Naman</div>
        </div>
      )}
      {screen === 'chat' && (
        <div style={isSmallScreen ? { ...styles.chat, ...styles.chatMobile } : styles.chat}>
          <div style={styles.chatHeader}>
            <button style={styles.back} onClick={leave}>← Back</button>
            <div style={styles.roomLabel}>{isDiscussion ? 'Discussion near you' : 'Nearby Chat'}{roomKey ? '' : ' (connecting...)'}</div>
            <div style={styles.status}>{status}</div>
          </div>
          {isDiscussion && pinned.text && (
            <div style={styles.pinned}>
              <div style={styles.pinnedLabel}>Pinned Topic</div>
              <div style={styles.pinnedText}>{pinned.text}</div>
              {pinned.until && (
                <div style={styles.countdown}>changes at {new Date(pinned.until).toLocaleTimeString()}</div>
              )}
            </div>
          )}
          <div style={{ ...styles.messages, paddingBottom: 72 + kbOffset }}>
            {messages.map((m, i) => (
              <div key={i} style={styles.message}>
                {m.type === 'chat' && (
                  <>
                    <div style={styles.meta}><b>{m.from}</b> <span>{new Date(m.ts).toLocaleTimeString()}</span></div>
                    <div>{m.text}</div>
                  </>
                )}
                {m.type !== 'chat' && (
                  <div style={styles.system}>{m.type}: {m.text || ''} {m.until ? `(until ${new Date(m.until).toLocaleString()})` : ''}</div>
                )}
              </div>
            ))}
          </div>
          <div style={{ ...styles.inputRow, ...(kbOffset ? { transform: `translateY(-${kbOffset}px)` } : {}) }}>
            <button
              aria-label="Speech to text"
              style={{
                ...styles.iconButton,
                ...(isRecording ? styles.iconActive : {}),
              }}
              onClick={() => (isRecording ? stopDictation() : startDictation())}
              title={isRecording ? 'Stop dictation' : 'Start dictation'}
            >
              <MicIcon active={isRecording} />
            </button>
            <textarea
              ref={textAreaRef}
              rows={1}
              wrap="soft"
              style={{ ...styles.input, ...styles.textarea }}
              value={(inputCommitted + (inputInterim ? (inputCommitted ? ' ' : '') + inputInterim : ''))}
              onChange={(e) => {
                // User typing updates committed text and clears interim
                setInputCommitted(e.target.value);
                setInputInterim('');
                adjustTextareaHeight();
              }}
              onInput={adjustTextareaHeight}
              onFocus={() => {
                // ensure keyboard offset recalculates and messages stay visible
                try { if (window.visualViewport) { const vv = window.visualViewport; const k = Math.max(0, window.innerHeight - vv.height - (vv.offsetTop || 0)); setKbOffset(k); } } catch(_) {}
              }}
              onBlur={() => setKbOffset(0)}
              onKeyDown={(e) => {
                // Enter inserts newline; Ctrl/Cmd+Enter sends
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !spectate) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder={spectate ? 'Spectating…' : (isDiscussion ? 'Share your take on the topic' : 'Message')}
              disabled={spectate}
            />
            <button
              style={{ ...styles.iconButton, ...styles.sendBtn }}
              onClick={sendMessage}
              disabled={spectate}
              aria-label="Send message"
              title="Send"
            >
              <SendIcon />
            </button>
          </div>
        </div>
      )}
      </div>
  );
}

  const styles = {
    app: {
      background: 'radial-gradient(1000px 600px at 50% -200px, #1b1b1b 0%, #000 60%)',
      color: '#fff',
      height: '100dvh',
      minHeight: '100dvh',
      width: '100vw',
      overflow: 'hidden',
      fontFamily:
        'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    },
    home: {
      width: '100%',
      maxWidth: 520,
      padding: 24,
      height: '100%',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      textAlign: 'center',
      borderRadius: 24,
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
      backdropFilter: 'blur(12px)'
    },
    title: {
      fontSize: 64,
      letterSpacing: -1,
      fontWeight: 800,
      background: 'linear-gradient(180deg, #fff, #a6a6a6)',
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent'
    },
    subtitle: { marginTop: 10, color: '#cfcfcf' },
    usernameRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      marginTop: 26
    },
    username: {
      border: '1px solid rgba(255,255,255,0.16)',
      padding: '10px 14px',
      borderRadius: 999,
      background: 'rgba(255,255,255,0.05)'
    },
    shuffle: {
      background: 'linear-gradient(180deg, #111, #000)',
      border: '1px solid rgba(255,255,255,0.6)',
      color: '#fff',
      padding: '10px 14px',
      borderRadius: 999,
      cursor: 'pointer'
    },
    shuffleSmall: {
      alignSelf: 'center',
      padding: '8px 14px',
      width: 'auto',
      maxWidth: 220
    },
    actions: { display: 'flex', justifyContent: 'center', gap: 12, marginTop: 26 },
    homeHeader: {
      width: '100%',
      textAlign: 'center',
      paddingTop: 24,
      paddingBottom: 16
    },
    homeActionsCol: {
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: 12,
      flex: 1,
      justifyContent: 'center',
      paddingTop: 16
    },
    fullWidth: { width: '100%' },
    usernameLabel: { color: '#cfcfcf', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, alignSelf: 'flex-start' },
    primary: {
      background: '#fff',
      color: '#000',
      border: '1px solid #fff',
      padding: '12px 18px',
      borderRadius: 14,
      cursor: 'pointer',
      fontWeight: 600
    },
    secondary: {
      background: 'rgba(0,0,0,0.6)',
      color: '#fff',
      border: '1px solid rgba(255,255,255,0.6)',
      padding: '12px 18px',
      borderRadius: 14,
      cursor: 'pointer',
      fontWeight: 600
    },
    // New modern button styles for home actions
    btn: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      height: 52,
      padding: '10px 16px',
      borderRadius: 16,
      border: '1px solid rgba(255,255,255,0.18)',
      cursor: 'pointer'
    },
    btnPrimary: {
      background: 'linear-gradient(180deg, #ffffff, #dcdcdc)',
      color: '#000',
      border: '1px solid #fff',
      boxShadow: '0 8px 24px rgba(255,255,255,0.12)'
    },
    btnNeutral: {
      background: 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))',
      color: '#fff',
      border: '1px solid rgba(255,255,255,0.22)'
    },
    btnGhost: {
      background: 'transparent',
      color: '#cfcfcf',
      border: '1px solid rgba(255,255,255,0.2)'
    },
    btnLabel: { fontWeight: 700, letterSpacing: 0.2 },
    btnWide: { alignSelf: 'center', width: '100%', maxWidth: 360 },
    btnNarrow: { alignSelf: 'center', width: '100%', maxWidth: 320 },
    footer: { marginTop: 64, color: '#8a8a8a', fontSize: 12 },
    chat: {
      width: '100%',
      maxWidth: 720,
      height: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      padding: 16,
      overflow: 'hidden'
    },
    chatHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: 12,
      borderBottom: '1px solid rgba(255,255,255,0.08)'
    },
    pinned: {
      marginTop: 12,
      marginBottom: 8,
      padding: 12,
      borderRadius: 14,
      background: 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04))',
      border: '1px solid rgba(255,255,255,0.14)'
    },
    pinnedLabel: { fontSize: 12, color: '#cfcfcf', marginBottom: 6, letterSpacing: 0.3 },
    pinnedText: { fontSize: 14, color: '#fff', fontWeight: 600 },
    countdown: { fontSize: 11, color: '#a0a0a0', marginTop: 6 },
    back: {
      background: 'rgba(255,255,255,0.06)',
      color: '#fff',
      border: '1px solid rgba(255,255,255,0.2)',
      borderRadius: 10,
      padding: '6px 12px',
      cursor: 'pointer'
    },
    roomLabel: { color: '#c8c8c8', fontSize: 12 },
    status: { color: '#9a9a9a', fontSize: 12 },
    messages: {
      flex: 1,
      overflowY: 'auto',
      padding: '16px 6px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      WebkitOverflowScrolling: 'touch',
      overscrollBehavior: 'contain'
    },
    message: {
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 16,
      padding: 12,
      boxShadow: '0 8px 20px rgba(0,0,0,0.35)'
    },
    meta: { color: '#bdbdbd', fontSize: 12, marginBottom: 6, display: 'flex', gap: 8 },
    system: { color: '#9b9b9b', fontSize: 12 },
    inputRow: {
      display: 'flex',
      gap: 10,
      paddingTop: 12,
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 16,
      padding: 10,
      alignItems: 'center',
      minWidth: 0,
      position: 'sticky',
      bottom: 0,
      zIndex: 10,
      backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)'
    },
    iconButton: {
      width: 44,
      height: 44,
      borderRadius: 12,
      background: 'linear-gradient(180deg, #0f0f0f, #000)',
      border: '1px solid rgba(255,255,255,0.2)',
      color: '#fff',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    },
    iconActive: {
      background: 'linear-gradient(180deg, #1a1a1a, #000)',
      border: '1px solid #fff'
    },
    input: {
      flex: 1,
      background: 'rgba(255,255,255,0.02)',
      color: '#fff',
      fontSize: 16,
      border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: 12,
      padding: '12px 14px',
      outline: 'none'
    },
    textarea: {
      minHeight: 44,
      maxHeight: '40vh',
      overflowX: 'hidden',
      overflowY: 'auto',
      resize: 'none',
      lineHeight: 1.35,
      fontSize: 16,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      overflowWrap: 'anywhere',
      boxSizing: 'border-box',
      width: '100%',
      minWidth: 0,
      display: 'block'
    },
    // Mobile overrides for edge-to-edge layout
    appMobile: {
      alignItems: 'stretch',
      justifyContent: 'flex-start'
    },
    homeMobile: {
      maxWidth: 'none',
      borderRadius: 0,
      padding: 16,
      height: '100%'
    },
    chatMobile: {
      maxWidth: 'none',
      padding: 12,
      height: '100dvh'
    },
    sendBtn: {
      background: '#fff',
      color: '#000',
      border: '1px solid #fff'
    }
  };

function MicIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3Z" fill={active ? '#000' : '#fff'}/>
      <path d="M5 11a7 7 0 0 0 14 0" stroke={active ? '#000' : '#fff'} strokeWidth="2" strokeLinecap="round"/>
      <path d="M12 18v3" stroke={active ? '#000' : '#fff'} strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3.4 4.6 20.5 12 3.4 19.4 5.8 12 3.4 4.6Z" stroke="#000" strokeWidth="2" fill="#fff" strokeLinejoin="round"/>
      <path d="M5.8 12h8.2" stroke="#000" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}


// Home action icons (use currentColor so they inherit button text color)
function DiscussionIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8l-4 4V6Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
      <path d="M18 8h2a2 2 0 0 1 2 2v8l-3-3h-3" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 5h16v10H8l-4 4V5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
      <circle cx="9" cy="10" r="1" fill="currentColor"/>
      <circle cx="12" cy="10" r="1" fill="currentColor"/>
      <circle cx="15" cy="10" r="1" fill="currentColor"/>
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" stroke="currentColor" strokeWidth="2"/>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
    </svg>
  );
}


