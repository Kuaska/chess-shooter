export function clamp(v: number, a: number, b: number) { return v < a ? a : v > b ? b : v; }
export function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
export function dist2(ax: number, ay: number, bx: number, by: number) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
export function dist(ax: number, ay: number, bx: number, by: number) { return Math.sqrt(dist2(ax, ay, bx, by)); }
export function angleTo(ax: number, ay: number, bx: number, by: number) { return Math.atan2(by - ay, bx - ax); }
export function norm(a: number) { a = a % (Math.PI * 2); return a < 0 ? a + Math.PI * 2 : a; }
export function angleDiff(a: number, b: number) { let d = norm(a - b); if (d > Math.PI) d -= Math.PI * 2; return d; }
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function pick<T>(rnd: () => number, arr: T[]): T { return arr[Math.floor(rnd() * arr.length)]; }
export function rand(rnd: () => number, a: number, b: number) { return a + rnd() * (b - a); }
export function randInt(rnd: () => number, a: number, b: number) { return Math.floor(rand(rnd, a, b + 1)); }
