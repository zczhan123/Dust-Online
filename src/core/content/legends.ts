import { HEROES } from './artifacts';
import type { LegendPanel, SkillDef } from '../model/types';

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
  /** 面板技能（开局即可用，无需激活；`side` 恒为 'only'）。文本转写进 `legendText.ts`。 */
  skills: SkillDef[];
  /** 面板计数上限（如 L01「雨落狂流」无上限则省略） */
  countCap?: number;
}

const idOf = (i: number): string => `L${String(i + 1).padStart(2, '0')}`;

/**
 * 面板技能的「尘落前置 N」**唯一来源**（引擎拦动作、界面判技能行灰绿都读这一份，
 * 禁止任何一侧再抄副本——曾因 `render.ts` 的副本漏了 `zoray.juedi` 而让「绝地惊雷」提前变绿）。
 * 键 = 技能 key；缺省（不在表内）= 无前置。
 */
export const LEGEND_DUSTFALL_REQ: Record<string, number> = {
  'ying.zangdihua': 1,
  'zoray.juedi': 3,
  'nisa.buqupaoxiao': 2,
  'xiva.meiyoulianmin': 4,
  'lifeng.bianyecansha': 2,
  'miyun.lidichengfo': 3,
};

/**
 * 面板技能定义（按英雄 key）。`side` 一律 'only'：面板没有左右侧、也没有激活步骤。
 * - L01「雨中剑圣」空：雨落狂流（持续+触发）、断苇一斩（触发）
 * - L02「永暗之刃」影：残影（持续）、暗夜凶神（触发）、潸然的葬敌花（必杀·尘落前置1）
 * - L03「孤塔之王」巴顿二世：无敌（持续）、拔城（触发）、统御战场（持续）
 * - L04「地狱的魔女」塔塔萝丝：无上剑术（持续）、我将在下个梦境与你再度相逢（必杀·尘落前置0）
 * - L05「轰鸣审判官」佐雷：复仇之灵（持续）、无法饶恕（触发）、绝地惊雷（必杀·尘落前置3）
 * - L06「漆黑死神」修：圆舞（持续）、无光领域（启动）、死即新生（持续）
 * - L07「荒野行者」尼萨：无尽追猎（持续）、始祖兽魂（触发）、不屈咆哮（必杀·尘落前置2）
 * - L08「黑枪」希瓦：蛇蝎之泪（持续）、只为赏金而来（触发）、没有怜悯（持续·尘落前置4）
 * - L09「天殇的战鬼」李封：吞虎之狼（持续）、鏖战（持续）、遍野残杀（必杀·尘落前置2）
 * - L10「破晓之剑」玛特：涤罪大剑术（触发）、汝等罪人（触发）、迟来的正义（持续）
 * - L11「受缚邪灵」艾娃：强加之罪（持续）、邪灵序曲（持续·计数上限99）、永恒女王（持续）
 * - L12「渡世行僧」弥云：见我身者菩提心（持续）、闻我名者断恶行（触发）、知我心者立地成佛（必杀·尘落前置3）
 */
