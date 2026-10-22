import type { ClassId } from '../data/game-data';
import type { PlayerInput } from '../game/sim';
import { fighterIdForSeat, type Snapshot } from '../game/state';

const NTFY = 'https://ntfy.envs.net';
const ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

export interface LobbyPlayer {
  id: string;
  seat: number;
  name: string;
  classId: ClassId;
}

export type NetAction =
  | { k: 'use'; id: string }
  | { k: 'drop'; i: number }
  | { k: 'equip'; id: string };

export interface NetHandlers {
  onCode(code: string): void;
  onLobby(players: LobbyPlayer[], coop: boolean): void;
  onStart(seed: number, seat: number, players: LobbyPlayer[], coop: boolean): void;
  onSnapshot(s: Snapshot): void;
  onStatus(text: string): void;
  onError(text: string): void;
  onAction?(seat: number, a: NetAction): void;
}

export interface Net {
  role: 'host' | 'guest';
  code: string;
  seat: number;
  players: LobbyPlayer[];
  coop: boolean;
  startGame(seed: number): void;
  setCoop(v: boolean): void;
  publishSnapshot(s: Snapshot): void;
  takeInputs(): Map<number, PlayerInput>;
  sendInput(input: PlayerInput): void;
  sendAction(a: NetAction): void;
  destroy(): void;
}

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function token(n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) out += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  return out;
}
const randomId = () => token(8);

type Wire = { t: string; ts?: number; from?: string; to?: string; [key: string]: unknown };

const topic = (code: string, side: 'h' | 'a') => `cs4pvp-${code}-${side}`;

