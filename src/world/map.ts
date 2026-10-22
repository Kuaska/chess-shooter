import { clamp, mulberry32, rand, randInt } from '../core/math';
import { EXTRACTS } from '../data/game-data';

export const TILE = 32;
export const MAP_SIZE = 128;
export const WORLD = TILE * MAP_SIZE;

export const T_FLOOR = 0;
export const T_WALL = 1;
export const T_TREE = 2;
export const T_CRATE = 3;
export const T_PALACE = 4;
export const T_ROAD = 5;
export const T_DOOR = 6;

export interface LootSpot { x: number; y: number; kind: 'crate' | 'safe' | 'duffel' }
export interface VaultDoor { c: number; r: number; key: string; label: string; open: boolean }

export interface GameMap {
  size: number;
  tile: Uint8Array;
  spots: LootSpot[];
  doors: VaultDoor[];
  seed: number;
}

export const idx = (c: number, r: number) => r * MAP_SIZE + c;

export function tileAt(m: GameMap, x: number, y: number): number {
  const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
  if (c < 0 || r < 0 || c >= m.size || r >= m.size) return T_WALL;
  return m.tile[r * m.size + c];
}

export const isSolid = (t: number) => t === T_WALL || t === T_TREE || t === T_CRATE || t === T_DOOR;
export const isOpaque = (t: number) => t === T_WALL || t === T_TREE || t === T_DOOR;

export function solidAt(m: GameMap, x: number, y: number) { return isSolid(tileAt(m, x, y)); }

function block(m: GameMap, x: number, y: number, w: number, h: number, t = T_WALL) {
  for (let r = y; r < y + h; r++) {
    if (r < 0 || r >= m.size) continue;
    for (let c = x; c < x + w; c++) {
      if (c < 0 || c >= m.size) continue;
      m.tile[r * m.size + c] = t;
    }
  }
}

function hollow(m: GameMap, x: number, y: number, w: number, h: number, t = T_WALL) {
  for (let r = y; r < y + h; r++) {
    for (let c = x; c < x + w; c++) {
      if (c < 0 || r < 0 || c >= m.size || r >= m.size) continue;
      if (r === y || r === y + h - 1 || c === x || c === x + w - 1) m.tile[r * m.size + c] = t;
    }
  }
}

