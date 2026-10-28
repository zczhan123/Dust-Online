/**
 * 挑战卡（单人挑战模式：昔日传奇自动机）。
 * 该数据供 **选择界面（头像弹窗）** 与 **挑战自动机引擎** 共用。
 * 转写规则见仓库外 `尘起时刻_挑战卡规格_Z01-Z12.md`（文本记法 + 结构化 schema）。
 */

export type ChallengeSlotKind = 'pips' | 'any' | 'same' | 'straight' | 'exact' | 'distinct';

export interface ChallengeSlot {
  kind: ChallengeSlotKind;
  count: number;
  /** kind==='pips'：每格可接受的点数（count>1＝任选；逐格不同＝拆成多条 count:1）。
   *  kind==='exact'：一组骰的**点数多重集恰好等于**它（升序，如 `[1,1]` / `[1,6]` / `[6,6]`）。Z05「数罪并罚」用。 */
  faces?: number[];
  /** **无限数量**（规则书 §7）：本槽容纳**全部**符合 `faces` 的驱动骰（`count` 忽略）。如 Z01「裁雨流」。 */
  unlimited?: boolean;
}

export interface ChallengeSkill {
  id: string;
  name: string;
  marker?: '∞' | '怜悯*';
  /** null＝无槽（必检：每回合都做一次"发动检查"、无骰子条件） */
  slots: ChallengeSlot[] | null;
  effect: string;
  endsTurn?: boolean;
  /** 纯被动（如 Z02「锋芒」＝按计数加伤害）：**不占"逐条结算"的步**，只在内部同步即可 */
  passive?: boolean;
  /**
   * 「相同」槽且本值 > 1 时：该技能一次可容纳**最多这么多组**（每组＝`slots[0].count` 颗同点）。
   * 用于「遁入暗影」这类"本技能上的驱动骰全部…每移动 1 组"的技能（Z02 = 2 组）。
   * 缺省 = 1（按普通"刚好满足"处理）。
   */
  maxSameGroups?: number;
  /**
   * **逐组独立**（"每投出 1 组…"类，Z05「数罪并罚」「电刑」）：各槽**各自独立匹配、可只匹配一部分**
   * （不是"全填才发"）；效果按**匹配到的组数**结算。缺省＝全填才发。
   */
  perGroup?: boolean;
  /**
   * **同点槽的"选组"代决**（Z06 虚无形态/勾魂镰/圆舞）：当驱动骰里有 **≥2 个不同点数的候选组**时，
   * 由挑战者代决"本技能上用哪一组同点驱动骰"（自动：有利＝点数大、不利＝点数小）；只有 1 组时直接匹配。
   */
  slotChoice?: boolean;
  /**
   * **可"再次发动"**（Z07「蛮王之牙」）：生效后清空本技能上的驱动骰，若剩余驱动骰仍能凑出可匹配的组 →
   * 再执行一遍本技能（循环），直至凑不出。
   */
  repeat?: boolean;
  /**
   * **黑白指示物门禁**（Z06「漆黑死神」）：`'black'`/`'white'` ＝ 只有指示物当前面与之相同时，本条才发动。
   * 缺省＝不受颜色影响（始终参与）。指示物本体见 `ChallengeCard.token`。
   */
  color?: 'black' | 'white';
  /**
   * **不占"逐条结算"的顺序步**（Z06「死即新生」）：由独立钩子（生命归 0）触发，`continueLegendTurn` 会跳过它；
   * 面板技能列里序号位显示 `x`（见 `render.ts`）。
   */
  unordered?: boolean;
  /**
   * 该技能是否"**持续生效中**"（＝面板技能列里常亮）。
   * - `true`：始终生效；
   * - `'count'`：当 `g.challenge.count > 0` 时生效（Z02「锋芒」）；
   * - `'lifeBonus'`：当"因生命差产生的攻击加成 > 0"时生效（Z05「绝境天神」：生命每低 10 点就亮）；
   * - `'lowLife'`：当**任一方生命 < 10** 时生效（Z10「迟来的正义」）。
   * 缺省＝不常亮。**数据驱动**（勿再按 `skill.id` 硬编码）。
   */
  alwaysOn?: boolean | 'count' | 'lifeBonus' | 'lowLife';
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
  /** 若"**上个挑战者的回合**"本传奇受到过伤害 → 回合开始**额外**投掷这么多驱动骰（Z05「绝境天神」=2）。 */
  rollDiceBonusOnDamage?: number;
  /** 当前生命每比初始生命低 10 点 → 其攻击伤害 **+（本值）**（Z05「绝境天神」=1）。 */
  attackBonusPer10MissingLife?: number;
  /** 「威压」类规则：**挑战者对传奇的每次攻击伤害上限**（Z09「天殇的战鬼」=4）。
   *  造成伤害时若原始伤害 > 该值 → 封顶并弹「威压」名（`z09-x`）。缺省＝不封顶。 */
  damageCapPerHit?: number;
  /** 是否使用**黑白指示物**（Z06「漆黑死神」）：战斗开始放黑面朝上、其回合结束翻面；技能按 `color` 决定是否发动。 */
  token?: boolean;
  /** 传奇「计数」上限（Z02「锋芒」X / 「暗夜凶神」+1 用）；无计数的卡不填。
   *  Z07「荒野行者」＝`Infinity`（不封顶，界面显示 `计数 N/∞`）。 */
  countCap?: number;
  skills?: ChallengeSkill[];
}

