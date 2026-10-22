import { ARMOR_TIERS, BOTS, CLASSES, ITEMS, WEAPONS, type WeaponId } from '../data/game-data';
import { angleDiff, angleTo, clamp, dist } from '../core/math';
import { PLAYER_R, TIME_LIMIT, addItem, consumeReserve, extractIndexAt, extractSpots, makeFighter, type FxEvent, type Fighter, type Raid, type Item } from './state';
import { castRay, freeSpot, idx, isSolid, losClear, solidAt, tileAt, T_DOOR, T_FLOOR } from '../world/map';

export function pushFx(r: Raid, k: string, x: number, y: number) {
  r.fx.push({ k, x, y } as FxEvent);
  if (r.fx.length > 80) r.fx.splice(0, r.fx.length - 80);
}

export interface PlayerInput {
  mx: number;
  my: number;
  aim: number;
  shoot: boolean;
  sprint: boolean;
  reload: boolean;
  ability: boolean;
  interact: boolean;
}

export const NO_INPUT: PlayerInput = { mx: 0, my: 0, aim: 0, shoot: false, sprint: false, reload: false, ability: false, interact: false };

function canStand(r: Raid, x: number, y: number, rad = PLAYER_R): boolean {
  if (solidAt(r.map, x, y)) return false;
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    if (solidAt(r.map, x + Math.cos(ang) * rad, y + Math.sin(ang) * rad)) return false;
  }
  return true;
}

export function moveFighter(r: Raid, f: Fighter, dx: number, dy: number) {
  if (dx !== 0 && canStand(r, f.x + dx, f.y)) f.x += dx;
  if (dy !== 0 && canStand(r, f.x, f.y + dy)) f.y += dy;
  f.x = clamp(f.x, 8, r.map.size * 32 - 8);
  f.y = clamp(f.y, 8, r.map.size * 32 - 8);
}

function spawnBullet(r: Raid, f: Fighter, ang: number, speed: number, dmg: number, color: string, life = 0.9) {
  const sp = WEAPONS[f.weapon];
  const mx = f.x + Math.cos(ang) * 18, my = f.y + Math.sin(ang) * 18;
  r.bullets.push({ x: mx, y: my, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, dmg, owner: f.id, life, color, fromPlayer: f.isPlayer });
  for (let i = 0; i < 3; i++) {
    r.particles.push({ x: mx, y: my, vx: Math.cos(ang + (Math.random() - 0.5) * 0.8) * 90, vy: Math.sin(ang + (Math.random() - 0.5) * 0.8) * 90, life: 0.12, max: 0.12, color, size: 2 + Math.random() * 2, kind: 'spark' });
  }
  void sp;
}

function tryShoot(r: Raid, f: Fighter, aim: number, firstShot: boolean) {
  const w = WEAPONS[f.weapon];
  if (f.fireT > 0 || f.reloadT > 0) return false;
  if (f.mag <= 0) { startReload(f); return false; }
  if (!firstShot && !w.auto) return false;
  f.fireT = w.rate / 1000;
  f.mag -= 1;
  pushFx(r, 'shot_' + f.weapon, f.x, f.y);
  for (let i = 0; i < w.pellets; i++) {
    const spread = (Math.random() - 0.5) * w.spread * 2;
    spawnBullet(r, f, aim + spread, w.speed, w.dmg, w.color, w.range / w.speed);
    r.particles.push({ x: f.x + Math.cos(aim) * 20, y: f.y + Math.sin(aim) * 20, vx: 0, vy: 0, life: 0.18, max: 0.18, color: '#fff3c4', size: 3, kind: 'smoke' });
  }
  return true;
}

