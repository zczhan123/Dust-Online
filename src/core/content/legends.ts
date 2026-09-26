import { HEROES } from './artifacts';

/**
 * 传奇英雄面板（12 块）：与 12 个英雄**一一绑定**（L01 = 第 1 个英雄…L12 = 第 12 个英雄）。
 * 仅预选模式可用；面板≈"第 4 件神器"，技能**开局即可用（无需激活）**，可受"失去持续效果 / 被弃置"影响。
 *
 * 注：技能文本后续逐张转写进 `LEGENDS[id].skills`；本文件先提供 id/英雄绑定/名称/预设神器/卡图。
 */
export const LEGEND_HERO_ORDER = [
  'kong',
  'ying',
  'batton',
  'tata',
  'zoray',
  'xiu',
  'nisa',
  'xiva',
  'lifeng',
  'mate',
  'aiwa',
  'miyun',
] as const;
export type LegendHeroKey = (typeof LEGEND_HERO_ORDER)[number];

export interface LegendDef {
  id: string; // 'L01'
  heroKey: LegendHeroKey;
  /** 英雄显示名（如「雨中剑圣 空」） */
  name: string;
  /** 该英雄的预设 3 件神器（面板与之绑定，不可混搭） */
  artifacts: [string, string, string];
}

const idOf = (i: number): string => `L${String(i + 1).padStart(2, '0')}`;

export const LEGENDS: Record<string, LegendDef> = Object.fromEntries(
  LEGEND_HERO_ORDER.map((heroKey, i) => {
    const h = HEROES[heroKey];
    const id = idOf(i);
    return [id, { id, heroKey, name: h.name, artifacts: h.artifacts as [string, string, string] }];
  }),
);

/** 英雄 key → 传奇英雄面板 id */
export const LEGEND_OF_HERO: Record<string, string> = Object.fromEntries(
  LEGEND_HERO_ORDER.map((heroKey, i) => [heroKey, idOf(i)]),
);

/** 面板卡图相对路径（沿用 `./legend/`，与 `./cards/` 同口径，上线前随其它路径一起改） */
export const legendImageUrl = (id: string): string => `./legend/${id}.jpg`;
