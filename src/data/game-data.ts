export type ClassId = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen';
export type WeaponId = 'pistol' | 'smg' | 'shotgun' | 'rifle';
export type BotKind = 'pawn' | 'knight' | 'bishop' | 'rook' | 'king';

export interface AbilityDef {
  kind: 'dash' | 'leap' | 'reveal' | 'shield' | 'volley';
  name: string;
  desc: string;
  cd: number;
  dur: number;
}

export interface FighterClass {
  id: ClassId;
  name: string;
  glyph: string;
  hp: number;
  stamina: number;
  speed: number;
  regen: number;
  color: string;
  ability: AbilityDef;
  trait: string;
  price: number;
}

export const CLASSES: Record<ClassId, FighterClass> = {
  pawn: {
    id: 'pawn', name: 'Пешка', glyph: '♟', hp: 100, stamina: 100, speed: 174, regen: 16, color: '#7ee081',
    ability: { kind: 'dash', name: 'Рывок', desc: 'Бросок вперёд на 130 px, сбивает прицел врагам', cd: 7, dur: 0.18 },
    trait: '+20% лута из контейнеров', price: 0,
  },
  knight: {
    id: 'knight', name: 'Конь', glyph: '♞', hp: 112, stamina: 132, speed: 180, regen: 18, color: '#8fb8ff',
    ability: { kind: 'leap', name: 'Прыжок', desc: 'Перескок через стену на 110 px', cd: 9, dur: 0.12 },
    trait: 'Спринт дешевле на 30%', price: 250,
  },
  bishop: {
    id: 'bishop', name: 'Слон', glyph: '♝', hp: 106, stamina: 112, speed: 168, regen: 15, color: '#c9a0ff',
    ability: { kind: 'reveal', name: 'Прозрение', desc: '3 с видит врагов сквозь стены', cd: 13, dur: 3 },
    trait: 'Враги на мини-карте дольше', price: 300,
  },
  rook: {
    id: 'rook', name: 'Ладья', glyph: '♜', hp: 150, stamina: 82, speed: 152, regen: 13, color: '#ffb86b',
    ability: { kind: 'shield', name: 'Щит', desc: '4 с получает на 65% меньше урона', cd: 12, dur: 4 },
    trait: 'Броня прочнее на 25%', price: 400,
  },
  queen: {
    id: 'queen', name: 'Ферзь', glyph: '♛', hp: 120, stamina: 120, speed: 172, regen: 16, color: '#ff7ea8',
    ability: { kind: 'volley', name: 'Залп', desc: 'Веер из пяти пуль без расхода патронов', cd: 14, dur: 0 },
    trait: 'Перезарядка быстрее на 15%', price: 600,
  },
};

export interface WeaponDef {
  id: WeaponId;
  name: string;
  dmg: number;
  pellets: number;
  rate: number;
  spread: number;
  speed: number;
  mag: number;
  reload: number;
  ammo: string;
  reserve: number;
  auto: boolean;
  range: number;
  color: string;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: { id: 'pistol', name: 'Пистолет «Пешка»', dmg: 19, pellets: 1, rate: 240, spread: 0.035, speed: 980, mag: 12, reload: 1.1, ammo: 'ammo_pistol', reserve: 72, auto: false, range: 640, color: '#ffe9a8' },
  smg: { id: 'smg', name: 'ПП «Гамбит»', dmg: 12, pellets: 1, rate: 88, spread: 0.085, speed: 940, mag: 30, reload: 1.5, ammo: 'ammo_smg', reserve: 150, auto: true, range: 520, color: '#ffd166' },
  shotgun: { id: 'shotgun', name: 'Дробовик «Ладья»', dmg: 8, pellets: 8, rate: 760, spread: 0.16, speed: 820, mag: 6, reload: 1.9, ammo: 'ammo_shotgun', reserve: 36, auto: false, range: 300, color: '#ff9f6b' },
  rifle: { id: 'rifle', name: 'Винтовка «Ферзь»', dmg: 38, pellets: 1, rate: 430, spread: 0.012, speed: 1320, mag: 10, reload: 1.7, ammo: 'ammo_rifle', reserve: 48, auto: false, range: 900, color: '#9ee7ff' },
};

export interface ItemDef {
  id: string;
  name: string;
  kind: 'weapon' | 'ammo' | 'med' | 'stim' | 'armor' | 'valuable';
  stack: number;
  value: number;
  desc: string;
}