export const CHALLENGES: ChallengeCard[] = [
  {
    id: 'Z01', legacy: '雨中剑圣', artifacts: ['001', '002', '003'],
    life: 50, defenseCap: 5, defenseRule: '只抵挡伤害 ≥ 2 的攻击', defenseMin: 2, rollDice: 7,
    skills: [
      { id: 'z01-0', name: '回合开始', slots: null, effect: '投掷 7 个驱动骰。' },
      { id: 'z01-1', name: '龙游万象', marker: '∞', slots: null, effect: '将所有 1 点 和 6 点 的驱动骰重新投掷 1 次。' },
      { id: 'z01-2', name: '断斩一斩', marker: '怜悯*', slots: [{ kind: 'pips', count: 5, faces: [2, 5] }], endsTurn: true, effect: '弃置双方的全部能力骰。对挑战者造成 10 点真实伤害，并获得 3 个随机点数的防御骰，然后立即结束回合。' },
      { id: 'z01-3', name: '龙腾万丈', slots: [{ kind: 'pips', count: 3, faces: [2, 5] }], effect: '获得 4 个随机点数的能力骰，将其中点数最大和最小的能力骰各 1 个移动到攻击骰区，将另外 2 个能力骰移动到防御骰区。' },
      { id: 'z01-4', name: '雨落狂流', marker: '∞', slots: null, effect: '检查「雨中剑圣」的区域中不符合骰点分布的能力骰数量。每有 3 个不符合骰点分布的能力骰，弃置挑战者的 1 个防御骰。' },
      { id: 'z01-5', name: '裁雨流', slots: [{ kind: 'pips', count: 0, faces: [3, 4], unlimited: true }], effect: '将本技能上的驱动骰全部移动到攻击骰区，并使用所有攻击骰进行攻击。前 3 次成功造成伤害的攻击骰移动至防御骰区。' },
    ],
  },
  {
    id: 'Z02', legacy: '永暗之刃', artifacts: ['004', '005', '006'],
    life: 50, defenseCap: 4, defenseRule: '只抵挡伤害 ≥ 3 的攻击', defenseMin: 3,
    rollDice: 8, countCap: 3,
    skills: [
      { id: 'z02-0', name: '回合开始', slots: null, effect: '投掷 8 个驱动骰。' },
      { id: 'z02-1', name: '锋芒', marker: '∞', slots: null, passive: true, alwaysOn: 'count', effect: '「永暗之刃」的攻击伤害 +X。X 为「永暗之刃」叠加的计数。' },
      { id: 'z02-2', name: '葬敌的完杀', slots: [{ kind: 'pips', count: 1, faces: [1] }, { kind: 'pips', count: 1, faces: [2] }, { kind: 'pips', count: 1, faces: [3] }, { kind: 'pips', count: 1, faces: [4] }], effect: '尽可能弃置挑战者的防御骰，直至数量降为 1。获得 1、2、3、4 点的攻击骰各 1 个。' },
      { id: 'z02-3', name: '暗夜凶神', slots: [{ kind: 'pips', count: 1, faces: [1] }, { kind: 'pips', count: 1, faces: [4] }, { kind: 'pips', count: 1, faces: [6] }], effect: '进行一次点数视为 8 点的不可抵挡的攻击，并弃置挑战者的 1 个防御骰。然后「永暗之刃」的计数 +1（最高叠加至 3 层）。' },
      { id: 'z02-4', name: '枭首', slots: [{ kind: 'pips', count: 1, faces: [6] }], effect: '将本技能上的驱动骰全部移动至攻击骰区。如果攻击骰的数量超过了挑战者的防御骰数量，则使用所有攻击骰发起攻击。' },
      { id: 'z02-5', name: '遁入暗影', slots: [{ kind: 'same', count: 2 }], maxSameGroups: 2, effect: '将本技能上的驱动骰全部移动至防御骰区。每移动 1 组，进行 1 次 2 点攻击。' },
    ],
  },
  {
    id: 'Z03', legacy: '孤塔之王', artifacts: ['007', '008', '009'],
    life: 70, defenseRule: '只会抵挡伤害 ≥ 2 的攻击', defenseMin: 2, rollDice: 6,
    // 防御骰上限：无（不填 defenseCap → 不截断）
    skills: [
      { id: 'z03-0', name: '回合开始', slots: null, effect: '投掷 6 个驱动骰。' },
      { id: 'z03-1', name: '统御战场', marker: '∞', slots: null, effect: '将挑战者的所有攻击骰点数变更为 1 点，并保留在原本的区域。' },
      { id: 'z03-2', name: '震荡斩击', slots: [{ kind: 'same', count: 3 }], effect: '弃置挑战者能力骰数量最多的区域中的 4 个能力骰。如果弃置的数量不足 4 个，进行 1 次 5 点的攻击。' },
      {
        id: 'z03-3', name: '战争横扫',
        slots: [{ kind: 'pips', count: 1, faces: [1, 2] }, { kind: 'pips', count: 1, faces: [3, 4] }, { kind: 'pips', count: 1, faces: [5, 6] }],
        effect: '弃置挑战者每种类型的能力骰各 1 个。每有一种未能成功弃置的能力骰，便进行 1 次 5 点的攻击。',
      },
      { id: 'z03-4', name: '战车', marker: '∞', slots: null, effect: '进行 1 次 5 点的攻击。如果攻击骰区有攻击骰，也使用所有攻击骰进行攻击。补充随机点数的防御骰，直至防御骰的数量为 4。每补充 1 个防御骰，「孤塔之王」受到 2 点真实伤害。' },
      { id: 'z03-5', name: '拔城', marker: '∞', slots: null, effect: '如果本回合「孤塔之王」既没有发动「震荡斩击」，也没有发动「战争横扫」：弃置挑战者的全部能力骰，并进行 2 次 5 点的攻击。' },
    ],
  },
  {
    id: 'Z04', legacy: '地狱的魔女', artifacts: ['010', '011', '012'],
    life: 40, defenseRule: '只会抵挡伤害 ≥ 5 的攻击', defenseMin: 5, rollDice: 10,
    // 防御骰上限：无（不填 defenseCap → 不截断）
    skills: [
      { id: 'z04-0', name: '回合开始', slots: null, effect: '投掷 10 个驱动骰。' },
      { id: 'z04-1', name: '真实之剑', marker: '∞', slots: null, effect: '如果「地狱的魔女」的防御骰数量超过 10 个，将其全部视为攻击骰发起攻击。' },
      { id: 'z04-2', name: '梦醒时分', marker: '怜悯*', slots: [{ kind: 'same', count: 4 }], effect: '将挑战者的计数和充能全部重设为 0，将「地狱的魔女」的生命回复至 40 点。' },
      { id: 'z04-3', name: '顿悟', marker: '怜悯*', slots: [{ kind: 'straight', count: 4 }], effect: '将「地狱的魔女」的所有区域中的能力骰数量翻倍，随机投掷新获得的能力骰。' },
      { id: 'z04-4', name: '无上剑术', marker: '∞', slots: null, effect: '将剩余驱动骰中所有最高点数的驱动骰移动至攻击骰区。如果攻击骰的数量超过了挑战者的防御骰数量，则使用所有攻击骰发起攻击。' },
      { id: 'z04-5', name: '灵能屏障', marker: '∞', slots: null, effect: '将剩余驱动骰中数量最多的点数的驱动骰移动至防御骰区。' },
    ],
  },
  {
    id: 'Z05', legacy: '轰鸣审判官', artifacts: ['013', '014', '015'],
    life: 50, defenseCap: 4, defenseRule: '只会抵挡伤害 ≥ 3 的攻击', defenseMin: 3, rollDice: 8,
    rollDiceBonusOnDamage: 2, attackBonusPer10MissingLife: 1,
    skills: [
      { id: 'z05-0', name: '回合开始', slots: null, effect: '投掷 8 个驱动骰。' },
      // 纯被动：+2 驱动骰在投骰时处理；"每低 10 点 +1 伤害"走 attackDamageBonus → 不占逐条结算的步
      { id: 'z05-1', name: '绝境天神', marker: '∞', slots: null, passive: true, alwaysOn: 'lifeBonus', effect: '如果「轰鸣审判官」在上个挑战者的回合受到过伤害，额外投掷 2 个驱动骰。「轰鸣审判官」的当前生命每比初始生命低 10 点，其攻击伤害 +1。' },
      { id: 'z05-2', name: '不可饶恕', marker: '∞', slots: null, effect: '弃置挑战者的所有 X 点能力骰，X 为本回合投掷的驱动骰中数量最多的点数。' },
      {
        id: 'z05-3', name: '数罪并罚', perGroup: true,
        slots: [
          { kind: 'exact', count: 2, faces: [1, 1] },
          { kind: 'exact', count: 2, faces: [1, 6] },
          { kind: 'exact', count: 2, faces: [6, 6] },
        ],
        effect: '每投掷出 1 组：进行 2 次 6 点的攻击，「轰鸣审判官」受到 3 点真实伤害。',
      },
      {
        id: 'z05-4', name: '电刑', perGroup: true,
        slots: [
          { kind: 'pips', count: 2, faces: [3, 4] },
          { kind: 'pips', count: 2, faces: [3, 4] },
        ],
        effect: '每投掷出 1 组：以 1、2、6 点依次进行 1 次攻击。如果攻击骰区有攻击骰，也使用所有攻击骰发起攻击。',
      },
      { id: 'z05-5', name: '净化', slots: [{ kind: 'pips', count: 2, faces: [2, 5] }], effect: '将本技能上的驱动骰全部移动至防御骰区。' },
    ],
  },
  {
    id: 'Z06', legacy: '漆黑死神', artifacts: ['016', '017', '018'],
    life: 45, defenseCap: 4, defenseRule: '只会抵挡伤害 ≥ 3 的攻击', defenseMin: 3, rollDice: 6,
    token: true,
    skills: [
      { id: 'z06-0', name: '回合开始', slots: null, effect: '投掷 6 个驱动骰。' },
      { id: 'z06-1', name: '无光领域', marker: '∞', slots: null, passive: true, effect: '战斗开始时，将 1 枚正面为黑色、反面为白色的指示物放在「无光领域」上。「漆黑死神」的行动由该指示物的颜色决定。其回合结束时，将该指示物翻面。' },
      { id: 'z06-2', name: '虚无形态·黑', color: 'black', slotChoice: true, slots: [{ kind: 'same', count: 3 }], effect: '「漆黑死神」受到 10 点真实伤害。进行 5 次 5 点的攻击。' },
      { id: 'z06-3', name: '勾魂镰·黑', color: 'black', slotChoice: true, slots: [{ kind: 'same', count: 2 }], effect: '本回合中，「漆黑死神」的攻击伤害 +2。将本技能上的驱动骰全部移动至防御骰区。将其余所有驱动骰移动至攻击骰区，并使用所有攻击骰进行攻击。' },
      { id: 'z06-4', name: '冥界行走·白', color: 'white', marker: '∞', slots: null, effect: '本回合中，每当「漆黑死神」的攻击造成伤害，「漆黑死神」回复该攻击点数一半的生命（向上取整）。' },
      { id: 'z06-5', name: '圆舞·白', color: 'white', slotChoice: true, slots: [{ kind: 'same', count: 2 }], effect: '将本技能上的驱动骰全部移动至防御骰区。将其余所有驱动骰移动至攻击骰区，并使用所有攻击骰进行攻击。' },
      { id: 'z06-x', name: '死即新生', unordered: true, slots: null, effect: '「漆黑死神」死亡时，立即获得点数为 1、2、3、4、5、6 的攻击骰各 1 个，并将生命重设为 13。本技能整局游戏最多生效 1 次。' },
    ],
  },
  {
    id: 'Z07', legacy: '荒野行者', artifacts: ['019', '020', '021'],
    life: 50, defenseCap: 3, defenseRule: '只会抵挡伤害 ≥ 3 的攻击', defenseMin: 3, rollDice: 4,
    countCap: Infinity,
    skills: [
      { id: 'z07-0', name: '回合开始', slots: null, effect: '投掷 4 个驱动骰。' },
      { id: 'z07-1', name: '燎原之火', marker: '∞', slots: null, effect: '「荒野行者」的计数 +1，然后回复等同于计数的生命。额外投掷等同于「荒野行者」计数的驱动骰。' },
      { id: 'z07-2', name: '不屈咆哮', marker: '怜悯*', slotChoice: true, slots: [{ kind: 'straight', count: 3 }], effect: '弃置挑战者等同于「荒野行者」计数的防御骰。' },
      { id: 'z07-3', name: '兽魂', marker: '∞', slots: null, effect: '如果剩余的驱动骰点数中：奇数点数的数量超过或等于偶数的数量，则进行 2 次 3 点的攻击；偶数点数的数量超过奇数的数量，则本回合中「荒野行者」的攻击伤害 +2。' },
      { id: 'z07-4', name: '蛮王之牙', repeat: true, slots: [{ kind: 'same', count: 2 }], effect: '弃置挑战者 3 个防御骰。若挑战者的防御骰数量不足 3 个，每少弃置 1 个防御骰，便进行 1 次 3 点的攻击。之后，清空本技能上的驱动骰，如有可能则再次发动本技能。' },
      { id: 'z07-5', name: '尘起', marker: '∞', slots: null, effect: '将剩余驱动骰全部移动至防御骰区。如果攻击骰区有攻击骰，也使用所有攻击骰发起攻击。' },
      { id: 'z07-x', name: '围攻', unordered: true, slots: null, effect: '当挑战者将要通过 6 点的攻击骰造成伤害，且「荒野行者」有计数时，取消该伤害，「荒野行者」的计数 -1。' },
    ],
  },
  {
    id: 'Z08', legacy: '黑枪', artifacts: ['022', '023', '024'],
    life: 50, defenseCap: 4, defenseRule: '只会抵挡伤害 ≥ 3 的攻击', defenseMin: 3, rollDice: 8,
    skills: [
      { id: 'z08-0', name: '回合开始', slots: null, effect: '投掷 8 个驱动骰。' },
      { id: 'z08-1', name: '填弹', marker: '∞', slots: null, effect: '将点数最高的 1 个驱动骰移动至「黑枪」的攻击骰区。' },
      {
        id: 'z08-2', name: '凶弹业舞', slotChoice: true, slots: [{ kind: 'straight', count: 4 }],
        effect: '将挑战者的所有防御骰移动至「黑枪」的攻击骰区。将挑战者的所有攻击骰移动至「黑枪」的防御骰区。',
      },
      {
        id: 'z08-3', name: '共振', slotChoice: true, slots: [{ kind: 'pips', count: 2, faces: [2, 5] }],
        effect: '如果挑战者的能力骰数量大于或等于 4：「黑枪」和挑战者各自获得 2 个随机点数的攻击骰。否则：「黑枪」和挑战者各自弃置 2 个防御骰。',
      },
      {
        id: 'z08-4', name: '处刑通牒', slotChoice: true, slots: [{ kind: 'same', count: 2 }],
        effect: '如果攻击骰的数量超过了挑战者的防御骰数量，则本回合中「黑枪」的攻击伤害 +5。否则，本回合中「黑枪」的攻击伤害 +1 且不可抵挡。使用所有攻击骰发起攻击。',
      },
      {
        id: 'z08-5', name: '蛇蝎之泪', slots: [{ kind: 'pips', count: 0, faces: [3, 4], unlimited: true }],
        effect: '将本技能上的驱动骰全部移动至防御骰区。',
      },
    ],
  },
  {
    id: 'Z09', legacy: '天殇的战鬼', artifacts: ['025', '026', '027'],
    life: 50, defenseMin: 2, defenseRule: '只会抵挡伤害 ≥ 2 的攻击', rollDice: 7,
    damageCapPerHit: 4, // 威压：挑战者每次攻击对传奇最多造成 4 伤害
    // 防御骰上限：无（不填 defenseCap → 不截断）
    skills: [
      { id: 'z09-0', name: '回合开始', slots: null, effect: '投掷 7 个驱动骰。' },
      { id: 'z09-1', name: '陷阵', marker: '∞', slots: null, effect: '重新投掷 1 个由挑战者选择的任意驱动骰。' },
      {
        id: 'z09-2', name: '战鬼的残杀', marker: '怜悯*', slotChoice: true, slots: [{ kind: 'straight', count: 4 }],
        effect: '将本技能上的驱动骰全部移动至攻击骰区，并使用所有能力骰进行攻击。',
      },
      { id: 'z09-3', name: '奇袭', slotChoice: true, slots: [{ kind: 'straight', count: 3 }], effect: '将本技能上的驱动骰全部移动至攻击骰区。' },
      {
        id: 'z09-4', name: '凛冽之音', slotChoice: true, slots: [{ kind: 'same', count: 2 }],
        effect: '「天殇的战鬼」补充防御骰，直至防御骰区中存在所有的点数。',
      },
      {
        id: 'z09-5', name: '横贯', slots: [{ kind: 'pips', count: 0, faces: [3, 5], unlimited: true }],
        effect: '将本技能上的驱动骰全部移动至攻击骰区，并使用所有攻击骰进行攻击。挑战者每进行 1 次抵挡后，必须弃置自己的 1 个任意能力骰。',
      },
      { id: 'z09-x', name: '威压', unordered: true, slots: null, alwaysOn: true, effect: '挑战者的每次攻击最多对「天殇的战鬼」造成 4 点伤害。' },
    ],
  },
  {
    id: 'Z10', legacy: '破晓之剑', artifacts: ['028', '029', '030'],
    life: 45, defenseMin: 3, defenseCap: 4, defenseRule: '只会抵挡伤害 ≥ 3 的攻击', rollDice: 6,
    skills: [
      { id: 'z10-0', name: '回合开始', slots: null, effect: '投掷 6 个驱动骰。' },
      { id: 'z10-1', name: '迟来的正义', marker: '∞', slots: null, passive: true, alwaysOn: 'lowLife', effect: '当「破晓之剑」或挑战者的生命少于 10 点时，「破晓之剑」的攻击伤害翻倍。' },
      {
        id: 'z10-2', name: '白昼之火', slotChoice: true, slots: [{ kind: 'same', count: 3 }],
        effect: '挑战者改为只能使用冥想骰来抵挡下述的 3 次攻击。进行 3 次 6 点的攻击。获得 2 个随机点数的防御骰。',
      },
      {
        id: 'z10-3', name: '陨落', slotChoice: true, slots: [{ kind: 'straight', count: 3 }],
        effect: '挑战者改为只能使用攻击骰来抵挡下述的 3 次攻击。进行 3 次 6 点的攻击。获得 2 个随机点数的防御骰。',
      },
      {
        id: 'z10-4', name: '涤罪大剑术', slotChoice: true, slots: [{ kind: 'same', count: 2 }],
        effect: '「破晓之剑」回复 10 点生命。进行 3 次 4 点的攻击。获得 2 个随机点数的防御骰。如果攻击骰区有攻击骰，也使用所有攻击骰发起攻击。',
      },
      {
        id: 'z10-5', name: '救赎', slots: [{ kind: 'same', count: 2 }],
        effect: '再次开始 1 个「破晓之剑」的回合。在这个新的回合中，「破晓之剑」的驱动骰改为 5 个，并且攻击伤害 +1。',
      },
    ],
  },
  {
    id: 'Z11', legacy: '受缚邪灵', artifacts: ['031', '032', '033'],
    life: 40, defenseMin: 2, defenseRule: '只会抵挡伤害 ≥ 2 的攻击', countCap: 7, rollDice: 6,
    skills: [
      { id: 'z11-0', name: '回合开始', slots: null, effect: '投掷 6 个驱动骰。' },
      { id: 'z11-1', name: '低语', marker: '∞', slots: null, effect: '将所有的点数不为 5 和 6 的驱动骰重新投掷 1 次。' },
      { id: 'z11-2', name: '死亡亦逝', marker: '∞', slots: null, effect: '挑战者下降生命，直至生命的个位数为 0。「受缚邪灵」尽可能地回复生命，直至生命的个位数为 0。' },
      {
        id: 'z11-3', name: '清算', marker: '怜悯*', slotChoice: true, slots: [{ kind: 'distinct', count: 4 }],
        effect: '挑战者弃置 X 个能力骰，若挑战者的能力骰数量不足 X 个，每少弃置 1 个能力骰，便对挑战者造成 3 点真实伤害。然后「受缚邪灵」的计数下降 1 点。X 为「受缚邪灵」叠加的计数。',
      },
      {
        id: 'z11-4', name: '血祭', slots: [{ kind: 'pips', count: 0, faces: [5, 6], unlimited: true }],
        effect: '将本技能上的驱动骰全部移动至攻击骰区，并使用所有攻击骰进行攻击。每次攻击后，「受缚邪灵」的计数 +1（最高叠加至 7 层）。每当攻击造成伤害后，「受缚邪灵」受到 X 点真实伤害。X 为「受缚邪灵」叠加的计数。',
      },
      { id: 'z11-5', name: '永恒女王', marker: '∞', slots: null, effect: '补充随机点数的防御骰，直至防御骰的数量为 3。' },
    ],
  },
  {
    id: 'Z12', legacy: '渡世行僧', artifacts: ['034', '035', '036'],
    life: 50, defenseMin: 3, defenseRule: '只会抵挡伤害 ≥ 3 的攻击', rollDice: 8,
    skills: [
      { id: 'z12-0', name: '回合开始', slots: null, effect: '投掷 8 个驱动骰。' },
      { id: 'z12-1', name: '不动菩提', marker: '∞', slots: null, alwaysOn: true, effect: '直到「渡世行僧」的下个回合开始前，挑战者无法使用、消耗、或弃置 X 点的能力骰。X 为本回合投掷的驱动骰中，数量最多的点数。' },
      {
        id: 'z12-2', name: '万象俱灭', marker: '怜悯*', slots: [{ kind: 'straight', count: 6 }],
        effect: '弃置挑战者的全部能力骰。造成等同于弃置能力骰点数总和的真实伤害。',
      },
      {
        id: 'z12-3', name: '超度', slotChoice: true,
        slots: [{ kind: 'pips', count: 1, faces: [1, 2] }, { kind: 'pips', count: 1, faces: [3, 4] }, { kind: 'pips', count: 1, faces: [5, 6] }],
        effect: '将挑战者能力骰数量最多的区域中的全部能力骰重掷，并根据新的点数，将其移动至挑战者对应点数的区域。造成 5 点真实伤害。',
      },
      {
        id: 'z12-4', name: '破障', slotChoice: true,
        slots: [{ kind: 'pips', count: 1, faces: [1, 2] }, { kind: 'pips', count: 1, faces: [3, 4] }, { kind: 'pips', count: 1, faces: [5, 6] }],
        effect: '进行 5 次 4 点的攻击。如果攻击骰区有攻击骰，也使用所有攻击骰发起攻击。',
      },
      { id: 'z12-5', name: '万丈明光', slots: [{ kind: 'same', count: 2 }], effect: '补充随机点数的防御骰，直至防御骰的数量为 3。「渡世行僧」回复 3 点生命。' },
    ],
  },
];

