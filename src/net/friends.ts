const NTFY = 'https://ntfy.envs.net';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface Friend { tag: string; name: string }
export interface FriendStatus extends Friend { online: boolean }

const presenceTopic = (tag: string) => `cs4pres-${tag}`;
const inviteTopic = (tag: string) => `cs4fr-${tag}`;

export function newTag(): string {
  let out = '';
  for (let i = 0; i < 6; i++) out += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  return out;
}

export function normalizeTag(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function post(topic: string, body: unknown) {
  fetch(`${NTFY}/${topic}`, {
    method: 'POST',
    body: JSON.stringify({ ...(body as object), ts: Date.now() }),
    headers: { 'Content-Type': 'text/plain' },
  }).catch(() => {});
}

function listen(topic: string, onMsg: (m: Record<string, unknown>) => void): EventSource {
  const started = Date.now();
  const es = new EventSource(`${NTFY}/${topic}/sse?since=20s`);
  es.onmessage = (e) => {
    try {
      const outer = JSON.parse(e.data) as { event?: string; message?: string };
      if (outer.event !== 'message' || !outer.message) return;
      const m = JSON.parse(outer.message) as Record<string, unknown>;
      if ((Number(m.ts) || 0) < started - 2500) return;
      onMsg(m);
    } catch { /* */ }
  };
  return es;
}

/** Друзья: постоянный тег, присутствие через ntfy, приглашения в комнату. */
export class FriendsService {
  tag: string;
  name: string;
  friends: Friend[];
  private last = new Map<string, number>();
  private watchers = new Map<string, EventSource>();
  private inviteEs: EventSource | null = null;
  private hb: number | null = null;
  private prune: number | null = null;
  onInvite: ((code: string, from: string, fromName: string) => void) | null = null;
  onStatus: (() => void) | null = null;
  private seenInvites = new Set<string>();

  constructor(tag: string, name: string, friends: Friend[]) {
    this.tag = normalizeTag(tag) || newTag();
    this.name = name;
    this.friends = friends.filter((f) => f.tag && f.tag !== this.tag);
  }

  list(): FriendStatus[] {
    const now = Date.now();
    return this.friends.map((f) => ({ ...f, online: now - (this.last.get(f.tag) ?? 0) < 40000 }));
  }

  start() {
    this.beat();
    this.hb = window.setInterval(() => this.beat(), 12000);
    this.inviteEs = listen(inviteTopic(this.tag), (m) => {
      if (m.t !== 'inv') return;
      const code = String(m.code ?? '').toUpperCase();
      const key = code + ':' + String(m.ts);
      if (!code || this.seenInvites.has(key)) return;
      this.seenInvites.add(key);
      this.onInvite?.(code, String(m.from ?? ''), String(m.fromName ?? 'Друг'));
    });
    for (const f of this.friends) this.watch(f.tag);
    this.prune = window.setInterval(() => this.onStatus?.(), 5000);
  }

  private beat() {
    post(presenceTopic(this.tag), { t: 'hb', tag: this.tag, name: this.name });
  }

  private watch(tag: string) {
    if (this.watchers.has(tag)) return;
    const es = listen(presenceTopic(tag), (m) => {
      if (m.t !== 'hb' && m.t !== 'inv') return;
      if (String(m.tag ?? '') !== tag) return;
      this.last.set(tag, Date.now());
      const f = this.friends.find((x) => x.tag === tag);
      if (f && typeof m.name === 'string' && m.name) f.name = m.name;
      this.onStatus?.();
    });
    this.watchers.set(tag, es);
  }

  /** @returns текст ошибки или null */
  add(rawTag: string, name: string): string | null {
    const tag = normalizeTag(rawTag);
    if (tag.length < 4) return 'Тег слишком короткий (4+ символа).';
    if (tag === this.tag) return 'Это ваш собственный тег.';
    if (this.friends.some((f) => f.tag === tag)) return 'Уже в друзьях.';
    if (this.friends.length >= 40) return 'Список друзей переполнен.';
    this.friends.push({ tag, name: name || tag });
    this.watch(tag);
    this.onStatus?.();
    return null;
  }

  remove(tag: string) {
    this.friends = this.friends.filter((f) => f.tag !== tag);
    this.last.delete(tag);
    this.watchers.get(tag)?.close();
    this.watchers.delete(tag);
    this.onStatus?.();
  }

  invite(friendTag: string, code: string) {
    post(inviteTopic(friendTag), { t: 'inv', code, from: this.tag, fromName: this.name });
  }

  destroy() {
    if (this.hb !== null) clearInterval(this.hb);
    if (this.prune !== null) clearInterval(this.prune);
    this.inviteEs?.close();
    for (const es of this.watchers.values()) es.close();
    this.watchers.clear();
  }
}
