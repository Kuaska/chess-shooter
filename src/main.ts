import './styles.css';
import { ITEMS, WEAPONS, type ClassId, type WeaponId } from './data/game-data';
import { Input } from './core/input';
import { clamp, dist } from './core/math';
import { Renderer } from './render/render';
import { Hud } from './ui/hud';
import { renderMenu, renderLobby, renderResult, type MenuActions } from './ui/menus';
import { InventoryUI } from './ui/inventory';
import { addToStash, buy, defaultSave, equip, insuranceCost, insure, loadSave, sellValuables, stashCount, writeSave, type SaveData } from './save';
import { applySnapshot, createRaid, fighterIdForSeat, makeFighter, snapshotRaid, type Raid, type Snapshot } from './game/state';
import { NO_INPUT, applyConsumable, dropItem, equipWeapon, updateRaid, useItemInRaid, type PlayerInput } from './game/sim';
import { createGuestNet, createHostNet, type LobbyPlayer, type Net, type NetAction } from './net/net';
import { FriendsService, newTag } from './net/friends';
import { sfx } from './audio/sfx';

const app = document.getElementById('app')!;
const NAME_KEY = 'chessshooter.name';

let save: SaveData = loadSave();
if (!save.tag) { save.tag = newTag(); writeSave(save); }
let playerName = localStorage.getItem(NAME_KEY) || 'Игрок';
let raid: Raid | null = null;
let renderer: Renderer | null = null;
let hud: Hud | null = null;
let invUI: InventoryUI | null = null;
const input = new Input();
let raf = 0;
let lastT = 0;
let finishing = false;
let currentScreen: HTMLElement | null = null;

let net: Net | null = null;
let lobbyEl: HTMLElement | null = null;
let lobbyCode = '';
let lobbyPlayers: LobbyPlayer[] = [];
let lobbyStatus = '';
let lobbyHost = false;
let lobbyCoop = false;
let guest = false;
let pendingSnap: Snapshot | null = null;
let netAcc = 0;
let insuredLoadout: { weapon: WeaponId; armor: string | null } | null = null;

sfx.setVolume(save.volume);
sfx.setMuted(save.muted);

const friends = new FriendsService(save.tag, playerName, save.friends);
friends.onInvite = (code, from, fromName) => showInvite(code, fromName);
friends.onStatus = () => {
  if (raid || net) return;
  const list = friends.list();
  document.querySelectorAll<HTMLElement>('.friend-row[data-tag]').forEach((row) => {
    const st = list.find((f) => f.tag === row.dataset.tag);
    row.querySelector('.dot')?.classList.toggle('on', Boolean(st?.online));
    const em = row.querySelector('em');
    if (em) em.textContent = st?.online ? 'в сети' : 'офлайн';
  });
};
friends.start();

function persistFriends() {
  save.friends = friends.friends;
  writeSave(save);
}

function clearScreen() {
  cancelAnimationFrame(raf);
  raf = 0;
  input.detach();
  hud?.destroy();
  hud = null;
  invUI?.destroy();
  invUI = null;
  renderer = null;
  currentScreen?.remove();
  currentScreen = null;
  lobbyEl = null;
  raid = null;
  finishing = false;
  pendingSnap = null;
  app.innerHTML = '';
}

function leaveNet() {
  net?.destroy();
  net = null;
  guest = false;
  lobbyPlayers = [];
  lobbyCode = '';
  lobbyStatus = '';
  lobbyCoop = false;
}

