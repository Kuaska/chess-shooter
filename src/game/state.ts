import { ARMOR_TIERS, BOTS, CLASSES, ITEMS, RAID_TIME, WEAPONS, type BotKind, type ClassId, type WeaponId } from '../data/game-data';
import { mulberry32, rand } from '../core/math';
import { TILE, generateMap, randomFreeSpot, type GameMap, type LootSpot } from '../world/map';

export interface Item { id: string; n: number }

export interface BotBrain {
  state: 'patrol' | 'alert' | 'combat';
  homeX: number;
  homeY: number;
  targetX: number;
  targetY: number;
  think: number;
  burst: number;
  burstCd: number;
  aim: number;
  seen: number;
}

export interface Fighter {
  id: number;
  isBot: boolean;
  isPlayer: boolean;
  name: string;
  glyph: string;
  color: string;
  classId: ClassId;
  botKind: BotKind | null;
  x: number; y: number;
  vx: number; vy: number;
  angle: number;
  hp: number; maxHp: number;
  sta: number; maxSta: number;
  speed: number;
  weapon: WeaponId;
  mag: number;
  reserve: Record<string, number>;
  fireT: number;
  reloadT: number;
  armor: string | null;
  armorDur: number;
  abilityT: number;
  shieldT: number;
  revealT: number;
  dashT: number;
  dashAngle: number;
  extractT: number;
  extracted: boolean;
  alive: boolean;
  kills: number;
  inv: Item[];
  hitT: number;
  walkT: number;
  brain: BotBrain | null;
  seat: number;
}

export interface Bullet {
  x: number; y: number; vx: number; vy: number;
  dmg: number; owner: number; life: number; color: string; fromPlayer: boolean;
}

export interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; kind: 'spark' | 'smoke' | 'blood';
}

export interface LootBox {
  id: number;
  x: number; y: number;
  kind: LootSpot['kind'] | 'corpse';
  items: Item[];
  opened: boolean;
  label: string;
}

export interface Raid {
  map: GameMap;
  seed: number;
  mode: 'solo' | 'pvp';
  fighters: Fighter[];
  bullets: Bullet[];
  loot: LootBox[];
  particles: Particle[];
  time: number;
  extractOpen: boolean[];
  log: string[];
  over: 'extracted' | 'dead' | null;
  me: Fighter;
  hurt: number;
}

export const PLAYER_R = 13;

export function makeFighter(partial: Partial<Fighter> & { x: number; y: number }): Fighter {
  const base: Fighter = {
    id: 0, isBot: false, isPlayer: false, name: 'Игрок', glyph: '♟', color: '#fff', classId: 'pawn',
    botKind: null, x: 0, y: 0, vx: 0, vy: 0, angle: 0, hp: 100, maxHp: 100, sta: 100, maxSta: 100,
    speed: 170, weapon: 'pistol', mag: 12, reserve: {}, fireT: 0, reloadT: 0, armor: null, armorDur: 0,
    abilityT: 0, shieldT: 0, revealT: 0, dashT: 0, dashAngle: 0, extractT: 0, extracted: false, alive: true,
    kills: 0, inv: [], hitT: 0, walkT: 0, brain: null, seat: -1,
  };
  return { ...base, ...partial };
}

function lootRoll(rnd: () => number, kind: LootBox['kind'], bonus: number): Item[] {
  const out: Item[] = [];
  const count = kind === 'safe' ? 3 : kind === 'duffel' ? 2 : 2;
  for (let i = 0; i < count; i++) {
    const r = rnd();
    if (r < 0.24) out.push({ id: 'ammo_pistol', n: 12 + Math.floor(rnd() * 12) });
    else if (r < 0.4) out.push({ id: 'ammo_smg', n: 20 + Math.floor(rnd() * 20) });
    else if (r < 0.5) out.push({ id: 'ammo_shotgun', n: 4 + Math.floor(rnd() * 4) });
    else if (r < 0.58) out.push({ id: 'ammo_rifle', n: 5 + Math.floor(rnd() * 5) });
    else if (r < 0.69) out.push({ id: 'medkit', n: 1 });
    else if (r < 0.76) out.push({ id: 'stim', n: 1 });
    else if (r < 0.82) out.push({ id: 'plate', n: 1 });
    else if (r < 0.87 && kind !== 'crate') out.push({ id: rnd() < 0.5 ? 'armor1' : 'armor2', n: 1 });
    else if (r < 0.93) out.push({ id: rnd() < 0.6 ? 'gold' : 'chip', n: 1 + Math.floor(rnd() * 3) });
    else out.push({ id: 'relic', n: 1 });
  }
  if (bonus > 0 && rnd() < bonus) out.push({ id: 'gold', n: 2 });
  return out;
}