export function startReload(f: Fighter) {
  if (f.reloadT > 0) return;
  const w = WEAPONS[f.weapon];
  if (f.mag >= w.mag) return;
  if ((f.reserve[w.ammo] ?? 0) <= 0) return;
  f.reloadT = (w.reload * (f.classId === 'queen' ? 0.85 : 1));
}
function finishReload(f: Fighter) {
  const w = WEAPONS[f.weapon];
  const need = w.mag - f.mag;
  const have = Math.min(need, f.reserve[w.ammo] ?? 0);
  f.mag += have;
  consumeReserve(f, f.weapon, have);
}

export function equipWeapon(f: Fighter, id: WeaponId): boolean {
  const i = f.inv.findIndex((it) => it.id === id);
  if (i < 0) return false;
  if (f.weapon === id) return false;
  f.inv.splice(i, 1);
  f.inv.push({ id: f.weapon, n: 1 });
  f.weapon = id;
  f.mag = 0;
  f.reloadT = 0;
  f.fireT = 0.2;
  startReload(f);
  return true;
}

function killFighter(r: Raid, target: Fighter, byId: number) {
  target.hp = 0;
  target.alive = false;
  const killer = r.fighters.find((f) => f.id === byId);
  if (killer && killer !== target) killer.kills += 1;
  r.particles.push({ x: target.x, y: target.y, vx: 0, vy: 0, life: 0.6, max: 0.6, color: target.color, size: 6, kind: 'smoke' });
  const drops: Item[] = [{ id: target.weapon, n: 1 }, ...(target.inv.length ? target.inv.slice(0, 4) : [])];
  r.loot.push({
    id: 8000 + target.id, x: target.x, y: target.y, kind: 'corpse', opened: false,
    items: drops, label: `Тело: ${target.name}`,
  });
  target.inv = [];
  pushFx(r, target === r.me ? 'death' : 'kill', target.x, target.y);
  if (target === r.me) {
    r.over = 'dead';
    r.log.unshift('Вы погибли. Снаряжение потеряно.');
  } else {
    r.log.unshift(`Убит ${target.name}.`);
  }
}

function damage(r: Raid, target: Fighter, amount: number, byId: number) {
  if (!target.alive) return;
  const attacker = r.fighters.find((f) => f.id === byId);
  if (r.coop && attacker && !attacker.isBot && !target.isBot) return;
  let dmg = amount;
  if (target.shieldT > 0) dmg *= 0.35;
  if (target.armor && target.armorDur > 0) {
    const tier = ARMOR_TIERS[target.armor];
    if (tier) {
      const absorb = dmg * tier.reduce;
      dmg -= absorb;
      target.armorDur = Math.max(0, target.armorDur - absorb * 0.55);
    }
  }
  target.hp -= dmg;
  target.hitT = 0.18;
  pushFx(r, 'hit', target.x, target.y);
  if (target.hp > 0 && target.shieldT <= 0 && dmg > 5 && Math.random() < 0.26) {
    if (target.bleed < 3) target.bleed += 1;
    pushFx(r, 'bleed', target.x, target.y);
    if (target === r.me) r.log.unshift('Кровотечение! Нужен бинт.');
  }
  for (let i = 0; i < 4; i++) {
    r.particles.push({ x: target.x, y: target.y, vx: (Math.random() - 0.5) * 160, vy: (Math.random() - 0.5) * 160, life: 0.3, max: 0.3, color: '#d9544d', size: 2 + Math.random() * 2, kind: 'blood' });
  }
  if (target === r.me) r.hurt = Math.min(1, r.hurt + dmg / target.maxHp);
  if (target.hp <= 0) killFighter(r, target, byId);
}