function showMenu() {
  leaveNet();
  clearScreen();
  const el = document.createElement('div');
  el.className = 'screen';
  app.appendChild(el);
  currentScreen = el;
  const actions: MenuActions = {
    onClass: (id: ClassId) => { save.classId = id; save.insured = null; writeSave(save); showMenu(); },
    onEquip: (id: string) => { equip(save, id); writeSave(save); showMenu(); },
    onBuy: (id: string) => { buy(save, id); writeSave(save); showMenu(); },
    onSell: () => { const g = sellValuables(save); writeSave(save); if (g > 0) alert(`Продано на ${g} ₡`); showMenu(); },
    onStart: () => startRaid(),
    onCreate: () => startPvpHost(),
    onJoin: (code: string, name: string) => startPvpGuest(code, name),
    onReset: () => {
      save = defaultSave();
      save.tag = friends.tag;
      save.friends = friends.friends;
      writeSave(save);
      showMenu();
    },
    onFriendAdd: (tag: string) => {
      const err = friends.add(tag, tag);
      persistFriends();
      if (err) alert(err);
      showMenu();
    },
    onFriendRemove: (tag: string) => { friends.remove(tag); persistFriends(); showMenu(); },
    onVolume: (v: number) => { save.volume = v; sfx.setVolume(v); writeSave(save); },
    onMute: (m: boolean) => { save.muted = m; sfx.setMuted(m); writeSave(save); showMenu(); },
    onInsure: () => {
      if (insure(save)) { writeSave(save); sfx.play('use'); }
      else alert('Недостаточно монет на страховку.');
      showMenu();
    },
  };
  renderMenu(el, save, playerName, actions, friends.list(), friends.tag, insuranceCost(save));
  const nameInput = el.querySelector<HTMLInputElement>('#player-name');
  if (nameInput) {
    nameInput.addEventListener('input', () => {
      playerName = nameInput.value.trim() || 'Игрок';
      friends.name = playerName;
      localStorage.setItem(NAME_KEY, playerName);
    });
  }
}

function showLobby(isHost: boolean, status: string) {
  lobbyHost = isHost;
  lobbyStatus = status;
  if (!lobbyEl) {
    clearScreen();
    const el = document.createElement('div');
    el.className = 'screen';
    app.appendChild(el);
    currentScreen = el;
    lobbyEl = el;
  }
  renderLobby(lobbyEl, lobbyCode, lobbyPlayers, isHost, () => {
    if (!net) return;
    const seed = (Math.random() * 1e9) | 0;
    const players = net.players;
    const coop = net.coop;
    net.startGame(seed);
    startRaid({ seed, seat: 0, players, coop });
  }, () => showMenu(), lobbyStatus, lobbyCoop,
  () => { if (net?.role === 'host') net.setCoop(!net.coop); },
  friends.list(),
  (tag) => { if (net && lobbyCode) { friends.invite(tag, lobbyCode); sfx.play('ui'); } },
  friends.tag);
}

function startPvpHost() {
  leaveNet();
  guest = false;
  lobbyCode = '';
  lobbyPlayers = [];
  lobbyCoop = false;
  net = createHostNet(playerName, save.classId, false, {
    onCode: (c) => { lobbyCode = c; showLobby(true, lobbyStatus || 'Ждём игроков…'); },
    onLobby: (p, coop) => { lobbyPlayers = p; lobbyCoop = coop; showLobby(true, lobbyStatus); },
    onStart: () => { /* стартует хост */ },
    onSnapshot: () => { /* хост не принимает снимки */ },
    onStatus: (t) => showLobby(true, t),
    onError: (t) => showLobby(true, t),
    onAction: (seat, a) => {
      if (!raid) return;
      const f = raid.fighters.find((x) => x.id === fighterIdForSeat(seat));
      if (f) applyAction(raid, f, a);
    },
  });
}

function startPvpGuest(code: string, name: string) {
  leaveNet();
  guest = true;
  lobbyCode = code.toUpperCase().slice(0, 5);
  lobbyPlayers = [];
  net = createGuestNet(code, name || playerName, save.classId, {
    onCode: () => {},
    onLobby: (p, coop) => { lobbyPlayers = p; lobbyCoop = coop; showLobby(false, lobbyStatus); },
    onStart: (seed, seat, players, coop) => startRaid({ seed, seat, players, coop }),
    onSnapshot: (s) => { pendingSnap = s; },
    onStatus: (t) => showLobby(false, t),
    onError: (t) => showLobby(false, t),
  });
  showLobby(false, 'Подключаемся к комнате…');
}

