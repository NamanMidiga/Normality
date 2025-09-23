import React, { useMemo, useRef, useState } from 'react';

const WS_URL = `ws://localhost:3001`;

function generateUsername() {
  const animals = ['Wolf','Raven','Fox','Viper','Falcon','Lynx','Puma','Cobra','Mantis','Orca'];
  const adj = ['Silent','Void','Neon','Quantum','Shadow','Chrome','Binary','Obsidian','Ghost','NOVA'];
  const a = adj[Math.floor(Math.random()*adj.length)];
  const b = animals[Math.floor(Math.random()*animals.length)];
  const n = Math.floor(100+Math.random()*900);
  return `${a}${b}${n}`;
}

function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ lat: 0, lon: 0 });
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve({ lat: 0, lon: 0 }),
      { enableHighAccuracy: true, timeout: 5000 }
    );
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

  const deviceId = useMemo(() => {
    const key = 'normality_device_id';
    let id = localStorage.getItem(key);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
    return id;
  }, []);

  async function connect(spectateMode) {
    setSpectate(!!spectateMode);
    setScreen('chat');
    const { lat, lon } = await getLocation();
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      ws.send(JSON.stringify({ type: 'hello', username, spectate: !!spectateMode, lat, lon, deviceId }));
    };
    ws.onclose = () => setStatus('disconnected');
    ws.onerror = () => setStatus('error');
    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.type === 'joined') setRoomKey(data.roomKey);
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

  // Speech-to-text (simple browser Web Speech API)
  const recRef = useRef(null);
  function startDictation() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    if (!recRef.current) {
      recRef.current = new SpeechRecognition();
      recRef.current.interimResults = true;
      recRef.current.continuous = true;
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
    }
    recRef.current.start();
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
    setScreen('home');
  }

  return (
    <div style={styles.app}>
      {screen === 'home' && (
        <div style={styles.home}>
          <div style={styles.title}>Normality</div>
          <div style={styles.subtitle}>Anonymous, hyperlocal, real-time group chat within ~100 meters.</div>
          <div style={styles.usernameRow}>
            <div style={styles.username}>{username}</div>
            <button style={styles.shuffle} onClick={() => setUsername(generateUsername())}>Shuffle</button>
          </div>
          <div style={styles.actions}>
            <button style={styles.primary} onClick={() => connect(false)}>Join Chat</button>
            <button style={styles.secondary} onClick={() => connect(true)}>Spectate</button>
          </div>
          <div style={styles.footer}>Built by Naman</div>
        </div>
      )}
      {screen === 'chat' && (
        <div style={styles.chat}>
          <div style={styles.chatHeader}>
            <button style={styles.back} onClick={leave}>← Back</button>
            <div style={styles.roomLabel}>{roomKey || 'Connecting...'}</div>
            <div style={styles.status}>{status}</div>
          </div>
          <div style={styles.messages}>
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
          <div style={styles.inputRow}>
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
            <input
              style={styles.input}
              value={(inputCommitted + (inputInterim ? (inputCommitted ? ' ' : '') + inputInterim : ''))}
              onChange={(e) => {
                // User typing updates committed text and clears interim
                setInputCommitted(e.target.value);
                setInputInterim('');
              }}
              placeholder={spectate ? 'Spectating…' : 'Message'}
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
    minHeight: '100vh',
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
  actions: { display: 'flex', justifyContent: 'center', gap: 12, marginTop: 26 },
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
  footer: { marginTop: 64, color: '#8a8a8a', fontSize: 12 },
  chat: {
    width: '100%',
    maxWidth: 720,
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    padding: 16
  },
  chatHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottom: '1px solid rgba(255,255,255,0.08)'
  },
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
    gap: 12
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
    alignItems: 'center'
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
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: 12,
    padding: '12px 14px',
    outline: 'none'
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