export function generateMap(seed = (Math.random() * 1e9) | 0): GameMap {
  const rnd = mulberry32(seed);
  const m: GameMap = { size: MAP_SIZE, tile: new Uint8Array(MAP_SIZE * MAP_SIZE), spots: [], doors: [], seed };

  // лес по краям мира — естественная граница
  for (let i = 0; i < 900; i++) {
    const x = randInt(rnd, 0, MAP_SIZE - 1), y = randInt(rnd, 0, MAP_SIZE - 1);
    const edge = x < 6 || y < 6 || x > MAP_SIZE - 7 || y > MAP_SIZE - 7;
    if (edge && rnd() < 0.7) m.tile[idx(x, y)] = T_TREE;
  }
  for (let i = 3; i < MAP_SIZE - 3; i++) {
    m.tile[idx(i, 3)] = T_WALL; m.tile[idx(i, MAP_SIZE - 4)] = T_WALL;
    m.tile[idx(3, i)] = T_WALL; m.tile[idx(MAP_SIZE - 4, i)] = T_WALL;
  }
  // проёмы под точки эвакуации
  block(m, 60, 3, 9, 2, T_FLOOR);
  block(m, 3, 60, 2, 9, T_FLOOR);
  block(m, 60, MAP_SIZE - 5, 9, 2, T_FLOOR);

  // дороги: крест от центра к эвакуациям
  for (let i = 4; i < MAP_SIZE - 4; i++) {
    for (let d = 0; d < 3; d++) {
      if (m.tile[idx(63 + d, i)] === T_FLOOR) m.tile[idx(63 + d, i)] = T_ROAD;
      if (m.tile[idx(i, 63 + d)] === T_FLOOR) m.tile[idx(i, 63 + d)] = T_ROAD;
    }
  }

  // дворец в центре
  const p0 = 50, p1 = 78;
  block(m, p0, p0, p1 - p0, 2);
  block(m, p0, p1 - 2, p1 - p0, 2);
  block(m, p0, p0, 2, p1 - p0);
  block(m, p1 - 2, p0, 2, p1 - p0);
  block(m, 62, p0, 4, 2, T_FLOOR);
  block(m, 62, p1 - 2, 4, 2, T_FLOOR);
  block(m, p0, 62, 2, 4, T_FLOOR);
  block(m, p1 - 2, 62, 2, 4, T_FLOOR);
  for (let r = 56; r < 74; r += 6) for (let c = 56; c < 74; c += 6) block(m, c, r, 2, 2);
  for (let r = 54; r < 76; r++) for (let c = 54; c < 76; c++) if (m.tile[idx(c, r)] === T_FLOOR && rnd() < 0.04) m.tile[idx(c, r)] = T_PALACE;

  // руины: северо-запад
  for (let i = 0; i < 9; i++) {
    const w = randInt(rnd, 7, 15), h = randInt(rnd, 6, 13);
    const x = randInt(rnd, 8, 46 - w), y = randInt(rnd, 8, 46 - h);
    hollow(m, x, y, w, h);
    const doors = randInt(rnd, 2, 3);
    for (let d = 0; d < doors; d++) {
      if (rnd() < 0.5) block(m, x + randInt(rnd, 1, w - 2), rnd() < 0.5 ? y : y + h - 1, 2, 1, T_FLOOR);
      else block(m, rnd() < 0.5 ? x : x + w - 1, y + randInt(rnd, 1, h - 2), 1, 2, T_FLOOR);
    }
    for (let k = 0; k < 6; k++) block(m, x + randInt(rnd, 1, w - 2), y + randInt(rnd, 1, h - 2), 1, 1, T_CRATE);
  }
  // деревня: юго-запад
  for (let i = 0; i < 10; i++) {
    const w = randInt(rnd, 5, 9), h = randInt(rnd, 5, 9);
    const x = randInt(rnd, 8, 46 - w), y = randInt(rnd, 80, 118 - h);
    hollow(m, x, y, w, h);
    block(m, x + randInt(rnd, 1, w - 2), y, 1, 1, T_FLOOR);
    block(m, x, y + randInt(rnd, 1, h - 2), 1, 1, T_FLOOR);
  }
  // посёлок у южного тракта — рядом со стартом игрока
  for (let i = 0; i < 7; i++) {
    const w = randInt(rnd, 5, 9), h = randInt(rnd, 5, 8);
    const x = randInt(rnd, 46, 80 - w), y = randInt(rnd, 84, 118 - h);
    hollow(m, x, y, w, h);
    block(m, x + randInt(rnd, 1, w - 2), y, 1, 1, T_FLOOR);
    block(m, x + w - 1, y + randInt(rnd, 1, h - 2), 1, 1, T_FLOOR);
  }
  // лес: северо-восток
  for (let i = 0; i < 46; i++) {
    const x = randInt(rnd, 80, 120), y = randInt(rnd, 8, 50);
    const n = randInt(rnd, 3, 9);
    for (let k = 0; k < n; k++) {
      const c = clamp(x + randInt(rnd, -3, 3), 4, MAP_SIZE - 5), r = clamp(y + randInt(rnd, -3, 3), 4, MAP_SIZE - 5);
      m.tile[idx(c, r)] = T_TREE;
    }
  }
  // склад: юго-восток
  for (let i = 0; i < 14; i++) {
    const x = randInt(rnd, 80, 116), y = randInt(rnd, 80, 116);
    if (rnd() < 0.5) block(m, x, y, randInt(rnd, 5, 9), 2, T_CRATE);
    else block(m, x, y, 2, randInt(rnd, 5, 9), T_CRATE);
  }
  // случайные деревья и камни по всей карте
  for (let i = 0; i < 420; i++) {
    const c = randInt(rnd, 5, MAP_SIZE - 6), r = randInt(rnd, 5, MAP_SIZE - 6);
    if (m.tile[idx(c, r)] !== T_FLOOR) continue;
    if (c > 48 && c < 80 && r > 48 && r < 80) continue;
    m.tile[idx(c, r)] = rnd() < 0.75 ? T_TREE : T_CRATE;
  }

  // закрытые схроны по углам мира: нужен ключ
  const vaults: Array<[number, number, string, string]> = [
    [10, 10, 'key_nw', 'Схрон руин'],
    [108, 10, 'key_ne', 'Схрон леса'],
    [10, 108, 'key_sw', 'Схрон деревни'],
    [108, 108, 'key_se', 'Схрон склада'],
  ];
  for (const [vx, vy, key, label] of vaults) {
    block(m, vx - 1, vy - 1, 11, 11, T_FLOOR);
    hollow(m, vx, vy, 9, 9);
    const dc = vx + 4, dr = vy + 8;
    m.tile[idx(dc, dr)] = T_DOOR;
    m.doors.push({ c: dc, r: dr, key, label, open: false });
    for (const [ox, oy] of [[2, 2], [6, 3], [4, 6]]) {
      m.spots.push({ x: (vx + ox) * TILE + TILE / 2, y: (vy + oy) * TILE + TILE / 2, kind: 'safe' });
    }
  }

  // тайники: только на свободных клетках
  const free: number[] = [];
  for (let r = 5; r < MAP_SIZE - 5; r++) for (let c = 5; c < MAP_SIZE - 5; c++) if (m.tile[idx(c, r)] === T_FLOOR) free.push(idx(c, r));
  for (let i = 0; i < 70 && free.length; i++) {
    const k = free.splice((rnd() * free.length) | 0, 1)[0];
    const c = k % MAP_SIZE, r = (k / MAP_SIZE) | 0;
    m.spots.push({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2, kind: i % 9 === 0 ? 'safe' : i % 3 === 0 ? 'duffel' : 'crate' });
  }
  return m;
}