function showInvite(code: string, fromName: string) {
  if (raid) return;
  document.getElementById('invite-toast')?.remove();
  const box = document.createElement('div');
  box.id = 'invite-toast';
  box.className = 'toast';
  box.innerHTML = `<b>${fromName}</b> зовёт в рейд <span>код ${code}</span>
    <button class="primary" data-join-invite="1">Войти</button>
    <button class="ghost" data-close-invite="1">✕</button>`;
  document.body.appendChild(box);
  box.querySelector<HTMLElement>('[data-join-invite]')?.addEventListener('click', () => {
    box.remove();
    sfx.play('ui');
    startPvpGuest(code, playerName);
  });
  box.querySelector<HTMLElement>('[data-close-invite]')?.addEventListener('click', () => box.remove());
  sfx.play('ui');
}

function startRaid(pvp?: { seed: number; seat: number; players: LobbyPlayer[]; coop?: boolean }) {
  clearScreen();
  const seed = pvp ? pvp.seed : (Math.random() * 1e9) | 0;
  const mySeat = pvp?.seat ?? 0;
  const coop = pvp ? Boolean(pvp.coop) : false;
  const insurance = save.insured;
  insuredLoadout = insurance;
  raid = createRaid({
    seed,
    classId: save.classId,
    weapon: save.weapon,
    armor: save.armor,
    name: playerName,
    mode: pvp ? 'pvp' : 'solo',
    coop,
    insured: Boolean(insurance),
    players: pvp && net?.role === 'host'
      ? pvp.players.filter((p) => p.seat > 0).map((p) => ({
          name: p.name, classId: p.classId, seat: p.seat, weapon: 'pistol' as WeaponId, armor: null,
        }))
      : undefined,
  });
  if (pvp) {
    const meId = fighterIdForSeat(mySeat);
    let me = raid.fighters.find((f) => f.id === meId);
    if (!me) {
      me = makeFighter({
        id: meId, x: raid.me.x, y: raid.me.y, seat: mySeat, name: playerName, classId: save.classId,
        weapon: save.weapon, mag: WEAPONS[save.weapon].mag,
        reserve: { ammo_pistol: 48, ammo_smg: 60, ammo_shotgun: 12, ammo_rifle: 20 },
      });
      raid.fighters.push(me);
    }
    raid.me = me;
  }
  if (insurance) { save.insured = null; }
  save.stats.raids += 1;
  writeSave(save);

  const el = document.createElement('div');
  el.className = 'screen game';
  const canvas = document.createElement('canvas');
  canvas.className = 'world';
  el.appendChild(canvas);
  app.appendChild(el);
  currentScreen = el;

  renderer = new Renderer(canvas);
  renderer.resize(window.innerWidth, window.innerHeight);
  renderer.resetExplored();
  hud = new Hud(el, input);
  invUI = new InventoryUI(el);
  input.attach(canvas);
  netAcc = 0;

  lastT = performance.now();
  const loop = (t: number) => {
    raf = requestAnimationFrame(loop);
    if (!raid || !renderer || !hud) return;
    const dt = clamp((t - lastT) / 1000, 0.001, 0.05);
    lastT = t;
    const cam = renderer.camera(raid);

    if (input.take('Tab') || input.take('KeyI')) {
      if (invUI) {
        invUI.toggle(raid, {
          use: (id) => invAction({ k: 'use', id }),
          drop: (i) => invAction({ k: 'drop', i }),
          equip: (id) => invAction({ k: 'equip', id }),
          close: () => invUI?.hide(),
        });
      }
    }

    if (guest) {
      if (pendingSnap) { applySnapshot(raid, pendingSnap); pendingSnap = null; }
      netAcc += dt;
      if (netAcc >= 1 / 30) {
        netAcc = 0;
        net?.sendInput(readInput(cam));
      }
      input.clearEdges();
      renderer.draw(raid, cam, dt);
      hud.update(raid, renderer, input.touchMode);
      if (invUI?.open) invUI.render(raid);
      drainFx(raid);
      if (raid.over && !finishing) finishRaid();
      return;
    }

    if (!raid.over && !finishing) {
      const inp = readInput(cam);
      updateRaid(raid, inp, dt, net ? net.takeInputs() : undefined);
      netAcc += dt;
      if (net && netAcc >= 1 / 30) {
        netAcc = 0;
        net.publishSnapshot(snapshotRaid(raid));
        drainFx(raid);
      } else if (!net) {
        drainFx(raid);
      }
      input.clearEdges();
      renderer.draw(raid, cam, dt);
      hud.update(raid, renderer, input.touchMode);
      if (invUI?.open) invUI.render(raid);
    } else if (raid.over && !finishing) {
      finishRaid();
    } else {
      renderer.draw(raid, cam, dt);
      hud.update(raid, renderer, input.touchMode);
    }
  };
  raf = requestAnimationFrame(loop);
}