/** 把挑战技能的槽转换成显示文本（**自造记法，求短**；与结构化数据一一对应）。 */
export function slotPhrase(slots: ChallengeSlot[] | null, perGroup = false): string {
  if (!slots || slots.length === 0) return '（必检）';
  const single = slots.length === 1 ? slots[0] : null;
  if (single?.unlimited) {
    const faces = (single.faces ?? []).join('/');
    return `（满足任意颗${faces}点时发动）`;
  }
  if (single && single.kind === 'exact') {
    return `（满足 ${(single.faces ?? []).join('＋')} 点时发动）`;
  }
  if (single && single.kind === 'pips') {
    const faces = (single.faces ?? []).join('/');
    return single.count === 1 ? `（满足${faces}点时发动）` : `（满足${single.count}颗${faces}点时发动）`;
  }
  if (slots.every((s) => s.kind === 'exact')) {
    const parts = slots.map((s) => (s.faces ?? []).join('＋')).join('、');
    return `（满足 ${parts} 中任一组时发动）`;
  }
  if (slots.every((s) => s.kind === 'pips')) {
    if (slots.every((s) => s.count === 1)) {
      // 每格都是**单点** → 合并（如 1、2、3、4）；**存在多点的格** → 逐格渲染、**不平铺**（如 1/2点、3/4点、5/6点）
      const allSingle = slots.every((s) => (s.faces ?? []).length === 1);
      if (allSingle) {
        const faces = slots.flatMap((s) => s.faces ?? []);
        return `（满足${faces.join('、')}点时发动）`;
      }
      const parts = slots.map((s) => `${(s.faces ?? []).join('/')}点`).join('、');
      return `（满足${parts}时发动）`;
    }
    if (perGroup) {
      const part = `${slots[0].count}颗${(slots[0].faces ?? []).join('/')}`;
      return `（每满足 1 组（${part}）时发动，最多 ${slots.length} 组）`;
    }
    const parts = slots.map((s) => `${s.count}颗${(s.faces ?? []).join('/')}`).join('＋');
    return `（满足${parts}点时发动）`;
  }
  const s = slots[0];
  if (s.kind === 'same') return `（满足${s.count}颗同点时发动）`;
  if (s.kind === 'any') return `（满足${s.count}颗任意点时发动）`;
  if (s.kind === 'straight') return `（满足${s.count}颗顺点时发动）`;
  if (s.kind === 'distinct') return `（满足${s.count}颗不相同的点数时发动）`;
  return '（必检）';
}