function updateHuman(r: Raid, f: Fighter, input: PlayerInput, dt: number) {
  if (!f.alive) return;
  const cls = CLASSES[f.classId];

  if (f.dashT > 0) {
    f.dashT -= dt;
    moveFighter(r, f, Math.cos(f.dashAngle) * 760 * dt, Math.sin(f.dashAngle) * 760 * dt);
  } else {
    let mx = input.mx, my = input.my;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    const moving = len > 0.05;
    const wantSprint = input.sprint && moving && f.sta > 0;
    const sprintMul = f.classId === 'knight' ? 1.34 : 1.4;
    const speed = moving ? f.speed * (wantSprint ? sprintMul : 1) * (f.shieldT > 0 ? 0.82 : 1) : 0;
    moveFighter(r, f, mx * speed * dt, my * speed * dt);
    if (wantSprint) f.sta = Math.max(0, f.sta - dt * (f.classId === 'knight' ? 15 : 22));
    if (moving) f.walkT += dt * (wantSprint ? 12 : 8);
    if (!wantSprint) f.sta = Math.min(f.maxSta, f.sta + cls.regen * dt * 0.55);
  }
  if (f.sta < f.maxSta) f.sta = Math.min(f.maxSta, f.sta + cls.regen * dt * 0.25);

  f.angle = input.aim;
  f.fireT = Math.max(0, f.fireT - dt);
  if (f.reloadT > 0) {
    f.reloadT -= dt;
    if (f.reloadT <= 0) { f.reloadT = 0; finishReload(f); }
  }
  if (input.reload) { const before = f.reloadT; startReload(f); if (f.reloadT > 0 && before <= 0) pushFx(r, 'reload', f.x, f.y); }
  if (input.shoot) tryShoot(r, f, f.angle, true);

  if (f.shieldT > 0) f.shieldT -= dt;
  if (f.revealT > 0) f.revealT -= dt;

  const ability = cls.ability;
  if (f.abilityT > 0) f.abilityT -= dt;
  if (input.ability && f.abilityT <= 0) {
    let used = true;
    if (ability.kind === 'dash') { f.dashT = ability.dur; f.dashAngle = f.angle; }
    else if (ability.kind === 'leap') {
      const nx = f.x + Math.cos(f.angle) * 118, ny = f.y + Math.sin(f.angle) * 118;
      if (canStand(r, nx, ny, PLAYER_R + 3)) { f.x = nx; f.y = ny; }
      else used = false;
    } else if (ability.kind === 'reveal') f.revealT = ability.dur;
    else if (ability.kind === 'shield') f.shieldT = ability.dur;
    else if (ability.kind === 'volley') {
      for (let i = -2; i <= 2; i++) spawnBullet(r, f, f.angle + i * 0.16, WEAPONS[f.weapon].speed * 0.95, WEAPONS[f.weapon].dmg * 0.8, '#ffd0e0', 0.5);
    }
    if (used) {
      f.abilityT = ability.cd;
      if (ability.kind === 'dash') f.sta = Math.max(0, f.sta - 12);
    }
  }

  if (input.interact) interact(r, f);
}

function interact(r: Raid, f: Fighter) {
  // сначала закрытые двери
  let door: (typeof r.map.doors)[number] | null = null;
  let doorD = 92;
  for (const d of r.map.doors) {
    if (d.open) continue;
    const dd = dist((d.c + 0.5) * 32, (d.r + 0.5) * 32, f.x, f.y);
    if (dd < doorD) { doorD = dd; door = d; }
  }
  if (door) {
    const ki = f.inv.findIndex((i) => i.id === door!.key);
    if (ki < 0) {
      r.log.unshift(`Заперто. Нужен ${ITEMS[door.key]?.name ?? 'ключ'}.`);
      return;
    }
    const slot = f.inv[ki];
    slot.n -= 1;
    if (slot.n <= 0) f.inv.splice(ki, 1);
    r.map.tile[idx(door.c, door.r)] = T_FLOOR;
    door.open = true;
    r.log.unshift(`${door.label} открыт.`);
    pushFx(r, 'unlock', (door.c + 0.5) * 32, (door.r + 0.5) * 32);
    return;
  }

  let best: number | null = null, bestD = 64;
  for (const box of r.loot) {
    if (box.opened) continue;
    const d = dist(box.x, box.y, f.x, f.y);
    if (d < bestD) { bestD = d; best = box.id; }
  }
  if (best === null) return;
  const box = r.loot.find((b) => b.id === best)!;
  let taken = 0;
  const left: Item[] = [];
  for (const item of box.items) {
    if (addItem(f, item)) {
      taken++;
      r.log.unshift(`Взято: ${ITEMS[item.id]?.name ?? item.id}${item.n > 1 ? ' ×' + item.n : ''}`);
    } else left.push(item);
  }
  box.items = left;
  box.opened = left.length === 0;
  if (taken === 0) r.log.unshift('Инвентарь полон.');
  if (taken > 0) pushFx(r, 'pickup', f.x, f.y);
  if (taken > 0) r.log.splice(0, Math.max(0, r.log.length - 40));
}

