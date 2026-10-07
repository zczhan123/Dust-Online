/**
 * 挑战卡（单人挑战模式：昔日传奇自动机）。
 * 该数据供 **选择界面（头像弹窗）** 与 **挑战自动机引擎** 共用。
 * 转写规则见仓库外 `尘起时刻_挑战卡规格_Z01-Z12.md`（文本记法 + 结构化 schema）。
 */

export type ChallengeSlotKind = 'pips' | 'any' | 'same' | 'straight';

export interface ChallengeSlot {
  kind: ChallengeSlotKind;
  count: number;
  /** kind==='pips' 时必填：每格可接受的点数（count>1＝任选；逐格不同＝拆成多条 count:1） */
  faces?: number[];
}

export interface ChallengeSkill {
  id: string;
  name: string;
  marker?: '∞' | '怜悯*';
  /** null＝无槽（必发动） */
  slots: ChallengeSlot[] | null;
  effect: string;
  endsTurn?: boolean;
  /** 纯被动（如 Z02「锋芒」＝按计数加伤害）：**不占"逐条结算"的步**，只在内部同步即可 */
  passive?: boolean;
}

export interface ChallengeCard {
  id: string;
  legacy: string;
  artifacts: [string, string, string];
  /** 以下字段随转写补全（未转写的卡暂缺） */
  life?: number;
  defenseCap?: number;
  defenseRule?: string;
  /** 防御规则的门槛（只会抵挡**伤害 ≥ 该值**的攻击）；缺省＝0（都挡） */
  defenseMin?: number;
  /** 回合开始投掷的驱动骰数量（必须与 skills[0] 的卡面文字一致——有测试锁） */
  rollDice?: number;
  /** 传奇「计数」上限（Z02「锋芒」X / 「暗夜凶神」+1 用）；无计数的卡不填 */
  countCap?: number;
  skills?: ChallengeSkill[];
}

export const CHALLENGES: ChallengeCard[] = [
  {
    id: 'Z01', legacy: '雨中剑圣', artifacts: ['001', '002', '003'],
    life: 50, defenseCap: 5, defenseRule: '只抵挡伤害 ≥ 2 的攻击', defenseMin: 2,
    skills: [
      { id: 'z01-0', name: '回合开始', slots: null, effect: '投掷 7 个驱动骰。' },
      { id: 'z01-1', name: '龙游万象', marker: '∞', slots: null, effect: '将所有 1 点 和 6 点 的驱动骰重新投掷 1 次。' },
      { id: 'z01-2', name: '断斩一斩', marker: '怜悯*', slots: [{ kind: 'pips', count: 5, faces: [2, 5] }], endsTurn: true, effect: '弃置双方的全部能力骰。对挑战者造成 10 点真实伤害，并获得 3 个随机点数的防御骰，然后立即结束回合。' },
      { id: 'z01-3', name: '龙腾万丈', slots: [{ kind: 'pips', count: 3, faces: [2, 5] }], effect: '获得 4 个随机点数的能力骰，将其中点数最大和最小的能力骰各 1 个移动到攻击骰区，将另外 2 个能力骰移动到防御骰区。' },
      { id: 'z01-4', name: '雨落狂流', marker: '∞', slots: null, effect: '检查「雨中剑圣」的区域中不符合骰点分布的能力骰数量。每有 3 个不符合骰点分布的能力骰，弃置挑战者的 1 个防御骰。' },
      { id: 'z01-5', name: '裁雨流', slots: null, effect: '将本技能上的驱动骰全部移动到攻击骰区，并使用所有攻击骰进行攻击。前 3 次成功造成伤害的攻击骰移动至防御骰区。' },
    ],
  },
  {
    id: 'Z02', legacy: '永暗之刃', artifacts: ['004', '005', '006'],
    life: 50, defenseCap: 4, defenseRule: '只抵挡伤害 ≥ 3 的攻击', defenseMin: 3,
    rollDice: 8, countCap: 3,
    skills: [
      { id: 'z02-0', name: '回合开始', slots: null, effect: '投掷 8 个驱动骰。' },
      { id: 'z02-1', name: '锋芒', marker: '∞', slots: null, passive: true, effect: '「永暗之刃」的攻击伤害 +X。X 为「永暗之刃」叠加的计数。' },
      { id: 'z02-2', name: '葬敌的完杀', slots: [{ kind: 'pips', count: 1, faces: [1] }, { kind: 'pips', count: 1, faces: [2] }, { kind: 'pips', count: 1, faces: [3] }, { kind: 'pips', count: 1, faces: [4] }], effect: '尽可能弃置挑战者的防御骰，直至数量降为 1。获得 1、2、3、4 点的攻击骰各 1 个。' },
      { id: 'z02-3', name: '暗夜凶神', slots: [{ kind: 'pips', count: 1, faces: [1] }, { kind: 'pips', count: 1, faces: [4] }, { kind: 'pips', count: 1, faces: [6] }], effect: '进行一次点数视为 8 点的不可抵挡的攻击，并弃置挑战者的 1 个防御骰。然后「永暗之刃」的计数 +1（最高叠加至 3 层）。' },
      { id: 'z02-4', name: '枭首', slots: [{ kind: 'pips', count: 1, faces: [6] }], effect: '将本技能上的驱动骰全部移动至攻击骰区。如果攻击骰的数量超过了挑战者的防御骰数量，则使用所有攻击骰发起攻击。' },
      { id: 'z02-5', name: '遁入暗影', slots: [{ kind: 'same', count: 2 }], effect: '将本技能上的驱动骰全部移动至防御骰区。每移动 1 组，进行 1 次 2 点攻击。' },
    ],
  },
  { id: 'Z03', legacy: '孤塔之王', artifacts: ['007', '008', '009'] },
  { id: 'Z04', legacy: '地狱的魔女', artifacts: ['010', '011', '012'] },
  { id: 'Z05', legacy: '轰鸣审判官', artifacts: ['013', '014', '015'] },
  { id: 'Z06', legacy: '漆黑死神', artifacts: ['016', '017', '018'] },
  { id: 'Z07', legacy: '荒野行者', artifacts: ['019', '020', '021'] },
  { id: 'Z08', legacy: '黑枪', artifacts: ['022', '023', '024'] },
  { id: 'Z09', legacy: '天殇的战鬼', artifacts: ['025', '026', '027'] },
  { id: 'Z10', legacy: '破晓之剑', artifacts: ['028', '029', '030'] },
  { id: 'Z11', legacy: '受缚邪灵', artifacts: ['031', '032', '033'] },
  { id: 'Z12', legacy: '渡世行僧', artifacts: ['034', '035', '036'] },
];

