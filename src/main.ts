import './styles.css';
import { ITEMS, WEAPONS, type ClassId, type WeaponId } from './data/game-data';
import { Input } from './core/input';
import { clamp } from './core/math';
import { Renderer } from './render/render';
import { Hud } from './ui/hud';
import { renderMenu, renderLobby, renderResult, type MenuActions } from './ui/menus';
import { addToStash, buy, defaultSave, equip, loadSave, sellValuables, stashCount, writeSave, type SaveData } from './save';
import { applySnapshot, createRaid, fighterIdForSeat, makeFighter, snapshotRaid, type Raid, type Snapshot } from './game/state';
import { NO_INPUT, equipWeapon, updateRaid, type PlayerInput } from './game/sim';
import { createGuestNet, createHostNet, type LobbyPlayer, type Net } from './net/net';

const app = document.getElementById('app')!;
const NAME_KEY = 'chessshooter.name';

let save: SaveData = loadSave();
let playerName = localStorage.getItem(NAME_KEY) || 'Игрок';
let raid: Raid | null = null;
let renderer: Renderer | null = null;
let hud: Hud | null = null;
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
let guest = false;
let pendingSnap: Snapshot | null = null;
let netAcc = 0;

function clearScreen() {
  cancelAnimationFrame(raf);
  raf = 0;
  input.detach();
  hud?.destroy();
  hud = null;
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
}

function showMenu() {
  leaveNet();
  clearScreen();
  const el = document.createElement('div');
  el.className = 'screen';
  app.appendChild(el);
  currentScreen = el;
  const actions: MenuActions = {
    onClass: (id: ClassId) => { save.classId = id; writeSave(save); showMenu(); },
    onEquip: (id: string) => { equip(save, id); writeSave(save); showMenu(); },
    onBuy: (id: string) => { buy(save, id); writeSave(save); showMenu(); },
    onSell: () => { const g = sellValuables(save); writeSave(save); if (g > 0) alert(`Продано на ${g} ₡`); showMenu(); },
    onStart: () => startRaid(),
    onCreate: () => startPvpHost(),
    onJoin: (code: string, name: string) => startPvpGuest(code, name),
    onReset: () => { save = defaultSave(); writeSave(save); showMenu(); },
  };
  renderMenu(el, save, playerName, actions);
  const nameInput = el.querySelector<HTMLInputElement>('#player-name');
  if (nameInput) {
    nameInput.addEventListener('input', () => {
      playerName = nameInput.value.trim() || 'Игрок';
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
    net.startGame(seed);
    startRaid({ seed, seat: 0, players });
  }, () => showMenu(), lobbyStatus);
}

function startPvpHost() {
  leaveNet();
  guest = false;
  lobbyCode = '';
  lobbyPlayers = [];
  net = createHostNet(playerName, save.classId, {
    onCode: (c) => { lobbyCode = c; if (lobbyEl) showLobby(true, lobbyStatus); else showLobby(true, 'Ждём игроков…'); },
    onLobby: (p) => { lobbyPlayers = p; showLobby(true, lobbyStatus); },
    onStart: () => { /* стартует хост */ },
    onSnapshot: () => { /* хост не принимает снимки */ },
    onStatus: (t) => showLobby(true, t),
    onError: (t) => showLobby(true, t),
  });
}

function startPvpGuest(code: string, name: string) {
  leaveNet();
  guest = true;
  lobbyCode = code.toUpperCase().slice(0, 5);
  lobbyPlayers = [];
  net = createGuestNet(code, name || playerName, save.classId, {
    onCode: () => {},
    onLobby: (p) => { lobbyPlayers = p; showLobby(false, lobbyStatus); },
    onStart: (seed, seat, players) => startRaid({ seed, seat, players }),
    onSnapshot: (s) => { pendingSnap = s; },
    onStatus: (t) => showLobby(false, t),
    onError: (t) => { showLobby(false, t); },
  });
  showLobby(false, 'Подключаемся к комнате…');
}

function startRaid(pvp?: { seed: number; seat: number; players: LobbyPlayer[] }) {
  clearScreen();
  const seed = pvp ? pvp.seed : (Math.random() * 1e9) | 0;
  const mySeat = pvp?.seat ?? 0;
  raid = createRaid({
    seed,
    classId: save.classId,
    weapon: save.weapon,
    armor: save.armor,
    name: playerName,
    mode: pvp ? 'pvp' : 'solo',
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
  input.attach(canvas);
  netAcc = 0;

  lastT = performance.now();
  const loop = (t: number) => {
    raf = requestAnimationFrame(loop);
    if (!raid || !renderer || !hud) return;
    const dt = clamp((t - lastT) / 1000, 0.001, 0.05);
    lastT = t;
    const cam = renderer.camera(raid);
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
      }
      input.clearEdges();
      renderer.draw(raid, cam, dt);
      hud.update(raid, renderer, input.touchMode);
    } else if (raid.over && !finishing) {
      finishRaid();
    } else {
      renderer.draw(raid, cam, dt);
      hud.update(raid, renderer, input.touchMode);
    }
  };
  raf = requestAnimationFrame(loop);
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
    save.weapon = 'pistol';
    save.armor = null;
  }
  save.stats.kills += raid.me.kills;
  writeSave(save);
  leaveNet();
  const lostValue = 0;
  const snapshot = raid;
  setTimeout(() => {
    if (!currentScreen) return;
    renderResult(currentScreen, snapshot, save, lostValue, { onMenu: showMenu, onAgain: () => startRaid() });
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

  // оружие и расходники
  for (let i = 0; i < 4; i++) {
    const codes = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
    if (input.take(codes[i])) {
      const id = (['pistol', 'smg', 'shotgun', 'rifle'] as WeaponId[])[i];
      if (me.weapon === id) continue;
      if (stashCount(save, id) > 0 || me.inv.some((it) => it.id === id)) equipWeapon(me, id);
    }
  }
  if (input.take('Digit5')) useItem('medkit');
  if (input.take('Digit6')) useItem('stim');
  if (input.take('Digit7')) useItem('plate');

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
  const idx = me.inv.findIndex((i) => i.id === id);
  if (idx < 0 && stashCount(save, id) === 0) return;
  const fromStash = idx < 0;
  if (!fromStash) {
    const it = me.inv[idx];
    it.n -= 1;
    if (it.n <= 0) me.inv.splice(idx, 1);
  } else {
    const slot = save.stash.find((i) => i.id === id)!;
    slot.n -= 1;
    if (slot.n <= 0) save.stash.splice(save.stash.indexOf(slot), 1);
    writeSave(save);
  }
  if (id === 'medkit') me.hp = Math.min(me.maxHp, me.hp + 45);
  if (id === 'stim') me.sta = Math.min(me.maxSta, me.sta + 60);
  if (id === 'plate' && me.armor) me.armorDur = Math.min(100, me.armorDur + 40);
  raid.log.unshift(`Использовано: ${ITEMS[id]?.name ?? id}`);
}

window.addEventListener('resize', () => {
  if (renderer) renderer.resize(window.innerWidth, window.innerHeight);
});

showMenu();

// отладочный доступ для автотестов
(window as unknown as { __raid: () => Raid | null }).__raid = () => raid;
(window as unknown as { __net: () => Net | null }).__net = () => net;