export function applyConsumable(r: Raid, f: Fighter, id: string): boolean {
  if (id === 'medkit') {
    f.hp = Math.min(f.maxHp, f.hp + 45);
    f.bleed = 0;
  } else if (id === 'bandage') {
    if (f.bleed <= 0) return false;
    f.bleed = 0;
    f.hp = Math.min(f.maxHp, f.hp + 5);
  } else if (id === 'stim') {
    f.sta = Math.min(f.maxSta, f.sta + 60);
  } else if (id === 'plate') {
    if (!f.armor) return false;
    f.armorDur = Math.min(100, f.armorDur + 40);
  } else return false;
  r.log.unshift(`Использовано: ${ITEMS[id]?.name ?? id}`);
  pushFx(r, 'use', f.x, f.y);
  return true;
}

/** Использовать предмет из инвентаря бойца (в рейде). */
export function useItemInRaid(r: Raid, f: Fighter, id: string): boolean {
  if (!f.alive) return false;
  const idx2 = f.inv.findIndex((i) => i.id === id);
  if (idx2 < 0) return false;
  if (!applyConsumable(r, f, id)) return false;
  const it = f.inv[idx2];
  it.n -= 1;
  if (it.n <= 0) f.inv.splice(idx2, 1);
  return true;
}

/** Выбросить предмет из инвентаря — остаётся лежать на земле. */
export function dropItem(r: Raid, f: Fighter, index: number): boolean {
  if (index < 0 || index >= f.inv.length) return false;
  const it = f.inv.splice(index, 1)[0];
  r.loot.push({
    id: 9000 + Math.floor(Math.random() * 900),
    x: f.x + Math.cos(f.angle) * 22, y: f.y + Math.sin(f.angle) * 22,
    kind: 'crate', items: [it], opened: false, label: 'Выброшено',
  });
  r.log.unshift(`Выброшено: ${ITEMS[it.id]?.name ?? it.id}`);
  return true;
}

function botShoot(r: Raid, b: Fighter, tx: number, ty: number, dt: number) {
  const w = WEAPONS[b.weapon];
  const aim = angleTo(b.x, b.y, tx, ty);
  b.angle = aim;
  const def = b.botKind ? BOTS[b.botKind] : null;
  const accuracy = def ? def.accuracy : 0.15;
  const d = dist(b.x, b.y, tx, ty);
  const err = accuracy * clamp(d / 380, 0.35, 1.8) * 2.1;
  b.fireT = Math.max(0, b.fireT - dt);
  if (b.reloadT > 0) { b.reloadT -= dt; if (b.reloadT <= 0) { b.reloadT = 0; b.mag = w.mag; } return; }
  if (b.fireT > 0) return;
  if (b.mag <= 0) { b.reloadT = w.reload; return; }
  b.fireT = (w.rate / 1000) * 1.75;
  b.mag -= 1;
  for (let i = 0; i < w.pellets; i++) {
    spawnBullet(r, b, aim + (Math.random() - 0.5) * err * 2, w.speed * 0.85, w.dmg * 0.55, '#ff8f6b', w.range / w.speed);
  }
}

