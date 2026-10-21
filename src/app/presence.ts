import { NetClient } from '@engine/net/netClient';

let count: number | null = null;
let started = false;
let unavailable = false;

/** Kept outside menu renders and matches, so changing pages never drops presence. */
export function presenceMarkup(): string {
  const label = count === null ? (unavailable ? 'Count unavailable' : 'Connecting…') : `${count} ${count === 1 ? 'player' : 'players'} online`;
  return `<span class="online-count ${count === null ? '' : 'is-live'}" data-online-count role="status" title="People browsing or playing on this server. Multiple tabs in one browser count once."><i aria-hidden="true"></i><span>${label}</span></span>`;
}

function update(next: number | null, failed = false): void {
  count = next;
  unavailable = failed;
  document.querySelectorAll('[data-online-count]').forEach(el => { el.outerHTML = presenceMarkup(); });
}

export function startPresence(): void {
  if (started) return;
  started = true;
  let client: string = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  try {
    const stored = localStorage.getItem('frc-sim-presence-id');
    if (stored && /^[a-zA-Z0-9_-]{16,80}$/.test(stored)) client = stored;
    else localStorage.setItem('frc-sim-presence-id', client);
  } catch { /* Storage disabled: this tab still participates. */ }
  let socket: WebSocket | null = null;
  let lastReply = 0;
  let retry = 1000;
  let timer: ReturnType<typeof setTimeout>;
  let paused = false;
  const connect = () => {
    if (paused) return;
    let ws: WebSocket;
    try { ws = new WebSocket(NetClient.defaultUrl()); }
    catch { update(null, true); return; }
    socket = ws;
    lastReply = Date.now();
    ws.onopen = () => ws.send(JSON.stringify({ op: 'presence', client }));
    ws.onmessage = e => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.op !== 'presence' || !Number.isSafeInteger(msg.count) || msg.count < 0) return;
        lastReply = Date.now();
        retry = 1000;
        update(msg.count);
      } catch { /* Ignore unrelated relay messages. */ }
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      update(null, true);
      if (!paused) {
        timer = setTimeout(connect, retry + Math.random() * 500);
        retry = Math.min(retry * 2, 30_000);
      }
    };
  };
  setInterval(() => {
    if (!socket || paused) return;
    if (Date.now() - lastReply > 90_000) {
      update(null, true);
      socket.close();
    } else if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: 'presence', client }));
  }, 25_000);
  window.addEventListener('pagehide', () => {
    paused = true;
    clearTimeout(timer);
    socket?.close();
  });
  connect();
}