export interface CreateOptions {
  seed: number;
  classId: ClassId;
  weapon: WeaponId;
  armor: string | null;
  name: string;
  mode?: 'solo' | 'pvp';
  botCount?: number;
  players?: PvpPlayerSpec[];
}

export interface PvpPlayerSpec {
  name: string;
  classId: ClassId;
  seat: number;
  weapon: WeaponId;
  armor: string | null;
}

export function fighterIdForSeat(seat: number) { return 1 + seat * 2; }

export function createRaid(opts: CreateOptions): Raid {
  const map = generateMap(opts.seed);
  const rnd = mulberry32(opts.seed ^ 0x9e3779b9);
  const cls = CLASSES[opts.classId];
  const spawn = randomFreeSpot(map, rnd, 56, 88, 72, 104);
  const me = makeFighter({
    id: 1, isPlayer: true, name: opts.name || 'Игрок', classId: opts.classId, glyph: cls.glyph, color: cls.color,
    x: spawn.x, y: spawn.y, hp: cls.hp, maxHp: cls.hp, sta: cls.stamina, maxSta: cls.stamina, speed: cls.speed,
    weapon: opts.weapon, mag: WEAPONS[opts.weapon].mag, armor: opts.armor, armorDur: opts.armor ? (ARMOR_TIERS[opts.armor]?.dur ?? 60) : 0,
    reserve: { ammo_pistol: 48, ammo_smg: 60, ammo_shotgun: 12, ammo_rifle: 20 },
  });

  const fighters: Fighter[] = [me];
  for (const p of opts.players ?? []) {
    if (p.seat === 0) continue;
    const c = CLASSES[p.classId];
    const spawn2 = randomFreeSpot(map, rnd, 56, 88, 72, 104);
    fighters.push(makeFighter({
      id: fighterIdForSeat(p.seat), name: p.name || `Игрок ${p.seat + 1}`, classId: p.classId, glyph: c.glyph,
      color: c.color, seat: p.seat, x: spawn2.x, y: spawn2.y, hp: c.hp, maxHp: c.hp, sta: c.stamina, maxSta: c.stamina,
      speed: c.speed, weapon: p.weapon, mag: WEAPONS[p.weapon].mag,
      armor: p.armor, armorDur: p.armor ? (ARMOR_TIERS[p.armor]?.dur ?? 60) : 0,
      reserve: { ammo_pistol: 48, ammo_smg: 60, ammo_shotgun: 12, ammo_rifle: 20 },
      inv: [{ id: 'medkit', n: 1 }, { id: 'ammo_' + WEAPONS[p.weapon].ammo, n: 30 }],
    }));
  }
  const kinds: BotKind[] = ['pawn', 'pawn', 'pawn', 'pawn', 'knight', 'knight', 'knight', 'bishop', 'bishop', 'rook', 'rook', 'pawn', 'knight', 'bishop'];
  const total = opts.botCount ?? 16;
  for (let i = 0; i < total; i++) {
    const kind = i === total - 1 ? 'king' : kinds[i % kinds.length];
    const def = BOTS[kind];
    const pos = kind === 'king'
      ? { x: 64 * TILE + 8, y: 64 * TILE + 8 }
      : (() => {
          let p = randomFreeSpot(map, rnd, 10, 10, 116, 116);
          for (let tries = 0; tries < 60; tries++) {
            if (Math.hypot(p.x - spawn.x, p.y - spawn.y) > 820) break;
            p = randomFreeSpot(map, rnd, 10, 10, 116, 116);
          }
          return p;
        })();
    const f = makeFighter({
      id: 10 + i, isBot: true, name: def.name, classId: kind === 'king' ? 'queen' : (kind as ClassId), glyph: def.glyph,
      color: def.color, botKind: kind, x: pos.x, y: pos.y, hp: def.hp, maxHp: def.hp, sta: 100, maxSta: 100,
      speed: def.speed, weapon: def.weapon, mag: WEAPONS[def.weapon].mag, reserve: {}, angle: rand(rnd, 0, 6.28),
      brain: { state: 'patrol', homeX: pos.x, homeY: pos.y, targetX: pos.x, targetY: pos.y, think: 0, burst: 0, burstCd: 0, aim: 0, seen: 0 },
      inv: def.loot.map((id) => ({ id, n: ITEMS[id]?.kind === 'valuable' ? 1 + Math.floor(rnd() * 2) : 1 })),
    });
    fighters.push(f);
  }

  const loot: LootBox[] = map.spots.map((s, i) => ({
    id: 1000 + i, x: s.x, y: s.y, kind: s.kind, opened: false,
    items: lootRoll(rnd, s.kind, opts.classId === 'pawn' ? 0.2 : 0),
    label: s.kind === 'safe' ? 'Сейф' : s.kind === 'duffel' ? 'Вещмешок' : 'Ящик',
  }));

  return {
    map, seed: opts.seed, mode: opts.mode ?? 'solo', fighters, bullets: [], loot, particles: [],
    time: 0, extractOpen: [false, false, false], log: ['Рейд начался. Найди лут и уходи через эвакуацию.'],
    over: null, me, hurt: 0,
  };
}