/** 把挑战技能的槽转换成显示文本（与规格文档记法一致）。 */
export function slotPhrase(slots: ChallengeSlot[] | null): string {
  if (!slots || slots.length === 0) return '（必发动）';
  const single = slots.length === 1 ? slots[0] : null;
  if (single && single.kind === 'pips' && single.count > 1) {
    return `（满足 ${single.count} 个〔${(single.faces ?? []).join('/')}点〕驱动骰时发动）`;
  }
  if (slots.every((s) => s.kind === 'pips')) {
    if (slots.every((s) => s.count === 1)) {
      const faces = slots.flatMap((s) => s.faces ?? []);
      return `（满足〔${faces.join('点、')}点〕驱动骰时发动）`;
    }
    const parts = slots.map((s) => `${s.count} 个〔${(s.faces ?? []).join('/')}点〕`).join('');
    return `（满足 ${parts}驱动骰时发动）`;
  }
  const s = slots[0];
  if (s.kind === 'same') return `（满足 ${s.count} 个任意相同点数驱动骰时发动）`;
  if (s.kind === 'any') return `（满足 ${s.count} 个任意点数驱动骰时发动）`;
  if (s.kind === 'straight') return `（满足 ${s.count} 个顺点驱动骰时发动）`;
  return '（必发动）';
}

/** 挑战模式「特殊规则（技能削弱）」单条。**浮窗与引擎共用这一份**，禁止另写文案。 */
export interface ChallengeRuleNote {
  id: string;
  /** 浮窗显示名（带神器编号更好认，如「013 鸣雷·雷暴（持续）」） */
  title: string;
  /** 一句话说明（照 FAQ 结论写，别自己发挥） */
  text: string;
  /**
   * 本模式下**整条失效**的神器技能 key（引擎只读它）。
   * 不填＝该条不是"整条失效"，而是"改结算口径"（如 023 跳过给传奇的冥想骰、020 改由挑战者决定）。
   */
  inertSkills?: string[];
}

/** 出处：`尘起时刻FAQ_v2.6文本.md`（13.2.5 / 17.1.5 / 28.1.2 / 41.1.1 / 23.2.3 / 20.1.4）。 */
export const CHALLENGE_RULE_NOTES: ChallengeRuleNote[] = [
  {
    id: 'leibao',
    title: '013 鸣雷·雷暴（持续）',
    text: '单人挑战中没有任何效果——「昔日传奇」没有重掷阶段。',
    inertSkills: ['minglei.leibao.continuous'],
  },
  {
    id: 'weimu',
    title: '017 幽冥·帷幕',
    text: '单人挑战中没有任何效果——「昔日传奇」没有重掷阶段。',
    inertSkills: ['youming.weimu'],
  },
  {
    id: 'tianfa-bairi',
    title: '028 天罚·白昼之火（含异相 A05）',
    text: '单人挑战中没有任何效果——用于降低「天罚」对「昔日传奇」的压制。',
    inertSkills: ['tianfa.bairi', 'tianfa.alt.shenkong'],
  },
  {
    id: 'shexie-gongzhen',
    title: '023 蛇蝎·共振',
    text: '选「双方各获得冥想骰」时，跳过给「昔日传奇」的那份；你照常获得。',
  },
  {
    id: 'shouhun',
    title: '020 兽魂',
    text: '「扣减你的计数」这类选择，由挑战者决定。',
  },
];

/** 本模式下**整条失效**的神器技能 key 集合——引擎只读这里（唯一来源）。 */
export function challengeInertSkills(): Set<string> {
  return new Set(CHALLENGE_RULE_NOTES.flatMap((n) => n.inertSkills ?? []));
}