/** 挑战模式「规则调整（技能削弱）」单条。**浮窗与引擎共用这一份**，禁止另写文案。 */
export interface ChallengeRuleNote {
  id: string;
  /** 浮窗显示名（**不带神器编号**，如「鸣雷·雷暴（持续）」） */
  title: string;
  /** 一句话说明（照 FAQ 结论写，别自己发挥） */
  text: string;
  /**
   * 本模式下**整条失效**的神器技能 key（引擎只读它）。
   * 不填＝该条不是"整条失效"，而是"改结算口径"（如 023 跳过给传奇的冥想骰、020 改由挑战者决定）。
   */
  inertSkills?: string[];
}

/** 出处：`尘起时刻FAQ_v2.6文本.md`（13.2.5 / 17.1.5 / 28.1.2 / 20.1.4 / 23.2.3 / 26? / 27.1.2 / 33.1.x）。
 *  **标题格式**：`神器·技能名（类型）`；异相条目写作 `神器「异相」·技能名`（兽魂不写技能名）。
 *  顺序＝按神器编号（013→033），战术牌排在最后。 */
/**
 * 挑战模式「结算模式」说明（**唯一来源**）：选择界面的三个药丸 + 战斗界面徽标的悬浮/点击小弹框都用这里。
 *  · favor ＝规则书标准（自动选对玩家有利）
 *  · against ＝自虐（自动选对玩家不利，可能无法战胜）
 *  · manual ＝自选（逐项手动，精确掌控）
 */