export function findFighter(r: Raid, id: number) { return r.fighters.find((f) => f.id === id); }

export function addItem(f: Fighter, item: Item): boolean {
  const def = ITEMS[item.id];
  if (!def) return false;
  if (def.stack > 1) {
    const stack = f.inv.find((i) => i.id === item.id && i.n < def.stack);
    if (stack) { stack.n = Math.min(def.stack, stack.n + item.n); return true; }
  }
  if (f.inv.length >= 14) return false;
  f.inv.push({ id: item.id, n: Math.min(item.n, def.stack) });
  return true;
}

export function reserveFor(f: Fighter, weapon: WeaponId): number {
  const key = WEAPONS[weapon].ammo;
  return f.reserve[key] ?? 0;
}

export function consumeReserve(f: Fighter, weapon: WeaponId, amount: number) {
  const key = WEAPONS[weapon].ammo;
  f.reserve[key] = Math.max(0, (f.reserve[key] ?? 0) - amount);
}

export function raidLootValue(items: Item[]): number {
  return items.reduce((sum, i) => sum + (ITEMS[i.id]?.value ?? 0) * i.n, 0);
}

export function extractIndexAt(r: Raid): number {
  const spots = extractSpots();
  for (let i = 0; i < spots.length; i++) {
    if (Math.hypot(spots[i].x - r.me.x, spots[i].y - r.me.y) < 92) return i;
  }
  return -1;
}

export function extractSpots() {
  return [
    { name: 'Северные ворота', x: 64 * TILE + 16, y: 4 * TILE + 16 },
    { name: 'Западный причал', x: 4 * TILE + 16, y: 64 * TILE + 16 },
    { name: 'Южный рынок', x: 64 * TILE + 16, y: 123 * TILE + 16 },
  ];
}

export const TIME_LIMIT = RAID_TIME;

export interface SnapFighter {
  i: number; x: number; y: number; a: number; hp: number; mh: number;
  al: 0 | 1; ex: 0 | 1; g: string; c: string; n: string; cl: ClassId; bk: BotKind | null;
  seat: number; w: WeaponId; mg: number; k: number; sh: number; rv: number; ab: number; et: number; dd: number; at: string | null;
  iv?: [string, number][];
}

