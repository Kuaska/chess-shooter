export interface Stick { active: boolean; dx: number; dy: number; id: number; ox: number; oy: number }

export class Input {
  keys = new Set<string>();
  private pressed = new Set<string>();
  mouse = { x: 0, y: 0 };
  down = false;
  touchMode = false;
  move: Stick = { active: false, dx: 0, dy: 0, id: -1, ox: 0, oy: 0 };
  aim: Stick = { active: false, dx: 0, dy: 0, id: -1, ox: 0, oy: 0 };
  private el: HTMLElement | null = null;
  private handlers: Array<[string, EventListener]> = [];

  attach(el: HTMLElement) {
    this.el = el;
    const add = (t: string, fn: EventListener) => { el.addEventListener(t, fn, { passive: false }); this.handlers.push([t, fn]); };
    const addWin = (t: string, fn: EventListener) => { window.addEventListener(t, fn); this.handlers.push(['win:' + t, fn]); };
    addWin('keydown', ((e: KeyboardEvent) => {
      if (['Tab', 'Space', 'KeyQ', 'KeyR', 'KeyE', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    }) as EventListener);
    addWin('keyup', ((e: KeyboardEvent) => { this.keys.delete(e.code); }) as EventListener);
    addWin('blur', (() => { this.keys.clear(); this.down = false; }) as EventListener);
    const pos = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    add('pointerdown', ((e: PointerEvent) => {
      const p = pos(e);
      if (e.pointerType === 'touch') {
        this.touchMode = true;
        if (p.x < el.clientWidth * 0.5) {
          if (!this.move.active) this.move = { active: true, dx: 0, dy: 0, id: e.pointerId, ox: p.x, oy: p.y };
        } else if (!this.aim.active) {
          this.aim = { active: true, dx: 0, dy: 0, id: e.pointerId, ox: p.x, oy: p.y };
        }
        el.setPointerCapture(e.pointerId);
      } else {
        this.mouse = p;
        this.down = true;
      }
      e.preventDefault();
    }) as EventListener);
    add('pointermove', ((e: PointerEvent) => {
      const p = pos(e);
      if (e.pointerType === 'touch') {
        if (this.move.active && this.move.id === e.pointerId) {
          const dx = p.x - this.move.ox, dy = p.y - this.move.oy;
          const len = Math.hypot(dx, dy), max = 56;
          const k = len > max ? max / len : 1;
          this.move.dx = (dx * k) / max;
          this.move.dy = (dy * k) / max;
        } else if (this.aim.active && this.aim.id === e.pointerId) {
          const dx = p.x - this.aim.ox, dy = p.y - this.aim.oy;
          const len = Math.hypot(dx, dy), max = 56;
          const k = len > max ? max / len : 1;
          this.aim.dx = (dx * k) / max;
          this.aim.dy = (dy * k) / max;
        }
      } else {
        this.mouse = p;
      }
    }) as EventListener);
    const up = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        if (this.move.active && this.move.id === e.pointerId) this.move = { active: false, dx: 0, dy: 0, id: -1, ox: 0, oy: 0 };
        if (this.aim.active && this.aim.id === e.pointerId) this.aim = { active: false, dx: 0, dy: 0, id: -1, ox: 0, oy: 0 };
      } else this.down = false;
    };
    add('pointerup', up as EventListener);
    add('pointercancel', up as EventListener);
    add('contextmenu', ((e: Event) => e.preventDefault()) as EventListener);
  }

  detach() {
    if (!this.el) return;
    for (const [t, fn] of this.handlers) {
      if (t.startsWith('win:')) window.removeEventListener(t.slice(4), fn);
      else this.el.removeEventListener(t, fn);
    }
    this.handlers = [];
    this.el = null;
  }

  down_(code: string) { return this.keys.has(code); }
  take(code: string) { const has = this.pressed.has(code); this.pressed.delete(code); return has; }
  tap(code: string) { this.pressed.add(code); }
  clearEdges() { this.pressed.clear(); }
}
