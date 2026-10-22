import { ITEMS, WEAPONS } from '../data/game-data';
import type { Raid } from '../game/state';
import { escapeHtml } from './hud';

export interface InvHandlers {
  use: (id: string) => void;
  drop: (index: number) => void;
  equip: (id: string) => void;
  close: () => void;
}

const USABLE = new Set(['medkit', 'bandage', 'stim', 'plate']);

export class InventoryUI {
  root: HTMLElement;
  open = false;
  private handlers: InvHandlers | null = null;
  private lastSig = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'inv-overlay';
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.handlers?.close();
    });
    parent.appendChild(this.root);
  }

  show(r: Raid, handlers: InvHandlers) {
    this.handlers = handlers;
    this.open = true;
    this.lastSig = '';
    this.root.classList.add('on');
    this.render(r);
  }

  hide() {
    this.open = false;
    this.root.classList.remove('on');
  }

  toggle(r: Raid, handlers: InvHandlers) {
    if (this.open) this.hide();
    else this.show(r, handlers);
  }

  render(r: Raid) {
    if (!this.open) return;
    const me = r.me;
    const sig = me.inv.map((i) => i.id + ':' + i.n).join(',') + '|' + me.weapon + '|' + me.armor + '|' + Math.ceil(me.armorDur) + '|' + me.bleed;
    if (this.lastSig === sig) return;
    this.lastSig = sig;
    const slots: string[] = [];
    for (let i = 0; i < 20; i++) {
      const it = me.inv[i];
      if (!it) {
        slots.push('<div class="inv-cell empty"></div>');
        continue;
      }
      const def = ITEMS[it.id];
      const usable = USABLE.has(it.id);
      const weapon = def?.kind === 'weapon';
      const key = def?.kind === 'key';
      slots.push(`<div class="inv-cell${key ? ' key' : ''}">
        <span class="ic">${key ? '🗝' : weapon ? '🔫' : def?.kind === 'armor' ? '🛡' : def?.kind === 'valuable' ? '◆' : '✚'}</span>
        <b>${escapeHtml(def?.name ?? it.id)}</b>
        <small>${it.n > 1 ? '×' + it.n : escapeHtml(def?.desc ?? '')}</small>
        <div class="cell-actions">
          ${usable ? `<button data-use="${it.id}">Исп.</button>` : ''}
          ${weapon ? `<button data-equip="${it.id}">В руки</button>` : ''}
          <button data-drop="${i}" class="ghost">Выбр.</button>
        </div>
      </div>`);
    }
    this.root.innerHTML = `
      <div class="inv-panel">
        <header>
          <h2>Рюкзак <small>${me.inv.length} / 20</small></h2>
          <button class="inv-close" data-close="1">Закрыть</button>
        </header>
        <div class="inv-equip">
          <div><span>В руках</span><b>${escapeHtml(WEAPONS[me.weapon].name)}</b></div>
          <div><span>Броня</span><b>${me.armor ? escapeHtml(ITEMS[me.armor]?.name ?? me.armor) + ' · ' + Math.ceil(me.armorDur) : 'нет'}</b></div>
          <div><span>Состояние</span><b class="${me.bleed > 0 ? 'bleeding' : ''}">${me.bleed > 0 ? `кровотечение ×${me.bleed}` : 'стабильно'}</b></div>
        </div>
        <div class="inv-grid">${slots.join('')}</div>
        <p class="muted small">Клик по предмету: использовать, взять в руки или выбросить. Выброшенное остаётся на земле.</p>
      </div>`;

    this.root.querySelectorAll<HTMLElement>('[data-use]').forEach((b) =>
      b.addEventListener('click', () => { this.handlers?.use(b.dataset.use!); }));
    this.root.querySelectorAll<HTMLElement>('[data-drop]').forEach((b) =>
      b.addEventListener('click', () => { this.handlers?.drop(Number(b.dataset.drop)); }));
    this.root.querySelectorAll<HTMLElement>('[data-equip]').forEach((b) =>
      b.addEventListener('click', () => { this.handlers?.equip(b.dataset.equip!); }));
    this.root.querySelector<HTMLElement>('[data-close]')?.addEventListener('click', () => this.handlers?.close());
  }

  destroy() { this.root.remove(); }
}
