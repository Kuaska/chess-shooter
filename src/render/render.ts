import { CLASSES, WEAPONS } from '../data/game-data';
import { clamp, dist } from '../core/math';
import { extractSpots, type Fighter, type Raid } from '../game/state';
import { MAP_SIZE, T_CRATE, T_DOOR, T_PALACE, T_ROAD, TILE, T_TREE, T_WALL, losClear, tileAt } from '../world/map';

export interface Camera { x: number; y: number; zoom: number; }

const VISION_R = 600;
const RAYS = 220;

function biomeTint(c: number, r: number): string {
  const palace = c > 50 && c < 78 && r > 50 && r < 78;
  if (palace) return '#231d14';
  if (c < 64 && r < 64) return '#181e26';
  if (c >= 64 && r < 64) return '#131f19';
  if (c < 64 && r >= 64) return '#1d1a17';
  return '#1a1c21';
}

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  fog: HTMLCanvasElement;
  fctx: CanvasRenderingContext2D;
  explore: HTMLCanvasElement;
  ectx: CanvasRenderingContext2D;
  minimap: HTMLCanvasElement | null = null;
  exploreTimer = 0;
  dpr = 1;
  w = 0;
  h = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.fog = document.createElement('canvas');
    this.fctx = this.fog.getContext('2d')!;
    this.explore = document.createElement('canvas');
    this.explore.width = MAP_SIZE;
    this.explore.height = MAP_SIZE;
    this.ectx = this.explore.getContext('2d')!;
    this.ectx.fillStyle = '#000';
    this.ectx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    this.ectx.globalCompositeOperation = 'lighter';
  }

  resize(w: number, h: number) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w; this.h = h;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.fog.width = Math.floor(w * 0.6);
    this.fog.height = Math.floor(h * 0.6);
  }

  resetExplored() {
    this.ectx.globalCompositeOperation = 'source-over';
    this.ectx.fillStyle = '#000';
    this.ectx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    this.ectx.globalCompositeOperation = 'lighter';
  }

  camera(r: Raid): Camera {
    const base = Math.max(0.62, Math.min(1.45, this.h / 740));
    const zoom = base;
    return { x: r.me.x, y: r.me.y, zoom };
  }

  private updateExplored(r: Raid, dt: number) {
    this.exploreTimer -= dt;
    if (this.exploreTimer > 0) return;
    this.exploreTimer = 0.18;
    const px = r.me.x / TILE, py = r.me.y / TILE;
    const rad = VISION_R / TILE;
    const c0 = Math.max(0, Math.floor(px - rad)), c1 = Math.min(MAP_SIZE - 1, Math.ceil(px + rad));
    const r0 = Math.max(0, Math.floor(py - rad)), r1 = Math.min(MAP_SIZE - 1, Math.ceil(py + rad));
    const img = this.ectx.getImageData(c0, r0, c1 - c0 + 1, r1 - r0 + 1);
    const d = img.data;
    for (let y = r0; y <= r1; y++) {
      for (let x = c0; x <= c1; x++) {
        const cx = x * TILE + 16, cy = y * TILE + 16;
        if (dist(cx, cy, r.me.x, r.me.y) > VISION_R) continue;
        if (!losClear(r.map, r.me.x, r.me.y, cx, cy)) continue;
        const i = ((y - r0) * (c1 - c0 + 1) + (x - c0)) * 4;
        d[i] = 74; d[i + 1] = 104; d[i + 2] = 128;
        d[i + 3] = 255;
      }
    }
    this.ectx.putImageData(img, c0, r0);
  }

  draw(r: Raid, cam: Camera, dt: number) {
    const ctx = this.ctx;
    const { w, h, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#07090d';
    ctx.fillRect(0, 0, w, h);

    this.updateExplored(r, dt);

    const z = cam.zoom;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(z, z);
    ctx.translate(-cam.x, -cam.y);

    const vw = w / z, vh = h / z;
    const c0 = Math.max(0, Math.floor((cam.x - vw / 2) / TILE) - 1);
    const c1 = Math.min(MAP_SIZE - 1, Math.ceil((cam.x + vw / 2) / TILE) + 1);
    const r0 = Math.max(0, Math.floor((cam.y - vh / 2) / TILE) - 1);
    const r1 = Math.min(MAP_SIZE - 1, Math.ceil((cam.y + vh / 2) / TILE) + 1);

    // пол
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        const t = tileAt(r.map, cc * TILE + 16, rr * TILE + 16);
        if (t === T_WALL || t === T_TREE) continue;
        const checker = (cc + rr) % 2 === 0;
        const tint = t === T_PALACE ? '#2a2216' : t === T_ROAD ? '#26261f' : biomeTint(cc, rr);
        ctx.fillStyle = tint;
        ctx.fillRect(cc * TILE, rr * TILE, TILE, TILE);
        if (checker) {
          ctx.fillStyle = 'rgba(255,255,255,0.012)';
          ctx.fillRect(cc * TILE, rr * TILE, TILE, TILE);
        }
        const hsh = ((cc * 73856093) ^ (rr * 19349663)) >>> 0;
        if (t !== T_ROAD && hsh % 9 === 0) {
          ctx.fillStyle = 'rgba(120,150,110,0.09)';
          const ox = 4 + (hsh % 22), oy = 4 + ((hsh >> 5) % 22);
          ctx.fillRect(cc * TILE + ox, rr * TILE + oy, 2, 5);
          ctx.fillRect(cc * TILE + ox - 2, rr * TILE + oy + 2, 2, 3);
        } else if (hsh % 13 === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.035)';
          ctx.beginPath();
          ctx.arc(cc * TILE + 6 + (hsh % 20), rr * TILE + 6 + ((hsh >> 7) % 20), 1.6, 0, 6.29);
          ctx.fill();
        }
        if (t === T_CRATE) {
          ctx.fillStyle = '#3b3025';
          ctx.fillRect(cc * TILE + 3, rr * TILE + 3, TILE - 6, TILE - 6);
          ctx.strokeStyle = '#55442f';
          ctx.lineWidth = 2;
          ctx.strokeRect(cc * TILE + 4, rr * TILE + 4, TILE - 8, TILE - 8);
          ctx.beginPath();
          ctx.moveTo(cc * TILE + 5, rr * TILE + 5);
          ctx.lineTo(cc * TILE + TILE - 5, rr * TILE + TILE - 5);
          ctx.stroke();
        }
      }
    }

    // стены и деревья
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        const t = tileAt(r.map, cc * TILE + 16, rr * TILE + 16);
        if (t === T_WALL) {
          ctx.fillStyle = '#242d3a';
          ctx.fillRect(cc * TILE, rr * TILE, TILE, TILE);
          ctx.fillStyle = '#313d4e';
          ctx.fillRect(cc * TILE, rr * TILE, TILE, 5);
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.fillRect(cc * TILE, rr * TILE + TILE - 6, TILE, 6);
        } else if (t === T_DOOR) {
          ctx.fillStyle = '#4a3a26';
          ctx.fillRect(cc * TILE, rr * TILE, TILE, TILE);
          ctx.fillStyle = '#6b5433';
          for (let i = 0; i < 4; i++) ctx.fillRect(cc * TILE + 4 + i * 7, rr * TILE + 3, 4, TILE - 6);
          ctx.fillStyle = '#d9b24c';
          ctx.beginPath();
          ctx.arc(cc * TILE + 23, rr * TILE + 16, 3.4, 0, 6.29);
          ctx.fill();
        } else if (t === T_TREE) {
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.beginPath();
          ctx.ellipse(cc * TILE + 16, rr * TILE + 22, 15, 7, 0, 0, 6.29);
          ctx.fill();
          ctx.fillStyle = '#1d3a2a';
          ctx.beginPath();
          ctx.arc(cc * TILE + 16, rr * TILE + 15, 16, 0, 6.29);
          ctx.fill();
          ctx.fillStyle = '#285038';
          ctx.beginPath();
          ctx.arc(cc * TILE + 13, rr * TILE + 12, 10, 0, 6.29);
          ctx.fill();
        }
      }
    }

    // зоны эвакуации
    const spots = extractSpots();
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const open = r.extractOpen[i];
      ctx.save();
      ctx.globalAlpha = open ? 0.9 : 0.35;
      ctx.strokeStyle = open ? '#69f0c0' : '#63707f';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 88, 0, 6.29);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = open ? 0.12 : 0.05;
      ctx.fillStyle = open ? '#69f0c0' : '#63707f';
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = open ? 'rgba(105,240,192,0.8)' : 'rgba(150,160,175,0.5)';
      ctx.font = '600 13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(s.name, s.x, s.y - 100);
      if (r.me.alive && dist(r.me.x, r.me.y, s.x, s.y) < 92 && open) {
        ctx.strokeStyle = '#b9ffe8';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 88, -Math.PI / 2, -Math.PI / 2 + (r.me.extractT / 4) * 6.283);
        ctx.stroke();
      }
    }

    // лут
    for (const box of r.loot) {
      if (box.opened) continue;
      if (Math.abs(box.x - cam.x) > vw / 2 + 80 || Math.abs(box.y - cam.y) > vh / 2 + 80) continue;
      const pulse = 0.6 + Math.sin(r.time * 3 + box.id) * 0.2;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = box.kind === 'safe' ? '#ffd166' : box.kind === 'corpse' ? '#c56d6d' : '#9aa7b8';
      ctx.beginPath();
      ctx.rect(box.x - 9, box.y - 7, 18, 14);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(box.x - 9, box.y - 1, 18, 3);
      ctx.restore();
      if (dist(box.x, box.y, r.me.x, r.me.y) < 70) {
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        ctx.font = '600 11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(box.label, box.x, box.y - 14);
      }
    }

    // пули
    for (const b of r.bullets) {
      const len = 12;
      const a = Math.atan2(b.vy, b.vx);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x - Math.cos(a) * len, b.y - Math.sin(a) * len);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // бойцы
    for (const f of r.fighters) {
      if (!f.alive) continue;
      if (f.isBot) {
        const d = dist(f.x, f.y, r.me.x, r.me.y);
        const visible = d < VISION_R && losClear(r.map, r.me.x, r.me.y, f.x, f.y);
        const revealed = r.me.revealT > 0 && d < 1000;
        if (!visible && !revealed) continue;
        ctx.save();
        if (revealed && !visible) ctx.globalAlpha = 0.42;
        this.drawFighter(ctx, f, r, false);
        ctx.restore();
      } else {
        this.drawFighter(ctx, f, r, f.isPlayer);
      }
    }

    // частицы
    for (const p of r.particles) {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (p.kind === 'smoke' ? 2.2 - a : 1), 0, 6.29);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.restore();

    // туман
    this.drawFog(r, cam);

    // прицел
    const mx = this.lastMouse ? this.lastMouse.x : null;
    if (mx !== null && r.me.alive) {
      const p = this.lastMouse!;
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, 6.29);
      ctx.moveTo(p.x - 12, p.y); ctx.lineTo(p.x - 4, p.y);
      ctx.moveTo(p.x + 4, p.y); ctx.lineTo(p.x + 12, p.y);
      ctx.moveTo(p.x, p.y - 12); ctx.lineTo(p.x, p.y - 4);
      ctx.moveTo(p.x, p.y + 4); ctx.lineTo(p.x, p.y + 12);
      ctx.stroke();
    }
  }

  private drawFighter(ctx: CanvasRenderingContext2D, f: Fighter, r: Raid, isPlayer: boolean) {
    const cls = CLASSES[f.classId];
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(f.x, f.y + 12, 14, 6, 0, 0, 6.29);
    ctx.fill();

    if (f.shieldT > 0) {
      ctx.strokeStyle = 'rgba(255,210,120,0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 20, 0, 6.29);
      ctx.stroke();
    }

    ctx.fillStyle = f.hitT > 0 ? '#ffffff' : (cls.color || '#ddd');
    ctx.beginPath();
    ctx.arc(f.x, f.y, 13, 0, 6.29);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.arc(f.x + 3, f.y + 3, 10, 0, 6.29);
    ctx.fill();
    ctx.fillStyle = f.hitT > 0 ? '#fff' : '#0e1116';
    ctx.font = '700 16px "Segoe UI Symbol", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(f.glyph, f.x, f.y + 1);

    // ствол
    ctx.strokeStyle = '#c9d4e3';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(f.x + Math.cos(f.angle) * 10, f.y + Math.sin(f.angle) * 10);
    ctx.lineTo(f.x + Math.cos(f.angle) * 20, f.y + Math.sin(f.angle) * 20);
    ctx.stroke();

    if (isPlayer) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 18, 0, 6.29);
      ctx.stroke();
    } else {
      const ratio = f.hp / f.maxHp;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(f.x - 17, f.y - 25, 34, 4);
      ctx.fillStyle = ratio > 0.5 ? '#7ee081' : ratio > 0.25 ? '#ffd166' : '#ff7a6b';
      ctx.fillRect(f.x - 17, f.y - 25, 34 * ratio, 4);
      if (f.botKind === 'king') {
        ctx.fillStyle = '#ffd700';
        ctx.font = '600 10px system-ui';
        ctx.fillText('КОРОЛЬ', f.x, f.y - 32);
      }
    }
    ctx.restore();
  }

  drawFog(r: Raid, cam: Camera) {
    const fc = this.fctx;
    const fw = this.fog.width, fh = this.fog.height;
    const sx = fw / this.w;
    fc.setTransform(sx, 0, 0, sx, 0, 0);
    fc.globalCompositeOperation = 'source-over';
    fc.clearRect(0, 0, this.w, this.h);
    fc.fillStyle = 'rgba(6,9,16,0.88)';
    fc.fillRect(0, 0, this.w, this.h);

    const z = cam.zoom;
    const toScreen = (x: number, y: number): [number, number] => [(x - cam.x) * z + this.w / 2, (y - cam.y) * z + this.h / 2];

    // память карты
    fc.globalCompositeOperation = 'destination-out';
    fc.globalAlpha = 0.55;
    const [ex, ey] = toScreen(0, 0);
    fc.imageSmoothingEnabled = false;
    fc.drawImage(this.explore, ex, ey, MAP_SIZE * TILE * z, MAP_SIZE * TILE * z);
    fc.globalAlpha = 1;
    fc.imageSmoothingEnabled = true;

    // текущая видимость
    const cx = r.me.x, cy = r.me.y;
    const poly: number[][] = [];
    for (let i = 0; i < RAYS; i++) {
      const a = (i / RAYS) * Math.PI * 2;
      const d = Math.min(VISION_R, rayDist(r, cx, cy, a));
      poly.push(toScreen(cx + Math.cos(a) * d, cy + Math.sin(a) * d));
    }
    const [px, py] = toScreen(cx, cy);
    const grad = fc.createRadialGradient(px, py, VISION_R * z * 0.35, px, py, VISION_R * z);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(0.72, 'rgba(0,0,0,0.96)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    fc.fillStyle = grad;
    fc.beginPath();
    fc.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) fc.lineTo(poly[i][0], poly[i][1]);
    fc.closePath();
    fc.fill();

    fc.globalCompositeOperation = 'source-over';
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fog, 0, 0, fw, fh, 0, 0, this.w, this.h);
    ctx.restore();

    // тепло фонаря
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const [lx, ly] = toScreen(cx, cy);
    const warm = ctx.createRadialGradient(lx, ly, 10, lx, ly, VISION_R * z * 0.55);
    warm.addColorStop(0, 'rgba(255,214,150,0.08)');
    warm.addColorStop(1, 'rgba(255,214,150,0)');
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.restore();
  }

  lastMouse: { x: number; y: number } | null = null;

  drawMinimap(mm: HTMLCanvasElement, r: Raid) {
    const ctx = mm.getContext('2d')!;
    const size = mm.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#0b0f15';
    ctx.fillRect(0, 0, size, size);
    ctx.globalAlpha = 0.55;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.explore, 0, 0, size, size);
    ctx.globalAlpha = 1;
    const k = size / (MAP_SIZE * TILE);
    for (let i = 0; i < 3; i++) {
      const s = extractSpots()[i];
      ctx.fillStyle = r.extractOpen[i] ? '#69f0c0' : '#56627a';
      ctx.beginPath();
      ctx.arc(s.x * k, s.y * k, 3, 0, 6.29);
      ctx.fill();
    }
    for (const f of r.fighters) {
      if (!f.alive || f.isBot === false) continue;
      const d = dist(f.x, f.y, r.me.x, r.me.y);
      const seen = d < 700 && losClear(r.map, r.me.x, r.me.y, f.x, f.y);
      if (!seen && !(r.me.revealT > 0)) continue;
      ctx.fillStyle = f.botKind === 'king' ? '#ffd700' : '#ff7a6b';
      ctx.beginPath();
      ctx.arc(f.x * k, f.y * k, f.botKind === 'king' ? 3.5 : 2.4, 0, 6.29);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(r.me.x * k, r.me.y * k);
    ctx.rotate(r.me.angle);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(6, 0); ctx.lineTo(-4, 4); ctx.lineTo(-4, -4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(120,140,170,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  }
}

function rayDist(r: Raid, x: number, y: number, a: number): number {
  const dx = Math.cos(a), dy = Math.sin(a);
  for (let d = 6; d < VISION_R; d += 6) {
    const t = tileAt(r.map, x + dx * d, y + dy * d);
    if (t === T_WALL || t === T_TREE) return d;
  }
  return VISION_R;
}