function publish(tp: string, msg: Wire): void {
  const body = JSON.stringify({ ...msg, ts: Date.now() });
  fetch(`${NTFY}/${tp}`, { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
}

function subscribe(tp: string, onMsg: (m: Wire) => void): EventSource {
  const started = Date.now();
  const es = new EventSource(`${NTFY}/${tp}/sse?since=15s`);
  es.onmessage = (e) => {
    try {
      const outer = JSON.parse(e.data) as { event?: string; message?: string };
      if (outer.event !== 'message' || !outer.message) return;
      const m = JSON.parse(outer.message) as Wire;
      if ((m.ts ?? 0) < started - 2500) return;
      onMsg(m);
    } catch { /* ignore */ }
  };
  return es;
}

class HostNet implements Net {
  role = 'host' as const;
  code: string;
  seat = 0;
  players: LobbyPlayer[];
  coop: boolean;
  private id = randomId();
  private h: NetHandlers;
  private es: EventSource;
  private pcs = new Map<string, { pc: RTCPeerConnection; dc: RTCDataChannel | null; pending: RTCIceCandidateInit[] }>();
  private inputs = new Map<number, PlayerInput>();
  private started = false;

  constructor(name: string, classId: ClassId, coop: boolean, h: NetHandlers) {
    this.h = h;
    this.coop = coop;
    this.code = token(5);
    this.players = [{ id: this.id, seat: 0, name: name || 'Хост', classId }];
    this.es = subscribe(topic(this.code, 'h'), (m) => this.onSignal(m));
    h.onCode(this.code);
    h.onLobby(this.players, this.coop);
  }

  private err(to: string, message: string) {
    publish(topic(this.code, 'a'), { t: 'err', from: this.id, to, message });
  }

  private broadcast(msg: Wire) {
    publish(topic(this.code, 'a'), { ...msg, from: this.id, code: this.code });
  }

  private onSignal(m: Wire) {
    if (m.to && m.to !== this.id) return;
    if (m.t === 'hello') this.addGuest(m);
    else if (m.t === 'answer') this.onAnswer(m);
    else if (m.t === 'ice') this.onIce(m);
  }

  private addGuest(m: Wire) {
    const from = String(m.from ?? '');
    if (!from) return;
    if (this.started) { this.err(from, 'Игра уже началась'); return; }
    const already = this.players.find((p) => p.id === from);
    if (already) {
      this.broadcast({ t: 'welcome', to: from, seat: already.seat });
      this.broadcast({ t: 'lobby', players: this.players, coop: this.coop });
      return;
    }
    if (this.players.length >= 4) { this.err(from, 'В комнате уже четыре игрока'); return; }
    const seat = [1, 2, 3].find((s) => !this.players.some((p) => p.seat === s))!;
    this.players.push({ id: from, seat, name: String(m.name ?? 'Игрок').slice(0, 14), classId: (m.classId as ClassId) ?? 'pawn' });
    this.broadcast({ t: 'welcome', to: from, seat });
    this.broadcast({ t: 'lobby', players: this.players, coop: this.coop });
    this.h.onLobby(this.players, this.coop);
    this.h.onStatus(`Подключился ${String(m.name ?? 'игрок')}.`);
    void this.connect(from);
  }

  private async connect(rid: string) {
    if (this.pcs.has(rid)) return;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const entry = { pc, dc: null as RTCDataChannel | null, pending: [] as RTCIceCandidateInit[] };
    this.pcs.set(rid, entry);
    const dc = pc.createDataChannel('game', { ordered: true });
    entry.dc = dc;
    dc.onmessage = (e) => this.onDc(rid, String(e.data));
    dc.onopen = () => {
      this.h.onStatus('Соединение установлено.');
      this.broadcast({ t: 'lobby', players: this.players, coop: this.coop });
    };
    dc.onclose = () => this.h.onStatus('Игрок отключился.');
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.broadcast({ t: 'ice', to: rid, cand: e.candidate.toJSON(), ic: true });
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.h.onStatus('P2P-соединение не установилось (сеть/файрвол).');
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.broadcast({ t: 'offer', to: rid, sdp: pc.localDescription?.sdp ?? '' });
  }

  private async onAnswer(m: Wire) {
    const entry = this.pcs.get(String(m.from ?? ''));
    if (!entry) return;
    try {
      await entry.pc.setRemoteDescription({ type: 'answer', sdp: String(m.sdp ?? '') });
      for (const c of entry.pending) { try { await entry.pc.addIceCandidate(c); } catch { /* */ } }
      entry.pending = [];
    } catch { /* */ }
  }

  private onIce(m: Wire) {
    const entry = this.pcs.get(String(m.from ?? ''));
    if (!entry || !m.cand) return;
    const cand = m.cand as RTCIceCandidateInit;
    if (!entry.pc.remoteDescription) entry.pending.push(cand);
    else entry.pc.addIceCandidate(cand).catch(() => {});
  }

  private onDc(rid: string, raw: string) {
    const p = this.players.find((x) => x.id === rid);
    if (!p) return;
    try {
      const m = JSON.parse(raw) as { t: string; i?: PlayerInput; a?: NetAction };
      if (m.t === 'i' && m.i) this.inputs.set(p.seat, m.i);
      else if (m.t === 'act' && m.a) this.h.onAction?.(p.seat, m.a);
    } catch { /* */ }
  }

  startGame(seed: number) {
    this.started = true;
    const msg = { t: 'start', seed, players: this.players, coop: this.coop };
    const send = () => {
      this.broadcast(msg);
      for (const { dc } of this.pcs.values()) {
        if (dc?.readyState === 'open') dc.send(JSON.stringify(msg));
      }
    };
    send();
    for (let i = 1; i <= 3; i++) setTimeout(send, i * 800);
  }

  publishSnapshot(s: Snapshot) {
    const msg = JSON.stringify({ t: 'snap', s });
    for (const { dc } of this.pcs.values()) {
      if (dc?.readyState === 'open') dc.send(msg);
    }
  }

  setCoop(v: boolean) {
    if (this.started) return;
    this.coop = v;
    this.broadcast({ t: 'lobby', players: this.players, coop: this.coop });
    this.h.onLobby(this.players, this.coop);
  }

  sendAction(): void { /* хост применяет действия сам */ }

  takeInputs(): Map<number, PlayerInput> {
    const out = new Map<number, PlayerInput>();
    for (const [seat, input] of this.inputs) out.set(fighterIdForSeat(seat), input);
    return out;
  }

  sendInput(): void { /* хост ввод читает локально */ }

  destroy() {
    this.es.close();
    for (const { pc } of this.pcs.values()) try { pc.close(); } catch { /* */ }
    this.pcs.clear();
  }
}

class GuestNet implements Net {
  role = 'guest' as const;
  code: string;
  seat = -1;
  players: LobbyPlayer[] = [];
  coop = false;
  private id = randomId();
  private h: NetHandlers;
  private es: EventSource;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private early: RTCIceCandidateInit[] = [];
  private retry = 0;
  private helloTimer: number | null = null;
  private joinTimer: number;
  private started = false;
  private name: string;
  private classId: ClassId;

  constructor(code: string, name: string, classId: ClassId, h: NetHandlers) {
    this.h = h;
    this.code = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    this.name = name;
    this.classId = classId;
    this.es = subscribe(topic(this.code, 'a'), (m) => this.onSignal(m));
    this.sayHello();
    this.helloTimer = window.setInterval(() => this.sayHello(), 2500);
    this.joinTimer = window.setTimeout(() => {
      if (this.seat < 0) {
        this.stopHello();
        this.h.onError('Комната не найдена или хост не в сети.');
      }
    }, 16000);
  }

  private sayHello() {
    if (this.seat >= 0) return;
    if (this.retry++ > 6) { this.stopHello(); return; }
    publish(topic(this.code, 'h'), { t: 'hello', from: this.id, name: this.name, classId: this.classId });
  }

  private stopHello() {
    if (this.helloTimer !== null) { clearInterval(this.helloTimer); this.helloTimer = null; }
  }

  private onSignal(m: Wire) {
    if (m.to && m.to !== this.id) return;
    if (m.t === 'err') { this.h.onError(String(m.message ?? 'Ошибка комнаты')); return; }
    if (m.t === 'welcome') {
      this.seat = Number(m.seat);
      this.stopHello();
      clearTimeout(this.joinTimer);
      if (this.seat >= 0 && !this.players.some((p) => p.id === this.id)) {
        this.players = [...this.players, { id: this.id, seat: this.seat, name: this.name, classId: this.classId }];
      }
      this.h.onLobby(this.players, this.coop);
      return;
    }
    if (m.t === 'lobby' && Array.isArray(m.players)) {
      this.players = m.players as LobbyPlayer[];
      if (this.seat >= 0 && !this.players.some((p) => p.id === this.id)) {
        this.players = [...this.players, { id: this.id, seat: this.seat, name: this.name, classId: this.classId }];
      }
      this.coop = Boolean(m.coop);
      this.h.onLobby(this.players, this.coop);
      return;
    }
    if (m.t === 'offer') void this.onOffer(m);
    else if (m.t === 'ice' && m.cand) {
      const c = m.cand as RTCIceCandidateInit;
      if (!this.pc || !this.pc.remoteDescription) this.early.push(c);
      else this.pc.addIceCandidate(c).catch(() => {});
    } else if (m.t === 'start') {
      this.stopHello();
      if (this.started) return;
      this.started = true;
      if (Array.isArray(m.players)) this.players = m.players as LobbyPlayer[];
      if (this.seat < 0) {
        const me = this.players.find((p) => p.id === this.id);
        if (me) this.seat = me.seat;
      }
      this.h.onStart(Number(m.seed) || 1, this.seat, this.players, Boolean(m.coop));
    }
  }

  private async onOffer(m: Wire) {
    if (this.pc) return;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    this.pc = pc;
    pc.ondatachannel = (e) => {
      this.dc = e.channel;
      this.dc.onopen = () => this.h.onStatus('Соединение установлено.');
      this.dc.onclose = () => this.h.onStatus('Соединение с хостом потеряно.');
      this.dc.onmessage = (ev) => {
        try {
          const m = JSON.parse(String(ev.data)) as { t: string; s?: Snapshot; seed?: number; players?: LobbyPlayer[]; coop?: boolean };
          if (m.t === 'snap' && m.s) this.h.onSnapshot(m.s);
          else if (m.t === 'start' && !this.started) this.startFromDc(m.seed ?? 1, m.players, m.coop);
        } catch { /* */ }
      };
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) publish(topic(this.code, 'h'), { t: 'ice', from: this.id, to: String(m.from ?? ''), cand: e.candidate.toJSON() });
    };
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: String(m.sdp ?? '') });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      publish(topic(this.code, 'h'), { t: 'answer', from: this.id, to: String(m.from ?? ''), sdp: pc.localDescription?.sdp ?? '' });
      for (const c of this.early) { try { await pc.addIceCandidate(c); } catch { /* */ } }
      this.early = [];
    } catch { this.h.onError('Не удалось установить соединение с хостом.'); }
  }

  private startFromDc(seed: number, players?: LobbyPlayer[], coop?: boolean) {
    if (this.started) return;
    this.started = true;
    this.stopHello();
    if (players) this.players = players;
    this.coop = Boolean(coop);
    if (this.seat < 0) {
      const me = this.players.find((p) => p.id === this.id);
      if (me) this.seat = me.seat;
    }
    this.h.onStart(seed, this.seat, this.players, this.coop);
  }

  setCoop(): void { /* режим задаёт хост */ }

  sendAction(a: NetAction) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify({ t: 'act', a }));
  }

  startGame(): void { /* стартует хост */ }

  publishSnapshot(): void { /* снимки приходят от хоста */ }

  takeInputs(): Map<number, PlayerInput> { return new Map(); }

  sendInput(input: PlayerInput) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify({ t: 'i', i: input }));
  }

  destroy() {
    this.stopHello();
    clearTimeout(this.joinTimer);
    this.es.close();
    try { this.dc?.close(); this.pc?.close(); } catch { /* */ }
    this.dc = null;
    this.pc = null;
  }
}

export function createHostNet(name: string, classId: ClassId, coop: boolean, h: NetHandlers): Net {
  return new HostNet(name, classId, coop, h);
}

export function createGuestNet(code: string, name: string, classId: ClassId, h: NetHandlers): Net {
  return new GuestNet(code, name, classId, h);
}