function updateBot(r: Raid, b: Fighter, dt: number) {
  if (!b.alive) return;
  const br = b.brain!;
  br.think -= dt;
  b.fireT = Math.max(0, b.fireT - dt);
  b.hitT = Math.max(0, b.hitT - dt);
  const def = BOTS[b.botKind ?? 'pawn'];
  let target: Fighter | null = null;
  let bestD = def.sight;
  if (r.time > 2.5) {
    for (const f of r.fighters) {
      if (!f.alive || f.extracted || f.isBot === b.isBot) continue;
      const d = dist(b.x, b.y, f.x, f.y);
      if (d < bestD && losClear(r.map, b.x, b.y, f.x, f.y)) { bestD = d; target = f; }
    }
  }
  if (target) {
    if (br.state !== 'combat') br.aim = 0.55;
    br.state = 'combat'; br.seen = 1.8; br.targetX = target.x; br.targetY = target.y;
  } else if (br.seen > 0) { br.seen -= dt; br.state = 'alert'; }
  else if (br.state === 'combat') br.state = 'alert';

  if (br.think <= 0) {
    br.think = 0.35 + Math.random() * 0.4;
    if (br.state === 'patrol') {
      if (dist(b.x, b.y, br.targetX, br.targetY) < 40) {
        const a = Math.random() * 6.28, rad = 120 + Math.random() * 260;
        br.targetX = clamp(br.homeX + Math.cos(a) * rad, 64, r.map.size * 32 - 64);
        br.targetY = clamp(br.homeY + Math.sin(a) * rad, 64, r.map.size * 32 - 64);
      }
    } else if (br.state === 'alert') {
      if (dist(b.x, b.y, br.targetX, br.targetY) < 50) { br.state = 'patrol'; br.homeX = b.x; br.homeY = b.y; }
    }
  }

  let dx = 0, dy = 0;
  if (br.state === 'combat' && target) {
    const ang = angleTo(b.x, b.y, target.x, target.y);
    const d = dist(b.x, b.y, target.x, target.y);
    const ideal = b.weapon === 'shotgun' ? 150 : b.weapon === 'rifle' ? 420 : 260;
    const radial = d > ideal + 40 ? 1 : d < ideal - 40 ? -1 : 0;
    const side = Math.sin(r.time * 1.3 + b.id) * 0.8;
    dx = Math.cos(ang) * radial + Math.cos(ang + Math.PI / 2) * side * 0.6;
    dy = Math.sin(ang) * radial + Math.sin(ang + Math.PI / 2) * side * 0.6;
    br.aim = Math.max(0, br.aim - dt);
    if (br.aim <= 0) botShoot(r, b, target.x, target.y, dt);
    if (b.reloadT <= 0 && b.mag <= 0) b.reloadT = WEAPONS[b.weapon].reload;
  } else if (br.state === 'alert') {
    const a = angleTo(b.x, b.y, br.targetX, br.targetY);
    dx = Math.cos(a); dy = Math.sin(a);
    b.angle = a;
  } else {
    const a = angleTo(b.x, b.y, br.targetX, br.targetY);
    if (dist(b.x, b.y, br.targetX, br.targetY) > 24) { dx = Math.cos(a) * 0.55; dy = Math.sin(a) * 0.55; }
    b.angle = a;
  }
  const len = Math.hypot(dx, dy);
  if (len > 0.01) {
    dx /= len; dy /= len;
    const before = b.x + b.y;
    moveFighter(r, b, dx * b.speed * dt, dy * b.speed * dt);
    if (Math.abs(b.x + b.y - before) < 0.05) {
      // обход препятствия
      const side = (b.id % 2 ? 1 : -1) * Math.PI / 2;
      moveFighter(r, b, Math.cos(b.angle + side) * b.speed * dt, Math.sin(b.angle + side) * b.speed * dt);
    }
    b.walkT += dt * 7;
  }
}

