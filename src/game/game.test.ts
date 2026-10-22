import { describe, expect, it } from 'vitest';
import { MAP_SIZE, TILE, generateMap, isSolid, losClear, extractPositions } from '../world/map';
import { applySnapshot, createRaid, snapshotRaid } from './state';
import { moveFighter, updateRaid, NO_INPUT } from './sim';
import { CLASSES } from '../data/game-data';

function firstSolidNearCenter(m: ReturnType<typeof generateMap>): { x: number; y: number } | null {
  for (let rr = 55; rr < 75; rr++) {
    for (let cc = 55; cc < 75; cc++) {
      if (isSolid(m.tile[rr * MAP_SIZE + cc])) {
        const hit = m.tile[rr * MAP_SIZE + cc];
        if (hit === 1) return { x: cc * TILE, y: rr * TILE };
      }
    }
  }
  return null;
}

describe('карта', () => {
  it('детерминирована по сиду', () => {
    const a = generateMap(1234);
    const b = generateMap(1234);
    expect(a.tile).toEqual(b.tile);
    expect(a.spots.length).toBeGreaterThan(40);
  });

  it('имеет границы-стены и дворец в центре', () => {
    const m = generateMap(7);
    let border = 0;
    for (let c = 0; c < MAP_SIZE; c++) for (let r = 0; r < 4; r++) if (isSolid(m.tile[r * MAP_SIZE + c])) border++;
    expect(border).toBeGreaterThan(20);
    let walls = 0;
    for (let rr = 50; rr < 78; rr++) for (let cc = 50; cc < 78; cc++) if (isSolid(m.tile[rr * MAP_SIZE + cc])) walls++;
    expect(walls).toBeGreaterThan(40);
  });

  it('стены перекрывают обзор', () => {
    const m = generateMap(7);
    const solid = firstSolidNearCenter(m);
    expect(solid).not.toBeNull();
    const { x, y } = solid!;
    expect(losClear(m, x - 60, y, x + 60, y)).toBe(false);
  });

  it('эвакуации стоят по краям карты', () => {
    const ex = extractPositions();
    expect(ex).toHaveLength(3);
    for (const e of ex) {
      expect(e.x).toBeGreaterThanOrEqual(0);
      expect(e.y).toBeGreaterThanOrEqual(0);
      expect(e.x).toBeLessThan(MAP_SIZE * TILE);
    }
  });
});

describe('рейд', () => {
  it('создаёт игрока, ботов и лут', () => {
    const r = createRaid({ seed: 42, classId: 'knight', weapon: 'smg', armor: 'armor1', name: 'Тест' });
    expect(r.fighters.length).toBe(17);
    expect(r.me.classId).toBe('knight');
    expect(r.me.maxHp).toBe(CLASSES.knight.hp);
    expect(r.loot.length).toBeGreaterThan(40);
    expect(r.me.armor).toBe('armor1');
  });

  it('добавляет людей PvP на места 1..3', () => {
    const r = createRaid({
      seed: 5, classId: 'pawn', weapon: 'pistol', armor: null, name: 'Хост', mode: 'pvp',
      players: [
        { name: 'Гость', classId: 'rook', seat: 1, weapon: 'shotgun', armor: null },
      ],
    });
    const guest = r.fighters.find((f) => f.id === 3);
    expect(guest?.name).toBe('Гость');
    expect(guest?.maxHp).toBe(CLASSES.rook.hp);
    expect(guest?.isBot).toBe(false);
  });

  it('стены не пропускают движение', () => {
    const r = createRaid({ seed: 9, classId: 'pawn', weapon: 'pistol', armor: null, name: 'Тест' });
    const solid = firstSolidNearCenter(r.map);
    expect(solid).not.toBeNull();
    const f = r.me;
    f.x = solid!.x + TILE + 18;
    f.y = solid!.y + TILE / 2;
    const before = f.x;
    moveFighter(r, f, -20, 0);
    const stopped = f.x;
    for (let i = 0; i < 6; i++) moveFighter(r, f, -20, 0);
    expect(f.x).toBe(stopped);
    expect(f.x).toBeGreaterThan(solid!.x + TILE - 20);
  });

  it('снимок переносит состояние на теневой рейд', () => {
    const host = createRaid({ seed: 77, classId: 'pawn', weapon: 'pistol', armor: null, name: 'Хост' });
    host.time = 123;
    host.me.x = 1000;
    host.me.hp = 55;
    const snap = snapshotRaid(host);
    const shadow = createRaid({ seed: 77, classId: 'pawn', weapon: 'pistol', armor: null, name: 'Гость' });
    applySnapshot(shadow, snap);
    const me = shadow.fighters.find((f) => f.id === 1)!;
    expect(shadow.time).toBe(123);
    expect(me.x).toBe(1000);
    expect(me.hp).toBe(55);
  });

  it('без ввода игрок не двигается и рейд идёт', () => {
    const r = createRaid({ seed: 3, classId: 'pawn', weapon: 'pistol', armor: null, name: 'Тест' });
    const x = r.me.x;
    updateRaid(r, NO_INPUT, 0.1);
    expect(r.time).toBeCloseTo(0.1, 5);
    expect(Math.abs(r.me.x - x)).toBeLessThan(1);
  });
});