/** Расстояние до первого препятствия, непрозрачного для взгляда. */
export function castRay(m: GameMap, x0: number, y0: number, ang: number, maxDist: number): number {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const step = 5;
  for (let d = step; d <= maxDist; d += step) {
    if (isOpaque(tileAt(m, x0 + dx * d, y0 + dy * d))) return d;
  }
  return maxDist;
}

/** Прямая видимость между точками (учитывает стены и деревья). */
export function losClear(m: GameMap, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1) return true;
  const steps = Math.ceil(len / 7);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (isOpaque(tileAt(m, ax + dx * t, ay + dy * t))) return false;
  }
  return true;
}

/** Точка не в стене и не в радиусе препятствий. */
export function freeSpot(m: GameMap, x: number, y: number, pad = 14): boolean {
  if (solidAt(m, x, y)) return false;
  for (const [ox, oy] of [[pad, 0], [-pad, 0], [0, pad], [0, -pad], [pad, pad], [-pad, -pad]]) {
    if (solidAt(m, x + ox, y + oy)) return false;
  }
  return true;
}

export function randomFreeSpot(m: GameMap, rnd: () => number, minX = 8, minY = 8, maxX = MAP_SIZE - 8, maxY = MAP_SIZE - 8): { x: number; y: number } {
  for (let i = 0; i < 400; i++) {
    const x = rand(rnd, minX * TILE, maxX * TILE), y = rand(rnd, minY * TILE, maxY * TILE);
    if (freeSpot(m, x, y)) return { x, y };
  }
  return { x: WORLD / 2, y: WORLD / 2 };
}

export function extractPositions() {
  return EXTRACTS.map((e) => ({ name: e.name, x: e.x * TILE + TILE / 2, y: e.y * TILE + TILE / 2 }));
}