function updateBullets(r: Raid, dt: number) {
  for (let i = r.bullets.length - 1; i >= 0; i--) {
    const b = r.bullets[i];
    const steps = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy) * dt) / 10));
    let dead = false;
    for (let s = 0; s < steps && !dead; s++) {
      b.x += (b.vx * dt) / steps;
      b.y += (b.vy * dt) / steps;
      if (isSolid(tileAt(r.map, b.x, b.y))) {
        dead = true;
        for (let k = 0; k < 3; k++) r.particles.push({ x: b.x, y: b.y, vx: (Math.random() - 0.5) * 130, vy: (Math.random() - 0.5) * 130, life: 0.2, max: 0.2, color: '#ffe6a8', size: 1.6, kind: 'spark' });
        break;
      }
      for (const f of r.fighters) {
        if (!f.alive || f.extracted || f.id === b.owner) continue;
        if (dist(b.x, b.y, f.x, f.y) < PLAYER_R + 2) {
          damage(r, f, b.dmg, b.owner);
          dead = true;
          break;
        }
      }
    }
    b.life -= dt;
    if (dead || b.life <= 0) r.bullets.splice(i, 1);
  }
}

export function updateRaid(r: Raid, input: PlayerInput, dt: number, extra?: Map<number, PlayerInput>) {
  if (r.over) return;
  r.time += dt;
  r.hurt = Math.max(0, r.hurt - dt * 1.6);
  const openAt = [110, 230, 350];
  for (let i = 0; i < 3; i++) {
    if (!r.extractOpen[i] && r.time >= openAt[i]) {
      r.extractOpen[i] = true;
      r.log.unshift(`Открыта эвакуация: ${extractSpots()[i].name}.`);
    }
  }
  updateHuman(r, r.me, input, dt);
  if (extra) {
    for (const [id, inp] of extra) {
      const f = r.fighters.find((x) => x.id === id);
      if (f && !f.isBot) updateHuman(r, f, inp, dt);
    }
  }
  for (const b of r.fighters) if (b.isBot) updateBot(r, b, dt);
  updateBullets(r, dt);
  for (const f of r.fighters) {
    if (!f.alive || f.bleed <= 0) continue;
    f.hp -= f.bleed * 1.5 * dt;
    if (f.hp <= 0) killFighter(r, f, -1);
  }
  for (let i = r.particles.length - 1; i >= 0; i--) {
    const p = r.particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94; p.life -= dt;
    if (p.life <= 0) r.particles.splice(i, 1);
  }
  if (r.me.alive) {
    const ex = extractIndexAt(r);
    if (ex >= 0 && r.extractOpen[ex]) {
      r.me.extractT += dt;
      if (r.me.extractT >= 4) {
        r.over = 'extracted';
        r.log.unshift('Эвакуация успешна.');
        pushFx(r, 'extract', r.me.x, r.me.y);
      }
    } else {
      r.me.extractT = Math.max(0, r.me.extractT - dt * 2);
    }
  }
  // остальные люди (гости) тоже могут эвакуироваться
  for (const f of r.fighters) {
    if (f.isBot || f === r.me || !f.alive || f.extracted) continue;
    let idx = -1;
    for (let i = 0; i < 3; i++) {
      const sp = extractSpots()[i];
      if (Math.hypot(sp.x - f.x, sp.y - f.y) < 92) { idx = i; break; }
    }
    if (idx >= 0 && r.extractOpen[idx]) {
      f.extractT += dt;
      if (f.extractT >= 4) {
        f.extracted = true;
        r.log.unshift(`${f.name} эвакуировался.`);
      }
    } else {
      f.extractT = Math.max(0, f.extractT - dt * 2);
    }
  }
  if (r.time >= TIME_LIMIT && !r.over) {
    r.over = 'dead';
    r.log.unshift('Время вышло. Вы не успели эвакуироваться.');
  }
  if (r.log.length > 60) r.log.length = 60;
}

export function makeReviveSpot(r: Raid) {
  const p = extractSpots()[0];
  void p;
  return makeFighter({ x: r.me.x, y: r.me.y });
}

export { castRay, freeSpot };
