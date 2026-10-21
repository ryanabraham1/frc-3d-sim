import type { ChatLine } from '@engine/net/protocol';
import { MAX_CHAT_LENGTH } from '@engine/net/protocol';
import type { InputManager } from '@engine/input/input';
import type { LobbyController } from './lobby';

/** The lobby's existing room chat, kept alive in the match HUD for drivers and spectators. */
export class MatchChat {
  private readonly root = document.createElement('section');
  private readonly log: HTMLElement;
  private readonly field: HTMLInputElement;
  private readonly toggle: HTMLButtonElement;
  private readonly off: () => void;
  private collapsed = window.matchMedia?.('(max-width: 760px), (pointer: coarse)').matches ?? false;
  private signature = '';
  private unread = 0;
  private initial = true;
  private lastSend = 0;

  constructor(container: HTMLElement, private lobby: LobbyController, private input: InputManager) {
    this.root.className = 'match-chat';
    this.root.setAttribute('aria-label', 'Live match chat');
    this.root.innerHTML = `<button class="match-chat-toggle" type="button" aria-expanded="true"><span><i aria-hidden="true"></i>Match chat <small>Everyone in this lobby</small></span><span data-chat-badge></span><span data-chat-chevron aria-hidden="true">−</span></button>
      <div class="match-chat-body"><div class="match-chat-log" role="log" aria-label="Match messages" aria-live="polite" aria-relevant="additions text"></div>
      <form class="match-chat-form"><input type="text" aria-label="Match chat message" placeholder="Message the lobby…" maxlength="${MAX_CHAT_LENGTH}" autocomplete="off"/><button type="submit" aria-label="Send message">Send</button></form>
      <span class="match-chat-hint">Enter to chat · Esc to return to the game</span><span class="match-chat-status" role="status"></span></div>`;
    container.append(this.root);
    this.log = this.root.querySelector('.match-chat-log')!;
    this.field = this.root.querySelector('input')!;
    this.toggle = this.root.querySelector('.match-chat-toggle')!;
    this.toggle.onclick = () => { this.collapsed = !this.collapsed; this.sync(); };
    this.root.querySelector('form')!.onsubmit = e => {
      e.preventDefault();
      const status = this.root.querySelector<HTMLElement>('.match-chat-status')!;
      if (!this.lobby.client.connected) { status.textContent = 'Reconnecting… Your message has not been sent.'; return; }
      const text = this.field.value.trim();
      if (!text) return;
      if (Date.now() - this.lastSend < 450) { status.textContent = 'Wait a moment before sending another message.'; return; }
      this.lastSend = Date.now();
      this.lobby.sendChat(text);
      this.field.value = '';
      status.textContent = '';
      this.field.focus();
    };
    this.root.addEventListener('focusin', () => this.input.setTyping(true));
    this.root.addEventListener('focusout', e => { if (!this.root.contains(e.relatedTarget as Node | null)) this.input.setTyping(false); });
    this.root.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        this.input.setTyping(false);
      }
    });
    window.addEventListener('keydown', this.onKey, true);
    this.off = lobby.subscribeChat(chat => this.update(chat));
    this.sync();
  }
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, button, [contenteditable="true"]')) return;
    if (this.root.closest('.hud')?.querySelector('.hud-modal:not(.hidden)')) return;
    e.preventDefault();
    e.stopPropagation();
    this.collapsed = false;
    this.sync();
    this.field.focus();
  };
  private sync(): void {
    this.root.classList.toggle('is-collapsed', this.collapsed);
    this.toggle.setAttribute('aria-expanded', String(!this.collapsed));
    this.root.querySelector<HTMLElement>('.match-chat-body')!.hidden = this.collapsed;
    this.root.querySelector('[data-chat-chevron]')!.textContent = this.collapsed ? '+' : '−';
    if (!this.collapsed) { this.unread = 0; this.log.scrollTop = this.log.scrollHeight; }
    this.root.querySelector('[data-chat-badge]')!.textContent = this.unread ? String(this.unread) : '';
  }
  private update(chat: readonly ChatLine[]): void {
    const signature = JSON.stringify(chat);
    if (signature === this.signature) return;
    this.signature = signature;
    const atBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 35;
    if (!this.initial && this.collapsed) this.unread++;
    this.initial = false;
    // Text nodes keep player-supplied names and messages out of HTML.
    const fragment = document.createDocumentFragment();
    if (!chat.length) {
      const empty = document.createElement('p');
      empty.className = 'match-chat-empty';
      empty.textContent = 'Coordinate with drivers and spectators here.';
      fragment.append(empty);
    }
    for (const line of chat) {
      const row = document.createElement('div');
      row.className = `match-chat-line ${line.from ? line.alliance ?? '' : 'system'}`;
      if (line.from) {
        const name = document.createElement('b');
        name.textContent = line.from;
        row.append(name, document.createTextNode(' '));
      }
      row.append(document.createTextNode(line.text));
      fragment.append(row);
    }
    this.log.replaceChildren(fragment);
    if (atBottom) this.log.scrollTop = this.log.scrollHeight;
    this.root.querySelector('[data-chat-badge]')!.textContent = this.unread ? String(this.unread) : '';
  }
  dispose(): void {
    this.off();
    window.removeEventListener('keydown', this.onKey, true);
    if (this.root.contains(document.activeElement)) this.input.setTyping(false);
    this.root.remove();
  }
}