function drainFx(r: Raid) {
  if (!r.fx.length) return;
  for (const e of r.fx) {
    const d = dist(e.x, e.y, r.me.x, r.me.y);
    const pan = clamp((e.x - r.me.x) / 480, -1, 1);
    sfx.play(e.k, d, pan);
  }
  r.fx.length = 0;
}

function applyAction(r: Raid, f: FighterLike, a: NetAction) {
  if (!f.alive) return;
  if (a.k === 'use') {
    if (useItemInRaid(r, f, a.id)) return;
    if (r.mode === 'solo' && f === r.me && stashCount(save, a.id) > 0) {
      const slot = save.stash.find((i) => i.id === a.id)!;
      slot.n -= 1;
      if (slot.n <= 0) save.stash.splice(save.stash.indexOf(slot), 1);
      if (applyConsumable(r, f, a.id)) writeSave(save);
    }
  } else if (a.k === 'drop') {
    dropItem(r, f, a.i);
  } else if (a.k === 'equip') {
    if (!WEAPONS[a.id as WeaponId]) return;
    const index = f.inv.findIndex((i) => i.id === a.id);
    if (index < 0) return;
    f.inv.splice(index, 1);
    const old = f.weapon;
    equipWeapon(f, a.id as WeaponId);
    if (old !== f.weapon) {
      const empty = f.inv.findIndex((i) => i.id === old);
      if (empty >= 0) f.inv[empty].n += 1;
      else f.inv.push({ id: old, n: 1 });
    }
  }
}

type FighterLike = Raid['me'];

function invAction(a: NetAction) {
  if (!raid) return;
  if (guest) {
    net?.sendAction(a);
  } else {
    applyAction(raid, raid.me, a);
    if (invUI?.open) invUI.render(raid);
  }
  sfx.play('ui');
}

function finishRaid() {
  if (!raid) return;
  finishing = true;
  const win = raid.over === 'extracted';
  const items = raid.me.inv;
  let gained = 0;
  if (win) {
    const keep = items.filter((i) => ITEMS[i.id]?.kind !== 'valuable');
    for (const i of items) {
      const def = ITEMS[i.id];
      if (def?.kind === 'valuable') gained += def.value * i.n;
    }
    addToStash(save, keep);
    save.coins += gained;
    save.stats.extracts += 1;
  } else {
    save.stats.deaths += 1;
    if (insuredLoadout) {
      addToStash(save, [{ id: insuredLoadout.weapon, n: 1 }]);
      if (insuredLoadout.armor) addToStash(save, [{ id: insuredLoadout.armor, n: 1 }]);
    }
    save.weapon = 'pistol';
    save.armor = null;
  }
  save.stats.kills += raid.me.kills;
  writeSave(save);
  leaveNet();
  const snapshot = raid;
  setTimeout(() => {
    if (!currentScreen) return;
    renderResult(currentScreen, snapshot, save, 0, { onMenu: showMenu, onAgain: () => startRaid() });
  }, 700);
}