export const ITEMS: Record<string, ItemDef> = {
  pistol: { id: 'pistol', name: 'Пистолет «Пешка»', kind: 'weapon', stack: 1, value: 120, desc: 'Надёжный, дешёвый, точный' },
  smg: { id: 'smg', name: 'ПП «Гамбит»', kind: 'weapon', stack: 1, value: 320, desc: 'Скорострельный, косой на дистанции' },
  shotgun: { id: 'shotgun', name: 'Дробовик «Ладья»', kind: 'weapon', stack: 1, value: 380, desc: 'В упор страшен, дальше бесполезен' },
  rifle: { id: 'rifle', name: 'Винтовка «Ферзь»', kind: 'weapon', stack: 1, value: 720, desc: 'Дорогая, точная, пробивает броню' },
  ammo_pistol: { id: 'ammo_pistol', name: 'Патроны 9×19', kind: 'ammo', stack: 60, value: 3, desc: 'Для пистолета' },
  ammo_smg: { id: 'ammo_smg', name: 'Патроны 9×21', kind: 'ammo', stack: 120, value: 2, desc: 'Для ПП' },
  ammo_shotgun: { id: 'ammo_shotgun', name: 'Картечь 12к', kind: 'ammo', stack: 24, value: 6, desc: 'Для дробовика' },
  ammo_rifle: { id: 'ammo_rifle', name: 'Патроны 7.62', kind: 'ammo', stack: 40, value: 9, desc: 'Для винтовки' },
  medkit: { id: 'medkit', name: 'Аптечка', kind: 'med', stack: 4, value: 90, desc: '+45 HP, 2.5 с' },
  stim: { id: 'stim', name: 'Стимулятор', kind: 'stim', stack: 4, value: 60, desc: 'Мгновенно +60 стамины' },
  plate: { id: 'plate', name: 'Плита брони', kind: 'armor', stack: 3, value: 80, desc: 'Ремонтирует броню на 40' },
  armor1: { id: 'armor1', name: 'Бронежилет «Слон»', kind: 'armor', stack: 1, value: 260, desc: '−30% урона, 60 прочности' },
  armor2: { id: 'armor2', name: 'Броня «Король»', kind: 'armor', stack: 1, value: 620, desc: '−45% урона, 110 прочности' },
  gold: { id: 'gold', name: 'Золото', kind: 'valuable', stack: 9, value: 55, desc: 'Ценность' },
  chip: { id: 'chip', name: 'Шахматный чип', kind: 'valuable', stack: 9, value: 110, desc: 'Ценность' },
  relic: { id: 'relic', name: 'Реликвия двора', kind: 'valuable', stack: 3, value: 320, desc: 'Редкая ценность' },
};

export const ARMOR_TIERS: Record<string, { reduce: number; dur: number }> = {
  armor1: { reduce: 0.3, dur: 60 },
  armor2: { reduce: 0.45, dur: 110 },
};

export interface BotDef {
  kind: BotKind;
  name: string;
  glyph: string;
  hp: number;
  speed: number;
  weapon: WeaponId;
  sight: number;
  accuracy: number;
  burst: [number, number];
  color: string;
  loot: string[];
}

export const BOTS: Record<BotKind, BotDef> = {
  pawn: { kind: 'pawn', name: 'Пешка-патруль', glyph: '♟', hp: 62, speed: 118, weapon: 'pistol', sight: 430, accuracy: 0.14, burst: [1, 3], color: '#7ee081', loot: ['ammo_pistol', 'gold', 'medkit'] },
  knight: { kind: 'knight', name: 'Конь-фланкер', glyph: '♞', hp: 84, speed: 158, weapon: 'smg', sight: 470, accuracy: 0.2, burst: [3, 6], color: '#8fb8ff', loot: ['ammo_smg', 'stim', 'chip'] },
  bishop: { kind: 'bishop', name: 'Слон-снайпер', glyph: '♝', hp: 74, speed: 108, weapon: 'rifle', sight: 720, accuracy: 0.06, burst: [1, 1], color: '#c9a0ff', loot: ['ammo_rifle', 'medkit', 'relic'] },
  rook: { kind: 'rook', name: 'Ладья-тяжёлый', glyph: '♜', hp: 150, speed: 92, weapon: 'shotgun', sight: 380, accuracy: 0.24, burst: [1, 2], color: '#ffb86b', loot: ['ammo_shotgun', 'armor1', 'plate'] },
  king: { kind: 'king', name: 'Король', glyph: '♚', hp: 460, speed: 104, weapon: 'rifle', sight: 820, accuracy: 0.07, burst: [2, 4], color: '#ffd700', loot: ['relic', 'armor2', 'rifle'] },
};

export const EXTRACTS = [
  { name: 'Северные ворота', x: 64, y: 5 },
  { name: 'Западный причал', x: 5, y: 64 },
  { name: 'Южный рынок', x: 64, y: 122 },
];

export const RAID_TIME = 600;