export const SETTLE_MODE_TEXT: Record<'favor' | 'against' | 'manual', string> = {
  favor: '替昔日传奇做的决定，都会自动选择对玩家有利——标准规则',
  against: '替昔日传奇做的决定，都会自动选择对玩家不利——可能出现无法战胜局面',
  manual: '替昔日传奇做的决定，都由玩家手动选择——可精确掌控每个结算步骤',
};

export const CHALLENGE_RULE_NOTES: ChallengeRuleNote[] = [
  {
    id: 'leibao',
    title: '鸣雷·雷暴（持续）',
    text: '单人挑战中没有任何效果——「昔日传奇」没有重掷阶段。',
    inertSkills: ['minglei.leibao.continuous'],
  },
  {
    id: 'weimu',
    title: '幽冥·帷幕（触发）',
    text: '单人挑战中没有任何效果——「昔日传奇」没有重掷阶段。',
    inertSkills: ['youming.weimu'],
  },
  {
    id: 'shouhun',
    title: '兽魂',
    text: '「扣减你的计数」这类选择，由挑战者决定。',
  },
  {
    id: 'shexie-gongzhen',
    title: '蛇蝎·共振（启动）',
    text: '选「双方各获得冥想骰」时，跳过给「昔日传奇」的那份；你照常获得。',
  },
  {
    id: 'shexie-weiju',
    title: '蛇蝎·畏惧（启动）',
    text: '需要对手选择使用/消耗/弃置骰子的这类选择，由挑战者决定。',
  },
  {
    id: 'kuangwu-ultimate',
    title: '狂舞·凶弹业舞（必杀）',
    text: '只按 5 个区域结算（跳过「昔日传奇」没有的冥想骰区）：我冥想→我攻击→我防御→对方攻击→对方防御。',
  },
  {
    id: 'aige-xianzhen',
    title: '哀歌·陷阵（持续）',
    text: '需要对手选择使用/消耗/弃置骰子的这类选择，由挑战者决定。',
  },
  {
    id: 'hanguang-linglie',
    title: '寒光·凛冽之音（充能）',
    text: '单人挑战中无法作用于「昔日传奇」——它没有重掷阶段，本技能只在你自己重掷能力骰时结算。',
  },
  {
    id: 'tianfa-bairi',
    title: '天罚·白昼之火（激活）',
    text: '单人挑战中没有任何效果——但依然可以激活。用于降低「天罚」对「昔日传奇」的压制。',
    inertSkills: ['tianfa.bairi'],
  },
  {
    id: 'tianfa-alt-shenkong',
    title: '天罚「异相」·深空之火',
    text: '单人挑战中没有任何效果——但依然可以激活。用于降低「天罚」对「昔日传奇」的压制。',
    inertSkills: ['tianfa.alt.shenkong'],
  },
  {
    id: 'diaoling-siwang',
    title: '凋零·死亡亦逝（持续）',
    text: '轮到「昔日传奇」的回合结束时，由挑战者决定选择一项执行，但不允许故意多弃骰子。',
  },
  {
    id: 'xianji',
    title: '先机（战术牌）',
    text: '本模式下「定先手」没有任何效果（挑战永远从「昔日传奇」的回合开始）。',
  },
];