export interface Snapshot {
  t: number;
  o: boolean[];
  f: SnapFighter[];
  b: [number, number, number, number, string][];
  l: [number, 0 | 1][];
  g: string[];
  v: 1;
}

export function snapshotRaid(r: Raid): Snapshot {
  return {
    v: 1,
    t: r.time,
    o: r.extractOpen.slice(),
    f: r.fighters.map((f) => ({
      i: f.id, x: Math.round(f.x), y: Math.round(f.y), a: Math.round(f.angle * 100) / 100,
      hp: Math.round(f.hp), mh: Math.round(f.maxHp), al: f.alive ? 1 : 0, ex: f.extracted ? 1 : 0,
      g: f.glyph, c: f.color, n: f.name, cl: f.classId, bk: f.botKind, seat: f.seat,
      w: f.weapon, mg: f.mag, k: f.kills, sh: Math.round(f.shieldT * 10) / 10,
      rv: Math.round(f.revealT * 10) / 10, ab: Math.round(f.abilityT * 10) / 10,
      et: Math.round(f.extractT * 10) / 10, dd: f.dashT > 0 ? 1 : 0, at: f.armor,
      iv: f.isBot ? undefined : f.inv.map((it) => [it.id, it.n] as [string, number]),
    })),
    b: r.bullets.map((b) => [Math.round(b.x), Math.round(b.y), Math.round(b.vx), Math.round(b.vy), b.color] as [number, number, number, number, string]),
    l: r.loot.filter((b) => b.opened || b.id >= 8000).map((b) => [b.id, b.opened ? 1 : 0] as [number, 0 | 1]),
    g: r.log.slice(0, 10),
  };
}

/** Обновляет теневой рейд гостя по снимку хоста. */
export function applySnapshot(r: Raid, s: Snapshot): void {
  r.time = s.t;
  r.extractOpen = s.o.slice();
  r.log = s.g.slice();
  const seen = new Set<number>();
  for (const sf of s.f) {
    seen.add(sf.i);
    let f = r.fighters.find((x) => x.id === sf.i);
    if (!f) {
      f = makeFighter({ id: sf.i, x: sf.x, y: sf.y, name: sf.n, glyph: sf.g, color: sf.c, classId: sf.cl, botKind: sf.bk, seat: sf.seat });
      r.fighters.push(f);
    }
    const prevX = f.x, prevY = f.y;
    f.x = sf.x; f.y = sf.y;
    f.vx = (sf.x - prevX) * 6; f.vy = (sf.y - prevY) * 6;
    f.angle = sf.a; f.hp = sf.hp; f.maxHp = sf.mh; f.alive = sf.al === 1; f.extracted = sf.ex === 1;
    f.weapon = sf.w; f.mag = sf.mg; f.kills = sf.k; f.shieldT = sf.sh; f.revealT = sf.rv;
    if (sf.iv) f.inv = sf.iv.map(([id, n]) => ({ id, n }));
    f.abilityT = sf.ab; f.extractT = sf.et; f.dashT = sf.dd; f.armor = sf.at;
    f.isBot = sf.bk !== null;
  }
  for (const f of r.fighters) if (!seen.has(f.id)) f.extracted = true;
  r.bullets = s.b.map((b) => ({ x: b[0], y: b[1], vx: b[2], vy: b[3], dmg: 0, owner: -1, life: 0.2, color: b[4], fromPlayer: false }));
  const lootSeen = new Set<number>();
  for (const [id, opened] of s.l) {
    lootSeen.add(id);
    let box = r.loot.find((b) => b.id === id);
    if (!box) {
      box = { id, x: r.me.x, y: r.me.y, kind: 'corpse', items: [], opened: false, label: 'Тело' };
      r.loot.push(box);
    }
    box.opened = opened === 1;
  }
  const mine = r.fighters.find((f) => f.id === r.me.id) ?? r.me;
  r.me = mine;
  if (!mine.alive) r.over = 'dead';
  else if (mine.extracted) r.over = 'extracted';
}

export type { Fighter as FighterType };