const LEGEND_SKILLS: Partial<Record<LegendHeroKey, SkillDef[]>> = {
  kong: [
    { side: 'only', kind: 'continuous', key: 'kong.yuluo' },
    { side: 'only', kind: 'trigger', key: 'kong.yuluo.trigger' },
    { side: 'only', kind: 'trigger', key: 'kong.duanweiyizhan' },
  ],
  ying: [
    { side: 'only', kind: 'continuous', key: 'ying.canying' },
    { side: 'only', kind: 'trigger', key: 'ying.anyexiongshen' },
    { side: 'only', kind: 'ultimate', key: 'ying.zangdihua' },
  ],
  batton: [
    { side: 'only', kind: 'continuous', key: 'batton.wudi' },
    { side: 'only', kind: 'trigger', key: 'batton.bacheng' },
    { side: 'only', kind: 'continuous', key: 'batton.tongyuzhancang' },
  ],
  tata: [
    { side: 'only', kind: 'continuous', key: 'tata.wushangjianshu' },
    { side: 'only', kind: 'ultimate', key: 'tata.mengjing' },
  ],
  zoray: [
    { side: 'only', kind: 'continuous', key: 'zoray.fuchouzhiling' },
    { side: 'only', kind: 'trigger', key: 'zoray.wufaraoshu' },
    { side: 'only', kind: 'ultimate', key: 'zoray.juedi' },
  ],
  xiu: [
    { side: 'only', kind: 'continuous', key: 'xiu.yuanwu' },
    { side: 'only', kind: 'activate', key: 'xiu.wuguanglingyu' },
    { side: 'only', kind: 'continuous', key: 'xiu.sijixinsheng' },
  ],
  nisa: [
    { side: 'only', kind: 'continuous', key: 'nisa.wujinzhulie' },
    { side: 'only', kind: 'trigger', key: 'nisa.shizushouhun' },
    { side: 'only', kind: 'ultimate', key: 'nisa.buqupaoxiao' },
  ],
  xiva: [
    { side: 'only', kind: 'continuous', key: 'xiva.shexiezhilei' },
    { side: 'only', kind: 'trigger', key: 'xiva.zhiweishangjin' },
    { side: 'only', kind: 'continuous', key: 'xiva.meiyoulianmin' },
  ],
  lifeng: [
    { side: 'only', kind: 'continuous', key: 'lifeng.tunhuzhilang' },
    { side: 'only', kind: 'continuous', key: 'lifeng.aozhan' },
    { side: 'only', kind: 'ultimate', key: 'lifeng.bianyecansha' },
  ],
  mate: [
    { side: 'only', kind: 'trigger', key: 'mate.dizuidaijianshu' },
    { side: 'only', kind: 'trigger', key: 'mate.nudengzuiren' },
    { side: 'only', kind: 'continuous', key: 'mate.chilaidezhengyi' },
  ],
  aiwa: [
    { side: 'only', kind: 'continuous', key: 'aiwa.qiangjiazhiuzui' },
    { side: 'only', kind: 'continuous', key: 'aiwa.xielingxuqu' },
    { side: 'only', kind: 'continuous', key: 'aiwa.yonghengnvwang' },
  ],
  miyun: [
    { side: 'only', kind: 'continuous', key: 'miyun.putixin' },
    { side: 'only', kind: 'trigger', key: 'miyun.duanexing' },
    { side: 'only', kind: 'ultimate', key: 'miyun.lidichengfo' },
  ],
};

/** 面板的**计数上限**（仅 L11「邪灵序曲」= 99；其余面板不显示 `/上限`） */
const LEGEND_COUNT_CAP: Partial<Record<LegendHeroKey, number>> = {
  aiwa: 99,
};

export const LEGENDS: Record<string, LegendDef> = Object.fromEntries(
  LEGEND_HERO_ORDER.map((heroKey, i) => {
    const h = HEROES[heroKey];
    const id = idOf(i);
    const skills = LEGEND_SKILLS[heroKey] ?? [];
    const countCap = LEGEND_COUNT_CAP[heroKey];
    return [
      id,
      {
        id,
        heroKey,
        name: h.name,
        artifacts: h.artifacts as [string, string, string],
        skills,
        ...(countCap !== undefined ? { countCap } : {}),
      },
    ];
  }),
);

/** 英雄 key → 传奇英雄面板 id */
export const LEGEND_OF_HERO: Record<string, string> = Object.fromEntries(
  LEGEND_HERO_ORDER.map((heroKey, i) => [heroKey, idOf(i)]),
);

/** 面板卡图相对路径（沿用 `./legend/`，与 `./cards/` 同口径，上线前随其它路径一起改） */
export const legendImageUrl = (id: string): string => `./legend/${id}.jpg`;

/** 构造运行时「传奇英雄面板」（引擎用）。技能文本转写后填入 `skills`。 */
export function makeLegend(id: string): LegendPanel {
  const def = LEGENDS[id];
  if (!def) throw new Error(`unknown legend id: ${id}`);
  return {
    id: def.id,
    heroKey: def.heroKey,
    name: def.name,
    count: 0,
    countCap: def.countCap,
    skills: def.skills.map((s) => ({ ...s })),
  };
}

/** 预选模式下，由某方所选「3 件神器」反查其英雄对应的传奇面板 id（非英雄三件套 → undefined）。 */
export function legendOfTrio(trio: readonly string[]): string | undefined {
  const key = (Object.keys(HEROES) as LegendHeroKey[]).find((k) => {
    const arts = HEROES[k].artifacts;
    return arts.length === trio.length && arts.every((a, i) => a === trio[i]);
  });
  return key ? LEGEND_OF_HERO[key] : undefined;
}
