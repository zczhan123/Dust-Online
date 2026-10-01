/**
 * 战斗牌（战术牌）· 内容数据。
 *
 * 规则（说明书 page_12「战术模组」）：
 * - 获得时机：**选取神器之后、投掷初始能力骰之前**；预设/轮选**抽 2 留 1**，构筑（含单人挑战）**直接自选 1 张**。
 * - 字段：①名字 ②战斗开始时初始生命修正 ③效果 ④编号。效果**无需激活，选取即产生效果**。
 * - 「战斗开始时」＝已完成神器选取、还没投掷初始能力骰时；此时结算（如初始生命修正，会**同时改变生命上限**）。
 *
 * 生命修正结算（用户裁定）：**先处理所有「+生命」取最大 → 再对所有「−生命」取最大**（同时改生命上限）。
 *
 * ⚠️ 转写进度（2026-10-02）：**T01–T18 全部已转写**。
 */
export interface TacticDef {
  id: string; // 'T01'
  /** 卡面编号（如 'Z-001'） */
  number: string;
  name: string;
  /** 战斗开始时**初始生命修正**（可多条；带方向）：`self`＝提高自己 / `opp`＝降低对方；`[]`＝无 */
  lifeMods: { who: 'self' | 'opp'; amount: number }[];
  /** 已实现的行为 key（未实现＝undefined） */
  key?:
    | 'qingzhen'
    | 'xianji'
    | 'wanqiang'
    | 'molu'
    | 'kuangre'
    | 'canren'
    | 'baoshou'
    | 'wuqing'
    | 'cibei'
    | 'yuhui'
    | 'miyan'
    | 'jijin'
    | 'yuanjian'
    | 'fuhuo'
    | 'yingzi'
    | 'qianfu'
    | 'youdi'
    | 'shipei';
  /**
   * L04「我将在下个梦境与你再度相逢」重开时，本牌是否**重新触发**。
   *
   * 规则（2026-10-01 用户定）：L04 重开＝从说明书第 4 页「游戏流程」的
   * **「获得初始能力骰子」步骤**重新开始；故按本牌**触发时点**判断：
   * - 触发时点在该步骤或之后（如 T01「当**你投掷**初始能力骰子」）→ `true`，重开时重跑；
   * - 触发时点早于该步骤（如 T02「当**你获得**本战术后」）→ 不设（`false`），重开不再触发；
   * - 各牌对**生命/生命上限**的修正属第 3 页初始设置 → 重开**一律不影响**（与 `reOnReset` 无关）。
   *
   * 注意：只有"战前交互类"（会产生待决策的）战术牌才用得上本字段；T03–T06 无战前交互，无需设置。
   */
  reOnReset?: boolean;
  /**
   * 效果在**开局设置阶段**就已结算完毕（一次性）：如 T01/T02 的战前交互、T03 的初始生命修正。
   * 这类牌进入战斗后**永远显示为"已生效"灰色**（效果不会再有）；L04 重开照旧为灰（T01 重跑后仍为灰）。
   * 仅"战斗中生效/触发"的牌（T04/T05/T06）不设。
   */
  setupOnly?: boolean;
  /** 效果文本（未转写时为空串） */
  effectText: string;
}