function readInput(cam: { x: number; y: number; zoom: number }): PlayerInput {
  if (!raid) return NO_INPUT;
  const me = raid.me;
  let mx = 0, my = 0;
  if (input.touchMode) {
    mx = input.move.dx; my = input.move.dy;
  } else {
    if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) my -= 1;
    if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) my += 1;
    if (input.keys.has('KeyA') || input.keys.has('ArrowLeft')) mx -= 1;
    if (input.keys.has('KeyD') || input.keys.has('ArrowRight')) mx += 1;
  }
  let aim = me.angle;
  let shoot = false;
  if (input.touchMode) {
    const len = Math.hypot(input.aim.dx, input.aim.dy);
    if (len > 0.14) {
      aim = Math.atan2(input.aim.dy, input.aim.dx);
      shoot = len > 0.34;
    } else if (Math.hypot(mx, my) > 0.12) {
      aim = Math.atan2(my, mx);
    }
  } else {
    const px = (me.x - cam.x) * cam.zoom + window.innerWidth / 2;
    const py = (me.y - cam.y) * cam.zoom + window.innerHeight / 2;
    aim = Math.atan2(input.mouse.y - py, input.mouse.x - px);
    shoot = input.down;
  }

  for (let i = 0; i < 4; i++) {
    const codes = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
    if (input.take(codes[i])) {
      const id = (['pistol', 'smg', 'shotgun', 'rifle'] as WeaponId[])[i];
      if (me.weapon === id) continue;
      if (stashCount(save, id) > 0 || me.inv.some((it) => it.id === id)) {
        if (guest) net?.sendAction({ k: 'equip', id });
        else equipWeapon(me, id);
      }
    }
  }
  if (input.take('Digit5')) useItem('medkit');
  if (input.take('Digit6')) useItem('stim');
  if (input.take('Digit7')) useItem('plate');
  if (input.take('KeyB')) useItem('bandage');

  return {
    mx, my, aim, shoot,
    sprint: input.touchMode ? (input.keys.has('ShiftLeft') || input.move.dx * input.move.dx + input.move.dy * input.move.dy > 0.85) : input.keys.has('ShiftLeft') || input.keys.has('ShiftRight'),
    reload: input.take('KeyR'),
    ability: input.take('KeyQ'),
    interact: input.take('KeyE'),
  };
}

function useItem(id: string) {
  if (!raid) return;
  const me = raid.me;
  if (guest) {
    net?.sendAction({ k: 'use', id });
    return;
  }
  if (useItemInRaid(raid, me, id)) { sfx.play('use'); return; }
  if (stashCount(save, id) > 0) {
    const slot = save.stash.find((i) => i.id === id)!;
    slot.n -= 1;
    if (slot.n <= 0) save.stash.splice(save.stash.indexOf(slot), 1);
    if (applyConsumable(raid, me, id)) { writeSave(save); sfx.play('use'); }
  }
}

window.addEventListener('resize', () => {
  if (renderer) renderer.resize(window.innerWidth, window.innerHeight);
});

// ссылка-приглашение ?room=CODE подключает к комнате автоматически
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam && roomParam.replace(/[^A-Za-z0-9]/g, '').length >= 4) {
  history.replaceState(null, '', location.pathname);
  startPvpGuest(roomParam.toUpperCase(), playerName);
} else {
  showMenu();
}

// отладочный доступ для автотестов
(window as unknown as { __raid: () => Raid | null }).__raid = () => raid;
(window as unknown as { __net: () => Net | null }).__net = () => net;
(window as unknown as { __friends: () => FriendsService }).__friends = () => friends;
