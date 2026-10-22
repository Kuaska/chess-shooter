import { CLASSES, ITEMS, WEAPONS, type ClassId } from '../data/game-data';
import { SHOP, stashCount, type SaveData } from '../save';
import type { Raid } from '../game/state';
import { raidLootValue } from '../game/state';
import { escapeHtml } from './hud';

export interface MenuActions {
  onClass: (id: ClassId) => void;
  onEquip: (id: string) => void;
  onBuy: (id: string) => void;
  onSell: () => void;
  onStart: () => void;
  onCreate: () => void;
  onJoin: (code: string, name: string) => void;
  onReset: () => void;
}

export function renderMenu(root: HTMLElement, save: SaveData, name: string, actions: MenuActions) {
  const cls = CLASSES[save.classId];
  const stashRows = groupStash(save);
  const weapons = Object.values(WEAPONS);
  const shopRows = SHOP.map((s) => {
    const def = ITEMS[s.id];
    const afford = save.coins >= s.price;
    return `<button class="shop-row" data-buy="${s.id}" ${afford ? '' : 'disabled'}>
      <span>${def.name}</span><em>${s.price}₡</em></button>`;
  }).join('');
  root.innerHTML = `
  <div class="menu">
    <header class="menu-head">
      <div>
        <div class="logo">CHESS<span>SHOOTER</span></div>
        <p class="tagline">Извлекательный шутер сверху вниз. Выбери фигуру, собери снаряжение, войди в рейд и вынеси лут.</p>
      </div>
      <div class="wallet"><span>Баланс</span><b>${save.coins} ₡</b></div>
    </header>

    <section class="panel classes">
      <h2>Фигура</h2>
      <div class="class-grid">
        ${Object.values(CLASSES).map((c) => `
          <button class="class-card ${c.id === save.classId ? 'active' : ''}" data-class="${c.id}" style="--c:${c.color}">
            <span class="glyph">${c.glyph}</span>
            <b>${c.name}</b>
            <small>${c.hp} HP · ${c.stamina} ST</small>
            <small class="trait">${escapeHtml(c.trait)}</small>
          </button>`).join('')}
      </div>
      <div class="class-detail" style="--c:${cls.color}">
        <div><b>${cls.ability.name}</b> — ${cls.ability.desc}</div>
        <div class="muted">Перезарядка ${cls.ability.cd} с · скорость ${cls.speed} · реген ${cls.regen}/с</div>
      </div>
    </section>

    <section class="panel loadout">
      <h2>Снаряжение</h2>
      <div class="equipped">
        <div class="equip-slot"><span>Оружие</span><b>${WEAPONS[save.weapon].name}</b><small>${WEAPONS[save.weapon].dmg} урон · ${WEAPONS[save.weapon].mag} патр.</small></div>
        <div class="equip-slot"><span>Броня</span><b>${save.armor ? ITEMS[save.armor].name : 'нет'}</b><small>${save.armor ? ITEMS[save.armor].desc : 'купи броню в магазине'}</small></div>
      </div>
      <div class="inv-list">
        ${stashRows.length ? stashRows.map((r) => `
          <div class="inv-row">
            <span>${ITEMS[r.id]?.name ?? r.id} ${r.n > 1 ? '×' + r.n : ''}</span>
            <div>
              ${(ITEMS[r.id]?.kind === 'weapon' || ITEMS[r.id]?.kind === 'armor') ? `<button data-equip="${r.id}">надеть</button>` : ''}
            </div>
          </div>`).join('') : '<div class="muted">Стэш пуст</div>'}
      </div>
      <div class="inv-actions">
        <button data-sell="1">Продать ценности</button>
        <button data-reset="1" class="ghost">Сброс прогресса</button>
      </div>
    </section>

    <section class="panel shop">
      <h2>Магазин</h2>
      <div class="shop-grid">${shopRows}</div>
    </section>

    <section class="panel deploy">
      <h2>В бой</h2>
      <div class="online-row">
        <label>Имя<input id="player-name" maxlength="14" value="${escapeHtml(name)}" /></label>
      </div>
      <div class="deploy-actions">
        <button class="primary big" data-start="1">В рейд (с ботами)</button>
        <button data-create="1">Создать PvP-комнату</button>
      </div>
      <div class="join-row">
        <input id="room-code" placeholder="КОД КОМНАТЫ" maxlength="6" />
        <button data-join="1">Присоединиться</button>
      </div>
      <p class="muted small">PvP — до 4 игроков, свободные слоты занимают боты. Хост создаёт мир, гости подключаются напрямую.</p>
    </section>

    <footer class="menu-foot">
      <div><b>WASD</b> движение · <b>Shift</b> спринт · <b>ЛКМ</b> огонь · <b>R</b> перезарядка · <b>Q</b> навык · <b>E</b> обыскать · <b>1–4</b> оружие · <b>5</b> аптечка · <b>6</b> стимулятор</div>
      <div class="stats">Рейдов: ${save.stats.raids} · Эвакуаций: ${save.stats.extracts} · Смертей: ${save.stats.deaths} · Убийств: ${save.stats.kills}</div>
      <div class="muted small">Смерть = потеря оружия и брони. Лут из рейда попадает в стэш только после эвакуации.</div>
    </footer>
  </div>`;

  root.querySelectorAll<HTMLElement>('[data-class]').forEach((b) => b.addEventListener('click', () => actions.onClass(b.dataset.class as ClassId)));
  root.querySelectorAll<HTMLElement>('[data-equip]').forEach((b) => b.addEventListener('click', () => actions.onEquip(b.dataset.equip!)));
  root.querySelectorAll<HTMLElement>('[data-buy]').forEach((b) => b.addEventListener('click', () => actions.onBuy(b.dataset.buy!)));
  root.querySelector<HTMLElement>('[data-sell]')?.addEventListener('click', actions.onSell);
  root.querySelector<HTMLElement>('[data-start]')?.addEventListener('click', () => actions.onStart());
  root.querySelector<HTMLElement>('[data-create]')?.addEventListener('click', () => actions.onCreate());
  root.querySelector<HTMLElement>('[data-join]')?.addEventListener('click', () => {
    const code = (root.querySelector<HTMLInputElement>('#room-code')?.value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const n = (root.querySelector<HTMLInputElement>('#player-name')?.value ?? name).trim();
    actions.onJoin(code, n);
  });
  root.querySelector<HTMLElement>('[data-reset]')?.addEventListener('click', () => {
    if (confirm('Сбросить весь прогресс?')) actions.onReset();
  });
  const nameInput = root.querySelector<HTMLInputElement>('#player-name');
  nameInput?.addEventListener('change', () => { name = nameInput.value.trim().slice(0, 14) || 'Игрок'; });
  void weapons;
}

function groupStash(save: SaveData) {
  const map = new Map<string, number>();
  for (const it of save.stash) map.set(it.id, (map.get(it.id) ?? 0) + it.n);
  return [...map.entries()].map(([id, n]) => ({ id, n })).filter((r) => ITEMS[r.id]);
}

export function renderResult(root: HTMLElement, raid: Raid, save: SaveData, extractedValue: number, actions: { onMenu: () => void; onAgain: () => void }) {
  const win = raid.over === 'extracted';
  const items = raid.me.inv;
  const value = raidLootValue(items);
  root.innerHTML = `
    <div class="result ${win ? 'win' : 'lose'}">
      <div class="result-card">
        <div class="result-mark">${win ? '▲' : '✕'}</div>
        <h1>${win ? 'Эвакуация' : 'Рейд провален'}</h1>
        <p>${win ? 'Ты вынес добычу. Ценности проданы, снаряжение в стэше.' : 'Фигура пала. Оружие и броня потеряны, но стэш цел.'}</p>
        <div class="result-stats">
          <div><span>Убийств</span><b>${raid.me.kills}</b></div>
          <div><span>Стоимость лута</span><b>${value} ₡</b></div>
          <div><span>Баланс</span><b>${save.coins} ₡</b></div>
        </div>
        ${win && items.length ? `<div class="result-loot">${items.map((i) => `<span>${ITEMS[i.id]?.name ?? i.id}${i.n > 1 ? ' ×' + i.n : ''}</span>`).join('')}</div>` : ''}
        ${!win && extractedValue > 0 ? `<div class="muted small">Потеряно снаряжения на ${extractedValue} ₡</div>` : ''}
        <div class="result-actions">
          <button class="primary" data-again="1">Ещё рейд</button>
          <button data-menu="1">В меню</button>
        </div>
      </div>
    </div>`;
  root.querySelector<HTMLElement>('[data-menu]')?.addEventListener('click', actions.onMenu);
  root.querySelector<HTMLElement>('[data-again]')?.addEventListener('click', actions.onAgain);
}

export function renderLobby(root: HTMLElement, code: string, players: Array<{ name: string; seat: number }>, isHost: boolean, onStart: () => void, onLeave: () => void, status: string) {
  const seats = ['Хост', 'Игрок 2', 'Игрок 3', 'Игрок 4'];
  root.innerHTML = `
    <div class="lobby">
      <h1>Комната <b>${code}</b></h1>
      <p class="muted">Отправь друзьям код или ссылку. Когда все зайдут — старт.</p>
      <div class="lobby-code">${code}</div>
      <div class="lobby-list">
        ${[0, 1, 2, 3].map((s) => {
          const p = players.find((x) => x.seat === s);
          return `<div class="lobby-slot ${p ? 'filled' : ''}"><span>${seats[s]}</span><b>${p ? escapeHtml(p.name) : 'свободно'}</b></div>`;
        }).join('')}
      </div>
      <p class="status">${escapeHtml(status)}</p>
      <div class="lobby-actions">
        ${isHost ? '<button class="primary" data-start="1">Начать рейд</button>' : '<span class="muted">Ждём хоста…</span>'}
        <button data-leave="1">Выйти</button>
      </div>
    </div>`;
  root.querySelector<HTMLElement>('[data-start]')?.addEventListener('click', onStart);
  root.querySelector<HTMLElement>('[data-leave]')?.addEventListener('click', onLeave);
}

export function stashSummary(save: SaveData) {
  return Object.keys(ITEMS).filter((id) => stashCount(save, id) > 0).length;
}