export const TACTICS: TacticDef[] = [
  {
    id: 'T01',
    number: 'Z-001',
    name: '谨慎',
    lifeMods: [{ who: 'self', amount: 2 }],
    key: 'qingzhen',
    reOnReset: true, // 「当你投掷初始能力骰子」→ 在重开范围内
    setupOnly: true, // 自选初始骰属开局设置，进入战斗后已生效
    effectText:
      '当你投掷初始能力骰时，由你决定你的初始能力骰点数。不能以此法使你的同类型能力骰数量超过 4 个。你没有对初始能力骰的重掷步骤。',
  },
  {
    id: 'T02',
    number: 'Z-002',
    name: '先机',
    lifeMods: [{ who: 'opp', amount: 2 }],
    key: 'xianji',
    setupOnly: true, // 决定先手属开局设置
    effectText: '当你选择本战术卡后，你决定一位玩家成为先手玩家（会改变尘印标记的所有者）。',
  },
  {
    id: 'T03',
    number: 'Z-003',
    name: '顽强',
    lifeMods: [{ who: 'self', amount: 6 }],
    key: 'wanqiang',
    setupOnly: true, // 初始生命修正属开局设置
    effectText: '',
  },
  {
    id: 'T04',
    number: 'Z-004',
    name: '末路',
    lifeMods: [],
    key: 'molu',
    effectText:
      '你启动「必杀式」技能后，造成等同于你的第三列神器充能需求的真实伤害，回复等同于你的第三列神器充能需求的生命。',
  },
  {
    id: 'T05',
    number: 'Z-005',
    name: '狂热',
    lifeMods: [],
    key: 'kuangre',
    effectText: '在你的前 3 个回合中，你的攻击伤害 +1。',
  },
  {
    id: 'T06',
    number: 'Z-006',
    name: '残忍',
    lifeMods: [],
    key: 'canren',
    effectText: '当对方的生命少于或等于 13 点时，你的攻击伤害 +5。',
  },
  {
    id: 'T07',
    number: 'Z-007',
    name: '保守',
    lifeMods: [],
    key: 'baoshou',
    effectText:
      '从游戏的第一个回合开始，当你的防御骰数量第一次为 0 时，你立即获得 1 个随机点数的防御骰和 1 个随机点数的冥想骰。',
  },
  {
    id: 'T08',
    number: 'Z-008',
    name: '无情',
    lifeMods: [],
    key: 'wuqing',
    effectText: '对方的回合开始时，如果有玩家的生命少于或等于 20 点，对方受到 2 点真实伤害。',
  },
  {
    id: 'T09',
    number: 'Z-009',
    name: '慈悲',
    lifeMods: [{ who: 'self', amount: 3 }],
    key: 'cibei',
    effectText:
      '当你将造成伤害时，你可以取消该伤害，改为使你回复等量的生命。这个效果整局游戏最多使用 1 次。',
  },
  {
    id: 'T10',
    number: 'Z-010',
    name: '迂回',
    lifeMods: [],
    key: 'yuhui',
    effectText:
      '当你第一次切换神器的技能后，你立即获得 2 个 1 点的能力骰，并放置在你的任意区域。本战术对具有“激活式”技能的神器无效。',
  },
  {
    id: 'T11',
    number: 'Z-011',
    name: '迷烟',
    lifeMods: [
      { who: 'self', amount: 3 },
      { who: 'opp', amount: 3 },
    ],
    key: 'miyan',
    effectText: '你在自己的第一个回合仍具有重掷阶段。',
  },
  {
    id: 'T12',
    number: 'Z-012',
    name: '激进',
    lifeMods: [{ who: 'opp', amount: 2 }],
    key: 'jijin',
    effectText:
      '你在自己的第一个尘起阶段中，可以对你的第三列神器进行 1 次额外的充能（需要正常使用冥想骰）。',
  },
  {
    id: 'T13',
    number: 'Z-013',
    name: '远见',
    lifeMods: [{ who: 'opp', amount: 2 }],
    key: 'yuanjian',
    effectText:
      '战斗开始时，猜测生命最先降为 20 点或以下的玩家。当有玩家的生命降为 20 点或以下时，如果你猜测正确，你立即获得 1 个任意点数的能力骰，并将其放置在任意区域。',
  },
  {
    id: 'T14',
    number: 'Z-014',
    name: '赴火',
    lifeMods: [{ who: 'opp', amount: 3 }],
    key: 'fuhuo',
    effectText: '当你第一次受到对方造成的伤害时，对其造成等量的真实伤害。',
  },
  {
    id: 'T15',
    number: 'Z-015',
    name: '影子',
    lifeMods: [
      { who: 'self', amount: 1 },
      { who: 'opp', amount: 1 },
    ],
    key: 'yingzi',
    effectText:
      '你的第一个回合开始时，将 1 个任意点数的能力骰从供应堆置于本战术上。当你使用与该能力骰点数相同的能力骰后，立即将该能力骰移动至对应点数的区域。这个效果整局游戏最多使用 1 次。',
  },
  {
    id: 'T16',
    number: 'Z-016',
    name: '潜伏',
    lifeMods: [{ who: 'opp', amount: 2 }],
    key: 'qianfu',
    effectText:
      '在双方各自的第一个回合中，双方均不能进行攻击。在双方各自的第二个回合中，双方的攻击伤害 +1。',
  },
  {
    id: 'T17',
    number: 'Z-017',
    name: '诱敌',
    lifeMods: [{ who: 'opp', amount: 2 }],
    key: 'youdi',
    effectText:
      '当你受到对方造成的伤害后，你可以将自己一个区域中最多 3 个能力骰移动至自己的另一个区域，并保留其原本的点数。这个效果整局游戏最多使用 1 次。',
  },
  {
    id: 'T18',
    number: 'Z-018',
    name: '适应',
    lifeMods: [{ who: 'self', amount: 2 }],
    key: 'shipei',
    effectText:
      '当你将要投掷任意数量的骰子时，你可以决定其中 1 个骰子的点数。这个效果整局游戏最多使用 1 次。',
  },
];

export const TACTIC_BY_ID: Record<string, TacticDef> = Object.fromEntries(TACTICS.map((t) => [t.id, t]));

/** 可抽取 / 可选的战术牌池。**暂只含已转写的牌**（随转写批次扩充，直到 18 张）。 */
export const TACTIC_POOL: string[] = ['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T10', 'T11', 'T12', 'T13', 'T14', 'T15', 'T16', 'T17', 'T18'];

/** 显示用技能文本：**效果文本在前、生命修正句在后**（多条生命修正用「，」连）。
 *  连接规则：效果句末尾的「。」改为「；」，生命修正句以「。」收尾；只有生命修正（无效果句）时原样「……点。」。 */
export function tacticDisplayText(def: TacticDef): string {
  const eff = def.effectText.trim();
  const life = def.lifeMods
    .map((m) => (m.who === 'self' ? `提高你的初始生命${m.amount}点` : `降低对方初始生命${m.amount}点`))
    .join('，');
  if (!life) return eff; // 无生命修正 → 原样
  if (!eff) return `${life}。`; // 只有生命修正 → 原样
  const body = eff.endsWith('。') ? eff.slice(0, -1) : eff;
  return `${body}；${life}。`;
}

/** 战斗牌卡图相对路径（与 `./cards/`、`./legend/` 同口径，上线前随其它路径一起改） */
export const tacticImageUrl = (id: string): string => `./tactics/${id}.jpg`;

export const isTacticId = (id: string): boolean => /^T\d{2}$/.test(id);
