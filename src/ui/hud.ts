import { CLASSES, ITEMS, WEAPONS } from '../data/game-data';
import { clamp, dist } from '../core/math';
import type { Input } from '../core/input';
import type { Raid } from '../game/state';
import type { Renderer } from '../render/render';

const fmt = (t: number) => {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class Hud {
  root: HTMLElement;
  private hp: HTMLElement;
  private hpText: HTMLElement;
  private sta: HTMLElement;
  private armor: HTMLElement;
  private bleedEl: HTMLElement;
  private timer: HTMLElement;
  private kills: HTMLElement;
  private wname: HTMLElement;
  private ammo: HTMLElement;
  private reloadBar: HTMLElement;
  private ability: HTMLElement;
  private abilityCd: HTMLElement;
  private feed: HTMLElement;
  private prompt: HTMLElement;
  private hurt: HTMLElement;
  private stickL: HTMLElement;
  private stickLDot: HTMLElement;
  private stickR: HTMLElement;
  private stickRDot: HTMLElement;
  private mobile: HTMLElement;
  minimap: HTMLCanvasElement;
  private input: Input;

  constructor(parent: HTMLElement, input: Input) {
    this.input = input;
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="vitals">
          <div class="bar-row"><span class="bar-label">HP</span><div class="bar hp"><i></i></div><b class="hp-num">100</b></div>
          <div class="bar-row"><span class="bar-label">ST</span><div class="bar sta"><i></i></div><span class="armor-tag">броня 0</span><span class="bleed-tag"></span></div>
        </div>
        <div class="raid-clock"><b class="clock">10:00</b><span class="kills">0 убийств</span></div>
      </div>
      <div class="hud-feed"></div>
      <div class="hud-prompt"></div>
      <div class="hud-bottom">
        <div class="gear">
          <div class="weapon"><span class="wname">Пистолет</span><b class="ammo">12 / 48</b><div class="reload"><i></i></div></div>
          <div class="ability-card"><span class="aname">Рывок</span><span class="acd">готов</span></div>
        </div>
        <canvas class="minimap" width="150" height="150"></canvas>
      </div>
      <div class="mobile-controls">
        <div class="stick stick-l"><i></i></div>
        <div class="stick stick-r"><i></i></div>
        <div class="mbtns">
          <button data-k="KeyQ">Навык</button>
          <button data-k="KeyR">Заряд</button>
          <button data-k="KeyE">Взять</button>
          <button data-k="Tab">Рюкзак</button>
        </div>
      </div>
      <div class="hurt"></div>
    `;
    parent.appendChild(this.root);
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.hp = q('.bar.hp i');
    this.hpText = q('.hp-num');
    this.sta = q('.bar.sta i');
    this.armor = q('.armor-tag');
    this.bleedEl = q('.bleed-tag');
    this.timer = q('.clock');
    this.kills = q('.kills');
    this.wname = q('.wname');
    this.ammo = q('.ammo');
    this.reloadBar = q('.reload i');
    this.ability = q('.acd');
    this.abilityCd = q('.aname');
    this.feed = q('.hud-feed');
    this.prompt = q('.hud-prompt');
    this.hurt = q('.hurt');
    this.stickL = q('.stick-l');
    this.stickLDot = q('.stick-l i');
    this.stickR = q('.stick-r');
    this.stickRDot = q('.stick-r i');
    this.mobile = q('.mobile-controls');
    this.minimap = q('.minimap');
    this.root.querySelectorAll<HTMLButtonElement>('.mbtns button').forEach((b) => {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.input.tap(b.dataset.k!); });
    });
  }

  destroy() { this.root.remove(); }

  update(r: Raid, renderer: Renderer, touch: boolean) {
    const me = r.me;
    const cls = CLASSES[me.classId];
    const hpRatio = clamp(me.hp / me.maxHp, 0, 1);
    this.hp.style.width = `${hpRatio * 100}%`;
    this.hp.style.background = hpRatio > 0.55 ? '#65d98a' : hpRatio > 0.28 ? '#ffd166' : '#ff6b5e';
    this.hpText.textContent = String(Math.ceil(me.hp));
    this.sta.style.width = `${clamp(me.sta / me.maxSta, 0, 1) * 100}%`;
    this.armor.textContent = me.armor ? `броня ${Math.ceil(me.armorDur)}` : 'без брони';
    this.bleedEl.textContent = me.bleed > 0 ? `кровь ×${me.bleed}` : '';
    this.bleedEl.style.display = me.bleed > 0 ? '' : 'none';
    this.timer.textContent = fmt(600 - r.time);
    this.kills.textContent = `${me.kills} убийств`;
    const w = WEAPONS[me.weapon];
    this.wname.textContent = w.name;
    this.ammo.textContent = `${me.mag} / ${me.reserve[w.ammo] ?? 0}`;
    this.reloadBar.style.width = me.reloadT > 0 ? `${(1 - me.reloadT / w.reload) * 100}%` : '0%';
    this.abilityCd.textContent = cls.ability.name;
    this.ability.textContent = me.abilityT > 0 ? `${me.abilityT.toFixed(1)} с` : 'готов';
    this.ability.style.color = me.abilityT > 0 ? '#8d97a6' : '#69f0c0';
    this.feed.innerHTML = r.log.slice(0, 3).map((l, i) => `<div style="opacity:${1 - i * 0.28}">${escapeHtml(l)}</div>`).join('');
    this.hurt.style.opacity = String(clamp(r.hurt * 1.2, 0, 0.85));

    let pr = '';
    const door = r.map.doors.find((d) => !d.open && dist((d.c + 0.5) * 32, (d.r + 0.5) * 32, me.x, me.y) < 92);
    if (door) {
      pr = me.inv.some((i) => i.id === door.key)
        ? `<b>E</b> — открыть ${door.label.toLowerCase()}`
        : `Заперто. Нужен ${ITEMS[door.key]?.name ?? 'ключ'}`;
      this.prompt.innerHTML = pr;
      this.prompt.style.opacity = '1';
      this.mobile.classList.toggle('on', touch);
      this.sticks(touch);
      renderer.drawMinimap(this.minimap, r);
      return;
    }
    let nearLoot = false;
    for (const b of r.loot) {
      if (!b.opened && dist(b.x, b.y, me.x, me.y) < 62) { nearLoot = true; break; }
    }
    if (nearLoot) pr = '<b>E</b> — обыскать';
    else {
      const idx = [0, 1, 2].find((i) => {
        const s = [{ x: 64 * 32 + 16, y: 4 * 32 + 16 }, { x: 4 * 32 + 16, y: 64 * 32 + 16 }, { x: 64 * 32 + 16, y: 123 * 32 + 16 }][i];
        return r.extractOpen[i] && dist(me.x, me.y, s.x, s.y) < 92;
      });
      if (idx !== undefined) pr = `Эвакуация: ${(me.extractT / 4 * 100).toFixed(0)}%`;
    }
    this.prompt.innerHTML = pr;
    this.prompt.style.opacity = pr ? '1' : '0';

    this.mobile.classList.toggle('on', touch);
    this.sticks(touch);
    renderer.drawMinimap(this.minimap, r);
  }

  private sticks(touch: boolean) {
    const m = this.input.move, a = this.input.aim;
    this.stickL.classList.toggle('on', touch && m.active);
    this.stickR.classList.toggle('on', touch && a.active);
    this.stickL.style.left = `${m.ox - 52}px`;
    this.stickL.style.top = `${m.oy - 52}px`;
    this.stickLDot.style.transform = `translate(${m.dx * 40}px, ${m.dy * 40}px)`;
    this.stickR.style.left = `${a.ox - 52}px`;
    this.stickR.style.top = `${a.oy - 52}px`;
    this.stickRDot.style.transform = `translate(${a.dx * 40}px, ${a.dy * 40}px)`;
  }
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
