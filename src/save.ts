import { CLASSES, ITEMS, WEAPONS, type ClassId, type WeaponId } from './data/game-data';
import type { Item } from './game/state';

export interface SaveData {
  coins: number;
  stash: Item[];
  weapon: WeaponId;
  armor: string | null;
  classId: ClassId;
  stats: { raids: number; extracts: number; deaths: number; kills: number };
}

const KEY = 'chessshooter.save.v1';

export function defaultSave(): SaveData {
  return {
    coins: 320,
    stash: [
      { id: 'ammo_pistol', n: 60 },
      { id: 'medkit', n: 2 },
      { id: 'stim', n: 1 },
      { id: 'plate', n: 1 },
    ],
    weapon: 'pistol',
    armor: 'armor1',
    classId: 'pawn',
    stats: { raids: 0, extracts: 0, deaths: 0, kills: 0 },
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const data = JSON.parse(raw) as SaveData;
    if (!data || typeof data.coins !== 'number' || !Array.isArray(data.stash)) return defaultSave();
    if (!WEAPONS[data.weapon]) data.weapon = 'pistol';
    if (!CLASSES[data.classId]) data.classId = 'pawn';
    return data;
  } catch {
    return defaultSave();
  }
}

export function writeSave(s: SaveData) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* приватный режим */ }
}

export function stashCount(s: SaveData, id: string): number {
  return s.stash.filter((i) => i.id === id).reduce((n, i) => n + i.n, 0);
}

export function addToStash(s: SaveData, items: Item[]) {
  for (const it of items) {
    const def = ITEMS[it.id];
    if (!def) continue;
    if (def.stack > 1) {
      let left = it.n;
      for (const slot of s.stash) {
        if (slot.id !== it.id) continue;
        const room = def.stack - slot.n;
        if (room <= 0) continue;
        const add = Math.min(room, left);
        slot.n += add;
        left -= add;
        if (left <= 0) break;
      }
      while (left > 0) {
        const add = Math.min(def.stack, left);
        s.stash.push({ id: it.id, n: add });
        left -= add;
      }
    } else {
      s.stash.push({ id: it.id, n: 1 });
    }
  }
  if (s.stash.length > 120) s.stash.length = 120;
}

export function sellValuables(s: SaveData): number {
  let gained = 0;
  const keep: Item[] = [];
  for (const it of s.stash) {
    const def = ITEMS[it.id];
    if (def && def.kind === 'valuable') gained += def.value * it.n;
    else keep.push(it);
  }
  s.stash = keep;
  s.coins += gained;
  return gained;
}

export function equip(s: SaveData, id: string): boolean {
  const def = ITEMS[id];
  if (!def) return false;
  const idx = s.stash.findIndex((i) => i.id === id);
  if (idx < 0) return false;
  if (def.kind === 'weapon') {
    s.stash.splice(idx, 1);
    s.stash.push({ id: s.weapon, n: 1 });
    s.weapon = id as WeaponId;
    return true;
  }
  if (def.kind === 'armor') {
    s.stash.splice(idx, 1);
    if (s.armor) s.stash.push({ id: s.armor, n: 1 });
    s.armor = id;
    return true;
  }
  return false;
}

export const SHOP: Array<{ id: string; price: number }> = [
  { id: 'pistol', price: 120 },
  { id: 'smg', price: 320 },
  { id: 'shotgun', price: 380 },
  { id: 'rifle', price: 720 },
  { id: 'armor1', price: 260 },
  { id: 'armor2', price: 620 },
  { id: 'medkit', price: 90 },
  { id: 'stim', price: 60 },
  { id: 'plate', price: 80 },
  { id: 'ammo_pistol', price: 40 },
  { id: 'ammo_smg', price: 50 },
  { id: 'ammo_shotgun', price: 55 },
  { id: 'ammo_rifle', price: 75 },
];

export function buy(s: SaveData, id: string): boolean {
  const entry = SHOP.find((e) => e.id === id);
  if (!entry || s.coins < entry.price) return false;
  s.coins -= entry.price;
  const def = ITEMS[id];
  const n = def.stack > 1 ? (id.startsWith('ammo') ? def.stack : 1) : 1;
  addToStash(s, [{ id, n }]);
  return true;
}