/** 本模式下**整条失效**的神器技能 key 集合——引擎只读这里（唯一来源）。 */
export function challengeInertSkills(): Set<string> {
  return new Set(CHALLENGE_RULE_NOTES.flatMap((n) => n.inertSkills ?? []));
}

/**
 * 挑战模式「调整」徽标要标的**神器 id**（选择界面 + 战斗界面共用这一份；名单可增删）。
 * 覆盖 `CHALLENGE_RULE_NOTES` 里涉及的神器：013 鸣雷 / 017 幽冥 / 020 兽魂 / 023 蛇蝎 /
 * 024 狂舞 / 026 哀歌 / 027 寒光 / 028 天罚 / A05 天罚「异相」 / 033 凋零。
 * ⚠️ **不含 A04（兽魂「异相」）**：020 的判定人是「攻击方」（挑战下永远是昔日 → 由挑战者代决＝属调整），
 *    而 A04 的判定人是「持有者」（＝挑战者自己，永远自选）→ **不属调整**（`combat.ts` 的 `shouhunInfo`）。
 */
export const ADJUSTED_ARTIFACTS: string[] = ['013', '017', '020', '023', '024', '026', '027', '028', 'A05', '033'];

/** 挑战模式「调整」徽标要标的**战术牌 id**（当前仅 T02「先机」）。 */
export const ADJUSTED_TACTICS: string[] = ['T02'];

/**
 * 挑战模式下**效果失效**的战斗牌（战术牌）key 集合——**生命修正不受影响，照吃**。
 * 当前仅 **T02「先机」**（`xianji`）：它的"定先手"会与"挑战永远从**传奇(B)**回合开始"冲突 → 挑战下只废"定先手"。
 * （用户裁定 2026-10-13：类似神器在挑战下的削弱，除生命外其余效果无效。）
 */
export function challengeInertTactics(): Set<string> {
  return new Set(['xianji']);
}
