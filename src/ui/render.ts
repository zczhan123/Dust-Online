import type {
  Action,
  Artifact,
  DiceKind,
  Die,
  GameState,
  LegendPanel,
  PendingAttack,
  Phase,
  PlayerId,
  PlayerState,
  SkillDef,
} from '../core/model/types';
import { ARTIFACT_TEXT } from '../core/content/artifactText';
import { isAltArtifact, SPECIAL_ARTIFACT_NOTE } from '../core/content/artifacts';
import { legendImageUrl, LEGENDS } from '../core/content/legends';
import { TACTIC_BY_ID, tacticImageUrl, tacticDisplayText, isTacticId } from '../core/content/tactics';
import { LEGEND_TEXT } from '../core/content/legendText';
import { CHALLENGES, CHALLENGE_RULE_NOTES, slotPhrase, ADJUSTED_ARTIFACTS, ADJUSTED_TACTICS } from '../core/content/challenges';
import { legendAttackBonus, isValueLocked, legendLockValue } from '../core/engine/challenge';
import { LEGEND_DISPLAY_NAME } from '../core/engine/log';
import { getLegalActions, legendSkillReady, quanzhiRemainderHasGroup, tacticBarState } from '../core/engine/game';
import { effectiveSpeed, effectiveWill, rerollAllowance, emptyDistribution } from '../core/engine/derive';
import { areaOf } from '../core/model/dice';
import { hasActiveSkill, skillUseKey } from '../core/engine/skill-state';
import { artifactWithSkill, attackDamageBonus, attackPointNote } from '../core/engine/combat';
import { battleNotes } from '../core/engine/battleNotes';
import { lidichengfoRegions } from '../core/engine/skills';
import { SKILL_SELECTION, hasSword, isDirectCost, type SelectStep } from './skillSelection';
import { DEFAULT_PREFS, applyPreset, clonePrefs, speedOf, type Prefs } from './prefs';
import { MOTION, anyRemoved, areaDiceChanged, areaDieIds, attackHold, attackJoin, attackResolve, attackStart, bumpEl, canAnimate, diceSetChanged, diffLife, drawTrueLine, heldAttackDieId, moveFxDuration, playBanner, playBubble, playGouhun, playLegendConsume, playLegendSpawn, playPayments, playUltimate, releaseHeldAttackDie, removalGroupMs, runBoardMotions, setMotionSpeed, resetMotionRuntime, restoreInFlightHides, setScaleX, snapshotDice, snapshotStored, storedIdsOf, weijuHold, weijuResolve, weijuStart, bubbleDuration, addsDuration, type BubbleOpts, type BubbleVariant, type DiceMoveFx, type LegendConsumeItem, type LifeDelta, type PayDie, type PayInfo, type Rect } from './motion';
import { turnTimerTick } from './turnTimer';
import { showSettleTip, hideSettleTip } from './settleTip';
import { diag, isDiagEnabled, missingDiceInDom, gameSnapshot, staleDice, diagDump, diagClear, diagCount } from './diag';
import { STANDARD_PHASES } from '../core/engine/turnFlow';
import { fxTake, type FxEvent, type FxSource } from '../core/engine/fx';

const AREA_LABEL: Record<DiceKind, string> = {
  attack: '攻击骰区',
  defense: '防御骰区',
  meditation: '冥想骰区',
};

const AREA_ORDER: DiceKind[] = ['defense', 'attack', 'meditation'];
// 敌方区域镜像：为贴合中央战场做上下翻转（与 AREA_ORDER 相反）
const AREA_ORDER_MIRRORED: DiceKind[] = ['meditation', 'attack', 'defense'];

const PHASE_LABEL: Record<Phase, string> = {
  setup: '准备',
  tactics: '战前',
  initialReroll: '初始重掷',
  refill: '补充',
  reroll: '重掷',
  dustRise: '尘起',
  main: '主要',
  end: '结束',
  gameOver: '结束',
};

/** 已显示视角（按 GameState 对象身份）。左右互搏换手时用于"动效播完再瞬间切视角"。 */
const lastView = new WeakMap<GameState, PlayerId>();
/** 上一次渲染的**局面对象引用**（重连/新开局会换对象 → 触发动效运行时重置） */
let lastStateRef: GameState | null = null;

/** 上一次已播"攻击反馈"的待抵挡对象（用于识别"新出现的一次攻击"）。 */
const lastAttack = new WeakMap<GameState, PendingAttack | null>();

/** 上一次的"回合玩家 / 阶段"（用于阶段横幅：换手 / 进尘起 / 进主要）。 */
const lastPhaseSnap = new WeakMap<GameState, { active: PlayerId; phase: GameState['phase'] }>();

/** 最近一帧战斗动效的总时长（含阶段横幅）。`main.ts` 用它给"挑战模式自动推进"配速。 */
let lastFrameMs = 0;

/**
 * 【先动画，再选择】挑战模式：代决面板要等到这个时刻（performance.now）之后才允许显示。
 * 本帧的传奇过场（技能名 + 驱骰进槽）播完前，操作区只显示"发动中…"占位。
 */
let legendPickHoldUntil = 0;

/**
 * 挑战模式「枭首」：这些骰子**已经飞出去攻击** → 每次渲染都**从数据层把它们排除**（直接从攻击骰区 DOM 里去掉），
 * ⚠️ 不能用 CSS `hidden`：元素每帧重建会把 `hidden` 弄丢 → 挑战者一点抵挡它又"复活"（真实事故）。
 * 自清理：只保留"此刻还在攻击骰区里"的 id。
 */
const legendGoneIds = new Set<string>();

/** 排查用：当前隐藏名单快照（供 `main.ts` 的 `state` 日志与测试读取）。 */
export function legendGoneList(): string[] {
  return [...legendGoneIds];
}

/**
 * 挑战模式：把"已飞出去"的骰子从**数据层**去掉（幂等）。**唯一入口**——开飞定时器与"每次渲染"都调它，缺一都会坏：
 *  · 只调定时器（v0.16.6）→ 挑战者一交互重绘，元素重建 → 骰子"复活"；
 *  · 只在渲染里做（v0.16.7）→ 开飞当下到下次重绘之间没人去掉它 → 骰子"停留"。
 * 源骰可能在**攻击骰区**（枭首/裁雨流/无上剑术/战车）或**防御骰区**（真实之剑·甲）→ 两区都要查。
 */
function hideLegendFlownDie(root: HTMLElement, id: string): void {
  legendGoneIds.add(id);
  diag('hide', { id });
  const el = root.querySelector<HTMLElement>(
    `.panel--challenge .area[data-kind="attack"] .die[data-id="${id}"], ` +
      `.panel--challenge .area[data-kind="defense"] .die[data-id="${id}"]`,
  );
  if (el) el.remove();
}

/** 本帧动效总时长（ms）——挑战模式"每步播完再走下一步"用。 */
export function lastFrameDurationMs(): number {
  return lastFrameMs;
}

/** 计数 / 充能 的上一帧值（用于"计数跳动" / "充能进度条生长"）。键＝`玩家:id`。 */
const lastCount = new WeakMap<GameState, Map<string, number>>();
const lastCharge = new WeakMap<GameState, Map<string, number>>();
/** 尘落 的上一帧值（用于「尘落计数跳动」）。 */
const lastDustfall = new WeakMap<GameState, number>();

export interface UiState {
  rerollSelected: Set<string>;
  selection: null | {
    key: string;
    artifactId: string;
    side: 'left' | 'right' | 'only';
    stepIndex: number;
    chosenDice: string[][];
    options: string[];
    currentSel: Set<string>;
    numbers: number[];
    /** 「slots」步骤的已填骰位（每格长度 1=真骰，2=置换） */
    slots: string[][];
    /** 「slots」步骤每格的填充模式 */
    slotModes: ('real' | 'convert')[];
    /** 若是为「待决策」打开的选骰面板（013 电刑/雷暴、017 帷幕、018 重掷、023 共振、025 横贯、026 威压/陷阵），确认时直接派发对应动作 */
    pendingKind?:
      | 'dianxing'
      | 'leibao'
      | 'weimu'
      | 'zhihaiReroll'
      | 'gongzhenPick'
      | 'weiyaPick'
      | 'xianzhenPick'
      | 'hengguan'
      | 'kuyu'
      | 'tiaolingPick'
      | 'endDiscard'
      | 'wanzhangDiscard'
      | 'kongYuluo'
      | 'kongYuluoGain'
      | 'wufaraoshu'
      | 'yuanwu'
      | 'shizushouhun'
      | 'shangjin'
      | 'dizuidaijianshu'
      | 'guwangCancelConvert'
      | 'dunwuHalveConvert'
      | 'weijuPayConvert';
  };
  pendingConfirm: null | { action: Action; label: string };
  /** 尘起 2 步流程：选择（激活时）启动侧 → 支付代价 */
  dustFlow: null | {
    artifactId: string;
    kind: 'activate' | 'switch' | 'charge';
    side?: 'left' | 'right';
    step: 'side' | 'pay';
    /** 019 尘起赠予的免费额外尘起（无需冥想骰，且不占每回合 1 次） */
    free?: boolean;
    /** 「真实之剑」置换：已选中的 2 颗能力骰 */
    convertPick?: string[];
    /** L05 复仇之灵：本流程为**强制额外尘起**（不耗冥想骰/不占次数） */
    fuchou?: boolean;
  };
  /** 攻击/抵挡的「真实之剑」置换：单步选择 2 颗能力骰 */
  convertPick: null | {
    kind: 'attack' | 'block';
    dieIds: string[];
  };
  /** 挑战代决·骰片选择（`challengePick.pick`）：已选骰 id；`Sig` 变化（换了代决）就重置 */
  challengePickSel?: string[];
  challengePickSig?: string;
  /** 锋芒（触发）：选择消耗的 1 颗攻击骰 + 1 颗冥想骰 */
  fengmangPick: null | {
    attackDieId?: string;
    meditationDieId?: string;
  };
  /**
   * 027 寒光·必杀（凛冽之音）的专用面板状态：两步式 —— 先选模式（①作为攻击骰使用 / ②移除并弃置对方同点数骰），
   * 再选神器上的骰（面板内或**卡面骰片**双入口），② 最后选对方的目标骰。
   */
  hanguangPick: null | {
    mode: 'move' | 'discard' | null;
    dieId: string | null;
  };
  /** 029 真言·全知（待决策）：专用分配面板 ——「一组一组手放 + 预览确认」（不再枚举逐颗选项） */
  quanzhi: null | {
    groups: { kind: 'defense' | 'attack'; dieIds: string[] }[];
    /** 当前已勾选、尚未成组的骰 */
    selected: string[];
    /** 是否处于"最终分布预览"步 */
    preview: boolean;
  };
  /** 界面偏好（与对局状态解耦；由宿主负责持久化） */
  prefs: Prefs;
  /** 设置面板是否打开 */
  settingsOpen: boolean;
  /** 挑战模式：是否打开「挑战模式特殊规则」浮窗 */
  challengeRulesOpen?: boolean;
  /** 挑战模式：是否打开「传奇技能详情」浮窗（右键/长按卡图；不再显示整张大图） */
  challengeSkillsOpen?: boolean;
  /** 联机·战斗界面「退出对局」二次确认弹框是否打开 */
  onlineLeaveOpen?: boolean;
  /** 战报抽屉是否打开（战报栏收起时用） */
  logOpen: boolean;
  /** 战报放大弹窗（右键战报栏打开，全量、大空间） */
  logPop: boolean;
  /** 技能详情浮窗（只读）：锚定触发卡片的屏幕矩形 + 所属玩家（双方同名/同 id 神器必须按玩家取件） */
  detail: null | {
    artifactId: string;
    player?: PlayerId;
    rect: { left: number; top: number; width: number; height: number };
  };
  /** UI 层的临时错误提示（非法操作等）——**只属于界面**，绝不写进引擎状态/战报 */
  error: string | null;
}

/** 联机对局时的 UI 上下文（缺省＝左右互搏，一切照旧） */
export interface OnlineUi {
  /** 本机玩家（固定视角 / 输入门禁用）。**旁观者＝null**（不能操作） */
  myPlayer: PlayerId | null;
  /** **旁观者**：全程只读（不能操作/不能发言）；点玩家面板切换视角 */
  spectator?: boolean;
  /** A/B → 昵称 */
  names: Record<PlayerId, string>;
  /** 胜利弹窗「回大厅」 */
  onLeaveLobby: () => void;
  /** 开/关聊天浮层（战斗界面用；由宿主持有 shell） */
  onChat?: () => void;
  /** 未读聊天条数（>0 时「聊天」按钮右上角显示红色药丸） */
  unread?: number;
  /** 对端是否在线（心跳判定）→ 在**对方**生命条名字旁显示状态点（在线绿 / 掉线红） */
  peerOnline?: boolean;
}

export interface RenderHooks {
  onAction: (a: Action) => void;
  /** 提出一个待确认操作；由宿主写入 ui.pendingConfirm 后重绘 */
  propose: (action: Action, label: string) => void;
  ui: UiState;
  requestRender: () => void;
  onRestart: () => void;
  /** 「相同配置快速重开」（**仅左右互搏**；宿主在 `startLocal` 记下配置后提供）。
   *  语义＝**配置相同、骰子全新**（宿主用 `newSeed()` 重建）；联机不提供（两个真人可能各点各的）。 */
  onRestartSame?: () => void;
  /** 偏好变化时回调（宿主负责写入 localStorage） */
  onPrefsChange?: (p: Prefs) => void;
  /** 联机对局的 UI 上下文（**缺省＝左右互搏**；联机的选择/战斗增强一律以它是否存在为条件） */
  online?: OnlineUi;
}

type ActiveSelection = NonNullable<UiState['selection']>;
type DiceStep = Extract<SelectStep, { kind: 'dice' }>;

const oppOf = (p: PlayerId): PlayerId => (p === 'A' ? 'B' : 'A');

/** 名字：联机＝昵称；挑战模式＝「昔日传奇」（B 侧）；否则「玩家A/B」。 */
function playerName(ctx: Ctx, id: PlayerId): string {
  if (ctx.state.mode === 'challenge' && id === 'B') return LEGEND_DISPLAY_NAME;
  return ctx.hooks.online?.names[id] ?? `玩家${id}`;
}

interface Ctx {
  state: GameState;
  legal: Action[];
  hooks: RenderHooks;
  maxReroll: number;
  selectionStep: SelectStep | null;
  selectionOwner: PlayerId | null;
  /** 技能选择器处于「slots」步骤时，区域骰由选择器内部处理，禁用区域骰点击 */
  slotsStepOpen: boolean;
  /** 尘起流程开启时禁用区域骰点击，避免与流程内选骰冲突 */
  dustFlowOpen: boolean;
  /** 当前“可选骰集合已确定”的区域选骰（双入口：骰区与面板骰片共享同一状态） */
  areaPick: {
    owner: PlayerId;
    kinds: DiceKind[];
    isSelected: (id: string) => boolean;
    toggle: (d: Die) => void;
    filter?: (d: Die) => boolean;
    /** Z12「不动菩提」：选骰目的不是使用/消耗/弃置（移动/改点/置换源/分配）→ 不按封锁过滤 */
    ignoreLock?: boolean;
  } | null;
  /** 界面偏好 */
  prefs: Prefs;
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

function button(label: string, action: Action, hooks: RenderHooks, cls = '', direct = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${cls}`.trim();
  b.dataset.act = action.t;
  b.textContent = label;
  // direct＝不弹确认条，点一下直接派发（如"无骰可挡"时的「不抵挡」）
  b.addEventListener('click', () => (direct ? hooks.onAction(action) : hooks.propose(action, label)));
  return b;
}

function findDie(state: GameState, id: string): Die | undefined {
  for (const pid of ['A', 'B'] as PlayerId[]) {
    const p = state.players[pid];
    for (const k of AREA_ORDER) {
      const d = p.areas[k].find((x) => x.id === id);
      if (d) return d;
    }
  }
  // 034 金刚·破障：神器上存放的骰（不在区域）也可被选（kind 由引擎按分布判定）
  for (const pid of ['A', 'B'] as PlayerId[]) {
    for (const a of state.players[pid].artifacts) {
      const h = (a.heldDice ?? []).find((x) => x.id === id);
      if (h) return { id: h.id, value: h.value, kind: 'meditation' };
    }
  }
  return undefined;
}

function dieValue(state: GameState, id: unknown): number | undefined {
  return typeof id === 'string' ? findDie(state, id)?.value : undefined;
}

/** 034 破障：某玩家神器上按分布视为 `kind` 的存放骰（供「使用」类骰区呈现） */
function heldDiceOfKind(state: GameState, player: PlayerId, kind: DiceKind): { id: string; value: number }[] {
  const p = state.players[player];
  if (!hasActiveSkill(p, 'jingang.pozhang.continuous')) return [];
  const dist = p.artifacts.find((x) => x.column === 2)?.distribution;
  if (!dist) return [];
  const out: { id: string; value: number }[] = [];
  for (const a of p.artifacts) {
    for (const h of a.heldDice ?? []) if (areaOf(h.value, dist) === kind) out.push({ id: h.id, value: h.value });
  }
  return out;
}

/** 某 id 是否为「神器上存放的骰」→ 骰片改中性样式、只显示点数 */
function heldDieValue(state: GameState, id: string): number | null {
  for (const pid of ['A', 'B'] as PlayerId[]) {
    for (const a of state.players[pid].artifacts) {
      const h = (a.heldDice ?? []).find((x) => x.id === id);
      if (h) return h.value;
    }
  }
  return null;
}

function diceListLabel(state: GameState, ids: string[]): string {
  return ids.map((id) => dieValue(state, id) ?? '?').join('/');
}

const KIND_NAMES: Record<string, string> = { attack: '攻击', defense: '防御', meditation: '冥想' };

const KIND_SHORT: Record<DiceKind, string> = { attack: '攻', defense: '防', meditation: '冥' };

/** 各技能代价所需骰类型（用于确认条文案；引擎按同样规则构造槽位） */
const COST_KIND_LABEL: Record<string, string> = {
  'buxiang.cuilian': '攻击',
  'yingle.qianxing': '攻击',
  'youlong.tengwan': '冥想',
  'yuqie.breakthrough': '冥想',
  'wansha.ultimate': '攻击',
  'tiebi.fist': '冥想',
  'dunwu.barrier.activate': '防御',
  'dunwu.pulse.activate': '攻击',
};

function kindFromType(type: string): SkillDef['kind'] | undefined {
  if (type.includes('激活')) return 'activation';
  if (type.includes('启动')) return 'activate';
  if (type.includes('必杀')) return 'ultimate';
  if (type.includes('充能')) return 'charge';
  if (type.includes('持续')) return 'continuous';
  if (type.includes('触发')) return 'trigger';
  return undefined;
}

function isActivatableType(type: string): boolean {
  return type.includes('启动') || type.includes('激活') || type.includes('必杀');
}

function findSkillKey(a: Artifact, side: SkillDef['side'], type: string): string | undefined {
  const kind = kindFromType(type);
  if (kind) {
    const def = a.skills.find((s) => s.side === side && s.kind === kind);
    if (def) return def.key;
  }
  return a.skills.find((s) => s.side === side)?.key;
}

function skillLabel(
  a: Artifact | undefined,
  side: 'left' | 'right' | 'only',
  kind: SkillDef['kind'] | undefined,
): string | undefined {
  if (!a || !kind) return undefined;
  const text = ARTIFACT_TEXT[a.id];
  const t = text?.skills.find((s) => s.side === side && kindFromType(s.type) === kind);
  return t?.name;
}

/** 激活侧是否为「激活」类技能、且当前已不可用（用于「已激活·xx」徽标变灰）；或无剩余生效能力 */
function activeSideSpent(ctx: Ctx, a: Artifact): boolean {
  const side = a.activeMarkerSide;
  if (!side) return false;
  // 该神器已无生效能力（持续失效、必杀用尽）→「已激活」徽标同样转灰
  // A07 异相·历王之血之印：本回合临时持续失效 → 徽标同样转灰
  if (a.continuousLost || a.continuousLostThisTurn) return true;
  const skills = ARTIFACT_TEXT[a.id]?.skills;
  const t =
    skills?.find((s) => s.side === side && s.type.includes('激活')) ??
    skills?.find((s) => s.side === 'only' && s.type.includes('激活'));
  if (!t) return false;
  return skillPartState(ctx, a, t) === 'spent';
}

/** 该神器某侧显示名（不区分技能类型），用于名称兜底 */
function sideDisplayName(a: Artifact | undefined, side: 'left' | 'right' | 'only'): string | undefined {
  if (!a) return undefined;
  return ARTIFACT_TEXT[a.id]?.skills.find((s) => s.side === side)?.name;
}

/** 内部 key 形如 `wansha.ultimate`，绝不应出现在界面上 */
function looksLikeInternalKey(s: string): boolean {
  return /^[a-z0-9]+(\.[a-z0-9]+)+$/i.test(s.trim());
}

/** 单条技能行的展示状态：可用(绿) / 未激活(浅灰) / 不能再使用(深灰) / 激活侧但本次已用完(灰底绿边) */
/** 018 至黑：必杀「强制发动」进行中（计数达 5 被引擎强制启动，尚在选择重掷骰） */
function zhihaiForcedFrame(ctx: Ctx, a: Artifact, s: { type: string }): boolean {
  const pd = ctx.state.pending;
  if (!pd || pd.kind !== 'zhihaiReroll' || !pd.forced) return false;
  if (!s.type.includes('必杀')) return false;
  return ctx.state.players[pd.player].artifacts.includes(a);
}

/** 该神器属于哪名玩家（双方可能持有同名神器，故记录键必须带玩家前缀） */
function ownerIdOfArtifact(state: GameState, a: Artifact): PlayerId | undefined {
  return (['A', 'B'] as PlayerId[]).find((id) => state.players[id].artifacts.includes(a));
}

function skillPartState(
  ctx: Ctx,
  a: Artifact,
  s: { side: SkillDef['side']; type: string },
): 'on' | 'off' | 'disabled' | 'spent' {
  const key = findSkillKey(a, s.side, s.type);
  const owner = ownerIdOfArtifact(ctx.state, a);
  const markerOk =
    a.allSidesActiveThisTurn === true ||
    (a.activeMarkerSide != null && (s.side === a.activeMarkerSide || s.side === 'only'));
  // 必杀「强制发动」进行中：该行临时显示为绿色（发动的一瞬间）
  if (zhihaiForcedFrame(ctx, a, s)) return 'on';
  if (key != null && s.type.includes('必杀') && owner != null && ctx.state.ultimatesUsed.includes(skillUseKey(owner, key))) return 'disabled';
  // 「在接下来的游戏中失去持续式效果」（018 必杀用后）／A07「历王之血之印」本回合临时持续失效：该持续技能行转深灰
  if ((a.continuousLost || a.continuousLostThisTurn) && s.type.includes('持续')) return 'disabled';
  if (key === 'buxiang.cuilian' && a.count >= 3) return 'disabled';
  if (a.column === 3 && s.type.includes('充能') && a.chargeLayer >= (a.chargeReq ?? 0)) return 'disabled';
  // L08 传奇面板·没有怜悯：024「狂舞」的必杀在尘落 ≥4 时**无需激活/充能**即可启动 → 该行显示为可用
  if (
    key === 'kuangwu.ultimate' &&
    owner != null &&
    hasActiveSkill(ctx.state.players[owner], 'xiva.meiyoulianmin') &&
    ctx.state.dustfall >= 4
  ) {
    return 'on';
  }
  // 「激活」类：只有被“切入该侧”的当回合、且本回合未用过时才可用；否则为“已用完”（灰底 + 保留绿色左边线）
  if (s.type.includes('激活') && markerOk) {
    const armedNow =
      a.armedTurn === ctx.state.turnIndex && a.armedSide === (s.side === 'only' ? 'left' : s.side);
    const used = key != null && owner != null && ctx.state.skillsUsedThisTurn.includes(skillUseKey(owner, key));
    if (!armedNow || used) return 'spent';
  }
  return markerOk ? 'on' : 'off';
}

type DustRiseAction = Extract<Action, { t: 'dustRise' }>;
type SkillAction = Extract<Action, { t: 'skill' }>;

const DUST_KIND_LABEL: Record<'activate' | 'switch' | 'charge', string> = {
  activate: '激活',
  switch: '切换',
  charge: '充能',
};

function dustFlowKind(a: Artifact): 'activate' | 'switch' | 'charge' {
  if (a.column === 3) return 'charge';
  return a.activeMarkerSide == null ? 'activate' : 'switch';
}

function dustSideSkillName(artifactId: string, side: 'left' | 'right'): string {
  const text = ARTIFACT_TEXT[artifactId];
  return text?.skills.find((s) => s.side === side)?.name ?? (side === 'left' ? '左侧' : '右侧');
}

function dustEntryLabel(a: Artifact, free = false): string {
  if (a.column === 3 && a.chargeLayer >= (a.chargeReq ?? 0)) {
    return `续充「${a.name}」（计数 +1、回复生命）`;
  }
  const base = `${DUST_KIND_LABEL[dustFlowKind(a)]}「${a.name}」`;
  return free ? `${base}（免费）` : base;
}

function skillName(state: GameState, a: SkillAction): string {
  // 「谁在做操作」必须走 actorOf（待决策优先）：非当前玩家的技能动作（如 018 强制必杀）也要能在其自己的卡面上解析到技能名
  const art = state.players[actorOf(state)].artifacts.find((x) => x.id === a.artifactId);
  const skill = art?.skills.find(
    (s) => s.side === a.side && (s.kind === 'activate' || s.kind === 'ultimate'),
  );
  const resolved =
    skillLabel(art, a.side, skill?.kind) ??
    sideDisplayName(art, a.side) ??
    art?.name ??
    '技能';
  return looksLikeInternalKey(resolved) ? (art?.name ?? '技能') : resolved;
}

/**
 * `params.dieId` 的文案**按技能 key 登记**（不得用参数形状猜语义！）
 * 真实事故 2026-09-20：共振 / 畏惧 / 024 充能 都带 `dieId` 参数，被统一套成了影袭的「降低点数」。
 */
function dieIdLabel(
  key: string | undefined,
  params: Record<string, unknown>,
  at: string,
): string {
  switch (key) {
    case 'yingle.yingxi':
      // 005 影掠·影袭（卡面用「下降」）
      return `使 1 颗骰点数下降 ${typeof params.x === 'number' ? params.x : 'X'} 点${at}`;
    case 'shexie.weiju':
      // 023 蛇蝎·畏惧
      return `消耗 1 颗能力骰${at}——随后由对方消耗并比较点数`;
    case 'shexie.gongzhen':
      // 023 蛇蝎·共振
      return `重掷 1 颗骰${at}（按新点数落入对应区域）`;
    case 'kuangwu.charge':
      // 024 狂舞·凶弹业舞（充能）
      return `将 1 颗骰${at}移到该玩家另一区域（保留点数）`;
    default:
      // 兜底：不猜语义（宁可中性）
      return `指定 1 颗骰${at}`;
  }
}

function skillActionLabel(ctx: Ctx, a: SkillAction): string {
  const name = skillName(ctx.state, a);
  const params = a.params ?? {};
  const parts: string[] = [];

  if (Array.isArray(params.costSlots) && params.costSlots.length) {
    const fills = params.costSlots as { dieIds?: string[] }[];
    const converted = fills.filter((f) => (f.dieIds ?? []).length > 1).length;
    const art = ctx.state.players[actorOf(ctx.state)].artifacts.find((x) => x.id === a.artifactId);
    const sk = art?.skills.find((s) => s.side === a.side && (s.kind === 'activate' || s.kind === 'ultimate'));
    const kindName =
      COST_KIND_LABEL[sk?.key ?? ''] ?? (typeof params.kind === 'string' ? KIND_NAMES[params.kind] : undefined);
    // 按“骰位”列出有效点数：真骰 = 其点数；置换 = 5
    const values = fills.map((f) => {
      const ids = f.dieIds ?? [];
      if (ids.length > 1) return '5';
      const v = dieValue(ctx.state, ids[0]);
      return v !== undefined ? String(v) : '?';
    });
    const suffix =
      converted > 0 ? `，其中 ${converted} 颗${kindName ?? ''}骰是用「真实之剑」置换` : '';
    parts.push(`消耗 ${fills.length} 颗${kindName ?? ''}骰（${values.join('/')}点）${suffix}`);
  }
  if (typeof params.attackDieId === 'string') {
    const v = dieValue(ctx.state, params.attackDieId);
    parts.push(v !== undefined ? `消耗 1 颗攻击骰（${v}点）` : '消耗 1 颗攻击骰');
  }
  if (Array.isArray(params.attackDieIds) && params.attackDieIds.length) {
    parts.push(
      `消耗 ${params.attackDieIds.length} 颗攻击骰（${diceListLabel(ctx.state, params.attackDieIds as string[])}点）`,
    );
  }
  if (Array.isArray(params.meditationDieIds) && params.meditationDieIds.length) {
    parts.push(
      `消耗 ${params.meditationDieIds.length} 颗冥想骰（${diceListLabel(ctx.state, params.meditationDieIds as string[])}点）`,
    );
  }
  if (typeof params.dieId === 'string') {
    const v = dieValue(ctx.state, params.dieId);
    const at = v !== undefined ? `（${v}点）` : '';
    const art = ctx.state.players[actorOf(ctx.state)].artifacts.find((x) => x.id === a.artifactId);
    const sk = art?.skills.find((s) => s.side === a.side);
    parts.push(dieIdLabel(sk?.key, params, at));
  }
  if (Array.isArray(params.opponentDefenseDieIds) && params.opponentDefenseDieIds.length) {
    parts.push(`弃置对方 ${params.opponentDefenseDieIds.length} 颗防御骰`);
  }
  if (params.opponentDiceByKind && typeof params.opponentDiceByKind === 'object') {
    const map = params.opponentDiceByKind as Record<string, unknown>;
    const names: Record<string, string> = { attack: '攻击', defense: '防御', meditation: '冥想' };
    const sub: string[] = [];
    for (const k of ['attack', 'defense', 'meditation']) {
      if (Array.isArray(map[k]) && (map[k] as string[]).length) {
        sub.push(`${names[k]}骰 ${(map[k] as string[]).length} 颗`);
      }
    }
    if (sub.length) parts.push(`弃置对方 ${sub.join('、')}`);
  }

  return parts.length ? `发动「${name}」：${parts.join('，')}` : `发动「${name}」`;
}

function canSelectForReroll(player: PlayerState, ctx: Ctx): boolean {
  return (
    (ctx.state.phase === 'reroll' || ctx.state.phase === 'initialReroll') &&
    player.id === ctx.state.activePlayer &&
    ctx.maxReroll > 0
  );
}

/** 为「待决策」（013 电刑/雷暴）打开选骰面板：一次列全部可选骰，选完确认即派发 */
function startPendingSelection(
  ctx: Ctx,
  key: string,
  kind: NonNullable<UiState['selection']>['pendingKind'],
): void {
  ctx.hooks.ui.selection = {
    key,
    artifactId: '',
    side: 'only',
    stepIndex: 0,
    chosenDice: [],
    options: [],
    currentSel: new Set<string>(),
    numbers: [],
    slots: [],
    slotModes: [],
    pendingKind: kind,
  };
  ctx.hooks.requestRender();
}

function startSkillSelection(
  ctx: Ctx,
  action: SkillAction,
  key: string,
  pendingKind?: NonNullable<UiState['selection']>['pendingKind'],
): void {
  const spec = SKILL_SELECTION[key];
  if (spec) {
    const player = actorOf(ctx.state); // 待决策优先：非当前玩家的技能动作也要按其本人构造选择器
    const steps = spec.steps({ state: ctx.state, player, chosenDice: [], options: [], numbers: [], slots: [] });
    if (steps.length === 0) {
      const params = spec.buildParams({ state: ctx.state, player, chosenDice: [], options: [], numbers: [], slots: [] });
      const built: SkillAction = {
        t: 'skill',
        artifactId: action.artifactId,
        side: action.side,
        params,
      };
      ctx.hooks.propose(built, skillActionLabel(ctx, built));
      return;
    }
  }
  ctx.hooks.ui.selection = {
    key,
    artifactId: action.artifactId,
    side: action.side,
    stepIndex: 0,
    chosenDice: [],
    options: [],
    currentSel: new Set<string>(),
    numbers: [],
    slots: [],
    slotModes: [],
    ...(pendingKind ? { pendingKind } : {}),
  };
  ctx.hooks.requestRender();
}

function openDustFlow(ctx: Ctx, a: Artifact, free = false, fuchou = false): void {
  const kind = dustFlowKind(a);
  const fuchouFlag = fuchou ? { fuchou: true as const } : {};
  if (free) {
    // 019 尘起赠予的免费尘起：切换/充能无需选侧与支付，直接派发；激活仍需选侧
    if (kind !== 'activate') {
      const side = kind === 'switch' ? (a.activeMarkerSide === 'left' ? 'right' : 'left') : undefined;
      ctx.hooks.onAction({ t: 'dustRise', artifactId: a.id, free: true, ...(side ? { side } : {}), ...fuchouFlag });
      return;
    }
    ctx.hooks.ui.dustFlow = { artifactId: a.id, kind, step: 'side', free: true, ...fuchouFlag };
    ctx.hooks.requestRender();
    return;
  }
  ctx.hooks.ui.dustFlow = {
    artifactId: a.id,
    kind,
    step: kind === 'activate' ? 'side' : 'pay',
  };
  ctx.hooks.requestRender();
}

/** 属性补正显示：0 不显示、正数 +N、负数自带 -（用于「速度 3+1」「意志 9-2」） */
function deltaSuffix(delta: number): string {
  if (delta === 0) return '';
  return delta > 0 ? `+${delta}` : `${delta}`;
}

/** 属性补正的着色：用该玩家的配色（A 蓝 / B 红） */
function deltaSpan(player: PlayerState, delta: number): HTMLElement {
  const span = el('span', `sub-delta player-${player.id}`);
  span.textContent = deltaSuffix(delta);
  return span;
}

/** 神器属性摘要片段：第N列 / 速度 / 意志 / 生命 / 充能 / 分布 / 计数（卡头与卡图浮窗共用一处来源）
 *  - 速度/意志带补正（玩家色）；充能与「生命」同一样式、位于徽标之前；计数带上限。 */
function metaParts(art: Artifact, player: PlayerState | null, animState?: GameState): (string | HTMLElement)[] {
  const parts: (string | HTMLElement)[] = [`第${art.column}列`];
  if (art.speed !== undefined) {
    parts.push(`速度 ${art.speed}`);
    const d = player ? effectiveSpeed(player) - art.speed : 0;
    if (player && d !== 0) parts.push(deltaSpan(player, d));
  }
  if (art.will !== undefined) {
    parts.push(`意志 ${art.will}`);
    const d = player ? effectiveWill(player) - art.will : 0;
    if (player && d !== 0) parts.push(deltaSpan(player, d));
  }
  if (art.life !== undefined) {
    parts.push(`生命 ${art.life}`);
    // 生命上限加成：与其他属性（速度/意志）同款「玩家色药丸」；无加成不显示
    const d = player ? player.lifeMax - art.life : 0;
    if (player && d !== 0) parts.push(deltaSpan(player, d));
  }
  if (art.chargeReq !== undefined) {
    // 「充能」为纯文本（与「生命」同样式）；y/x 用旧黄色药丸（`充能 ` 末尾保留半角空格 → 文案仍是「充能 0/1」）
    parts.push('充能 ');
    const charge = el('span', 'sub-charge');
    const fill = el('span', 'sub-charge-fill');
    const ratio = art.chargeReq > 0 ? art.chargeLayer / art.chargeReq : 0;
    let prev: number | undefined;
    if (animState && player) {
      const key = `${player.id}:${art.id}`;
      const m = lastCharge.get(animState) ?? new Map<string, number>();
      prev = m.get(key);
      m.set(key, ratio);
      lastCharge.set(animState, m);
    }
    setScaleX(fill, ratio, prev); // 进度条：随 y/x 生长
    charge.appendChild(fill);
    const tx = el('span', 'sub-charge-tx');
    tx.textContent = `${art.chargeLayer}/${art.chargeReq}`;
    charge.appendChild(tx);
    parts.push(charge);
  }
  if (art.distribution) {
    parts.push(
      `分布 防${art.distribution.defense.join('/')} 攻${art.distribution.attack.join('/')} 冥${art.distribution.meditation.join('/')}`,
    );
  }
  return parts;
}

/** 计数上限的**唯一来源**：L07「始祖兽魂」在场时，「兽魂」(020/A04) 可被加价推到 3
 *  → 上限显示取 **max(卡面上限, 当前计数)**：只有真的加到 3 才显示 `3/3`，未加价一律 `2/2`。 */
function countCapOf(art: Artifact, player: PlayerState | null): number | undefined {
  if (art.countCap === undefined) return undefined;
  const isShouhun = art.skills.some((s) => s.key.startsWith('shouhun.'));
  if (isShouhun && player && hasActiveSkill(player, 'nisa.shizushouhun')) {
    return Math.max(art.countCap, art.count);
  }
  return art.countCap;
}

/** 计数文案的唯一来源（计数与充能是两种属性：计数用独立徽标、会升会降） */
function countText(art: Artifact, player: PlayerState | null = null): string {
  const cap = countCapOf(art, player);
  return cap !== undefined ? `计数 ${art.count}/${cap}` : `计数 ${art.count}`;
}

/** 以全角空格连接文本/节点片段（药丸类补正/充能紧贴前一个值，不插分隔） */
function appendParts(parent: HTMLElement, parts: (string | HTMLElement)[]): void {
  for (const [i, p] of parts.entries()) {
    const inline =
      typeof p !== 'string' && (p.classList.contains('sub-delta') || p.classList.contains('sub-charge'));
    if (i > 0 && !inline) parent.appendChild(document.createTextNode('　'));
    if (typeof p === 'string') parent.appendChild(document.createTextNode(p));
    else parent.appendChild(p);
  }
}

function artifactCard(a: Artifact, ctx: Ctx, player: PlayerState): HTMLElement {
  const card = el('div', 'card');
  card.dataset.artifact = a.id;

  const head = el('div', 'card-head');
  const name = el('span', 'card-name');
  name.textContent = a.weapon ? `${a.name}（${a.weapon}）` : a.name;
  head.appendChild(name);

  // 副标题：与「生命 50」同一字体/样式的纯文本（含充能；充能位于所有徽标之前）
  const sub = el('span', 'card-sub');
  appendParts(sub, metaParts(a, player, ctx.state));
  head.appendChild(sub);

  if (a.activeMarkerSide) {
    const act = el('span', 'badge badge-active');
    const activeName =
      sideDisplayName(a, a.activeMarkerSide) ?? sideDisplayName(a, 'only') ?? a.name;
    act.textContent = `已激活·${activeName}`;
    if (activeSideSpent(ctx, a)) act.classList.add('badge-active--spent');
    head.appendChild(act);
  }
  // 计数徽标：计数变化时"弹一下"（与上一帧比较，键＝玩家:id）
  const countKey = `${player.id}:${a.id}`;
  const countMap = lastCount.get(ctx.state) ?? new Map<string, number>();
  const prevCount = countMap.get(countKey);
  const countChanged = prevCount !== undefined && prevCount !== a.count;
  countMap.set(countKey, a.count);
  lastCount.set(ctx.state, countMap);
  if (a.count > 0) {
    const count = el('span', 'badge badge-count');
    count.textContent = countText(a, player);
    if (countChanged) {
      count.dataset.bump = '1';
      bumpEl(count);
    }
    head.appendChild(count);
  }
  // 存放骰（027 寒光·必杀 / 034 破障 / A03 金刚异相 / A06 勾魂）：显示在**卡片标题行末尾**。
  // 骰片用中性灰（不带攻/防/冥前缀），尺寸适配标题行高（见 styles.css 的 .card-held--head），**不加标签**。
  if (a.heldDice && a.heldDice.length > 0) {
    const held = el('div', 'pay-dice card-held card-held--head');
    // 标题行本身是"点击 / 长按看详情"的触发区：在存放骰区域内拦截事件，避免点骰片时弹出技能详情
    held.addEventListener('click', (e) => e.stopPropagation());
    held.addEventListener('pointerdown', (e) => e.stopPropagation());
    const pendingPick = ctx.state.pending?.kind === 'hanguangPick' ? ctx.state.pending : null;
    // 仅 027 寒光 本身的存放骰可点（避免混搭时把 034 金刚等其它神器的存放骰误当成可点）
    const isHanguang = a.skills.some((s) => s.key === 'hanguang.ultimate');
    const clickable = isHanguang && pendingPick !== null && pendingPick.player === player.id;
    for (const h of a.heldDice) {
      const chip = document.createElement(clickable ? 'button' : 'span');
      chip.className = 'pay-die pay-die--held';
      chip.dataset.id = h.id;
      chip.dataset.value = String(h.value);
      chip.textContent = String(h.value);
      chip.title = `置于「${a.name}」上的骰（点数 ${h.value}）`;
      if (clickable) {
        // 双入口：卡面骰片与面板骰片共享同一选中状态（ui.hanguangPick）
        (chip as HTMLButtonElement).type = 'button';
        chip.classList.add('clickable');
        chip.addEventListener('click', () => {
          const st = ctx.hooks.ui.hanguangPick;
          ctx.hooks.ui.hanguangPick = { mode: st?.mode ?? null, dieId: h.id };
          ctx.hooks.requestRender();
        });
      }
      held.appendChild(chip);
    }
    head.appendChild(held);
  }
  card.appendChild(head);
  // 卡片头部同样可点击/长按查看技能详情（省略卡图时这是唯一入口）
  attachDetailTrigger(head, ctx, a.id, player.id);

  // 卡图（缩略 / 完整）；卡片头部也可点击/长按查看技能详情
  const art = el('div', `card-art${ctx.prefs.cardArt === 'thumb' ? ' card-art--thumb' : ''}`);
  const artImg = document.createElement('img');
  artImg.className = 'card-art-img';
  artImg.src = `./cards/${a.id}.jpg`;
  artImg.alt = `${a.name}${a.weapon ? `（${a.weapon}）` : ''}`;
  artImg.addEventListener('error', () => {
    art.classList.add('card-art--missing');
    art.textContent = '（卡图占位）';
  });
  art.appendChild(artImg);
  attachDetailTrigger(art, ctx, a.id, player.id);
  if (isAltArtifact(a.id)) {
    const alt = el('span', 'card-alt-badge');
    alt.textContent = '异相';
    art.appendChild(alt);
  }
  if (a.special) {
    const sp = el('span', 'card-special-badge');
    sp.textContent = '特典';
    art.appendChild(sp);
  }
  // 挑战模式「调整」徽标（红底白字）：仅挑战模式 + 仅名单内的神器；无「异相」占异相位置、有则排其下
  if (ctx.state.mode === 'challenge' && ADJUSTED_ARTIFACTS.includes(a.id)) {
    const adj = el('span', `card-adjust-badge${isAltArtifact(a.id) ? ' card-adjust-badge--below' : ''}`);
    adj.textContent = '调整';
    art.appendChild(adj);
  }
  card.appendChild(art);

  const text = ARTIFACT_TEXT[a.id];
  if (text) {
    const showText = ctx.prefs.showSkillText;
    const skills = el('div', `skills${showText ? '' : ' skills--inline'}`);

    // 单个技能条目 → `.skill-part`（类型徽标 + 技能名 + 状态/强制徽标；描述仅在「显示」时加入）
    const buildPart = (s: (typeof text.skills)[number], label: string): HTMLElement => {
      const pstate = skillPartState(ctx, a, s);
      const pcls =
        pstate === 'on'
          ? 'skill-part--on'
          : pstate === 'disabled'
            ? 'skill-part--disabled'
            : pstate === 'spent'
              ? 'skill-part--spent'
              : 'skill-part--off';
      const part = el('div', `skill-part ${pcls}`);
      part.dataset.side = s.side;
      const key = findSkillKey(a, s.side, s.type);
      if (key) part.dataset.key = key;

      const isUsedUltimate = usedUltimateKey(ctx, player.id, key, s.type);
      if (isUsedUltimate) part.classList.add('skill-part--used');
      const isForcedNow = zhihaiForcedFrame(ctx, a, s);

      const pHead = el('div', 'skill-part-head');
      const badge = el('span', 'skill-type');
      badge.textContent = s.type;
      pHead.appendChild(badge);
      // 技能名与类型徽标同行（隐藏描述时这就是那一行的主体，也是点击发动的目标）
      const nameEl = el('span', 'skill-name');
      nameEl.textContent = label;
      pHead.appendChild(nameEl);
      if (isForcedNow) {
        const forced = el('span', 'badge badge-forced');
        forced.textContent = '强制发动';
        pHead.appendChild(forced);
      }
      if (showText) {
        const body = el('div', 'skill-text');
        body.textContent = s.text;
        pHead.appendChild(body);
      }
      part.appendChild(pHead);

      const skillAction = ctx.legal.find(
        (x): x is SkillAction => x.t === 'skill' && x.artifactId === a.id && x.side === s.side,
      );
      if (skillAction && isActivatableType(s.type) && !isUsedUltimate && !onlineNonActor(ctx)) {
        part.classList.add('clickable');
        part.dataset.act = 'skill';
        part.title = '点击启动技能';
        const skillKey = key;
        part.addEventListener('click', () => {
          if (skillKey && SKILL_SELECTION[skillKey]) {
            startSkillSelection(ctx, skillAction, skillKey);
          } else {
            ctx.hooks.propose(skillAction, `启动技能：${skillName(ctx.state, skillAction)}`);
          }
        });
      }
      return part;
    };

    if (showText) {
      // 显示描述：按技能名分组（同一技能名的多个条目收在一个盒子里）
      const groups = new Map<string, typeof text.skills>();
      for (const s of text.skills) {
        const existing = groups.get(s.name);
        if (existing) existing.push(s);
        else groups.set(s.name, [s]);
      }
      for (const [groupName, parts] of groups) {
        const box = el('div', 'skill');
        for (const s of parts) box.appendChild(buildPart(s, groupName));
        skills.appendChild(box);
      }
    } else {
      // 隐藏描述：按「侧」分组 —— 左列（左对齐）/ 右列（右对齐）；全是 only 则一行居中
      const hasOnly = text.skills.every((s) => s.side === 'only');
      for (const side of ['left', 'right', 'only'] as const) {
        const parts = text.skills.filter((s) => s.side === side);
        if (!parts.length) continue;
        const box = el('div', `skill skill--${side}`);
        for (const s of parts) box.appendChild(buildPart(s, s.name));
        skills.appendChild(box);
      }
      if (hasOnly) skills.classList.add('skills--inline--only');
    }
    card.appendChild(skills);
    // 特典神器（`special`）：**有技能描述时**在技能区**下方**追加一行提示（隐藏描述的紧凑视图不加）
    if (a.special && showText) {
      const note = el('div', 'card-special-note');
      note.textContent = SPECIAL_ARTIFACT_NOTE;
      card.appendChild(note);
    }
  }

  return card;
}

/** 面板技能 key：**优先用文案条目自带的 `key`**（稳定、与数组下标无关）。
 *  无 key 时退回"文案下标 → **静态** `LEGENDS[id].skills` 同下标"——**绝不读运行时会变的 `lg.skills`**
 *  （否则 L04 必杀用后删掉自身技能表，下标错位会让名字/类型全乱）。
 *  不可按类型(kind)反查——同一面板可能有**两个同类型**技能（L06 圆舞/死即新生、L08 蛇蝎之泪/没有怜悯）。 */
function legendFindKey(lg: LegendPanel, s: { key?: string; type?: string; name?: string }): string | undefined {
  if (s.key) return s.key;
  const def = LEGENDS[lg.id];
  const text = LEGEND_TEXT[lg.id];
  const i = text ? text.skills.indexOf(s as (typeof text.skills)[number]) : -1;
  if (i >= 0 && def) return def.skills[i]?.key;
  // 兜底（拿不到文案条目时）：保持旧行为，至少不要报错
  const kind = s.type ? kindFromType(s.type) : undefined;
  if (kind) {
    const d = def?.skills.find((x) => x.kind === kind);
    if (d) return d.key;
  }
  return def?.skills.find((x) => x.side === 'only')?.key;
}

/** 传奇某技能 key → 技能名（取自 `LEGEND_TEXT`，**按 `key` 直接匹配**、与数组下标/运行时删除无关）。
 *  传奇 side 全是 'only'、kind 会重复（L11 三条"持续"）→ 只有 key 唯一，故必须按 key 定名。 */
export function legendSkillNameOf(lg: LegendPanel, skillKey?: string): string {
  if (!skillKey) return '';
  return LEGEND_TEXT[lg.id]?.skills.find((s) => s.key === skillKey)?.name ?? '';
}

/** 某技能（神器或传奇面板）的 `kind`：按 `skillKey` 反查。用于判定"必杀"→ 走必杀横幅。 */
export function skillKindOf(
  state: GameState,
  player: PlayerId,
  artifactId: string,
  skillKey?: string,
): SkillDef['kind'] | undefined {
  if (!skillKey) return undefined;
  const pl = state.players[player];
  const a = pl.artifacts.find((x) => x.id === artifactId);
  if (a) return a.skills.find((s) => s.key === skillKey)?.kind;
  // 传奇：从**静态** `LEGENDS` 取 kind（不读运行时可变的 `lg.skills` → L04 用后删技能也能判为必杀）
  if (pl.legend && pl.legend.id === artifactId) return LEGENDS[artifactId]?.skills.find((s) => s.key === skillKey)?.kind;
  return undefined;
}

/** 该技能行是否"**必杀已用尽**" → 追加 `.skill-part--used`（灰 + 删除线）。
 *  **神器卡 / 传奇面板 / 卡图浮窗共用这一判定**，保证"已用必杀"三处表现统一（风格＝同一条 CSS）。 */
function usedUltimateKey(ctx: Ctx, owner: PlayerId, key: string | undefined, type: string): boolean {
  return !!key && type.includes('必杀') && ctx.state.ultimatesUsed.includes(skillUseKey(owner, key));
}

/** 面板技能行状态：可发动条件与引擎**同一来源**（`legendSkillReady`：尘落前置 + 个别额外前提） */function legendSkillState(
  ctx: Ctx,
  player: PlayerState,
  lg: LegendPanel,
  s: { type: string },
): 'on' | 'disabled' | 'off' {
  const key = legendFindKey(lg, s);
  // 技能已从面板"失去"（如 L04 必杀用后从 `lg.skills` 删掉自身）→ 深灰不可用（否则会误显示为绿色"可用"）
  if (key && !lg.skills.some((k) => k.key === key)) return 'disabled';
  if ((lg.continuousLost || lg.continuousLostThisTurn) && s.type.includes('持续')) return 'disabled';
  if (s.type.includes('必杀')) {
    if (key && ctx.state.ultimatesUsed.includes(skillUseKey(player.id, key))) return 'disabled';
  }
  // 「整局一次」类的非必杀面板技能（如 L11「永恒女王」）用过后 → 深灰
  if (key && ctx.state.legendOnceUsed.includes(skillUseKey(player.id, key))) return 'disabled';
  // 尘落前置：必杀 / 持续 都可能带（如 L08「没有怜悯」持续但尘落前置 4）→ 未满足时显示灰（不可用）
  if (key && !legendSkillReady(ctx.state, player.id, key)) return 'off';
  return 'on';
}

/**
 * 传奇卡图「缩略」＝统一横条（锚定人物眼睛）。
 * 逐图给出**眼睛纵向位置（占图高比例 y）**与**图高 h(px)**；12 张均宽 787。
 * 微调横条高度：只改 `LEGEND_THUMB_H`（比例由此处内联写入 `aspect-ratio`）。
 * 第一阶段：卡图区先留空（占位块），把统一尺寸定死；第二阶段再上眼睛裁切图。
 */
const LEGEND_ART_W = 787;
const LEGEND_THUMB_H = 220; // ← 横条高度（在 787 宽下的像素高）；调高度改这一个数
const LEGEND_EYE: Record<string, { y: number; h: number }> = {
  L01: { y: 0.42, h: 647 },
  L02: { y: 0.47, h: 676 },
  L03: { y: 0.68, h: 680 },
  L04: { y: 0.6, h: 740 },
  L05: { y: 0.62, h: 678 },
  L06: { y: 0.68, h: 619 },
  L07: { y: 0.58, h: 686 },
  L08: { y: 0.62, h: 645 },
  L09: { y: 0.67, h: 685 },
  L10: { y: 0.59, h: 680 },
  L11: { y: 0.64, h: 658 },
  L12: { y: 0.71, h: 647 },
};

/** 缩略：写入统一横条比例，并算好「眼睛居中」的 object-position 的 Y%（存为 CSS 变量 `--legend-eye-y`，第二阶段供图片使用）。 */
function applyLegendThumbAspect(art: HTMLElement, id: string): void {
  art.style.aspectRatio = `${LEGEND_ART_W} / ${LEGEND_THUMB_H}`;
  const eye = LEGEND_EYE[id];
  let y = 0.5;
  if (eye && eye.h > LEGEND_THUMB_H) {
    // boxH(在 787 宽下) = LEGEND_THUMB_H → 让眼睛位于横条中央：Y = (eyeH - boxH/2) / (h - boxH)
    const boxH = LEGEND_THUMB_H;
    y = Math.max(0, Math.min(1, (eye.y * eye.h - boxH / 2) / (eye.h - boxH)));
  }
  art.style.setProperty('--legend-eye-y', `${(y * 100).toFixed(1)}%`);
}

/**
 * 传奇英雄面板（预设·带传奇）：外形沿用神器卡（`.card`）。
 * 技能区与神器卡同款（技能名＋类型徽标；描述跟随「显示技能描述」）。
 */
function legendBox(player: PlayerState, ctx: Ctx): HTMLElement {
  const lg = player.legend!;
  const box = el('div', 'card card-legend');
  box.dataset.legend = lg.id;

  const head = el('div', 'card-head');
  const name = el('span', 'card-name');
  name.textContent = lg.name;
  head.appendChild(name);
  // 「传奇英雄」小字（与神器标题小字同款）；位于名字之后、计数之前
  const kind = el('span', 'card-sub');
  kind.textContent = '传奇英雄';
  head.appendChild(kind);
  if (lg.count > 0 || lg.countCap !== undefined) {
    const count = el('span', 'badge badge-count');
    count.textContent = lg.countCap ? `计数 ${lg.count}/${lg.countCap}` : `计数 ${lg.count}`;
    head.appendChild(count);
  }
  box.appendChild(head);

  // 缩略＝统一横条（按眼睛锚定裁切）；完整＝现整图（787:756 黑底板、图垂直居中）
  const thumb = ctx.prefs.cardArt === 'thumb';
  const art = el('div', `card-legend-art${thumb ? ' card-legend-art--thumb' : ''}`);
  if (thumb) applyLegendThumbAspect(art, lg.id);
  const img = document.createElement('img');
  img.src = legendImageUrl(lg.id);
  img.alt = lg.name;
  img.draggable = false;
  img.addEventListener('error', () => {
    art.classList.add('card-art--missing');
    art.textContent = '（面板图占位）';
  });
  art.appendChild(img);
  box.appendChild(art);
  // 点卡图 / 长按 → 只读技能详情浮窗
  attachDetailTrigger(art, ctx, lg.id, player.id);
  attachDetailTrigger(head, ctx, lg.id, player.id);

  const text = LEGEND_TEXT[lg.id];
  if (text && text.skills.length) {
    const showText = ctx.prefs.showSkillText;
    const skills = el('div', `skills${showText ? '' : ' skills--inline-legend'}`);

    // 单个技能条目 → `.skill-part`（类型徽标 + 技能名 + 状态；描述仅在「显示」时加入）
    const buildPart = (s: (typeof text.skills)[number], label: string): HTMLElement => {
      const state = legendSkillState(ctx, player, lg, s);
      const cls =
        state === 'on' ? 'skill-part--on' : state === 'disabled' ? 'skill-part--disabled' : 'skill-part--off';
      const part = el('div', `skill-part ${cls}`);
      const key = legendFindKey(lg, s);
      if (key) part.dataset.key = key;
      // 必杀用尽 → 与神器卡/卡图浮窗同款"灰 + 删除线"（此前传奇面板缺这条）
      if (usedUltimateKey(ctx, player.id, key, s.type)) part.classList.add('skill-part--used');
      const pHead = el('div', 'skill-part-head');
      const badge = el('span', 'skill-type');
      badge.textContent = s.type;
      pHead.appendChild(badge);
      const nameEl = el('span', 'skill-name');
      nameEl.textContent = label;
      pHead.appendChild(nameEl);
      if (showText) {
        const body = el('div', 'skill-text');
        body.textContent = s.text;
        pHead.appendChild(body);
      }
      part.appendChild(pHead);
      // 可发动（启动 / 激活 / 必杀，与神器卡一致）：点击 → 发动（面板动作带 legendKey，按 key 精确匹配）
      const action = ctx.legal.find(
        (x): x is SkillAction =>
          x.t === 'skill' &&
          x.artifactId === lg.id &&
          (((x.params?.legendKey as string | undefined) ?? key) === key || x.side === s.side),
      );
      if (action && isActivatableType(s.type) && state === 'on' && !onlineNonActor(ctx)) {
        part.classList.add('clickable');
        part.dataset.act = 'skill';
        part.title = '点击发动技能';
        const k2 = key;
        part.addEventListener('click', () => {
          if (k2 && SKILL_SELECTION[k2]) startSkillSelection(ctx, action, k2);
          else ctx.hooks.propose(action, `发动「${label}」`);
        });
      }
      return part;
    };

    if (showText) {
      // 显示描述：按技能名分组
      const groups = new Map<string, typeof text.skills>();
      for (const s of text.skills) {
        const g = groups.get(s.name);
        if (g) g.push(s);
        else groups.set(s.name, [s]);
      }
      for (const [groupName, parts] of groups) {
        const skillBox = el('div', 'skill');
        for (const s of parts) skillBox.appendChild(buildPart(s, groupName));
        skills.appendChild(skillBox);
      }
    } else {
      // 隐藏描述：**维持原样**（按技能名分组、横向换行）——用独立类 `.skills--inline-legend`，
      // 避免吃到神器那套「两列 / only 一行居中」的新样式。
      const groups = new Map<string, typeof text.skills>();
      for (const s of text.skills) {
        const g = groups.get(s.name);
        if (g) g.push(s);
        else groups.set(s.name, [s]);
      }
      for (const [groupName, parts] of groups) {
        const skillBox = el('div', 'skill');
        for (const s of parts) skillBox.appendChild(buildPart(s, groupName));
        skills.appendChild(skillBox);
      }
    }
    box.appendChild(skills);
  }

  return box;
}

function areaBox(kind: DiceKind, player: PlayerState, ctx: Ctx): HTMLElement {
  const box = el('div', 'area');
  box.dataset.kind = kind;

  const label = el('div', 'area-label');
  label.textContent = `${AREA_LABEL[kind]}（${player.areas[kind].length}）`;
  box.appendChild(label);

  const dice = el('div', 'dice');
  const nonActor = onlineNonActor(ctx);
  // 挑战·自动模式：昔传抵挡由引擎自动完成 → 昔传的骰子不点选为抵挡
  const autoLegendBlock =
    ctx.state.mode === 'challenge' &&
    ctx.state.challenge?.settleMode !== 'manual' &&
    !!ctx.state.pendingAttack &&
    ctx.state.pendingAttack.attacker === 'A' &&
    player.id === 'B';
  const ap = ctx.areaPick;
  const areaPickable = ap != null && ap.owner === player.id && ap.kinds.includes(kind);

  for (const d of player.areas[kind]) {
    const die = el('span', `die die-${player.id}`);
    die.dataset.id = d.id;
    die.dataset.value = String(d.value);
    die.textContent = String(d.value);

    if (nonActor) {
      // 联机·非本人操作：骰子一律不可点（攻击/抵挡/重掷/双入口全部关闭；真正门禁在 dispatch 兜底）
    } else if (ap) {
      // 选骰面板开启：仅“可选集合已确定”的骰区可点（与面板骰片共享同一选中状态）
      if (areaPickable && (!ap.filter || ap.filter(d))) {
        const locked = !ap.ignoreLock && isValueLocked(ctx.state, player.id, d.value);
        if (!locked) {
          die.classList.add('clickable');
          die.title = '点击选择该骰';
          if (ap.isSelected(d.id)) die.classList.add('selected');
          die.addEventListener('click', () => ap.toggle(d));
        }
      }
    } else if (challengeDieInChipPool(ctx, d, player)) {
      // 挑战代决·骰片选择：骰区对应骰子与面板骰片**双入口**（共享同一选中状态）
      die.classList.add('clickable');
      die.title = '点击选择该骰';
      if (ctx.hooks.ui.challengePickSel?.includes(d.id)) die.classList.add('selected');
      die.addEventListener('click', () => toggleChallengePickDie(ctx, d.id));
    } else if (ctx.slotsStepOpen) {
      // 第一列技能分格面板：可选集合取决于未填的格 → 骰区不可点，仅用面板
    } else if (ctx.dustFlowOpen) {
      // 尘起【付款步】：骰区骰子与操作栏骰片**双入口**（“选侧”步不可点）
      const flow = ctx.hooks.ui.dustFlow;
      if (flow && flow.step === 'pay' && player.id === actorOf(ctx.state)) {
        const converting = !!flow.convertPick;
        const pickable = !isValueLocked(ctx.state, player.id, d.value) && (converting
          ? true
          : hasDustVariant(ctx, flow.artifactId, 'dice') && d.kind === 'meditation');
        if (pickable) {
          die.classList.add('clickable');
          die.title = '点击用于尘起支付';
          if (converting && flow.convertPick!.includes(d.id)) die.classList.add('selected');
          die.addEventListener('click', () => pickDustDie(ctx, d.id));
        }
      }
    } else if (ctx.selectionStep) {
      const step = ctx.selectionStep;
      if (step.kind === 'dice' && ctx.selectionOwner === player.id && step.areas.includes(kind)) {
        const locked = !step.ignoreLock && isValueLocked(ctx.state, player.id, d.value);
        const selectable = !locked && (!step.filter || step.filter(d));
        if (selectable) {
          die.classList.add('clickable');
          die.title = '点击选择该骰';
          const sel = ctx.hooks.ui.selection;
          if (sel?.currentSel.has(d.id)) die.classList.add('selected');
          die.addEventListener('click', () => {
            const active = ctx.hooks.ui.selection;
            if (!active) return;
            if (active.currentSel.has(d.id)) active.currentSel.delete(d.id);
            else if (active.currentSel.size < step.max) active.currentSel.add(d.id);
            ctx.hooks.requestRender();
          });
        }
      }
    } else {
      const attackAction = ctx.legal.find(
        (x) => x.t === 'attack' && x.costSlots[0]?.dieIds[0] === d.id,
      );
      const blockAction = ctx.legal.find(
        (x) => x.t === 'block' && x.costSlots?.[0]?.dieIds[0] === d.id,
      );
      if (attackAction) {
        die.classList.add('clickable');
        die.dataset.act = 'attack';
        die.title = '点击发起攻击';
        die.addEventListener('click', () =>
          ctx.hooks.propose(attackAction, `攻击：用 ${d.value} 点攻击骰`),
        );
      } else if (blockAction && !autoLegendBlock) {
        die.classList.add('clickable');
        die.dataset.act = 'block';
        die.title = '点击抵挡';
        die.addEventListener('click', () =>
          ctx.hooks.propose(blockAction, `抵挡：用 ${d.value} 点防御骰`),
        );
      } else if (canSelectForReroll(player, ctx)) {
        die.classList.add('clickable');
        die.dataset.act = 'select';
        die.title = '点击选择重掷';
        if (ctx.hooks.ui.rerollSelected.has(d.id)) die.classList.add('selected');
        die.addEventListener('click', () => {
          const set = ctx.hooks.ui.rerollSelected;
          if (set.has(d.id)) set.delete(d.id);
          else if (set.size < ctx.maxReroll) set.add(d.id);
          ctx.hooks.requestRender();
        });
      }
    }

    dice.appendChild(die);
  }
  box.appendChild(dice);

  // 尘印标记：冥想骰区最右侧（仅展示、不可点）
  if (kind === 'meditation' && player.hasDustSeal) {
    const seal = el('span', 'badge badge-seal area-seal');
    seal.textContent = '尘印标记';
    box.appendChild(seal);
  }

  return box;
}

/** 战术牌横条（战斗界面）：名字按钮 +（按「显示技能描述」偏好）效果全文；名字可点/右键查看卡图详情 */
function tacticBar(player: PlayerState, ctx: Ctx): HTMLElement {
  const id = player.tactic as string;
  const def = TACTIC_BY_ID[id];
  // 三态（单一来源见引擎 `tacticBarState`）：生效中（绿）/ 已用尽·已结束（灰）/ 普通
  const state = tacticBarState(ctx.state, player.id);
  const bar = el('div', `tactic-bar tactic-bar--${state}`);
  const name = document.createElement('button');
  name.type = 'button';
  name.className = 'tactic-bar-name';
  name.textContent = def?.name ?? id;
  name.dataset.tactic = id; // 供「连续右键」的遮罩转发识别战术
  const open = (): void => {
    const r = name.getBoundingClientRect();
    ctx.hooks.ui.detail = {
      artifactId: id,
      player: player.id,
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    };
    ctx.hooks.requestRender();
  };
  // 查看卡图：右键（长按可等价）——技能行左键发动不受影响
  name.addEventListener('contextmenu', (e) => { e.preventDefault(); open(); });
  // 触屏：单击战术名即看详情（名字本身没有其他左键行为）
  name.addEventListener('click', () => open());
  let lp: number | null = null;
  const clearLp = (): void => { if (lp != null) { window.clearTimeout(lp); lp = null; } };
  name.addEventListener('pointerdown', () => {
    lp = window.setTimeout(() => { lp = null; open(); }, 500);
  });
  name.addEventListener('pointerup', clearLp);
  name.addEventListener('pointerleave', clearLp);
  name.addEventListener('pointercancel', clearLp);
  bar.appendChild(name);
  // 挑战模式「调整」徽标（红底白字，行内）：仅挑战模式 + 仅名单内的战术牌（当前 T02「先机」）
  if (ctx.state.mode === 'challenge' && ADJUSTED_TACTICS.includes(id)) {
    const adj = el('span', 'card-adjust-badge card-adjust-badge--inline');
    adj.textContent = '调整';
    bar.appendChild(adj);
  }
  // 「战术」标签：做成小药丸（复用 .skill-type 外观，如「启动」那样）；位于名字之后、存放骰/猜测之前
  const kind = el('span', 'skill-type tactic-bar-kind');
  kind.textContent = '战术';
  bar.appendChild(kind);
  // T15「影子」：战术上的存放骰 → 显示在**战术标题之后、技能描述之前**（仿 034 存放骰）
  if (player.tacticHeldDie) {
    const hd = el('span', 'tactic-held-die');
    hd.dataset.id = player.tacticHeldDie.id;
    hd.dataset.value = String(player.tacticHeldDie.value);
    hd.textContent = String(player.tacticHeldDie.value);
    hd.title = `「影子」存放骰：${player.tacticHeldDie.value} 点`;
    bar.appendChild(hd);
  }
  // T13「远见」：猜测的玩家 → 同样显示在**战术标题之后、技能描述之前**
  if (player.tacticGuess) {
    const gd = el('span', 'tactic-guess');
    gd.textContent = `猜玩家${player.tacticGuess}`;
    gd.title = `「远见」猜测：玩家${player.tacticGuess} 将最先降至 20 点或以下`;
    bar.appendChild(gd);
  }
  if (ctx.prefs.showSkillText) {
    const eff = el('div', 'tactic-bar-eff');
    eff.textContent = def ? tacticDisplayText(def) : '（效果文本待转写）';
    bar.appendChild(eff);
  }
  return bar;
}

/** 玩家面板：只保留骰区与神器卡（不显示「玩家A/B」归属标签——身份由生命值栏/面板边线呈现） */
/** 挑战卡图 URL：卡 id（如 'Z02'）→ `./challenges/Z002.jpg`（**入库文件名是 3 位编号**，两处引用必须走这里）。 */
export function challengeImageUrl(id: string): string {
  const num = id.replace(/^Z/, '');
  const padded = /^\d+$/.test(num) ? num.padStart(3, '0') : num;
  return `./challenges/Z${padded}.jpg`;
}

/**
 * 挑战·昔传技能「持续生效中」（长明）判定：**只影响本模式的技能列显示**（标准模式无关）。
 * **数据驱动**：读 `ChallengeSkill.alwaysOn`（`true`＝始终；`'count'`＝计数>0；`'lifeBonus'`＝生命差攻击加成>0；缺省＝不常亮）。
 * 新 Z 卡的持续技能在数据里填 `alwaysOn` 即可，**不要再按 `skill.id` 硬编码**。
 */
function challengeSkillAlwaysOn(state: GameState, sk: { alwaysOn?: boolean | 'count' | 'lifeBonus' | 'lowLife' }): boolean {
  if (sk.alwaysOn === true) return true;
  if (sk.alwaysOn === 'count') return (state.challenge?.count ?? 0) > 0;
  if (sk.alwaysOn === 'lifeBonus') return legendAttackBonus(state).value > 0;
  if (sk.alwaysOn === 'lowLife') return state.players.A.life < 10 || state.players.B.life < 10;
  return false;
}

/** 挑战模式 · 对手面板（D 方案）：面板头（含点数分布/计数）＋ 卡图缩略（点开放大）＋ 技能列（高亮"正在结算"）
 *  ＋ 三区（防御骰区 / 攻击骰区 / **驱动骰槽**＝原冥想骰区槽位）＋ 生命条。 */
function challengePanel(player: PlayerState, ctx: Ctx): HTMLElement {
  const { state } = ctx;
  const card = CHALLENGES.find((c) => c.id === state.challenge?.cardId) ?? null;
  const panel = el('div', 'player player--enemy panel--challenge');
  panel.dataset.player = player.id;
  if (state.phase !== 'gameOver' && actorOf(state) === player.id) panel.classList.add('player--acting');

  // ① 面板头：传奇名 ＋ 「昔日传奇」＋ 生命/防御骰上限/防御规则（放点数分布之前）＋ 点数分布 ＋ 计数
  const head = el('div', 'player-header');
  const title = el('span', 'player-title');
  title.textContent = card ? `传说中的「${card.legacy}」` : '昔日传奇';
  head.appendChild(title);
  const pill = el('span', 'skill-type');
  pill.textContent = LEGEND_DISPLAY_NAME;
  head.appendChild(pill);
  if (card) {
    const meta = el('span', 'card-sub');
    meta.textContent = card.life != null ? `生命 ${card.life}` : '生命 —';
    head.appendChild(meta);
  }
  const dist = player.artifacts.find((a) => a.column === 2)?.distribution;
  if (dist) {
    const sub = el('span', 'card-sub');
    sub.textContent = `分布 防${dist.defense.join('/')} 攻${dist.attack.join('/')} 冥${dist.meditation.join('/')}`;
    head.appendChild(sub);
  }
  if (card?.countCap != null) {
    // 与神器 004 / 标准传奇面板**同款药丸**（`.badge badge-count`）；计数后端不封顶（`Infinity`）时显示 `∞`
    const cnt = el('span', 'badge badge-count');
    const capText = Number.isFinite(card.countCap) ? String(card.countCap) : '∞';
    cnt.textContent = `计数 ${state.challenge?.count ?? 0}/${capText}`;
    head.appendChild(cnt);
  }
  panel.appendChild(head);

  // ② 卡图缩略（点开看大图）＋ 技能表（一条一框、正在结算＝绿）＋ 最下方"临时驱动骰区域"
  const row = el('div', 'challenge-row');
  const thumb = document.createElement('button');
  thumb.type = 'button';
  // 缩略（默认偏好）＝裁掉"顶部标题条 + 底部留白"；完整＝整张全图。点开大图始终是全图。
  thumb.className = `challenge-thumb${ctx.prefs.cardArt === 'thumb' ? ' challenge-thumb--crop' : ''}`;
  thumb.dataset.act = 'challengeSkillsOpen';
  thumb.title = '右键 / 长按查看技能';
  const im = document.createElement('img');
  im.src = card ? challengeImageUrl(card.id) : '';
  im.alt = card ? card.legacy : '';
  thumb.appendChild(im);
  attachChallengeSkillsTrigger(thumb, ctx);
  row.appendChild(thumb);

  const right = el('div', 'challenge-skills');
  const table = el('div', 'challenge-skill-table');
  (card?.skills ?? []).forEach((sk, i) => {
    if (sk.unordered) return; // Z06「死即新生」不占顺序步 → 单独一行渲染（见下），不进技能表
    const alwaysOn = challengeSkillAlwaysOn(state, sk);
    const cls = ['challenge-skill'];
    if (alwaysOn) cls.push('is-on'); // 持续生效中（长明，静）
    if (state.challenge?.activeSkill === i) cls.push('is-active'); // 当前结算（聚光灯，走位）
    const r = el('div', cls.join(' '));
    const no = el('span', 'csk-no');
    no.textContent = String(i);
    r.appendChild(no);
    if (alwaysOn) {
      // 药丸放在**序号与技能名之间**
      const onPill = el('span', 'csk-on-pill');
      onPill.textContent = '生效中';
      r.appendChild(onPill);
    }
    const nm = el('span', 'csk-name');
    nm.textContent = sk.name;
    r.appendChild(nm);
    if (sk.marker) {
      const mk = el('span', 'csk-mark');
      mk.textContent = sk.marker;
      r.appendChild(mk);
    }
    const sl = el('span', 'csk-slot');
    sl.textContent = slotPhrase(sk.slots ?? null, sk.perGroup);
    r.appendChild(sl);
    const eff = el('span', 'csk-eff');
    eff.textContent = sk.effect; // 完整效果（照卡面）——与上面同一段文字流，不另起两行
    r.appendChild(eff);
    table.appendChild(r);
  });
  right.appendChild(table);
  // 「不占顺序步」的技能（`unordered`，序号位 `x`）→ 单独一行（虚线框＝"独立行"样式），放在"临时驱动骰区域"上方。
  //   · Z06「死即新生」：触发绿 / 用掉灰（`deathUsed`/`deathJustTriggered` 只在触发帧）；
  //   · Z07「围攻」：独立钩子（无触发/用掉态）；
  //   · Z09「威压」：卡面级规则 → `alwaysOn` 常亮（左绿条 + 药丸「生效中」）。
  for (const dsk of card?.skills ?? []) {
    if (!dsk.unordered) continue;
    const alwaysOn = challengeSkillAlwaysOn(state, dsk);
    const cls = ['challenge-skill', 'challenge-skill--death'];
    if (state.challenge?.deathUsed && !state.challenge?.deathJustTriggered) cls.push('is-used');
    if (state.challenge?.deathJustTriggered) cls.push('is-triggered');
    if (alwaysOn) cls.push('is-on');
    const drow = el('div', cls.join(' '));
    const dno = el('span', 'csk-no');
    dno.textContent = 'x';
    drow.appendChild(dno);
    if (alwaysOn) {
      const onPill = el('span', 'csk-on-pill');
      onPill.textContent = '生效中';
      drow.appendChild(onPill);
    }
    const dnm = el('span', 'csk-name');
    dnm.textContent = dsk.name;
    drow.appendChild(dnm);
    const deff = el('span', 'csk-eff');
    deff.textContent = dsk.effect;
    drow.appendChild(deff);
    right.appendChild(drow);
  }
  // 临时驱动骰区域（一整条、跨全宽）：回合开始投出的骰子落在这里
  const staging = el('div', 'challenge-staging');
  staging.dataset.act = 'challengeStaging';
  const slab = el('span', 'csk-staging-lab');
  slab.textContent = '临时驱动骰区域';
  staging.appendChild(slab);
  const sdice = el('div', 'dice');
  // 驱动骰**按点数升序（同点按 id 稳定）显示**——**仅显示层**：不改 `challenge.driven` 的存储顺序
  //（引擎槽匹配用 `sortedDice` 副本，与显示顺序无关；重掷/追加后每帧重排会自动跟上）
  const drivenSorted = [...(state.challenge?.driven ?? [])].sort(
    (a, b) => a.value - b.value || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  for (const d of drivenSorted) {
    const chip = el('span', 'die die-B');
    chip.dataset.id = d.id;
    chip.dataset.value = String(d.value);
    chip.textContent = String(d.value);
    // 挑战代决"骰片选择"（如尘起：owner=B）→ 驱动骰**双入口**可点（与面板骰片共享选中态、等效）
    if (challengeDieInChipPool(ctx, d, player)) {
      chip.classList.add('clickable');
      chip.title = '点击选择该骰';
      if (ctx.hooks.ui.challengePickSel?.includes(d.id)) chip.classList.add('selected');
      chip.addEventListener('click', () => toggleChallengePickDie(ctx, d.id));
    }
    sdice.appendChild(chip);
  }
  staging.appendChild(sdice);
  right.appendChild(staging);
  row.appendChild(right);
  panel.appendChild(row);

  // ③ 生命条（占"驱动骰槽列 + 攻击骰区列"）；「防御骰上限 / 规则」放在第 3 列 ＝ 防御骰区**正下方**，
  //    两者**直角相接**（不是合并）：骰区下两角、信息框上两角都是直角、中间无缝。
  const band = el('div', 'playband playband--single');
  const life = lifeBar(player, playerName(ctx, player.id));
  life.style.gridColumn = '1 / span 2';
  band.appendChild(life);
  if (card) {
    const info = el('div', 'challenge-legacy-info');
    info.dataset.act = 'challengeLegacyInfo';
    info.style.gridColumn = '3';
    const cap = card.defenseCap != null ? `防御骰上限 ${card.defenseCap}` : '防御骰上限 无';
    const rule = card.defenseRule ?? '防御规则 —';
    info.textContent = `${cap}　｜　${rule}`;
    band.appendChild(info);
  }
  panel.appendChild(band);

  // ④ 三区：防御骰区 / 攻击骰区 / 驱动骰槽（＝原"冥想骰区"槽位，仅本模式改名）
  const areas = el('div', 'areas');
  const driven = el('div', 'area area--driven');
  driven.dataset.kind = 'driven';
  const dlab = el('div', 'area-label');
  dlab.textContent = '驱动骰槽';
  driven.appendChild(dlab);
  const ddice = el('div', 'dice');
  for (const d of state.challenge?.slot ?? []) {
    const chip = el('span', 'die die-B');
    chip.dataset.id = d.id;
    chip.dataset.value = String(d.value);
    chip.textContent = String(d.value);
    ddice.appendChild(chip);
  }
  driven.appendChild(ddice);
  // Z06「漆黑死神」黑白指示物：贴在驱动骰区**最右**（行布局里 `margin-left:auto` 推到边）
  if (card?.token) {
    const face = state.challenge?.token === 'white' ? '白' : '黑';
    const tok = el('span', `challenge-token challenge-token--${face === '白' ? 'white' : 'black'}`);
    tok.dataset.act = 'challengeToken';
    tok.textContent = `无光领域指示物·${face}`;
    driven.appendChild(tok);
  }
  for (const k of AREA_ORDER_MIRRORED) {
    if (k === 'meditation') areas.appendChild(driven);
    else areas.appendChild(areaBox(k, player, ctx));
  }
  panel.appendChild(areas);

  // Z06「死即新生」：绿色"刚触发"只亮一帧 → 渲染后即用掉（下一帧转为"已用掉"灰）
  if (state.challenge?.deathJustTriggered) state.challenge.deathJustTriggered = false;

  return panel;
}

/** 挑战·卡图缩略：**右键 / 长按** → 打开「技能详情」浮窗（左键不再打开大图；与神器详情浮窗同款触发）。 */
function attachChallengeSkillsTrigger(node: HTMLElement, ctx: Ctx): void {
  const open = (): void => {
    ctx.hooks.ui.challengeSkillsOpen = true;
    ctx.hooks.requestRender();
  };
  let timer: number | null = null;
  const cancel = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    open();
  });
  node.addEventListener('pointerdown', () => {
    cancel();
    timer = window.setTimeout(() => {
      timer = null;
      open();
    }, 500);
  });
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointerleave', cancel);
  node.addEventListener('pointercancel', cancel);
  // 触屏：单击即看技能（战斗界面卡图不可选，不会与选定冲突）
  node.addEventListener('click', () => open());
}

/** 挑战·传奇「技能详情」浮窗（右键/长按卡图打开；**不再显示整张大图**），内容＝各条技能名/标记/槽/完整效果。 */
function challengeSkillsOverlay(ctx: Ctx): HTMLElement {
  const overlay = el('div', 'settings-overlay');
  overlay.dataset.act = 'challengeSkillsOverlay';
  const box = el('div', 'challenge-skills-box');
  const card = CHALLENGES.find((c) => c.id === ctx.state.challenge?.cardId);
  const title = el('div', 'challenge-skills-title');
  title.textContent = card ? `传说中的「${card.legacy}」· 技能` : '技能';
  box.appendChild(title);
  const list = el('div', 'challenge-skills-list');
  for (const [i, sk] of (card?.skills ?? []).entries()) {
    const item = el('div', 'csk-detail');
    const head = el('div', 'csk-detail-head');
    const no = el('span', 'csk-no');
    no.textContent = String(i);
    head.appendChild(no);
    const nm = el('span', 'csk-name');
    nm.textContent = sk.name;
    head.appendChild(nm);
    if (sk.marker) {
      const mk = el('span', 'csk-mark');
      mk.textContent = sk.marker;
      head.appendChild(mk);
    }
    const sl = el('span', 'csk-slot');
    sl.textContent = slotPhrase(sk.slots ?? null, sk.perGroup);
    head.appendChild(sl);
    item.appendChild(head);
    const eff = el('div', 'csk-detail-eff');
    eff.textContent = sk.effect;
    item.appendChild(eff);
    list.appendChild(item);
  }
  box.appendChild(list);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-cancel settings-close';
  close.dataset.act = 'challengeSkillsClose';
  close.textContent = '关闭 ✕';
  close.addEventListener('click', () => {
    ctx.hooks.ui.challengeSkillsOpen = false;
    ctx.hooks.requestRender();
  });
  box.appendChild(close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      ctx.hooks.ui.challengeSkillsOpen = false;
      ctx.hooks.requestRender();
    }
  });
  overlay.appendChild(box);
  return overlay;
}

function playerPanel(
  player: PlayerState,
  role: 'enemy' | 'self',
  mirrored: boolean,
  ctx: Ctx,
): HTMLElement {
  const panel = el('div', `player player--${role}`);
  panel.dataset.player = player.id;
  // **旁观者**：点玩家面板切换视角（点 A 看 A、点 B 看 B；不点不切）
  if (ctx.hooks.online?.spectator) {
    panel.classList.add('player--spectate');
    panel.addEventListener('click', () => {
      setLocalViewPlayer(player.id);
      ctx.hooks.requestRender();
    });
  }
  // 正在操作的一方加淡黄外光圈（不占布局）——**左右互搏与联机都显示**；与红/绿彩光并存（见 motion.ts panelGlow）
  if (ctx.state.phase !== 'gameOver' && actorOf(ctx.state) === player.id) {
    panel.classList.add('player--acting');
  }

  const cards = el('div', 'cards');
  // 镜像神器摆放：敌方面板按「列3、列2、列1」显示（左右互搏下随上下角色自动跟随）
  const flip = mirrored && ctx.prefs.mirrorEnemy;
  const artifacts = flip ? [...player.artifacts].reverse() : player.artifacts;
  for (const a of artifacts) cards.appendChild(artifactCard(a, ctx, player));

  // 骰区顺序恒为「敌方镜像」，与镜像开关无关
  const areas = el('div', 'areas');
  const order = mirrored ? AREA_ORDER_MIRRORED : AREA_ORDER;
  for (const k of order) areas.appendChild(areaBox(k, player, ctx));

  // 中央侧的一行 band：一端＝战术条（占 2 个神器宽），另一端＝生命条
  // （镜像神器摆放时，两者随视觉位置左右交换；无战术牌则只放生命条）
  const band = el('div', 'playband');
  if (player.tactic) {
    const bar = tacticBar(player, ctx);
    bar.style.gridColumn = flip ? '2 / span 2' : '1 / span 2';
    band.appendChild(bar);
  }
  const oppStatus: 'on' | 'off' | undefined =
    ctx.hooks.online && player.id !== ctx.hooks.online.myPlayer
      ? ctx.hooks.online.peerOnline === false
        ? 'off'
        : 'on'
      : undefined;
  const life = lifeBar(player, playerName(ctx, player.id), oppStatus);
  life.style.gridColumn = flip ? '1' : '3';
  band.appendChild(life);

  const seq = role === 'enemy' ? [cards, band, areas] : [areas, band, cards];

  // 传奇英雄面板（预设·带传奇）：两列 —— 传奇列 + 右列（神器/band/骰区堆叠）。
  // 缩略模式：传奇列"绝对填充"到右列高度（面板高度＝三行）；完整模式：顶部对齐（右列下方留白）。
  if (player.legend) {
    panel.classList.add('player--legend');
    if (flip) panel.classList.add('player--legend-right');
    panel.classList.add(ctx.prefs.cardArt === 'thumb' ? 'player--legend-thumb' : 'player--legend-full');
    const legendCol = el('div', 'legend-col');
    legendCol.appendChild(legendBox(player, ctx));
    const rightCol = el('div', 'right-col');
    for (const node of seq) rightCol.appendChild(node);
    // 镜像神器摆放：传奇列与右列左右对调
    for (const n of flip ? [rightCol, legendCol] : [legendCol, rightCol]) panel.appendChild(n);
  } else {
    for (const node of seq) panel.appendChild(node);
  }

  return panel;
}

/** 单方生命：一行的 `玩家X  [进度条]  生命 cur/max`（A 蓝 / B 红）；放该玩家第三列神器朝中央的一侧，
 *  高度由同一行 band 拉伸到与战术条一致。 */
function lifeBar(player: PlayerState, name?: string, status?: 'on' | 'off'): HTMLElement {
  const wrap = el('div', 'lifeline');
  wrap.dataset.player = player.id;
  const who = el('span', `lifeline-who player-${player.id}`);
  who.textContent = name ?? `玩家${player.id}`;
  if (status) {
    const dot = el('span', `lifeline-dot${status === 'off' ? ' lifeline-dot--off' : ''}`);
    dot.title = status === 'off' ? '对方已掉线' : '对方在线';
    who.appendChild(dot);
  }
  wrap.appendChild(who);
  const track = el('div', 'lifeline-track');
  const fill = el('i', `lifeline-fill bg-${player.id}`);
  const pct =
    player.lifeMax > 0
      ? Math.max(0, Math.min(100, Math.round((player.life / player.lifeMax) * 100)))
      : 0;
  fill.style.width = `${pct}%`;
  track.appendChild(fill);
  wrap.appendChild(track);
  const hp = el('span', `lifeline-hp life-${player.id}`);
  hp.textContent = `生命 ${player.life}/${player.lifeMax}`;
  wrap.appendChild(hp);
  return wrap;
}

/** 提示栏分段：color = 用该玩家配色高亮（用于技能名） */
interface HintPart {
  text: string;
  color?: PlayerId;
}

const weiyaReasonCn = (r: 'attack' | 'defense' | 'dustRise' | 'skill'): string =>
  r === 'attack' ? '攻击支付' : r === 'defense' ? '抵挡支付' : r === 'dustRise' ? '尘起支付' : '技能代价';

function phaseHint(ctx: Ctx): HintPart[] {
  return phaseHintInner(ctx);
}

/**
 * 全场常驻提醒（与当前操作者无关，例如 027「凛冽之音」惩罚生效期）。
 * 由 hintBox 渲染为**独立元素** `.hint-global`（放在阶段提示之后），避免与「轮到X操作」连读产生歧义。
 */
function globalHint(ctx: Ctx): HintPart[] {
  const { state } = ctx;
  if (state.phase === 'gameOver') return [];
  const out: HintPart[] = [];
  if (state.rerollPunish.A || state.rerollPunish.B) {
    const owner: PlayerId = state.rerollPunish.A ? 'A' : 'B';
    out.push({ text: `${playerName(ctx, owner)}「凛冽之音」生效中——任何玩家重掷能力骰后，被重掷方受到等量真实伤害`, color: owner });
  }
  // A07 异相·历王之血之印：本回合双方所有持续式效果失效（全回合、双方可见）
  if ((['A', 'B'] as PlayerId[]).some((id) => state.players[id].artifacts.some((a) => a.continuousLostThisTurn))) {
    out.push({ text: `${out.length ? '　｜　' : ''}「历王之血之印」生效中——本回合双方所有持续式效果失效` });
  }
  // Z12「不动菩提」：挑战者本回合被封锁的点数（**全局**：不分阶段、不看是否轮到挑战者）——
  //   挑战者几乎任何场景（攻击 / 抵挡 / 尘起 / 技能代价 / 主动弃骰）都可能受此限制，故常驻可见。
  const lockV = legendLockValue(state);
  if (lockV !== null) {
    out.push({ text: `${out.length ? '　｜　' : ''}「不动菩提」：不能用 / 耗 / 弃 ${lockV} 点能力骰`, color: 'B' });
  }
  return out;
}

function phaseHintInner(ctx: Ctx): HintPart[] {
  const { state } = ctx;
  const pd = state.pending;
  if (pd && pd.kind === 'activationResolve') {
    const a = state.players[pd.player].artifacts.find((x) => x.id === pd.artifactId);
    const skills = ARTIFACT_TEXT[pd.artifactId]?.skills ?? [];
    const t = skills.find((s) => s.side === pd.side && s.type.includes('激活')) ?? skills.find((s) => s.side === pd.side);
    return [
      { text: t?.name ?? a?.name ?? '激活', color: pd.player },
      { text: '：装填即强制结算，请完成选择后确认。' },
    ];
  }
  if (pd && pd.kind === 'sijiChuxing') {
    return [
      { text: '处刑通牒', color: pd.player },
      { text: '：使用攻击骰前须先决定——可扣 1 点计数，令本次攻击 ①伤害+1且不可抵挡 或 ②伤害+5。' },
    ];
  }
  if (pd && pd.kind === 'weijuPay') {
    return [
      { text: '畏惧', color: pd.initiator },
      { text: '：' },
      { text: playerName(ctx, pd.player), color: pd.player },
      { text: ` 必须消耗 1 颗能力骰（对方已消耗 ${pd.initiatorValue} 点）——随后比较双方消耗的能力骰点数大小；1 视为大于 6；请选择` },
    ];
  }
  // 挑战模式：昔传回合（逐条结算中）→ 提示"正在结算哪一条"（技能名用昔传玩家色）
  // ⚠️ 必须排除 `pendingAttack`——昔传发起攻击、挑战者正选"是否抵挡"时，要走下面的"攻击提示"分支
  //    （否则这句会盖住攻击提示，连"本次伤害/加伤"都看不到；真实事故 2026-10-10）。
  if (
    ctx.state.mode === 'challenge' &&
    ctx.state.activePlayer === 'B' &&
    !pd &&
    !ctx.state.pendingAttack &&
    ctx.state.challenge?.resumeAt != null
  ) {
    const card = CHALLENGES.find((c) => c.id === ctx.state.challenge?.cardId);
    const sk = card?.skills?.[ctx.state.challenge.activeSkill ?? 0];
    const parts: HintPart[] = [{ text: `「${LEGEND_DISPLAY_NAME}」正在结算：` }];
    parts.push(sk?.name ? { text: sk.name, color: 'B' } : { text: '…' });
    return parts;
  }
  if (pd && pd.kind === 'challengePick') {
    // Z04「D1：开局选骰」——提示语原样展示（不再是"挑战模式 · 代决："格式）
    if (pd.tag === 'assign') return [{ text: pd.prompt }];
    // 代决提示：把开头的「技能名」拆出来、用昔传玩家色；其余保持素色
    const m = /^「([^」]+)」/.exec(pd.prompt);
    if (m) {
      return [
        { text: '挑战模式 · 代决：' },
        { text: `「${m[1]}」`, color: 'B' },
        { text: pd.prompt.slice(m[0].length) },
      ];
    }
    return [{ text: `挑战模式 · 代决：${pd.prompt}` }];
  }
  if (pd && pd.kind === 'gongzhenPick') {
    const CN: Record<string, string> = { attack: '攻击', defense: '防御', meditation: '冥想' };
    return [
      { text: '共振', color: pd.player },
      { text: `：重掷后落入${CN[pd.areaKind]}骰区；请选择 ①双方各获得 2 颗 / ②双方各弃置 2 颗（弃置由你指定）` },
    ];
  }
  if (pd && pd.kind === 'chargeResolve') {
    return [
      { text: '凶弹业舞', color: pd.player },
      { text: '：充能效果 — 选择任意玩家的 1 颗能力骰，移到该玩家的另一个区域（保留点数）。' },
    ];
  }
  if (pd && pd.kind === 'chenaiFreeRise') {
    return [
      { text: '尘起', color: pd.player },
      { text: '：你通过攻击造成了伤害，可以立即进行 1 次无需冥想骰的额外尘起行动；是否发动？' },
    ];
  }
  if (pd && pd.kind === 'kongYuluo') {
    return [
      { text: '雨落狂流', color: pd.player },
      { text: '：计数达到 3（已重设为 0），请选择 1 项执行——① 弃置对方的 1 个能力骰；② 获得 1 个随机点数的能力骰并移入你的任意区域；或选择不发动。' },
    ];
  }
  if (pd && pd.kind === 'anyexiongshen') {
    return [
      { text: '暗夜凶神', color: pd.player },
      { text: '：你通过「锋芒」取消了对方的防御骰，可以使「不祥」的计数 +1（最高 3 层）；是否发动？' },
    ];
  }
  if (pd && pd.kind === 'bacheng') {
    return [
      { text: '拔城', color: pd.player },
      { text: '：对方弃置的能力骰少于你消耗的，你可以视为以 5 点进行 1 次攻击，并切换「主宰」的技能；是否发动？' },
    ];
  }
  if (pd && pd.kind === 'wufaraoshu') {
    return [
      { text: '无法饶恕', color: pd.player },
      { text: `：你的攻击造成了伤害，可以弃置对方 1 个 ${pd.value} 点防御骰；是否发动？` },
    ];
  }
  if (pd && pd.kind === 'dizuidaijianshu') {
    return [
      { text: '涤罪大剑术', color: pd.player },
      { text: '：你进行了 1 次尘起行动，且第一列与第二列神器的激活标记在同一侧；可以弃置对方 2 个"种类不相同"的能力骰。' },
    ];
  }
  if (pd && pd.kind === 'nudengzuiren') {
    return [
      { text: '汝等罪人', color: pd.player },
      { text: `：你将回复 ${pd.amount} 点生命；可以改为对对方造成等量的真实伤害。` },
    ];
  }
  if (pd && pd.kind === 'shangjin') {
    return [
      { text: '只为赏金而来', color: pd.player },
      { text: '：你发动了「处刑通牒」；可以立即启动你的 1 个已激活的"启动式"技能（不计入每回合 1 次的上限）。' },
    ];
  }
  if (pd && pd.kind === 'shizushouhun') {
    return [
      { text: '始祖兽魂', color: pd.player },
      { text: '：你激活了「兽魂」；可以额外消耗 1 个冥想骰，改为将其计数重设为 3。' },
    ];
  }
  if (pd && pd.kind === 'fuchouRise') {
    return [
      { text: '复仇之灵', color: pd.player },
      { text: '：你的生命十位数发生变化，必须立即进行 1 次无需冥想骰的额外尘起行动（请选择尘起目标）。' },
    ];
  }
  if (pd && pd.kind === 'yuanwu') {
    return [
      { text: '圆舞', color: pd.player },
      { text: '：你受到了自己造成的伤害，必须将 1 个能力骰移动到你的另 1 个区域（先选骰、再选区域）。' },
    ];
  }
  if (pd && pd.kind === 'shouhunCancel') {
    return [
      { text: '兽魂', color: pd.owner },
      { text: '：' },
      { text: playerName(ctx, pd.owner), color: pd.owner },
      { text: ` 将受到 ${pd.attack.value} 点攻击伤害，且「兽魂」计数 ≥${pd.minCount}；你可以取消该伤害（令其计数 −1）。` },
    ];
  }
  if (pd && pd.kind === 'weimu') {
    return [
      { text: '帷幕', color: pd.player },
      { text: '（对方的重掷阶段结束时）：可受到 2 点真实伤害，并弃置对方的 1 个能力骰；请选择' },
    ];
  }
  if (pd && pd.kind === 'zhihaiReroll') {
    return [
      { text: '漆黑绽放', color: pd.player },
      {
        text: pd.forced
          ? `计数达 5 · 必杀强制发动（无论现在是谁的回合）：已获得 ${pd.x} 个随机能力骰；请选择要重掷的骰子（0–${pd.x} 颗，可含刚获得的骰）`
          : `：已获得 ${pd.x} 个随机能力骰；请选择要重掷的骰子（0–${pd.x} 颗，可含刚获得的骰）`,
      },
    ];
  }
  if (pd && pd.kind === 'caiyuliu') {
    return [{ text: '裁雨流', color: pd.player }, { text: '：选择该骰去向。' }];
  }
  if (pd && pd.kind === 'c01Caiyuliu') {
    return [
      { text: '极之境·裁雨流', color: pd.player },
      { text: '：你用攻击骰造成了伤害，可将其重新投掷并按新点数移回你的对应区域。' },
    ];
  }
  if (pd && pd.kind === 'fengmang') {
    return [
      { text: '锋芒', color: pd.player },
      { text: '：可发动（消耗 1 攻击骰 + 1 冥想骰）或不发动。' },
    ];
  }
  if (pd && pd.kind === 'guwangCharge') {
    return [
      { text: '高塔铁幕', color: pd.player },
      { text: '：可将对方 1 个攻击骰点数改为 1。' },
    ];
  }
  if (pd && pd.kind === 'guwangCancel') {
    return [
      { text: '高塔铁幕', color: pd.player },
      { text: `：受到 ${pd.amount} 点真实伤害，可消耗 1 个防御骰取消。` },
    ];
  }
  if (pd && pd.kind === 'shenhongKill') {
    return [
      { text: '杀意', color: pd.player },
      { text: '：本回合补充≤3，可造成 3 点真实伤害并回复 2 点生命。' },
    ];
  }
  if (pd && pd.kind === 'aidao') {
    return [
      { text: '哀悼', color: pd.player },
      { text: '：本回合补充≤3，可造成 2 点真实伤害并弃置对方的 1 个防御骰。' },
    ];
  }
  if (pd && pd.kind === 'duanexing') {
    return [
      { text: '闻我名者断恶行', color: pd.player },
      { text: '：你受到伤害，可弃置对方的 1 个攻击骰（每回合 1 次）。' },
    ];
  }
  if (pd && pd.kind === 'dunwuHalve') {
    return [
      { text: '灵能屏障', color: pd.player },
      { text: '：可消耗 1 个冥想骰，使本次攻击伤害减半。' },
    ];
  }
  if (pd && pd.kind === 'dunwuPulse') {
    return [
      { text: '灵能脉冲', color: pd.player },
      { text: `：可造成 ${pd.amount} 点真实伤害（本回合消耗 ${pd.amount} 颗能力骰）。` },
    ];
  }
  if (state.pending && state.pending.kind === 'leibaoReroll') {
    return [
      { text: '雷暴', color: state.pending.player },
      { text: '：对方重掷阶段结束，可插入一个你的重掷阶段（重掷 1 次、骰数 ≤ 速度）。' },
    ];
  }
  if (state.pending && state.pending.kind === 'dianxing') {
    const vals = (state.pending.values ?? [1, 2, 3]).join('、');
    return [
      { text: '电刑', color: state.pending.player },
      { text: `：你使用了攻击骰，可消耗 2 个冥想骰（依次以 ${vals} 点各进行一次攻击）。` },
    ];
  }
  if (state.pending && state.pending.kind === 'leibao') {
    return [
      { text: '雷暴', color: state.pending.player },
      { text: '：你的攻击被抵挡，可将最多 2 个冥想骰移动到攻击骰区（保留点数）。' },
    ];
  }
  if (pd && pd.kind === 'weiyaPick') {
    return [
      { text: '威压', color: pd.player },
      {
        text: `（${playerName(ctx, pd.player)} 的「哀歌」）：${playerName(ctx, pd.player)} 刚使用了 1 个能力骰（${weiyaReasonCn(pd.reason)}），可令自己或对方的 1 颗能力骰点数变为 ${pd.value}（保留原区域）；请选择`,
      },
    ];
  }
  if (pd && pd.kind === 'xianzhenPick') {
    return [
      { text: '陷阵', color: pd.owner },
      {
        text: `（${playerName(ctx, pd.owner)} 的「哀歌」）：${playerName(ctx, pd.owner)} 的重掷阶段结束，由生命最少的一方（${playerName(ctx, pd.player)}）选择弃置 ${playerName(ctx, pd.owner)} 的 1 颗能力骰；随后 ${playerName(ctx, pd.owner)} 获得另外两类各 1 颗；请选择`,
      },
    ];
  }
  if (pd && pd.kind === 'hengguan') {
    return [
      { text: '横贯', color: pd.player },
      { text: `：攻击被抵挡后，可弃置对方 1 颗点数小于本次攻击（${pd.value} 点）的能力骰；请选择` },
    ];
  }
  if (pd && pd.kind === 'hanguangPick') return []; // 面板已说明，不再重复（避免与「轮到X操作」连读）
  if (state.pendingAttack) {
    const pa = state.pendingAttack;
    const bonus = pa.bonusValue !== undefined ? { value: pa.bonusValue, label: pa.bonusLabel } : attackDamageBonus(state, pa.attacker);
    const parts: HintPart[] = [];
    // 点数被改判（028「视为6」/ L06 ±1）→ 提示栏也要写明，别只说"被 3 点攻击骰攻击"却按 6 算
    const pointNote = attackPointNote(state, pa);
    if (pa.sourceValue !== undefined) {
      parts.push({ text: `被 ${pa.sourceValue} 点攻击骰${pointNote ? `（${pointNote}）` : ''}攻击，本次 ${pa.value} 伤害` });
    } else if (pa.sourceSkill) {
      // 技能发起的攻击：写明"由该技能引起"，并区分「持有者自己发起 / 他人因该效果发起」
      // 技能名**按所属方取色**（昔传=B 红；将来涉及挑战者则是 A 蓝）——不按名字，避免重名串色
      parts.push({ text: playerName(ctx, pa.attacker), color: pa.attacker });
      parts.push({ text: pa.sourceSkillOwner === pa.attacker ? '「' : ' 因对方「' });
      parts.push({ text: pa.sourceSkill, color: pa.sourceSkillOwner });
      const noDie = `无攻击骰${pointNote ? `，${pointNote}` : ''}`;
      parts.push({
        text:
          pa.sourceSkillOwner === pa.attacker
            ? `」发起攻击，本次 ${pa.value} 伤害（${noDie}）`
            : `」效果而发起攻击，本次 ${pa.value} 伤害（${noDie}）`,
      });
    } else {
      parts.push({ text: `本次 ${pa.value} 伤害（技能攻击，无攻击骰${pointNote ? `，${pointNote}` : ''}）` });
    }
    if (bonus.value > 0) {
      parts.push({ text: '（' });
      // 加成归属＝**发起攻击方**（昔传攻击＝B 红）；技能名按所属方取色
      if (bonus.label) parts.push({ text: `「${bonus.label}」`, color: pa.attacker });
      parts.push({ text: `加成 ${bonus.value} 伤害）` });
    }
    if (pa.halveReason) {
      // 减半来自**防守方**的卡（411 灵能屏障 / 023 畏惧 / 021 满计数）→ 按防守方取色
      parts.push({ text: '（「' });
      parts.push({ text: pa.halveReason, color: oppOf(pa.attacker) });
      parts.push({ text: '」减半）' });
    }
    if (pa.unblockable) parts.push({ text: '（不可抵挡）' });
    // 028 天罚：说明"受哪张卡影响、只能用哪类骰抵挡"
    if (pa.blockKind) {
      const skillName = pa.blockKind === 'meditation' ? '白昼之火' : '陨落';
      const kindCn = pa.blockKind === 'meditation' ? '冥想' : '攻击';
      parts.push({ text: `（受 ` });
      parts.push({ text: playerName(ctx, pa.attacker), color: pa.attacker });
      parts.push({ text: ' 的「' });
      parts.push({ text: skillName, color: pa.attacker }); // 该技能属**攻击方**的天罚
      parts.push({ text: `」影响：只能用${kindCn}骰抵挡）` });
    }
    // 挑战模式"因多组触发的攻击"：显示「（第 K / N 组 · 本组第 j / m 次）」
    //（遁入暗影每组 1 段 → 只有"（第 K / N 组）"；数罪并罚 2 段 / 电刑 3 段 → 带组内序号）
    if (pa.legendGroup) {
      const lg = pa.legendGroup;
      if (lg.total <= 1 && lg.sub != null) {
        // 只有 1 组（Z06 虚无形态的 5 段）→ 不写"组"，只显组内序号
        parts.push({ text: `（第 ${lg.sub} / ${lg.subTotal} 次）` });
      } else if (lg.sub != null) {
        parts.push({ text: `（第 ${lg.index} / ${lg.total} 组 · 本组第 ${lg.sub} / ${lg.subTotal} 次）` });
      } else {
        parts.push({ text: `（第 ${lg.index} / ${lg.total} 组）` });
      }
    }
    // Z06「冥界行走·白」（本回合）：其攻击造成伤害 → 回复该点数一半（提示挑战者"让它伤到会回血"）
    if (state.mode === 'challenge' && pa.attacker === 'B' && state.challenge?.mingjieHeal) {
      parts.push({ text: '（造成伤害后「' });
      parts.push({ text: '冥界行走·白', color: 'B' });
      parts.push({ text: '」回复该攻击点数一半的生命（向上取整））' });
    }
    parts.push({ text: '；请选择' });
    return parts;
  }
  if (pd) {
    if (pd.kind === 'kuyu') {
      return [
        { text: `（${playerName(ctx, pd.player)} 的「` },
        { text: '梦魇', color: pd.player },
        { text: '」）：主要阶段结束，请宣称 1 个能力骰类型；请选择' },
      ];
    }
    if (pd.kind === 'tiaolingPick') {
      const legendDuty = ctx.state.mode === 'challenge' && (pd.owner ?? pd.player) !== pd.player;
      return [
        { text: '（「' },
        { text: '凋零', color: pd.player },
        {
          text: legendDuty
            ? `」）：${playerName(ctx, pd.player)} 回合结束，请择①全相同/②全不同 → 再选要保留的点数（其余自动弃置）；请选择`
            : `」）：${playerName(ctx, pd.player)} 回合结束，请择①全相同/②全不同并弃置自己的能力骰（可弃 0 颗、也可多弃）；请选择`,
        },
      ];
    }
    if (pd.kind === 'endDiscard') {
      return [{ text: `（${playerName(ctx, pd.player)}）：结束阶段，能力骰总数超出意志上限，请自行选择要弃置的能力骰；请选择` }];
    }
    if (pd.kind === 'wanzhangDiscard') {
      return [
        { text: `（${playerName(ctx, pd.player)} 的「` },
        { text: '千劫', color: pd.player },
        { text: '」）：主要阶段开始，请弃置 2 个能力骰；请选择' },
      ];
    }
    if (pd.kind === 'putiPick') {
      return [
        { text: `（${playerName(ctx, pd.player)} 的「` },
        { text: '金刚', color: pd.player },
        {
          text: `」）：对方${pd.mode === 'block' ? '用防御骰抵挡' : '使用了攻击骰'}——可移除神器上 ${pd.value} 点存放骰以取消其效果；请选择`,
        },
      ];
    }
  }
  switch (state.phase) {
    case 'initialReroll':
      return [{ text: '初始重掷：可点选任意数量的骰子后点「重掷选中」，或点「跳过」。' }];
    case 'reroll': {
      // 可重掷次数与引擎**同一口径**：游龙万象 2 次、其它 1 次；013 雷暴插入的额外重掷阶段固定 1 次（不叠加）
      const rp = state.players[state.activePlayer];
      const allowance = state.extraReroll ? 1 : rerollAllowance(rp);
      const parts: HintPart[] = [
        {
          text: `重掷阶段：本阶段可重掷 ${allowance} 次（已用 ${state.rerollUsed}）——点选骰子后点「重掷选中」；或点「跳过重掷」。`,
        },
      ];
      if (state.extraReroll) {
        parts.push({ text: '（' });
        parts.push({ text: '「雷暴」', color: rp.id });
        parts.push({ text: '插入的额外重掷阶段：仅 1 次）' });
      } else if (allowance === 2 && hasActiveSkill(rp, 'youlong.wanxiang')) {
        parts.push({ text: '（' });
        parts.push({ text: '「龙游万象」', color: rp.id });
        parts.push({ text: '：速度 +1，且每回合的重掷阶段可重掷 2 次）' });
      }
      return parts;
    }
    case 'dustRise': {
      const rp = state.players[state.activePlayer];
      const parts: HintPart[] = [
        { text: '尘起阶段：点卡上的尘起按钮，或结束该阶段（不行动会 +尘落）。' },
      ];
      // 战术牌 T12「激进」：首个尘起阶段可额外充能第三列神器 1 次
      if (TACTIC_BY_ID[rp.tactic ?? '']?.key === 'jijin' && state.firstRound[rp.id] && !rp.tacticOnceUsed) {
        parts.push({ text: '（' });
        parts.push({ text: '「激进」', color: rp.id });
        parts.push({ text: '：本尘起阶段可对第三列神器额外充能 1 次）' });
      }
      // L02 传奇面板·残影：每个尘起阶段可进行最多 2 次"尘起行动"
      if (hasActiveSkill(rp, 'ying.canying')) {
        const left = Math.max(0, 2 - state.dustRiseNormalCount);
        parts.push({ text: '（' });
        parts.push({ text: '「残影」', color: rp.id });
        parts.push({ text: `：本尘起阶段可进行最多 2 次「尘起行动」（剩余 ${left} 次））` });
      }
      // L10 传奇面板·涤罪大剑术：尘起行动后，若第一/二列激活标记同侧，可弃对方 2 个种类不同的能力骰
      if (hasActiveSkill(rp, 'mate.dizuidaijianshu')) {
        parts.push({ text: '（' });
        parts.push({ text: '「涤罪大剑术」', color: rp.id });
        parts.push({ text: '：你进行 1 次尘起行动后，若第一列与第二列神器的激活标记在同一侧，可弃置对方 2 个种类不同的能力骰）' });
      }
      return parts;
    }
    case 'main':
      return [{ text: '主要阶段：可启动技能、发动攻击（顺序不限）；完成后「结束回合」。' }];
    case 'gameOver':
      return state.winner
        ? [
            { text: '游戏结束，胜者：' },
            { text: playerName(ctx, state.winner), color: state.winner },
            { text: '。' },
          ]
        : [{ text: '游戏结束，平局。' }];
    default:
      return [];
  }
}

export function actorOf(state: GameState): PlayerId {
  // 待决策**优先**：它才是当前必须做决定的人。
  // （026 威压这类待决策会与「待抵挡」同时存在，且决策人可能是**攻击方**——旧的先判 pendingAttack 会把它算成防守方）
  if (state.pending) return state.pending.player;
  if (state.pendingAttack) return state.pendingAttack.attacker === 'A' ? 'B' : 'A';
  return state.activePlayer;
}

/**
 * 联机·非本人操作：当前"该操作的人"不是本机 → 本机**只能看、不能操作**。
 * - 左右互搏（无 online）恒 false → 原路径完全不变。
 * - 游戏结束放行（双方都要能点「回大厅」）。
 * 用于把**所有决策表面**（操作区各面板 / 骰区点击 / 卡片技能名 / 战前战术牌弹窗）统一降级为只读。
 */
function onlineNonActor(ctx: Ctx): boolean {
  const on = ctx.hooks.online;
  // 旁观者：**永远**只读（myPlayer 为 null，actorOf 恒不等于它，这里再显式兜一层）
  if (on?.spectator) return ctx.state.phase !== 'gameOver';
  return !!on && ctx.state.phase !== 'gameOver' && actorOf(ctx.state) !== on.myPlayer;
}

/**
 * 「谁在下方」＝视角归属者。
 * - **左右互搏**：＝当前操作者 `actorOf`（谁操作谁在下方，换手会镜像整盘）。
 * - **联机（将来）**：改为**本机玩家（固定）** → 则 `prevView === viewTarget` 恒成立，**永不触发视角切换**。
 * 视角切换 / 两阶段等逻辑**只依赖本函数**；联机改造只需改这里（其余不动）。
 */
let viewOwnerOverride: PlayerId | null = null;

/**
 * 联机：设置"本机玩家"（**固定视角**）；传 `null` 复原＝左右互搏（`actorOf`：谁操作谁在下方）。
 * 这是"视角切换 / 两阶段"的**唯一开关**——联机下 `viewOwnerOf` 恒定 → `holdView` 永远为假 → 不切视角。
 */
export function setLocalViewPlayer(p: PlayerId | null): void {
  viewOwnerOverride = p;
}

function viewOwnerOf(state: GameState): PlayerId {
  return viewOwnerOverride ?? actorOf(state);
}

function hintBox(ctx: Ctx): HTMLElement {
  const hint = el('div', 'hint');
  const left = el('div', 'hint-left');
  // Z04「D1：开局选骰」＝替昔传做决定 → "轮到 X 操作"写「昔日传奇」而非决策者(A)，且不算"强制执行"
  const isAssign =
    ctx.state.pending?.kind === 'challengePick' && (ctx.state.pending as { tag?: string }).tag === 'assign';
  const actor = actorOf(ctx.state);
  const who0 = isAssign ? 'B' : actor;
  const turn = el('span', 'hint-turn');
  turn.appendChild(document.createTextNode('轮到 '));
  const who = el('span', `hint-player player-${who0}`);
  who.textContent = playerName(ctx, who0 as typeof actor);
  turn.appendChild(who);
  turn.appendChild(document.createTextNode(' 操作'));
  // 待决策属于非当前玩家（跨回合强制触发，如 018 强制必杀 / 017 帷幕）→ 明确标注
  if (!isAssign && ctx.state.pending && ctx.state.pending.player !== ctx.state.activePlayer) {
    const forced = el('span', 'hint-forced');
    forced.textContent = '（强制执行）';
    turn.appendChild(forced);
  }
  left.appendChild(turn);
  const phase = el('span', 'hint-phase');
  for (const part of phaseHint(ctx)) {
    if (part.color) {
      const strong = el('span', `hint-skill player-${part.color}`);
      strong.textContent = part.text;
      phase.appendChild(strong);
    } else {
      phase.appendChild(document.createTextNode(part.text));
    }
  }
  left.appendChild(phase);
  // 全场常驻提醒（独立元素；不与「轮到X操作」连读）
  const glob = globalHint(ctx);
  if (glob.length > 0) {
    const owner = glob[0].color;
    const g = el('span', `hint-global${owner ? ` player-${owner}` : ''}`);
    g.textContent = glob.map((p) => p.text).join('');
    left.appendChild(g);
  }
  // 主要阶段的「攻击提示」：只列出此刻可用的攻击相关修正（独占一行，由 .hint-notes 的 flex:1 1 100% 保证）
  const notes = battleNotes(ctx.state, actor);
  if (notes.length > 0) {
    const line = el('div', 'hint-notes');
    line.dataset.role = 'battle-notes';
    line.appendChild(document.createTextNode('攻击提示：'));
    notes.forEach((n, i) => {
      if (i > 0) line.appendChild(document.createTextNode('　｜　'));
      const skill = el('span', `hint-skill player-${n.color ?? actor}`);
      skill.textContent = `「${n.label}」`;
      line.appendChild(skill);
      line.appendChild(document.createTextNode(n.text));
    });
    left.appendChild(line);
  }
  // UI 层错误提示（非法操作等）：只在这里显示，不落进引擎状态/战报
  if (ctx.hooks.ui.error) {
    const err = el('span', 'hint-error');
    err.textContent = `｜${ctx.hooks.ui.error}`;
    left.appendChild(err);
  }
  hint.appendChild(left);
  // 尘落计数：操作栏右上角。墨底小徽标（大号等宽数字 + 「尘落」小标签 + 弱化 /10）；数值变化时数字弹一下。
  // 挑战模式：单人挑战**不存在尘落** → 不渲染该徽标（仅挑战模式，标准模式不变）。
  if (ctx.state.mode !== 'challenge') {
    const curDust = ctx.state.dustfall;
    const prevDust = lastDustfall.get(ctx.state);
    lastDustfall.set(ctx.state, curDust);
    const dust = el('span', 'hint-dust');
    dust.dataset.alert = curDust >= 10 ? '10' : curDust >= 7 ? '7' : '0';
    const dustLabel = el('span', 'hint-dust-label');
    dustLabel.textContent = '尘落';
    const dustNum = el('span', 'hint-dust-num');
    dustNum.textContent = String(curDust);
    const dustMax = el('span', 'hint-dust-max');
    dustMax.textContent = '/ 10';
    dust.append(dustLabel, dustNum, dustMax);
    if (prevDust !== undefined && prevDust !== curDust) {
      dust.dataset.bump = '1';
      bumpEl(dustNum);
    }
    hint.appendChild(dust);
  }
  return hint;
}

/** 中央操作区：把「轮到谁 + 阶段提示」与下方的操作栏合并为一块 */
function actionZone(ctx: Ctx): HTMLElement {
  const zone = el('div', 'actionzone');
  // 联机：行动倒计时进度条（细紫、融进下框线；两端同一条）
  if (ctx.hooks.online) {
    turnTimerTick();
    zone.appendChild(el('i', 'turn-timer'));
  }
  zone.appendChild(hintBox(ctx));
  // 联机·非本人操作：只给只读说明，不渲染任何可点决策面板
  //（一处覆盖：操作列表 / 置换·全知·雨汇·影子·远见得骰·友敌·适配·锋芒·威压 面板 / 技能选择器 / 尘起流程 / 确认条）
  if (onlineNonActor(ctx)) {
    const note = el('div', 'actionlist-readonly');
    note.textContent = ctx.hooks.online?.spectator
      ? '旁观中（只读）· 点击任一玩家面板可切换视角'
      : `对方正在操作：${opponentActingText(ctx)}`;
    zone.appendChild(note);
    return zone;
  }
  const ui = ctx.hooks.ui;
  if (ui.convertPick) {
    zone.appendChild(convertPickPanel(ctx));
  } else if (ui.quanzhi) {
    zone.appendChild(quanzhiPanel(ctx));
  } else if (ctx.state.pending?.kind === 'yuhuiPlace') {
    zone.appendChild(yuhuiPanel(ctx));
  } else if (ctx.state.pending?.kind === 'yingziPick') {
    zone.appendChild(yingziPanel(ctx));
  } else if (ctx.state.pending?.kind === 'yuanjianGain') {
    zone.appendChild(yuanjianPanel(ctx));
  } else if (ctx.state.pending?.kind === 'youdiMove') {
    zone.appendChild(youdiPanel(ctx));
  } else if (ctx.state.pending?.kind === 'shipeiPick') {
    zone.appendChild(shipeiPanel(ctx));
  } else if (ui.fengmangPick && ui.pendingConfirm == null) {
    zone.appendChild(fengmangPanel(ctx));
  } else if (ui.dustFlow) {
    zone.appendChild(dustFlowView(ctx));
  } else if (challengePickHeld(ctx)) {
    // 【先动画，再选择】传奇那一段过场（技能名 + 驱骰进槽）还没播完 → 先显示占位，播完自动重绘出选项
    const note = el('div', 'actionlist-readonly');
    note.textContent = `「${LEGEND_DISPLAY_NAME}」发动中…`;
    zone.appendChild(note);
    const left = legendPickHoldUntil - performance.now();
    window.setTimeout(() => ctx.hooks.requestRender(), Math.max(40, left + 20));
  } else if (challengePickHasChips(ctx)) {
    // 挑战代决"从池子里选 n 颗" → 骰片面板（选满才可确认）
    zone.appendChild(challengeChipsPanel(ctx));
  } else {
    const confirm = confirmRow(ctx);
    if (confirm) {
      zone.appendChild(confirm);
    } else if (ui.selection) {
      const chooser = chooserPanel(ctx);
      if (chooser) zone.appendChild(chooser);
    } else {
      zone.appendChild(operationList(ctx));
    }
  }
  return zone;
}

/** 挑战模式：代决面板是否还在"等传奇过场动画播完"（先动画，再选择）。 */
function challengePickHeld(ctx: Ctx): boolean {
  return (
    ctx.state.mode === 'challenge' &&
    ctx.state.pending?.kind === 'challengePick' &&
    typeof performance !== 'undefined' &&
    performance.now() < legendPickHoldUntil
  );
}

/** 挑战代决带 `pick`（"从池子里选 n 颗"）→ 用**骰片面板**（不再是固定组合按钮）。 */
function challengePickHasChips(ctx: Ctx): boolean {
  const pd = ctx.state.pending;
  return pd?.kind === 'challengePick' && !!pd.pick;
}

/** 切换"骰片选择"里的某一颗（**面板骰片**与**骰区骰子**双入口共用）。 */
function toggleChallengePickDie(ctx: Ctx, id: string): void {
  const pd = ctx.state.pending;
  if (pd?.kind !== 'challengePick' || !pd.pick) return;
  const ui = ctx.hooks.ui;
  const sel = ui.challengePickSel ?? (ui.challengePickSel = []);
  const i = sel.indexOf(id);
  if (i >= 0) sel.splice(i, 1);
  else if (sel.length < pd.pick.n) sel.push(id);
  ctx.hooks.requestRender();
}

/** 该骰是否属于当前"挑战代决·骰片选择"的池子（用于骰区双入口）。按 **`pick.owner`**（骰子归属）判，不是"代决者"。 */
function challengeDieInChipPool(ctx: Ctx, d: { id: string }, player: { id: PlayerId }): boolean {
  const pd = ctx.state.pending;
  if (pd?.kind !== 'challengePick' || !pd.pick) return false;
  const owner = pd.pick.owner ?? pd.player;
  return owner === player.id && pd.pick.pool.some((x) => x.id === d.id);
}

/** 挑战·代决"骰片选择"面板：骰片可点；**选满 n 颗才能确认**（确认时 id 拼成逗号串派发 `challengePick`）。 */
function challengeChipsPanel(ctx: Ctx): HTMLElement {
  const pd = ctx.state.pending as {
    kind: 'challengePick';
    player: PlayerId;
    prompt: string;
    options: { id: string; label: string }[];
    pick: { pool: { id: string; value: number; kind: DiceKind }[]; n: number; owner?: PlayerId };
  };
  const pick = pd.pick;
  const ui = ctx.hooks.ui;
  // 换了代决（提示语 / 池子 变）→ 重置已选
  const sig = `${pd.prompt}|${pick.pool.map((x) => x.id).join(',')}`;
  if (ui.challengePickSig !== sig) {
    ui.challengePickSig = sig;
    ui.challengePickSel = [];
  }
  const sel = ui.challengePickSel ?? (ui.challengePickSel = []);
  const panel = el('div', 'selector selector--head-row');
  const head = el('div', 'selector-head');
  const title = el('div', 'selector-title');
  title.textContent = pd.prompt;
  head.appendChild(title);
  const info = el('div', 'selector-info');
  info.textContent = `已选 ${sel.length}（需 ${pick.n} 颗）`;
  head.appendChild(info);
  panel.appendChild(head);
  const box = el('div', 'pay-dice');
  for (const d of pick.pool) {
    // 骰片颜色＝**骰子归谁**（`pick.owner`），不是"谁在代决"——传奇自己的骰（遁入/龙腾/净化/尘起）应为 B 红
    const chip = el('span', `pay-die die-${pick.owner ?? pd.player}`);
    chip.dataset.id = d.id;
    chip.dataset.value = String(d.value);
    chip.textContent = `${KIND_SHORT[d.kind]}${d.value}`;
    if (sel.includes(d.id)) chip.classList.add('selected');
    chip.classList.add('clickable');
    chip.title = '点击选择该骰';
    chip.addEventListener('click', () => toggleChallengePickDie(ctx, d.id));
    box.appendChild(chip);
  }
  panel.appendChild(box);
  const row = el('div', 'selector-actions');
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'btn btn-confirm';
  ok.dataset.act = 'challengePickConfirm';
  ok.textContent = '确认';
  ok.disabled = sel.length !== pick.n;
  ok.addEventListener('click', () => {
    ctx.hooks.onAction({ t: 'challengePick', id: sel.join(',') });
    ui.challengePickSel = [];
  });
  row.appendChild(ok);
  panel.appendChild(row);
  return panel;
}

function confirmRow(ctx: Ctx): HTMLElement | null {
  const pc = ctx.hooks.ui.pendingConfirm;
  if (!pc) return null;
  const row = el('div', 'confirm-row');

  const label = el('span', 'confirm-label');
  label.textContent = `${pc.label}？`;
  row.appendChild(label);

  // L12「知我心者立地成佛」发动前预览：告诉玩家"现在发动会造成几点真实伤害"（区域数＝引擎唯一来源）
  if (pc.action.t === 'skill' && pc.action.params?.legendKey === 'miyun.lidichengfo') {
    const n = lidichengfoRegions(ctx.state).length;
    const hint = el('span', 'confirm-hint');
    hint.textContent = `目前双方共有 ${n} 个“有且只有 1 种点数”的区域 → 会造成 ${6 * n} 点真实伤害`;
    row.appendChild(hint);
  }

  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'btn btn-confirm';
  ok.dataset.act = 'confirm';
  ok.textContent = '确认';
  ok.addEventListener('click', () => ctx.hooks.onAction(pc.action));
  row.appendChild(ok);

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-cancel';
  cancel.dataset.act = 'cancel';
  cancel.textContent = '取消';
  cancel.addEventListener('click', () => {
    ctx.hooks.ui.pendingConfirm = null;
    ctx.hooks.requestRender();
  });
  row.appendChild(cancel);

  return row;
}

function advanceLabel(phase: Phase): string {
  switch (phase) {
    case 'dustRise':
      return '结束尘起阶段';
    case 'initialReroll':
      return '跳过';
    case 'reroll':
      return '跳过重掷';
    case 'main':
      return '结束回合';
    default:
      return '跳过';
  }
}

function actionLabel(ctx: Ctx, a: Action): string | null {
  // 025 屠虎·奇袭：把能力骰「视为攻击骰」发起攻击 → 文案必须点明「视为」，不可与真攻击骰混淆
  if (a.t === 'attack' && a.costSlots[0]?.treated === true) {
    const d = findDie(ctx.state, a.costSlots[0].dieIds[0]);
    return d ? `将 ${KIND_SHORT[d.kind]}${d.value} 视为攻击骰发起攻击` : '将能力骰视为攻击骰发起攻击';
  }
  const segs = actionDieSegments(ctx, a);
  if (segs) return segsToText(ctx, segs);
  const { state } = ctx;
  switch (a.t) {
    case 'advance':
      return advanceLabel(state.phase);
    case 'block':
      return '不抵挡';
    case 'dustRise': {
      const owner: PlayerId =
        a.fuchou && state.pending?.kind === 'fuchouRise' ? state.pending.player : state.activePlayer;
      const art = state.players[owner].artifacts.find((x) => x.id === a.artifactId);
      return art ? dustEntryLabel(art) : '尘起';
    }
    case 'caiyuliu':
      return a.to === 'defense' ? '「裁雨流」移到防御骰区' : a.to === 'meditation' ? '「裁雨流」移到冥想骰区' : '不发动「裁雨流」';
    case 'c01Caiyuliu':
      return a.accept ? '发动「极之境·裁雨流」（重掷该攻击骰）' : '不发动「极之境·裁雨流」';
    case 'guwangCharge':
      return '不变更';
    case 'chuxingPick':
      return a.pick === 'none'
        ? '不发动「处刑通牒」'
        : a.pick === 'unblockable'
          ? '① 本次攻击伤害 +1 且不可抵挡'
          : '② 本次攻击伤害 +5';
    case 'gongzhenResolve':
      return a.pick === 'gain' ? '① 双方各获得 2 颗' : '② 双方各弃置 2 颗';
    case 'challengePick': {
      const pd = state.pending;
      if (pd?.kind !== 'challengePick') return null;
      return pd.options.find((o) => o.id === a.id)?.label ?? null;
    }
    case 'weijuPay':
      return '消耗 1 颗能力骰';
    case 'guwangCancel':
      return '不发动「高塔铁幕」';
    case 'dunwuHalve':
      return '不发动「灵能屏障」';
    case 'fengmang': {
      if (!a.accept) return '不发动';
      const pd = state.pending;
      const pp = pd && pd.kind === 'fengmang' ? state.players[pd.player] : state.players[state.activePlayer];
      const av = pp.areas.attack.find((d) => d.id === a.attackDieId)?.value ?? '?';
      const mv = pp.areas.meditation.find((d) => d.id === a.meditationDieId)?.value ?? '?';
      return `发动（消耗 攻击${av} 与 冥想${mv}）`;
    }
    case 'shenhongKill':
      return a.accept ? '发动「杀意」（3 真伤 + 回2）' : '不发动「杀意」';
    case 'aidao':
      // 带 defenseDieId 的变体已由 actionDieSegments 走骰片（"弃置对方 防X"）；裸 accept 只在对方无防御骰时出现
      return a.accept ? '发动「哀悼」（对方无防御骰）' : '不发动「哀悼」';
    case 'duanexing':
      return a.accept ? '发动「闻我名者断恶行」' : '不发动「闻我名者断恶行」';
    case 'ciBei': {
      const pd = state.pending;
      const amount = pd && pd.kind === 'ciBei' ? pd.amount : 0;
      return a.accept
        ? `发动「慈悲」（取消 ${amount} 点伤害，改为回复 ${amount} 点生命）`
        : '不发动「慈悲」';
    }
    case 'leibaoReroll':
      return a.accept ? '发动「雷暴」进行额外重掷' : '不发动「雷暴」';
    case 'dianxing':
      return a.accept === false ? '不发动「电刑」' : '发动「电刑」（选择 2 颗冥想骰）';
    case 'leibao':
      return a.accept === false ? '不发动「雷暴」' : '发动「雷暴」（选择要移动的冥想骰）';
    case 'dunwuPulse': {
      const pd = state.pending;
      const amount = pd && pd.kind === 'dunwuPulse' ? pd.amount : 0;
      return a.accept ? `发动「灵能脉冲」（${amount} 点真实伤害）` : '不发动「灵能脉冲」';
    }
    case 'reroll':
    case 'skill':
      return null;
    default:
      return null;
  }
}

function skillButton(ctx: Ctx, a: SkillAction): HTMLElement {
  const { state, hooks } = ctx;
  const actor = actorOf(state);
  const art = state.players[actor].artifacts.find((x) => x.id === a.artifactId);
  // 同名技能（如 024「凶弹业舞」充能+必杀）要按当前上下文取对应那条
  const isChargeCtx = state.pending?.kind === 'chargeResolve' && state.pending.artifactId === a.artifactId;
  const def = a.t === 'skill'
    ? art?.skills.find(
        (s) =>
          s.side === a.side &&
          (isChargeCtx
            ? s.kind === 'charge'
            : s.kind === 'activate' || s.kind === 'activation' || s.kind === 'ultimate'),
      )
    : undefined;
  const key = def?.key;
  const name = skillName(state, a);
  const label =
    def?.kind === 'activation'
      ? `结算「${name}」（激活·立即生效）`
      : def?.kind === 'ultimate'
        ? `发动必杀：「${name}」`
        : `启动技能：${name}`;
  if (key && SKILL_SELECTION[key]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-skill';
    b.dataset.act = 'skill';
    b.textContent = label;
    b.addEventListener('click', () => startSkillSelection(ctx, a, key));
    return b;
  }
  return button(label, a, hooks, 'btn-skill');
}

function rerollButton(ctx: Ctx): HTMLButtonElement | null {
  const reroll = ctx.legal.find((x): x is Extract<Action, { t: 'reroll' }> => x.t === 'reroll');
  if (!reroll) return null;
  const count = ctx.hooks.ui.rerollSelected.size;
  // 027 凛冽之音：惩罚生效期内，重掷按钮/确认条直接写明会掉多少血（避免"忽然被扣血"）
  const punished = ctx.state.rerollPunish.A || ctx.state.rerollPunish.B;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-reroll';
  b.dataset.act = 'reroll';
  b.textContent = punished ? `重掷选中(${count})（将受 ${count} 点真实伤害）` : `重掷选中(${count})`;
  if (punished) b.title = '「凛冽之音」生效中：重掷多少颗，被重掷方就受到多少点真实伤害';
  b.disabled = count === 0;
  b.addEventListener('click', () => {
    const n = ctx.hooks.ui.rerollSelected.size;
    if (n === 0) return;
    ctx.hooks.propose(
      { t: 'reroll', dieIds: [...ctx.hooks.ui.rerollSelected] },
      punished ? `重掷 ${n} 颗（「凛冽之音」：将受 ${n} 点真实伤害）` : `重掷 ${n} 颗`,
    );
  });
  return b;
}

function dustEntryButton(ctx: Ctx, a: Artifact, free = false, fuchou = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-dust';
  b.dataset.act = 'dustRise';
  b.dataset.artifact = a.id;
  if (free) b.dataset.free = '1';
  if (fuchou) b.dataset.fuchou = '1';
  b.textContent = dustEntryLabel(a, free);
  b.addEventListener('click', () => openDustFlow(ctx, a, free, fuchou));
  return b;
}

/** 动作里涉及的一颗骰（供骰片行渲染） */
interface DieSeg {
  id: string;
  owner: PlayerId;
}

/** 动作的“文本片段 + 骰子”分段（parts.length === dice.length + 1）；无骰返回 null。
 *  统一规则：凡文案指向具体骰子，一律用骰片呈现，不得写成文字。 */
function actionDieSegments(ctx: Ctx, a: Action): { parts: string[]; dice: DieSeg[] } | null {
  const { state } = ctx;
  const opponent = (p: PlayerId): PlayerId => (p === 'A' ? 'B' : 'A');
  switch (a.t) {
    case 'attack':
      return {
        parts: ['攻击', ''],
        dice: (a.costSlots[0]?.dieIds ?? []).map((id) => ({ id, owner: state.activePlayer })),
      };
    case 'block': {
      const ids = a.costSlots?.[0]?.dieIds ?? [];
      if (ids.length === 0) return null; // 「不抵挡」按文字处理
      const owner = state.pendingAttack ? opponent(state.pendingAttack.attacker) : state.activePlayer;
      return { parts: ['抵挡', ''], dice: ids.map((id) => ({ id, owner })) };
    }
    case 'guwangCancel': {
      if (!a.cancel || !a.defenseDieId) return null;
      const pd = state.pending;
      const owner: PlayerId = pd && pd.kind === 'guwangCancel' ? pd.player : state.activePlayer;
      return { parts: ['发动「高塔铁幕」取消（消耗 ', '）'], dice: [{ id: a.defenseDieId, owner }] };
    }
    case 'dunwuHalve': {
      if (!a.accept || !a.meditationDieId) return null;
      const pd = state.pending;
      const owner: PlayerId = pd && pd.kind === 'dunwuHalve' ? pd.player : state.activePlayer;
      return { parts: ['发动「灵能屏障」伤害减半（消耗 ', '）'], dice: [{ id: a.meditationDieId, owner }] };
    }
    case 'aidao': {
      // A02 深红（异相）·哀悼：弃置的是**对方区域内**的防御骰 → owner = 持有者之对手
      if (!a.accept || !a.defenseDieId) return null;
      const pd = state.pending;
      const owner: PlayerId = pd && pd.kind === 'aidao' ? opponent(pd.player) : state.activePlayer;
      return { parts: ['发动「哀悼」（弃置对方 ', '）'], dice: [{ id: a.defenseDieId, owner }] };
    }
    case 'duanexing': {
      // L12 闻我名者断恶行：弃置的是**对方区域内**的攻击骰 → owner = 持有者之对手
      if (!a.accept || !a.dieId) return null;
      const pd = state.pending;
      const owner: PlayerId = pd && pd.kind === 'duanexing' ? opponent(pd.player) : state.activePlayer;
      return { parts: ['发动「闻我名者断恶行」（弃置对方 ', '）'], dice: [{ id: a.dieId, owner }] };
    }
    case 'weijuPay': {
      // 023 畏惧：对方被迫消耗的那颗骰 → 1 颗用内联骰片
      if (!a.dieId) return null;
      const pd = state.pending;
      const owner: PlayerId = pd && pd.kind === 'weijuPay' ? pd.player : state.activePlayer;
      return { parts: ['消耗 1 颗能力骰 ', ''], dice: [{ id: a.dieId, owner }] };
    }
    case 'guwangCharge': {
      if (!a.dieId) return null;
      const pd = state.pending;
      const owner: PlayerId = pd && pd.kind === 'guwangCharge' ? opponent(pd.player) : state.activePlayer;
      return { parts: ['改为 1 点 ', ''], dice: [{ id: a.dieId, owner }] };
    }
    default:
      return null;
  }
}

/** 骰子的文字形式（如 防6） */
function segDieText(ctx: Ctx, seg: DieSeg): string {
  const d = findDie(ctx.state, seg.id);
  return d ? `${KIND_SHORT[d.kind]}${d.value}` : '?';
}

/** 文本片段 + 骰子的分段（契约：`parts.length === dice.length + 1`，逐位拼接 → 用于纯文字标签）。
 *  注意：**骰片行**（`actionChipRow`）会把「同一文案、不同骰子」的多个动作合并成一行，
 *  那里的后缀必须只渲染一次、位于整行末尾，不能按本函数的逐位规则。 */
function segsToText(ctx: Ctx, segs: { parts: string[]; dice: DieSeg[] }): string {
  let out = segs.parts[0] ?? '';
  segs.dice.forEach((s, i) => {
    out += segDieText(ctx, s) + (segs.parts[i + 1] ?? '');
  });
  return out;
}

/** 一行骰片：文本片段 + 可点骰片（每个骰片对应一个动作），节省纵向空间 */
function actionChipRow(
  ctx: Ctx,
  parts: string[],
  items: { a: Action; die: DieSeg }[],
): HTMLElement {
  const row = el('div', 'actionlist-chips');
  const lead = el('span', 'chip-label');
  lead.textContent = parts[0] ?? '';
  row.appendChild(lead);
  items.forEach(({ a, die }) => {
    const d = findDie(ctx.state, die.id);
    const heldValue = heldDieValue(ctx.state, die.id);
    const treated = a.t === 'attack' && a.costSlots[0]?.treated === true;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className =
      heldValue != null
        ? 'pay-die clickable pay-die--held'
        : `pay-die clickable die-${die.owner}${treated ? ' pay-die--treated' : ''}`;
    chip.dataset.id = die.id;
    chip.dataset.act = a.t;
    if (treated) chip.dataset.treated = '1';
    chip.textContent =
      heldValue != null
        ? String(heldValue)
        : d
          ? treated
            ? `${KIND_SHORT[d.kind]}${d.value} → 攻击`
            : `${KIND_SHORT[d.kind]}${d.value}`
          : '?';
    chip.addEventListener('click', () => ctx.hooks.propose(a, actionLabel(ctx, a) ?? ''));
    row.appendChild(chip);
  });
  // 同一行是把「同一文案、不同骰子」的多个动作合并成一行 → 后缀（如「）」）只出现一次、位于整行末尾
  const tail = parts[parts.length - 1] ?? '';
  if (tail) {
    const t = el('span', 'chip-label');
    t.textContent = tail;
    row.appendChild(t);
  }
  return row;
}

type HanguangAction = Extract<Action, { t: 'hanguangPick' }>;

/**
 * 027 寒光·凛冽之音（必杀）：神器上的骰不在任何区域 → 专用面板。
 * **两步式**：①先选模式（作为攻击骰使用 / 移除并弃置对方同点数骰）→ ②选骰（面板内 + 卡面骰片双入口）
 * → ②再选对方目标骰。全部动作由 `getLegalActions` 提供，派发走确认条（`propose`）；强制、无「不发动」。
 */
function hanguangPanel(ctx: Ctx): HTMLElement {
  const pd = ctx.state.pending;
  const panel = el('div', 'selector selector--flow');
  const head = el('div', 'selector-head');
  const title = el('div', 'selector-title');
  title.textContent = '「凛冽之音」：使用攻击骰前先决定';
  head.appendChild(title);
  panel.appendChild(head);
  if (!pd || pd.kind !== 'hanguangPick') return panel;

  const card = artifactWithSkill(ctx.state.players[pd.player], 'hanguang.ultimate');
  const held = card?.heldDice ?? [];
  const acts = ctx.legal.filter((x): x is HanguangAction => x.t === 'hanguangPick');
  const st = ctx.hooks.ui.hanguangPick ?? { mode: null, dieId: null };
  const oppId: PlayerId = oppOf(pd.player);
  const valueOf = (id: string | null): number | null =>
    id ? (held.find((h) => h.id === id)?.value ?? null) : null;

  // ── 第一步：模式 ──────────────────────────────────────────
  const modeRow = el('div', 'pay-dice');
  const modeBtn = (mode: 'move' | 'discard', label: string, disabled: boolean, why?: string): void => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-skill';
    b.dataset.act = `hanguangMode-${mode}`;
    b.textContent = label;
    if (disabled) {
      b.disabled = true;
      if (why) b.title = why;
    }
    if (st.mode === mode) b.classList.add('selected');
    b.addEventListener('click', () => {
      ctx.hooks.ui.hanguangPick = { mode, dieId: st.dieId };
      ctx.hooks.requestRender();
    });
    modeRow.appendChild(b);
  };
  const hasDiscardTarget = acts.some((x) => x.pick === 'discard');
  modeBtn('move', '① 作为攻击骰使用', false);
  modeBtn(
    'discard',
    '② 移除并弃置对方同点数骰',
    !hasDiscardTarget,
    hasDiscardTarget ? undefined : '对方没有与神器上任何骰点数相同的能力骰',
  );
  head.appendChild(modeRow); // 与标题同一行，保持面板仅 1 行

  if (!st.mode) return panel;

  // ── 第二步：选骰（面板内）────────────────────────────────
  const diceBox = el('div', 'pay-dice');
  const diceLab = el('span', 'chip-label');
  diceLab.textContent = '选择神器上的 1 颗骰：';
  diceBox.appendChild(diceLab);
  for (const h of held) {
    const usable = acts.some((x) => x.dieId === h.id && x.pick === st.mode);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'pay-die pay-die--held';
    chip.dataset.act = 'hanguangDie';
    chip.dataset.id = h.id;
    chip.textContent = String(h.value);
    chip.title = `置于「${card?.name ?? ''}」上的骰（点数 ${h.value}）`;
    if (!usable) chip.disabled = true;
    if (st.dieId === h.id) chip.classList.add('selected');
    chip.addEventListener('click', () => {
      ctx.hooks.ui.hanguangPick = { mode: st.mode, dieId: h.id };
      ctx.hooks.requestRender();
    });
    diceBox.appendChild(chip);
  }
  panel.appendChild(diceBox);

  // ── 第三步：② 选对方目标骰 / ① 确认 ──────────────────────
  const pickedValue = valueOf(st.dieId);
  if (st.mode === 'discard' && st.dieId) {
    const targets = acts.filter((x) => x.dieId === st.dieId && x.pick === 'discard');
    const tRow = el('div', 'pay-dice');
    const tl = el('span', 'chip-label');
    tl.textContent = '选择要弃置的对方能力骰：';
    tRow.appendChild(tl);
    for (const t of targets) {
      const found = findDie(ctx.state, t.targetDieId ?? '');
      const tc = document.createElement('button');
      tc.type = 'button';
      tc.className = `pay-die clickable die-${oppId}`;
      tc.dataset.act = 'hanguangDiscard';
      tc.dataset.id = t.targetDieId ?? '';
      tc.dataset.held = t.dieId;
      tc.textContent = found ? `${KIND_SHORT[found.kind]}${found.value}` : '?';
      tc.addEventListener('click', () =>
        ctx.hooks.propose(t, `「凛冽之音」：移除 ${pickedValue ?? '?'} 点骰，并弃置对方同点数能力骰`),
      );
      tRow.appendChild(tc);
    }
    panel.appendChild(tRow);
  } else if (st.mode === 'move' && st.dieId) {
    const move = acts.find((x) => x.dieId === st.dieId && x.pick === 'move');
    if (move) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-confirm';
      b.dataset.act = 'hanguangCommit';
      b.textContent = '确认：移入对应区域';
      b.addEventListener('click', () =>
        ctx.hooks.propose(move, `「凛冽之音」：将 ${pickedValue ?? '?'} 点骰移入对应区域`),
      );
      panel.appendChild(b);
    }
  }
  return panel;
}

/** 联机·对方操作时，给我方看的只读说明 */
function opponentActingText(ctx: Ctx): string {
  const st = ctx.state;
  if (st.pendingAttack) return '是否抵挡';
  if (st.pending) {
    const t = phaseHint(ctx)
      .map((p) => p.text)
      .join('')
      .trim();
    return t || '作出选择';
  }
  return '行动中';
}

function operationList(ctx: Ctx): HTMLElement {
  const box = el('div', 'actionlist');

  // 联机·对方操作时（或旁观者）：只读提示，不给可点控件
  if (
    ctx.hooks.online &&
    ctx.state.phase !== 'gameOver' &&
    (ctx.hooks.online.spectator === true || actorOf(ctx.state) !== ctx.hooks.online.myPlayer)
  ) {
    const note = el('div', 'actionlist-readonly');
    note.textContent = ctx.hooks.online.spectator
      ? '旁观中（只读）· 点击任一玩家面板可切换视角'
      : `对方正在操作：${opponentActingText(ctx)}`;
    box.appendChild(note);
    return box;
  }

  // 挑战·自动模式：昔传抵挡由引擎自动完成 → 不弹可点选项（只给提示）
  if (
    ctx.state.mode === 'challenge' &&
    ctx.state.challenge?.settleMode !== 'manual' &&
    ctx.state.pendingAttack?.attacker === 'A'
  ) {
    const note = el('div', 'actionlist-readonly');
    note.textContent = '自动结算中：昔传抵挡…';
    box.appendChild(note);
    return box;
  }

  const rb = rerollButton(ctx);
  if (rb) box.appendChild(rb);

  const { state } = ctx;
  if (state.phase === 'main' && !state.pendingAttack && !state.pending) {
    const payer = state.activePlayer;
    if (convertAvailable(state, payer)) {
      box.appendChild(
        convertButton('使用「真实之剑」置换进行攻击', () => openConvertPick(ctx, 'attack')),
      );
    }
  }
  if (state.pendingAttack && !state.pendingAttack.unblockable && !state.pending) {
    const defender: PlayerId = state.pendingAttack.attacker === 'A' ? 'B' : 'A';
    if (convertAvailable(state, defender)) {
      box.appendChild(
        convertButton('使用「真实之剑」置换进行抵挡', () => openConvertPick(ctx, 'block')),
      );
    }
  }

  const seenSkill = new Set<string>();
  const seenDust = new Set<string>();
  let seenFengmang = false;
  let seenWeimu = false;
  let seenZhihaiReroll = false;
  let seenChenaiRise = false;
  let seenShouhun = false;
  let seenChuxing = false;
  let seenGongzhen = false;
  let seenWeiya = false;
  let seenXianzhen = false;
  let seenHengguan = false;
  let seenHanguang = false;
  let seenQuanzhi = false;
  let seenKuyu = false;
  let seenTiaoling = false;
  let seenEndDiscard = false;
  let seenWanzhang = false;
  let seenPuti = false;
  let seenGuwangConvert = false;
  let seenDunwuConvert = false;
  let seenWeijuConvert = false;
  let seenAnyexiongshen = false;
  let seenBacheng = false;
  let seenYuluoDecline = false;
  let seenYuluoGain = false;
  let seenYuluoDiscard = false;
  let seenWufaraoshuDecline = false;
  let seenWufaraoshuDiscard = false;
  let seenYuanwu = false;
  let seenShizushouhunDecline = false;
  let seenShizushouhunPay = false;
  const seenShangjin = new Set<string>();
  const seenDizui = new Set<string>();
  const seenNudeng = new Set<string>();
  const groups = new Map<string, { parts: string[]; items: { a: Action; die: DieSeg }[] }>();
  const plain: Action[] = [];
  for (const a of ctx.legal) {
    if (a.t === 'reroll') continue;
    if (a.t === 'yuhuiPlace') continue; // T10「迂回」：由专用选择浮窗渲染（不逐条枚举 9 种组合）
    if (a.t === 'yingziPick') continue; // T15「影子」：由专用选择面板渲染（不逐条枚举 6 个点数）
    if (a.t === 'yuanjianGain') continue; // T13「远见」：由专用选择面板渲染（不逐条枚举 6×3 组合）
    if (a.t === 'youdiMove') continue; // T17「诱敌」：由专用选择面板渲染（不枚举组合）
    if (a.t === 'shipeiPick') continue; // T18「适应」：由专用选择面板渲染
    // 「真实之剑」(010) 置换入口：给 009 高塔铁幕·触发 / 011 灵能屏障·触发 / 023 畏惧·对方 的「消耗 1 颗」加「2 颗顶 1」
    if (
      (a.t === 'guwangCancel' || a.t === 'dunwuHalve' || a.t === 'weijuPay') &&
      hasSword(ctx.state, actorOf(ctx.state)) &&
      // Z12「不动菩提」：置换出的有效点数 5 被封锁时，不提供"2 颗顶 1"入口
      !isValueLocked(ctx.state, actorOf(ctx.state), 5)
    ) {
      const okToOpen =
        (a.t === 'guwangCancel' && a.cancel) || (a.t === 'dunwuHalve' && a.accept) || a.t === 'weijuPay';
      if (okToOpen) {
        const flag = a.t === 'guwangCancel' ? 'guwang' : a.t === 'dunwuHalve' ? 'dunwu' : 'weiju';
        const seen = flag === 'guwang' ? seenGuwangConvert : flag === 'dunwu' ? seenDunwuConvert : seenWeijuConvert;
        if (!seen) {
          if (flag === 'guwang') seenGuwangConvert = true;
          else if (flag === 'dunwu') seenDunwuConvert = true;
          else seenWeijuConvert = true;
          const kind = `${flag === 'guwang' ? 'guwangCancel' : flag === 'dunwu' ? 'dunwuHalve' : 'weijuPay'}Convert`;
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn btn-skill';
          b.dataset.act = kind;
          b.textContent = '用「真实之剑」置换：2 颗任意骰代替 1 颗';
          b.addEventListener('click', () =>
            startPendingSelection(ctx, `@${kind}`, kind as NonNullable<UiState['selection']>['pendingKind']),
          );
          box.appendChild(b);
        }
      }
    }
    if (a.t === 'dianxing' || a.t === 'leibao') {
      // 013 待决策（电刑/雷暴）：唯一渲染来源（勿在循环外再渲染一份，否则重复）
      if (a.accept !== false) continue; // 默认 dieIds 动作仅供 AI/测试，真人走选择器
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn-skill';
      open.dataset.act = `${a.t}Open`;
      open.textContent =
        a.t === 'dianxing' ? '发动「电刑」（选择 2 颗冥想骰）' : '发动「雷暴」（选择要移动的冥想骰）';
      open.addEventListener('click', () => startPendingSelection(ctx, `@${a.t}`, a.t));
      box.appendChild(open);
      box.appendChild(button(a.t === 'dianxing' ? '不发动「电刑」' : '不发动「雷暴」', a, ctx.hooks));
      continue;
    }
    if (a.t === 'chuxingPick') {
      // 022 处刑通牒：使用攻击骰前的强制决定（唯一渲染来源）
      if (seenChuxing) continue;
      seenChuxing = true;
      box.appendChild(button('不发动「处刑通牒」', { t: 'chuxingPick', pick: 'none' }, ctx.hooks));
      box.appendChild(button('① 本次攻击伤害 +1 且不可抵挡', { t: 'chuxingPick', pick: 'unblockable' }, ctx.hooks));
      box.appendChild(button('② 本次攻击伤害 +5', { t: 'chuxingPick', pick: 'bonus5' }, ctx.hooks));
      continue;
    }
    if (a.t === 'gongzhenResolve') {
      // 023 共振：打开选择器（①/② + 弃置选择），确认后直接派发（唯一渲染来源）
      if (seenGongzhen) continue;
      seenGongzhen = true;
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn-skill';
      open.dataset.act = 'gongzhenOpen';
      open.textContent = '选择「共振」效果';
      open.addEventListener('click', () => startPendingSelection(ctx, '@gongzhen', 'gongzhenPick'));
      box.appendChild(open);
      continue;
    }
    if (a.t === 'weiyaPick') {
      // 026 威压：唯一渲染来源；「不发动」+ 打开选择器（候选骰仅供 AI/测试）
      if (a.dieId) continue;
      if (seenWeiya) continue;
      seenWeiya = true;
      box.appendChild(button('不发动「威压」', a, ctx.hooks));
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn-skill';
      open.dataset.act = 'weiyaOpen';
      open.textContent = '发动「威压」（选择要变更的能力骰）';
      open.addEventListener('click', () => startPendingSelection(ctx, '@weiyaPick', 'weiyaPick'));
      box.appendChild(open);
      continue;
    }
    if (a.t === 'xianzhenResolve') {
      // 026 陷阵：强制、无「不发动」；唯一渲染来源（候选骰仅供 AI/测试）
      if (seenXianzhen) continue;
      seenXianzhen = true;
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn-skill';
      open.dataset.act = 'xianzhenOpen';
      open.textContent = '「陷阵」：选择要弃置的能力骰';
      open.addEventListener('click', () => startPendingSelection(ctx, '@xianzhenPick', 'xianzhenPick'));
      box.appendChild(open);
      continue;
    }
    if (a.t === 'hengguan') {
      // 025 横贯·触发：唯一渲染来源；「不发动」+ 打开选择器（候选骰仅供 AI/测试）
      if (a.dieId) continue;
      if (seenHengguan) continue;
      seenHengguan = true;
      box.appendChild(button('不发动「横贯」', a, ctx.hooks));
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn-skill';
      open.dataset.act = 'hengguanOpen';
      open.textContent = '发动「横贯」（选择要弃置的能力骰）';
      open.addEventListener('click', () => startPendingSelection(ctx, '@hengguan', 'hengguan'));
      box.appendChild(open);
      continue;
    }
    if (a.t === 'hanguangPick') {
      // 027 凛冽之音·必杀：强制、无「不发动」；直接内联渲染合法动作（神器上的骰不在任何区域）
      if (seenHanguang) continue;
      seenHanguang = true;
      box.appendChild(hanguangPanel(ctx));
      continue;
    }
    if (a.t === 'quanzhiAssign') {
      // 029 真言·全知：强制、无「不发动」；打开专用分配面板（候选动作仅供 AI/测试）
      if (seenQuanzhi) continue;
      seenQuanzhi = true;
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn-skill';
      open.dataset.act = 'quanzhiOpen';
      open.textContent = '「全知」：分配全部能力骰落区';
      open.addEventListener('click', () => {
        ctx.hooks.ui.quanzhi = { groups: [], selected: [], preview: false };
        ctx.hooks.requestRender();
      });
      box.appendChild(open);
      continue;
    }
    if (a.t === 'kuyuResolve') {
      // 032 梦魇·低语：强制、无「不发动」；打开类型选择器（候选仅供 AI/测试）
      if (seenKuyu) continue;
      seenKuyu = true;
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn-skill';
      open.dataset.act = 'kuyuOpen';
      open.textContent = '「低语」：宣称能力骰类型';
      open.addEventListener('click', () => startPendingSelection(ctx, '@kuyu', 'kuyu'));
      box.appendChild(open);
      continue;
    }
    if (a.t === 'tiaolingResolve') {
      // 033 凋零·死亡亦逝：强制、无「不发动」；打开①/②+弃骰选择器（候选仅供 AI/测试）
      if (seenTiaoling) continue;
      seenTiaoling = true;
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn-skill';
      open.dataset.act = 'tiaolingOpen';
      open.textContent = '「死亡亦逝」：弃置自己的能力骰';
      open.addEventListener('click', () => startPendingSelection(ctx, '@tiaolingPick', 'tiaolingPick'));
      box.appendChild(open);
      continue;
    }
    if (a.t === 'endDiscardResolve') {
      // 结束阶段「超出意志上限」：强制、无「不发动」；打开弃骰选择器（候选仅供 AI/测试）
      if (seenEndDiscard) continue;
      seenEndDiscard = true;
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn-skill';
      open.dataset.act = 'endDiscardOpen';
      open.textContent = '结束阶段：弃置超出意志上限的能力骰';
      open.addEventListener('click', () => startPendingSelection(ctx, '@endDiscard', 'endDiscard'));
      box.appendChild(open);
      continue;
    }
    if (a.t === 'wanzhangDiscard') {
      // 035 千劫·万丈明光：强制、无「不发动」；打开弃骰选择器（候选仅供 AI/测试）
      if (seenWanzhang) continue;
      seenWanzhang = true;
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn-skill';
      open.dataset.act = 'wanzhangOpen';
      open.textContent = '「万丈明光」：弃置能力骰';
      open.addEventListener('click', () => startPendingSelection(ctx, '@wanzhangDiscard', 'wanzhangDiscard'));
      box.appendChild(open);
      continue;
    }
    if (a.t === 'putiResolve') {
      // 034 金刚·不动菩提（触发）：唯一渲染来源；「不发动」/「发动（移除同点数存放骰）」
      if (seenPuti) continue;
      seenPuti = true;
      box.appendChild(button('不发动「不动菩提」', { t: 'putiResolve', accept: false }, ctx.hooks));
      box.appendChild(button('发动「不动菩提」（移除同点数存放骰）', { t: 'putiResolve', accept: true }, ctx.hooks));
      continue;
    }
    if (a.t === 'chenaiFreeRise') {
      // 019 尘起：是否接受免费额外尘起（唯一渲染来源）
      if (seenChenaiRise) continue;
      seenChenaiRise = true;
      box.appendChild(button('发动「尘起」：立即进行 1 次免费尘起行动', { t: 'chenaiFreeRise', accept: true }, ctx.hooks));
      box.appendChild(button('不发动「尘起」', { t: 'chenaiFreeRise', accept: false }, ctx.hooks));
      continue;
    }
    if (a.t === 'anyexiongshen') {
      // L02 暗夜凶神（触发）：是否使「不祥」计数 +1（唯一渲染来源）
      if (seenAnyexiongshen) continue;
      seenAnyexiongshen = true;
      box.appendChild(button('发动「暗夜凶神」：「不祥」计数 +1', { t: 'anyexiongshen', accept: true }, ctx.hooks));
      box.appendChild(button('不发动「暗夜凶神」', { t: 'anyexiongshen', accept: false }, ctx.hooks));
      continue;
    }
    if (a.t === 'bacheng') {
      // L03 拔城（触发）：是否视为以 5 点攻击并切换「主宰」（唯一渲染来源）
      if (seenBacheng) continue;
      seenBacheng = true;
      box.appendChild(button('发动「拔城」：以 5 点攻击 1 次并切换「主宰」技能', { t: 'bacheng', accept: true }, ctx.hooks));
      box.appendChild(button('不发动「拔城」', { t: 'bacheng', accept: false }, ctx.hooks));
      continue;
    }
    if (a.t === 'yuanwu') {
      // L06 圆舞（强制）：入口按钮 → 两步选择器（选骰 → 选目标区域）
      if (seenYuanwu) continue;
      seenYuanwu = true;
      const yb = document.createElement('button');
      yb.type = 'button';
      yb.className = 'btn btn-skill';
      yb.dataset.act = 'yuanwuOpen';
      yb.textContent = '移动 1 个能力骰到另一区域';
      yb.addEventListener('click', () => startPendingSelection(ctx, '@yuanwu', 'yuanwu'));
      box.appendChild(yb);
      continue;
    }
    if (a.t === 'dizuidaijianshu') {
      // L10 涤罪大剑术（触发）：不发动 / 开选骰面板（对方跨类型、恰好 2 颗且**种类不相同**）
      if (a.accept === false) {
        if (seenDizui.has('decline')) continue;
        seenDizui.add('decline');
        box.appendChild(button('不发动「涤罪大剑术」', a, ctx.hooks));
        continue;
      }
      if (seenDizui.has('open')) continue;
      seenDizui.add('open');
      const db = document.createElement('button');
      db.type = 'button';
      db.className = 'btn btn-skill';
      db.dataset.act = 'dizuidaijianshuOpen';
      db.textContent = '弃置对方 2 颗能力骰（种类不相同）';
      db.addEventListener('click', () => startPendingSelection(ctx, '@dizuidaijianshu', 'dizuidaijianshu'));
      box.appendChild(db);
      continue;
    }
    if (a.t === 'nudengzuiren') {
      // L10 汝等罪人：发动＝改为对对方造成（名义量）真实伤害；不发动＝正常回复（受生命上限封顶）
      const pdN = state.pending;
      const amt = pdN && pdN.kind === 'nudengzuiren' ? pdN.amount : 0;
      const healer = pdN && pdN.kind === 'nudengzuiren' ? state.players[pdN.player] : null;
      const healable = healer ? Math.min(amt, Math.max(0, healer.lifeMax - healer.life)) : amt;
      if (seenNudeng.has(a.accept ? 'yes' : 'no')) continue;
      seenNudeng.add(a.accept ? 'yes' : 'no');
      const label = a.accept
        ? `发动「汝等罪人」（改为对对方造成 ${amt} 点真实伤害）`
        : `不发动「汝等罪人」（正常回复 ${healable} 点生命）`;
      box.appendChild(button(label, a, ctx.hooks));
      continue;
    }
    if (a.t === 'shangjin') {
      // L08 只为赏金而来（触发）：不发动 / 选一个"已激活的启动式"技能（打开它自己的选择器）
      if (a.decline) {
        if (seenShangjin.has('decline')) continue;
        seenShangjin.add('decline');
        box.appendChild(button('不发动「只为赏金而来」', a, ctx.hooks));
        continue;
      }
      const sig = `skill:${a.artifactId}:${a.skillKey ?? a.side}`;
      if (seenShangjin.has(sig)) continue;
      seenShangjin.add(sig);
      const skillAction: SkillAction = { t: 'skill', artifactId: a.artifactId ?? '', side: a.side ?? 'left' };
      const sb = document.createElement('button');
      sb.type = 'button';
      sb.className = 'btn btn-skill';
      sb.dataset.act = 'shangjinOpen';
      sb.textContent = `启动「${skillName(state, skillAction)}」`;
      sb.addEventListener('click', () =>
        startSkillSelection(ctx, skillAction, (a.skillKey ?? '') as string, 'shangjin'),
      );
      box.appendChild(sb);
      continue;
    }
    if (a.t === 'shizushouhun') {
      // L07 始祖兽魂（触发）：不发动 / 额外消耗 1 个冥想骰把「兽魂」计数改为 3
      if (!a.accept) {
        if (seenShizushouhunDecline) continue;
        seenShizushouhunDecline = true;
        box.appendChild(button('不发动「始祖兽魂」', a, ctx.hooks));
        continue;
      }
      if (seenShizushouhunPay) continue;
      seenShizushouhunPay = true;
      const sb = document.createElement('button');
      sb.type = 'button';
      sb.className = 'btn btn-skill';
      sb.dataset.act = 'shizushouhunOpen';
      sb.textContent = '额外消耗 1 个冥想骰（计数改为 3）';
      sb.addEventListener('click', () => startPendingSelection(ctx, '@shizushouhun', 'shizushouhun'));
      box.appendChild(sb);
      continue;
    }
    if (a.t === 'wufaraoshu') {
      // L05 无法饶恕（触发）：不发动 / 点开选骰面板弃置对方 1 个同点数防御骰
      if (a.choice === 'decline') {
        if (seenWufaraoshuDecline) continue;
        seenWufaraoshuDecline = true;
        box.appendChild(button('不发动「无法饶恕」', a, ctx.hooks));
        continue;
      }
      if (seenWufaraoshuDiscard) continue;
      seenWufaraoshuDiscard = true;
      const wb = document.createElement('button');
      wb.type = 'button';
      wb.className = 'btn btn-skill';
      wb.dataset.act = 'wufaraoshuOpen';
      wb.textContent = '弃置对方的 1 个同点数防御骰';
      wb.addEventListener('click', () => startPendingSelection(ctx, '@wufaraoshu', 'wufaraoshu'));
      box.appendChild(wb);
      continue;
    }
    if (a.t === 'kongYuluo') {
      // L01 雨落狂流：两步式——操作列表仅三个按钮（不发动 / 弃置对方 1 骰 / 获得随机能力骰），
      // 后两者点进去才选（骰片面板 / 区域面板）。
      if (a.choice === 'decline') {
        if (seenYuluoDecline) continue;
        seenYuluoDecline = true;
        box.appendChild(button('不发动「雨落狂流」', a, ctx.hooks));
        continue;
      }
      if (a.choice === 'gain') {
        if (seenYuluoGain) continue;
        seenYuluoGain = true;
        const gb = document.createElement('button');
        gb.type = 'button';
        gb.className = 'btn btn-skill';
        gb.dataset.act = 'kongYuluoGainOpen';
        gb.textContent = '获得随机能力骰';
        gb.addEventListener('click', () => startPendingSelection(ctx, '@kongYuluoGain', 'kongYuluoGain'));
        box.appendChild(gb);
        continue;
      }
      // discard：入口按钮 → 选骰面板（面板里才是敌方骰片）
      if (seenYuluoDiscard) continue;
      seenYuluoDiscard = true;
      const db = document.createElement('button');
      db.type = 'button';
      db.className = 'btn btn-skill';
      db.dataset.act = 'kongYuluoDiscardOpen';
      db.textContent = '弃置对方的 1 个能力骰';
      db.addEventListener('click', () => startPendingSelection(ctx, '@kongYuluo', 'kongYuluo'));
      box.appendChild(db);
      continue;
    }
    if (a.t === 'shouhunCancel') {
      // 020 兽魂：攻击方选择取消伤害 vs 正常造成伤害（唯一渲染来源）
      if (seenShouhun) continue;
      seenShouhun = true;
      box.appendChild(button('取消这次伤害（「兽魂」计数 −1）', { t: 'shouhunCancel', cancel: true }, ctx.hooks));
      box.appendChild(button('不取消，正常造成伤害', { t: 'shouhunCancel', cancel: false }, ctx.hooks));
      continue;
    }
    if (a.t === 'weimu') {
      // 017 帷幕：唯一渲染来源；接受 → 打开选择器显式选对方 1 个能力骰
      if (!a.accept) {
        box.appendChild(button('不发动「帷幕」', a, ctx.hooks));
        continue;
      }
      if (seenWeimu) continue; // 其余 accept 动作（每颗骰一条）仅供 AI，真人走选择器
      seenWeimu = true;
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn-skill';
      open.dataset.act = 'weimuOpen';
      open.textContent = '发动「帷幕」（选择弃置对方 1 个能力骰）';
      open.addEventListener('click', () => startPendingSelection(ctx, '@weimu', 'weimu'));
      box.appendChild(open);
      continue;
    }
    if (a.t === 'zhihaiReroll') {
      // 018 漆黑绽放·必杀：获得 X 骰后可选重掷（含新骰）
      const x = state.pending && state.pending.kind === 'zhihaiReroll' ? state.pending.x : 0;
      if (a.dieIds.length === 0) {
        box.appendChild(button('不重掷', a, ctx.hooks));
        continue;
      }
      if (seenZhihaiReroll) continue; // 默认候选仅供 AI，真人走选择器
      seenZhihaiReroll = true;
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn-skill';
      open.dataset.act = 'zhihaiRerollOpen';
      open.textContent = `重掷最多 ${x} 颗能力骰（可含刚获得的骰）`;
      open.addEventListener('click', () => startPendingSelection(ctx, '@zhihaiReroll', 'zhihaiReroll'));
      box.appendChild(open);
      continue;
    }
    if (a.t === 'skill') {
      // 传奇面板技能：操作列表也渲染一个按钮（与神器一致：卡面行 + 操作按钮）
      const lgOwner = state.players[actorOf(state)].legend;
      if (lgOwner && lgOwner.id === a.artifactId) {
        // 按动作携带的 `legendKey` 精确定位该面板技能（面板可同时含「启动 / 必杀」）
        const legendKey = (a.params?.legendKey as string | undefined) ?? undefined;
        const sk = lgOwner.skills.find((x) => x.key === legendKey);
        const sigLg = `${a.artifactId}:${legendKey ?? a.side}`;
        if (seenSkill.has(sigLg)) continue;
        seenSkill.add(sigLg);
        const txt = LEGEND_TEXT[lgOwner.id]?.skills.find(
          (x) => kindFromType(x.type) === (sk?.kind ?? 'ultimate'),
        );
        const nm = txt?.name ?? '技能';
        // 文案按技能类型区分（与神器 skillButton 的风格一致）：启动 → 「启动技能：X」；必杀 → 「发动必杀：「X」」
        const label = sk?.kind === 'activate' ? `启动技能：${nm}` : `发动必杀：「${nm}」`;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-skill';
        b.dataset.act = 'skill';
        b.textContent = label;
        b.addEventListener('click', () => {
          if (legendKey && SKILL_SELECTION[legendKey]) startSkillSelection(ctx, a, legendKey);
          else ctx.hooks.propose(a, label);
        });
        box.appendChild(b);
        continue;
      }
      // L01 断苇一斩：改动「斩神切」参数的**独立入口**（直接确认发动，不走"逐类选骰"向导）
      if (a.params?.opponentDiscardAll === true) {
        const sig = `${a.artifactId}:${a.side}:duanweiyizhan`;
        if (seenSkill.has(sig)) continue;
        seenSkill.add(sig);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-skill';
        b.dataset.act = 'skill';
        b.textContent = '发动「断苇一斩」：斩神切改为弃置对方全部能力骰';
        b.addEventListener('click', () =>
          ctx.hooks.propose(a, '发动「断苇一斩」：斩神切改为弃置对方全部能力骰'),
        );
        box.appendChild(b);
        continue;
      }
      const sig = `${a.artifactId}:${a.side}`;
      if (seenSkill.has(sig)) continue;
      seenSkill.add(sig);
      box.appendChild(skillButton(ctx, a));
      continue;
    }
    if (a.t === 'dustRise') {
      if (seenDust.has(a.artifactId)) continue;
      seenDust.add(a.artifactId);
      // L05 复仇之灵：强制尘起可能属于"非当前回合玩家"（如对方回合中触发）→ 按其归属玩家取神器
      const isFuchou = a.fuchou === true;
      const owner: PlayerId =
        isFuchou && state.pending?.kind === 'fuchouRise' ? state.pending.player : state.activePlayer;
      const art = state.players[owner].artifacts.find((x) => x.id === a.artifactId);
      // 019 免费额外尘起 / L05 复仇之灵强制额外尘起：按「免费」处理（fuchou 走强制额外通道）
      const free = isFuchou || state.freeNoCostRise > 0;
      if (art) box.appendChild(dustEntryButton(ctx, art, free, isFuchou));
      continue;
    }
    if (a.t === 'fengmang') {
      // 锋芒不再枚举「攻×冥」组合：入口 + 选骰面板
      if (!a.accept) {
        plain.push(a);
      } else if (!seenFengmang) {
        seenFengmang = true;
        box.appendChild(fengmangButton(ctx));
      }
      continue;
    }
    const segs = actionDieSegments(ctx, a);
    if (segs && segs.dice.length === 1) {
      const key = `${segs.parts.join('\u0000')}#${segs.parts.length}`;
      const g = groups.get(key) ?? { parts: segs.parts, items: [] };
      g.items.push({ a, die: segs.dice[0] });
      groups.set(key, g);
      continue;
    }
    plain.push(a);
  }
  // 骰片行（攻击/抵挡/取消真伤/减半/改点）→ 与技能、尘起、纯文字动作并列
  // 「不抵挡」在**无骰可挡**时一键直发（不弹确认条）；有骰可挡时仍走确认条
  const blockHasDice = ctx.legal.some(
    (x) => x.t === 'block' && (x.costSlots?.[0]?.dieIds?.length ?? 0) > 0,
  );
  for (const g of groups.values()) box.appendChild(actionChipRow(ctx, g.parts, g.items));
  for (const a of plain) {
    const label = actionLabel(ctx, a);
    if (label === null) continue;
    const direct = a.t === 'block' && !blockHasDice;
    box.appendChild(button(label, a, ctx.hooks, '', direct));
  }
  if (box.childElementCount === 0) {
    const empty = el('div', 'actionlist-empty');
    empty.textContent = '（无可用操作）';
    box.appendChild(empty);
  }
  return box;
}

/** 技能代价「slots」步骤：复用分格支付面板的呈现（每格 真骰/置换） */
function slotsStepView(ctx: Ctx, sel: ActiveSelection, step: SlotsStep): HTMLElement {
  const { state, hooks } = ctx;
  if (sel.slots.length !== step.kinds.length) {
    sel.slots = step.kinds.map(() => []);
    sel.slotModes = step.kinds.map(() => 'real');
  }

  const box = el('div', 'paypanel paypanel--slots');
  for (let i = 0; i < step.kinds.length; i++) {
    const row = el('div', 'slot-row');
    row.dataset.slot = String(i);

    const head = el('div', 'slot-head');
    const kindName = KIND_NAMES[step.kinds[i]];
    const name = el('span', 'slot-name');
    name.textContent = `格${i + 1}（${kindName}）`;
    head.appendChild(name);

    const modeDefs: { mode: 'real' | 'convert'; text: string }[] = [
      { mode: 'real', text: `用 1 颗${kindName}` },
      { mode: 'convert', text: '置换：2 颗任意骰' },
    ];
    for (const m of modeDefs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn slot-btn${sel.slotModes[i] === m.mode ? ' slot-btn--on' : ''}`;
      b.dataset.mode = m.mode;
      b.textContent = m.text;
      b.addEventListener('click', () => {
        if (sel.slotModes[i] === m.mode) return;
        sel.slotModes[i] = m.mode;
        sel.slots[i] = [];
        hooks.requestRender();
      });
      head.appendChild(b);
    }

    const summary = el('span', 'slot-summary');
    summary.textContent = slotSummary(state, step.kinds, sel.slotModes, sel.slots, i);
    head.appendChild(summary);

    row.appendChild(head);
    box.appendChild(row);
  }

  // 付款方 = 「现在轮到谁」的视角（待决策玩家优先）——与面板/生命值栏一致
  const payer = state.players[actorOf(state)];
  const current = firstUnfilledSelSlot(sel, step);
  const used = new Set(sel.slots.flat());
  const diceBox = el('div', 'pay-dice');
  for (const k of AREA_ORDER) {
    for (const d of payer.areas[k]) {
      const die = el('span', `pay-die die-${payer.id}`);
      die.dataset.id = d.id;
      die.dataset.kind = d.kind;
      die.dataset.value = String(d.value);
      die.textContent = `${KIND_SHORT[d.kind]}${d.value}`;
      if (used.has(d.id)) {
        die.classList.add('pay-die--used');
      } else if (current >= 0) {
        const allowed = sel.slotModes[current] === 'convert' || d.kind === step.kinds[current];
        if (allowed) {
          die.classList.add('clickable');
          die.addEventListener('click', () => assignSelDie(ctx, sel, step, d));
        }
      }
      diceBox.appendChild(die);
    }
  }
  box.appendChild(diceBox);

  const info = el('div', 'selector-info');
  const filled = step.kinds.filter((_, i) => sel.slots[i].length >= selSlotSize(sel.slotModes[i])).length;
  info.textContent = `已填 ${filled}/${step.kinds.length}`;
  box.appendChild(info);

  return box;
}

/** 技能选择器「dice」步骤的骰片（与骰区点选共享同一选中状态；双入口） */
function chooserDiceChips(ctx: Ctx, sel: ActiveSelection, step: DiceStep): HTMLElement {
  const actor = actorOf(ctx.state);
  const ownerId = step.owner === 'self' ? actor : oppOf(actor);
  const owner = ctx.state.players[ownerId];
  const box = el('div', 'pay-dice');
  for (const k of AREA_ORDER) {
    if (!step.areas.includes(k)) continue;
    for (const d of owner.areas[k]) {
      const die = el('span', `pay-die die-${owner.id}`);
      die.dataset.id = d.id;
      die.dataset.kind = d.kind;
      die.dataset.value = String(d.value);
      die.textContent = `${KIND_SHORT[d.kind]}${d.value}`;
      if (sel.currentSel.has(d.id)) {
        die.classList.add('selected');
      }
      if ((step.ignoreLock || !isValueLocked(ctx.state, ownerId, d.value)) && (!step.filter || step.filter(d))) {
        die.classList.add('clickable');
        die.addEventListener('click', () => toggleSelDie(ctx.hooks, step, d));
      } else {
        die.classList.add('pay-die--used');
      }
      box.appendChild(die);
    }
  }
  // 034/A03 破障（持续）：神器上存放的骰当作能力骰「使用/消耗」→ 仅限走 paySlots 的支付步（allowArtifact）
  // 只附**与本步类型相符**的存放骰（类型按第二列分布判定），避免出现"类型不符"的假可选项。
  if (step.allowArtifact === true && step.owner === 'self' && hasActiveSkill(owner, 'jingang.pozhang.continuous')) {
    for (const k of AREA_ORDER) {
      if (!step.areas.includes(k)) continue;
      for (const h of heldDiceOfKind(ctx.state, ownerId, k)) {
        const hd = { id: h.id, value: h.value, kind: k };
        const chip = el('span', 'pay-die pay-die--held');
        chip.dataset.id = h.id;
        chip.dataset.value = String(h.value);
        chip.textContent = String(h.value);
        chip.title = `「金刚·破障」：神器上存放的骰（${h.value} 点，视为${KIND_NAMES[k]}骰）`;
        if (sel.currentSel.has(h.id)) chip.classList.add('selected');
        if ((step.ignoreLock || !isValueLocked(ctx.state, ownerId, h.value)) && (!step.filter || step.filter(hd))) {
          chip.classList.add('clickable');
          chip.addEventListener('click', () => toggleSelDie(ctx.hooks, step, hd));
        } else {
          chip.classList.add('pay-die--used');
        }
        box.appendChild(chip);
      }
    }
  }
  return box;
}

function chooserPanel(ctx: Ctx): HTMLElement | null {
  const sel: ActiveSelection | null = ctx.hooks.ui.selection;
  if (!sel) return null;
  const spec = SKILL_SELECTION[sel.key];
  if (!spec) return null;
  const { state, hooks } = ctx;
    const steps = spec.steps({ state, player: actorOf(state), chosenDice: sel.chosenDice, options: sel.options, numbers: sel.numbers, slots: sel.slots });
    const step = steps[sel.stepIndex];
  // **仅"骰片步"**用 3 行式（文字独占一行、骰片+按钮下一行）；选项/数字/点数/slots 步保持原样（与按钮同行）
  const panel = el('div', step && step.kind === 'dice' ? 'selector selector--head-row' : 'selector');
  if (!step) return panel;

  const head = el('div', 'selector-head');
  const title = el('div', 'selector-title');
  title.textContent = `步骤 ${sel.stepIndex + 1}/${steps.length} · ${step.label}`;
  head.appendChild(title);

  let diceValidate: { ok: boolean; hint?: string } = { ok: true };
  if (step.kind === 'dice') {
    const info = el('div', 'selector-info');
    info.textContent = `已选 ${sel.currentSel.size}（需 ${step.min}–${step.max} 颗）`;
    head.appendChild(info);
    if (step.validate) {
      const picked = [...sel.currentSel].map((id) => findDie(state, id)).filter((d): d is Die => d !== undefined);
      diceValidate = step.validate(picked);
      if (diceValidate.hint) {
        const hint = el('div', 'selector-hint');
        hint.textContent = diceValidate.hint;
        if (!diceValidate.ok) hint.classList.add('selector-hint--bad');
        head.appendChild(hint);
      }
    }
  } else if (step.kind === 'option') {
    const row = el('div', 'option-row');
    for (const o of step.options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn option-btn';
      b.dataset.option = o.value;
      if (sel.options[sel.stepIndex] === o.value) b.classList.add('option-btn--on');
      b.textContent = o.label;
      b.addEventListener('click', () => {
        sel.options[sel.stepIndex] = o.value;
        hooks.requestRender();
      });
      row.appendChild(b);
    }
    head.appendChild(row);
  } else if (step.kind === 'number') {
    const nums = el('div', 'number-row');
    for (let n = step.min; n <= step.max; n++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn number-btn';
      if (sel.numbers[sel.stepIndex] === n) b.classList.add('number-btn--on');
      b.textContent = step.fmt ? step.fmt(n) : String(n);
      b.addEventListener('click', () => {
        sel.numbers[sel.stepIndex] = n;
        hooks.requestRender();
      });
      nums.appendChild(b);
    }
    head.appendChild(nums);
  } else if (step.kind === 'pips') {
    const info = el('div', 'selector-info');
    info.textContent = `已选 ${sel.currentSel.size}（需 ${step.min}–${step.max} 个互不相同的点数）`;
    head.appendChild(info);
    const row = el('div', 'option-row');
    for (let v = 1; v <= 6; v++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn option-btn';
      b.dataset.pip = String(v);
      if (sel.currentSel.has(String(v))) b.classList.add('option-btn--on');
      b.textContent = `${v} 点`;
      b.addEventListener('click', () => {
        const key = String(v);
        if (sel.currentSel.has(key)) sel.currentSel.delete(key);
        else if (sel.currentSel.size < step.max) sel.currentSel.add(key);
        hooks.requestRender();
      });
      row.appendChild(b);
    }
    head.appendChild(row);
  }
  panel.appendChild(head);

  if (step.kind === 'slots') {
    panel.appendChild(slotsStepView(ctx, sel, step));
  } else if (step.kind === 'dice') {
    panel.appendChild(chooserDiceChips(ctx, sel, step));
  }

  const actions = el('div', 'selector-actions');

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-cancel';
  cancel.textContent = '取消';
  cancel.addEventListener('click', () => {
    hooks.ui.selection = null;
    hooks.requestRender();
  });
  const chosenNum = sel.numbers[sel.stepIndex];
  let satisfied: boolean;
  if (step.kind === 'dice') {
    satisfied = sel.currentSel.size >= step.min && sel.currentSel.size <= step.max && diceValidate.ok;
  } else if (step.kind === 'option') {
    satisfied = step.options.some((o) => o.value === sel.options[sel.stepIndex]);
  } else if (step.kind === 'slots') {
    satisfied = allSelSlotsFilled(sel, step);
  } else if (step.kind === 'pips') {
    satisfied = sel.currentSel.size >= step.min && sel.currentSel.size <= step.max;
  } else {
    satisfied = Number.isInteger(chosenNum) && chosenNum >= step.min && chosenNum <= step.max;
  }

  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'btn btn-confirm';
  ok.textContent = isDirectCost(spec, ctx.state, actorOf(ctx.state)) ? '发动' : '确认';
  ok.disabled = !satisfied;
  ok.addEventListener('click', () => confirmSelection(ctx));
  // 统一顺序：确认 → 取消（全站一致）
  actions.appendChild(ok);
  actions.appendChild(cancel);

  panel.appendChild(actions);
  return panel;
}

function confirmSelection(ctx: Ctx): void {
  const sel = ctx.hooks.ui.selection;
  if (!sel) return;
  const spec = SKILL_SELECTION[sel.key];
  if (!spec) {
    ctx.hooks.ui.selection = null;
    ctx.hooks.requestRender();
    return;
  }
  const { state, hooks } = ctx;
  const player = actorOf(state);
  const steps = spec.steps({ state, player, chosenDice: sel.chosenDice, options: sel.options, numbers: sel.numbers, slots: sel.slots });
  const step = steps[sel.stepIndex];
  if (!step) {
    hooks.ui.selection = null;
    hooks.requestRender();
    return;
  }

  if (step.kind === 'dice') {
    sel.chosenDice.push([...sel.currentSel]);
    sel.currentSel = new Set<string>();
  } else if (step.kind === 'option') {
    if (!step.options.some((o) => o.value === sel.options[sel.stepIndex])) {
      hooks.requestRender();
      return;
    }
    sel.chosenDice.push([]);
  } else if (step.kind === 'slots') {
    if (!allSelSlotsFilled(sel, step)) {
      hooks.requestRender();
      return;
    }
    sel.slots = sel.slots.map((ids) => [...ids]);
  } else if (step.kind === 'pips') {
    if (sel.currentSel.size < step.min || sel.currentSel.size > step.max) {
      hooks.requestRender();
      return;
    }
    sel.chosenDice.push([...sel.currentSel]);
    sel.currentSel = new Set<string>();
  }
  sel.stepIndex += 1;

  const nextSteps = spec.steps({ state, player, chosenDice: sel.chosenDice, options: sel.options, numbers: sel.numbers, slots: sel.slots });
  if (sel.stepIndex >= nextSteps.length) {
    const numberIdx = nextSteps
      .map((s, i) => (s.kind === 'number' ? i : -1))
      .filter((i) => i >= 0);
    const numbers = numberIdx.map((i) => sel.numbers[i]);
    if (sel.pendingKind) {
      // 「待决策」直接派发：询问本身即确认（013 电刑/雷暴、017 帷幕、018 重掷、023 共振）
      if (sel.pendingKind === 'gongzhenPick') {
        const pendingAction: Action = {
          t: 'gongzhenResolve',
          pick: sel.options[0] === 'discard' ? 'discard' : 'gain',
          myIds: sel.chosenDice[1] ?? [],
          oppIds: sel.chosenDice[2] ?? [],
        };
        hooks.ui.selection = null;
        hooks.onAction(pendingAction);
        return;
      }
      const ids = sel.chosenDice[0] ?? [];
      let pendingAction: Action;
      if (sel.pendingKind === 'kuyu') {
        hooks.ui.selection = null;
        hooks.onAction({ t: 'kuyuResolve', area: (sel.options[0] ?? 'attack') as DiceKind });
        return;
      }
      if (sel.pendingKind === 'tiaolingPick') {
        // 新版：① 全相同/全不同 ② 选要保留的点数 → buildParams 自动算出要弃的骰
        const built = spec.buildParams({
          state,
          player,
          chosenDice: sel.chosenDice,
          options: sel.options,
          numbers,
          slots: sel.slots,
        }) as { pick: 'same' | 'diff'; dieIds: string[] };
        hooks.ui.selection = null;
        hooks.onAction({ t: 'tiaolingResolve', pick: built.pick, dieIds: built.dieIds });
        return;
      }
      if (sel.pendingKind === 'wanzhangDiscard') {
        hooks.ui.selection = null;
        hooks.onAction({ t: 'wanzhangDiscard', dieIds: sel.chosenDice[0] ?? [] });
        return;
      }
      if (sel.pendingKind === 'kongYuluo') {
        hooks.ui.selection = null;
        hooks.onAction({ t: 'kongYuluo', choice: 'discard', dieId: sel.chosenDice[0]?.[0] ?? '' });
        return;
      }
      if (sel.pendingKind === 'kongYuluoGain') {
        hooks.ui.selection = null;
        hooks.onAction({ t: 'kongYuluo', choice: 'gain', kind: (sel.options[0] ?? 'attack') as DiceKind });
        return;
      }
      if (sel.pendingKind === 'wufaraoshu') {
        hooks.ui.selection = null;
        hooks.onAction({ t: 'wufaraoshu', choice: 'discard', dieId: sel.chosenDice[0]?.[0] ?? '' });
        return;
      }
      if (sel.pendingKind === 'yuanwu') {
        hooks.ui.selection = null;
        hooks.onAction({
          t: 'yuanwu',
          dieId: sel.chosenDice[0]?.[0] ?? '',
          to: (sel.options[1] ?? 'attack') as DiceKind,
        });
        return;
      }
      if (sel.pendingKind === 'endDiscard') {
        hooks.ui.selection = null;
        hooks.onAction({ t: 'endDiscardResolve', dieIds: sel.chosenDice[0] ?? [] });
        return;
      }
      if (sel.pendingKind === 'guwangCancelConvert') {
        hooks.ui.selection = null;
        hooks.onAction({ t: 'guwangCancel', cancel: true, costSlots: [{ dieIds: sel.chosenDice[0] ?? [] }] });
        return;
      }
      if (sel.pendingKind === 'dunwuHalveConvert') {
        hooks.ui.selection = null;
        hooks.onAction({ t: 'dunwuHalve', accept: true, costSlots: [{ dieIds: sel.chosenDice[0] ?? [] }] });
        return;
      }
      if (sel.pendingKind === 'weijuPayConvert') {
        hooks.ui.selection = null;
        hooks.onAction({ t: 'weijuPay', costSlots: [{ dieIds: sel.chosenDice[0] ?? [] }] });
        return;
      }
      if (sel.pendingKind === 'dianxing') pendingAction = { t: 'dianxing', dieIds: ids };
      else if (sel.pendingKind === 'leibao') pendingAction = { t: 'leibao', dieIds: ids };
      else if (sel.pendingKind === 'weimu') pendingAction = { t: 'weimu', accept: true, dieId: ids[0] };
      else if (sel.pendingKind === 'weiyaPick')
        pendingAction = {
          t: 'weiyaPick',
          owner: sel.options[0] === 'opponent' ? 'opp' : 'self',
          dieId: sel.chosenDice[1]?.[0],
        };
      else if (sel.pendingKind === 'xianzhenPick')
        pendingAction = { t: 'xianzhenResolve', dieId: sel.chosenDice[0]?.[0] ?? '' };
      else if (sel.pendingKind === 'hengguan')
        pendingAction = { t: 'hengguan', dieId: sel.chosenDice[0]?.[0] };
      else if (sel.pendingKind === 'shizushouhun')
        pendingAction = { t: 'shizushouhun', accept: true, costSlots: [{ dieIds: sel.chosenDice[0] ?? [] }] };
      else if (sel.pendingKind === 'dizuidaijianshu')
        pendingAction = { t: 'dizuidaijianshu', dieIds: sel.chosenDice[0] ?? [] };
      else if (sel.pendingKind === 'shangjin') {
        // L08「只为赏金而来」：按该技能自己的选择器补全参数后，以**普通技能动作**提交
        //（引擎在 `shangjin` 待决策存在时认定"不计入每回合上限"）
        const params = spec.buildParams({
          state,
          player,
          chosenDice: sel.chosenDice,
          options: sel.options,
          numbers,
          slots: sel.slots,
        });
        const skillAction: SkillAction = { t: 'skill', artifactId: sel.artifactId, side: sel.side, params };
        hooks.ui.selection = null;
        hooks.propose(skillAction, skillActionLabel(ctx, skillAction));
        return;
      } else pendingAction = { t: 'zhihaiReroll', dieIds: ids };
      hooks.ui.selection = null;
      hooks.onAction(pendingAction);
      return;
    }
    const params = spec.buildParams({ state, player, chosenDice: sel.chosenDice, options: sel.options, numbers, slots: sel.slots });
    const action: SkillAction = { t: 'skill', artifactId: sel.artifactId, side: sel.side, params };
    hooks.ui.selection = null;
    // S1：多颗「真实之剑」代价（持剑时）→ **直接派发**，不再弹确认条（代价汇总已写在该步标题里）
    if (isDirectCost(spec, state, player)) hooks.onAction(action);
    else hooks.propose(action, skillActionLabel(ctx, action));
  }
  hooks.requestRender();
}

/**
 * 战报上色（**仅界面层**，引擎 `entry.text` 不变 → 现有 `l.text` 断言不受影响）。
 * 把"玩家名 / 技能名"渲染成按归属上色的 span：
 *  ① 身份词：`玩家A`(蓝) / `玩家B`(红) / 挑战模式 `「<当前卡名>」`(红) / `昔日传奇`(红)；
 *  ② `「…」`里的名字 → 按"离它**最近的前一个身份词**"上色（无前身份 → 取本行第一个身份词）；
 *  ③ 挑战模式"传奇回合行"（以 `「<卡名>」` 开头）里的**裸技能名**（匹配该卡技能名表）→ 红。
 * **同名技能不串色**：颜色只由"这句话在讲谁"决定，不建"名字→归属"全局表。
 * （残留局限：一行里同时提双方、且技能属"后提到"一方且中间无身份词过渡时可能偏色——罕见，接受。）
 */
function appendLogColored(
  line: HTMLElement,
  text: string,
  cardLegacy: string | null,
  cardSkillNames: string[],
): void {
  const actors: { start: number; end: number; color: PlayerId }[] = [];
  const skills: { start: number; end: number }[] = [];
  const scan = (re: RegExp, on: (m: RegExpExecArray) => void): void => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      on(m);
      if (m.index === re.lastIndex) re.lastIndex += 1; // 防零宽死循环
    }
  };
  scan(/玩家A/g, (m) => actors.push({ start: m.index, end: m.index + 3, color: 'A' }));
  scan(/玩家B/g, (m) => actors.push({ start: m.index, end: m.index + 3, color: 'B' }));
  scan(/昔日传奇/g, (m) => actors.push({ start: m.index, end: m.index + 4, color: 'B' }));
  if (cardLegacy) {
    const tag = `「${cardLegacy}」`;
    scan(new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), (m) =>
      actors.push({ start: m.index, end: m.index + tag.length, color: 'B' }),
    );
  }
  scan(/「[^」]*」/g, (m) => {
    const inner = m[0].slice(1, -1);
    if (cardLegacy && inner === cardLegacy) return; // 已作身份词，不重复
    skills.push({ start: m.index, end: m.index + m[0].length });
  });
  // 传奇回合行里的"裸技能名"（数据匹配；仅此类行 → 挑战者行永不触发 → 同名不串）
  if (cardLegacy && text.startsWith(`「${cardLegacy}」`)) {
    for (const nm of cardSkillNames) {
      if (!nm) continue;
      let i = text.indexOf(nm);
      while (i >= 0) {
        const end = i + nm.length;
        const overlaps =
          actors.some((a) => i < a.end && end > a.start) || skills.some((s) => i < s.end && end > s.start);
        if (!overlaps) skills.push({ start: i, end });
        i = text.indexOf(nm, i + nm.length);
      }
    }
  }
  const colorOf = (start: number): PlayerId | null => {
    let best: { start: number; color: PlayerId } | null = null;
    for (const a of actors) if (a.start < start && (!best || a.start > best.start)) best = a;
    return (best ?? actors[0])?.color ?? null;
  };
  const marks = [
    ...actors.map((a) => ({ start: a.start, end: a.end, cls: `log-actor player-${a.color}` })),
    ...skills
      .map((s) => ({ s, c: colorOf(s.start) }))
      .filter((x) => x.c !== null)
      .map((x) => ({ start: x.s.start, end: x.s.end, cls: `log-skill player-${x.c}` })),
  ].sort((a, b) => a.start - b.start);

  let pos = 0;
  for (const mk of marks) {
    if (mk.start < pos) continue; // 交叠 → 取先者
    if (mk.start > pos) line.appendChild(document.createTextNode(text.slice(pos, mk.start)));
    const span = el('span', mk.cls);
    span.textContent = text.slice(mk.start, mk.end);
    line.appendChild(span);
    pos = mk.end;
  }
  if (pos < text.length) line.appendChild(document.createTextNode(text.slice(pos)));
}

function logLines(box: HTMLElement, entries: GameState['log'], ctx: Ctx): void {
  if (entries.length === 0) {
    box.textContent = '（暂无记录）';
    return;
  }
  const card =
    ctx.state.mode === 'challenge' && ctx.state.challenge
      ? CHALLENGES.find((c) => c.id === ctx.state.challenge!.cardId)
      : undefined;
  const cardLegacy = card?.legacy ?? null;
  const cardSkillNames = (card?.skills ?? []).map((s) => s.name);
  for (const entry of entries) {
    const line = el('div', 'log-line');
    const prefix = el('span', 'log-prefix');
    prefix.textContent = `T${entry.turn}·${PHASE_LABEL[entry.phase]}：`;
    line.appendChild(prefix);
    appendLogColored(line, entry.text, cardLegacy, cardSkillNames);
    box.appendChild(line);
  }
}

function logPanel(ctx: Ctx, zoomable = false): HTMLElement {
  const box = el('div', 'log');
  // 右键 → 战报放大弹窗（更大的空间看全量战报）
  if (zoomable) {
    box.classList.add('log--zoomable');
    box.title = '右键 / 长按 / 单击放大战报';
    const openPop = (): void => {
      ctx.hooks.ui.logPop = true;
      ctx.hooks.requestRender();
    };
    box.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openPop();
    });
    // 触屏：单击即看完整战报（桌面左键不弹，避免误触）
    box.addEventListener('click', (e) => {
      const pe = e as PointerEvent;
      const coarse =
        typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
      if (pe.pointerType === 'touch' || (!pe.pointerType && coarse)) openPop();
    });
    // 长按：位移超过 10px 才取消（真机手指微抖不误取消）
    let lp: number | null = null;
    let sx = 0;
    let sy = 0;
    const clearLp = (): void => { if (lp != null) { window.clearTimeout(lp); lp = null; } };
    box.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      clearLp();
      sx = e.clientX;
      sy = e.clientY;
      lp = window.setTimeout(() => { lp = null; openPop(); }, 500);
    });
    box.addEventListener('pointermove', (e) => {
      if (lp == null) return;
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) clearLp();
    });
    box.addEventListener('pointerup', clearLp);
    box.addEventListener('pointercancel', clearLp);
  }
  logLines(box, ctx.state.log.slice(-30).reverse(), ctx);
  return box;
}

/** 战报放大弹窗：全量战报、大空间（右键/单击战报打开；点弹窗外面关闭，无头部按钮） */
function logPopModal(ctx: Ctx): HTMLElement {
  const overlay = el('div', 'logpop-overlay');
  const modal = el('div', 'logpop-modal');
  const body = el('div', 'log log--pop');
  logLines(body, [...ctx.state.log].reverse(), ctx);
  modal.appendChild(body);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      ctx.hooks.ui.logPop = false;
      ctx.hooks.requestRender();
    }
  });
  overlay.appendChild(modal);
  return overlay;
}

/** 战术牌·战前「抽 2 留 1」弹窗（预设/轮选）：只显示当前选者的 2 张（暗牌），点击即定 */
function tacticChooseOverlay(ctx: Ctx): HTMLElement {
  const { state, hooks } = ctx;
  const who = state.tacticQueue[0];
  const overlay = el('div', 'tactic-choose-overlay');
  const modal = el('div', 'tactic-choose-modal');
  const title = el('div', 'tactic-choose-title');
  title.textContent = who ? `玩家${who} · 从 2 张中选 1 张战术牌` : '';
  modal.appendChild(title);
  const grid = el('div', 'tactic-choose-grid');
  const picks = getLegalActions(state).filter(
    (a): a is Extract<Action, { t: 'tacticPick' }> => a.t === 'tacticPick',
  );
  for (const a of picks) {
    const def = TACTIC_BY_ID[a.id];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'tactic-choose-card';
    card.dataset.id = a.id;
    const img = document.createElement('img');
    img.src = tacticImageUrl(a.id);
    img.alt = def?.name ?? a.id;
    img.draggable = false;
    card.appendChild(img);
    const nm = el('div', 'tactic-choose-name');
    nm.textContent = def?.name ?? a.id;
    card.appendChild(nm);
    const eff = el('div', 'tactic-choose-eff');
    eff.textContent = def ? tacticDisplayText(def) : '（效果文本待转写）';
    card.appendChild(eff);
    card.addEventListener('click', () => hooks.onAction({ t: 'tacticPick', id: a.id }));
    grid.appendChild(card);
  }
  modal.appendChild(grid);
  overlay.appendChild(modal);
  return overlay;
}

/** 联机·非本人操作时的战前等待层（**不显示**对方的暗牌——抽2留1 是隐藏信息） */
function tacticWaitOverlay(ctx: Ctx): HTMLElement {
  const overlay = el('div', 'tactic-choose-overlay');
  const modal = el('div', 'tactic-choose-modal tactic-choose-modal--wait');
  const title = el('div', 'tactic-choose-title');
  title.textContent = `等待 ${playerName(ctx, actorOf(ctx.state))} 选择战术牌…`;
  modal.appendChild(title);
  const note = el('div', 'tactic-choose-wait');
  note.textContent = '（对方正在选牌，牌面保密）';
  modal.appendChild(note);
  overlay.appendChild(modal);
  return overlay;
}

/** T02「先机」：指定一位玩家成为先手（尘印标记随之转移） */
function tacticFirstOverlay(ctx: Ctx): HTMLElement {
  const { state, hooks } = ctx;
  const who = state.pending?.kind === 'tacticFirst' ? state.pending.player : null;
  const overlay = el('div', 'tactic-choose-overlay');
  const modal = el('div', 'tactic-choose-modal');
  const title = el('div', 'tactic-choose-title');
  title.textContent = who ? `玩家${who} 「先机」：指定一位玩家成为先手` : '「先机」';
  modal.appendChild(title);
  const grid = el('div', 'tactic-choose-grid');
  for (const w of ['A', 'B'] as const) {
    const other = w === 'A' ? 'B' : 'A';
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'tactic-choose-card tactic-first-card';
    card.dataset.who = w;
    const nm = el('div', 'tactic-choose-name');
    nm.textContent = `玩家${w} 先手`;
    const eff = el('div', 'tactic-choose-eff');
    eff.textContent = `尘印标记收入玩家${other}`;
    card.appendChild(nm);
    card.appendChild(eff);
    card.addEventListener('click', () => hooks.onAction({ t: 'tacticFirst', who: w }));
    grid.appendChild(card);
  }
  modal.appendChild(grid);
  overlay.appendChild(modal);
  return overlay;
}

/** T13「远见」：战斗开始时，猜测"生命最先降为 20 点或以下"的玩家 */
function tacticGuessOverlay(ctx: Ctx): HTMLElement {
  const { state, hooks } = ctx;
  const who = state.pending?.kind === 'tacticGuess' ? state.pending.player : null;
  const overlay = el('div', 'tactic-choose-overlay');
  const modal = el('div', 'tactic-choose-modal');
  const title = el('div', 'tactic-choose-title');
  title.textContent = who ? `玩家${who} 「远见」：猜测生命最先降为 20 点或以下的玩家` : '「远见」';
  modal.appendChild(title);
  const grid = el('div', 'tactic-choose-grid');
  for (const w of ['A', 'B'] as const) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'tactic-choose-card tactic-first-card';
    card.dataset.who = w;
    const nm = el('div', 'tactic-choose-name');
    nm.textContent = `玩家${w}`;
    const eff = el('div', 'tactic-choose-eff');
    eff.textContent = `猜测玩家${w}最先降至 20 点或以下`;
    card.appendChild(nm);
    card.appendChild(eff);
    card.addEventListener('click', () => hooks.onAction({ t: 'tacticGuess', who: w }));
    grid.appendChild(card);
  }
  modal.appendChild(grid);
  overlay.appendChild(modal);
  return overlay;
}

/** T01「谨慎」：自定初始能力骰点数（同类型不超过 4 个；无初始重掷） */
function tacticDiceOverlay(ctx: Ctx): HTMLElement {
  const { state, hooks } = ctx;
  const pd = state.pending;
  const who = pd && pd.kind === 'tacticDice' ? pd.player : 'A';
  const p = state.players[who];
  const will = effectiveWill(p);
  const dist = emptyDistribution(p) ?? { attack: [1, 2], defense: [3, 4], meditation: [5, 6] };
  const values: (number | null)[] = new Array(will).fill(null);
  const KIND_SHORT: Record<DiceKind, string> = { attack: '攻', defense: '防', meditation: '冥' };
  const KIND_ORDER: DiceKind[] = ['attack', 'defense', 'meditation'];

  const overlay = el('div', 'tactic-choose-overlay');
  const modal = el('div', 'tactic-choose-modal');
  const title = el('div', 'tactic-choose-title');
  title.textContent = `玩家${who} 「谨慎」：选择你的初始能力骰点数（共 ${will} 颗；同类型不超过 4 个）`;
  modal.appendChild(title);

  // 点数 → 类型映射（该玩家第二列神器的分布），让玩家知道选哪个数字得到哪种骰
  const map = el('div', 'tactic-dice-map');
  map.textContent = `你的分布　${KIND_ORDER.map((k) => `${KIND_SHORT[k]} ${dist[k].join('·')}`).join('　')}`;
  modal.appendChild(map);

  const grid = el('div', 'tactic-dice-grid');
  const kindLabels: HTMLElement[] = [];

  // 底部：已选类型实时统计
  const stat = el('div', 'tactic-dice-dist');
  const statLabel = el('span', 'tactic-dice-dist-label');
  statLabel.textContent = '已选';
  stat.appendChild(statLabel);
  const statNums: Record<DiceKind, HTMLElement> = { attack: stat, defense: stat, meditation: stat };
  for (const k of KIND_ORDER) {
    const item = el('span', 'tactic-dice-dist-item');
    const lab = el('span', 'tactic-dice-dist-k');
    lab.textContent = KIND_SHORT[k];
    const num = el('span', 'tactic-dice-dist-n');
    num.textContent = '0';
    statNums[k] = num;
    item.appendChild(lab);
    item.appendChild(num);
    stat.appendChild(item);
  }

  const err = el('div', 'tactic-dice-err');
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'tactic-dice-confirm';
  confirm.textContent = '确认';

  const refresh = () => {
    const counts: Record<DiceKind, number> = { attack: 0, defense: 0, meditation: 0 };
    let filled = 0;
    for (const v of values) {
      if (v == null) continue;
      counts[areaOf(v, dist)] += 1;
      filled += 1;
    }
    // 每行类型标签
    for (let i = 0; i < will; i++) {
      const v = values[i];
      const kl = kindLabels[i];
      if (v == null) {
        kl.textContent = '';
        kl.className = 'tactic-dice-kind';
      } else {
        const k = areaOf(v, dist);
        kl.textContent = KIND_SHORT[k];
        kl.className = `tactic-dice-kind k-${k}`;
      }
    }
    // 实时统计
    for (const k of KIND_ORDER) {
      statNums[k].textContent = String(counts[k]);
      statNums[k].classList.toggle('over', counts[k] > 4);
    }
    const bad = KIND_ORDER.some((k) => counts[k] > 4);
    err.textContent = bad ? '同类型能力骰不能超过 4 个' : filled < will ? `还需选择 ${will - filled} 颗` : '';
    err.classList.toggle('on', bad);
    confirm.disabled = bad || filled < will;
  };

  for (let i = 0; i < will; i++) {
    const row = el('div', 'tactic-dice-row');
    const idx = el('span', 'tactic-dice-idx');
    idx.textContent = `第 ${i + 1} 颗`;
    row.appendChild(idx);
    const btns: HTMLButtonElement[] = [];
    for (let v = 1; v <= 6; v++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tactic-dice-num';
      b.dataset.val = String(v);
      b.textContent = String(v);
      b.addEventListener('click', () => {
        values[i] = v;
        for (const bb of btns) bb.classList.toggle('on', Number(bb.dataset.val) === values[i]);
        refresh();
      });
      btns.push(b);
      row.appendChild(b);
    }
    const kl = el('span', 'tactic-dice-kind');
    kindLabels.push(kl);
    row.appendChild(kl);
    grid.appendChild(row);
  }
  refresh();

  confirm.addEventListener('click', () => {
    const vals = values.filter((v): v is number => v != null);
    if (vals.length !== will) return;
    hooks.onAction({ t: 'tacticDice', values: vals });
  });
  const foot = el('div', 'tactic-dice-foot');
  foot.appendChild(confirm);
  modal.appendChild(grid);
  modal.appendChild(stat);
  modal.appendChild(err);
  modal.appendChild(foot);
  overlay.appendChild(modal);
  return overlay;
}

/** T10「迂回」：把 2 个 1 点能力骰放置到任意区域（快速操作栏内的选择面板；**单行**、不改栏高） */
function yuhuiPanel(ctx: Ctx): HTMLElement {
  const { hooks } = ctx;
  const panel = el('div', 'selector yuhui-panel');
  const head = el('div', 'selector-head');
  const title = el('div', 'selector-title');
  title.textContent = '「迂回」';
  head.appendChild(title);
  const AREA: { k: DiceKind; label: string }[] = [
    { k: 'attack', label: '攻' },
    { k: 'defense', label: '防' },
    { k: 'meditation', label: '冥' },
  ];
  const chosen: (DiceKind | null)[] = [null, null];
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'btn btn-confirm';
  confirm.textContent = '确认';
  confirm.disabled = true;
  for (let i = 0; i < 2; i++) {
    const idx = el('span', 'selector-info');
    idx.textContent = i === 0 ? '①' : '②';
    head.appendChild(idx);
    const row = el('div', 'option-row');
    const btns: HTMLButtonElement[] = [];
    for (const { k, label } of AREA) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn option-btn';
      b.dataset.k = k;
      b.textContent = label;
      b.addEventListener('click', () => {
        chosen[i] = k;
        for (const bb of btns) bb.classList.toggle('option-btn--on', bb.dataset.k === k);
        confirm.disabled = chosen.some((c) => c == null);
      });
      btns.push(b);
      row.appendChild(b);
    }
    head.appendChild(row);
  }
  panel.appendChild(head);
  confirm.addEventListener('click', () => {
    if (chosen.some((c) => c == null)) return;
    hooks.onAction({ t: 'yuhuiPlace', areas: [chosen[0]!, chosen[1]!] });
  });
  const actions = el('div', 'selector-actions');
  actions.appendChild(confirm);
  panel.appendChild(actions);
  return panel;
}

/** T15「影子」：第一个回合开始时，为战术上的存放骰选定点数（1–6）——快速操作栏内嵌单行面板 */
function yingziPanel(ctx: Ctx): HTMLElement {
  const { hooks } = ctx;
  const panel = el('div', 'selector yingzi-panel');
  const head = el('div', 'selector-head');
  const title = el('div', 'selector-title');
  title.textContent = '「影子」：选择置于战术上的能力骰点数';
  head.appendChild(title);
  let chosen: number | null = null;
  const nums = el('div', 'number-row');
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'btn btn-confirm';
  confirm.textContent = '确认';
  confirm.disabled = true;
  const btns: HTMLButtonElement[] = [];
  for (let n = 1; n <= 6; n++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn number-btn';
    b.dataset.n = String(n);
    b.textContent = String(n);
    b.addEventListener('click', () => {
      chosen = n;
      for (const bb of btns) bb.classList.toggle('number-btn--on', bb.dataset.n === String(n));
      confirm.disabled = false;
    });
    btns.push(b);
    nums.appendChild(b);
  }
  head.appendChild(nums);
  panel.appendChild(head);
  confirm.addEventListener('click', () => {
    if (chosen == null) return;
    hooks.onAction({ t: 'yingziPick', value: chosen });
  });
  const actions = el('div', 'selector-actions');
  actions.appendChild(confirm);
  panel.appendChild(actions);
  return panel;
}

/** T13「远见」·奖励：猜测正确时，获得 1 个任意点数能力骰（1–6）并放入任意区域——快速操作栏内嵌面板 */
function yuanjianPanel(ctx: Ctx): HTMLElement {
  const { hooks } = ctx;
  const panel = el('div', 'selector yuanjian-panel');
  const head = el('div', 'selector-head');
  const title = el('div', 'selector-title');
  title.textContent = '「远见」：获得 1 个任意点数能力骰';
  head.appendChild(title);
  let value: number | null = null;
  let area: DiceKind | null = null;
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'btn btn-confirm';
  confirm.textContent = '确认';
  confirm.disabled = true;
  const sync = (): void => {
    confirm.disabled = value == null || area == null;
  };
  const nums = el('div', 'number-row');
  const numBtns: HTMLButtonElement[] = [];
  for (let n = 1; n <= 6; n++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn number-btn';
    b.dataset.n = String(n);
    b.textContent = String(n);
    b.addEventListener('click', () => {
      value = n;
      for (const bb of numBtns) bb.classList.toggle('number-btn--on', bb.dataset.n === String(n));
      sync();
    });
    numBtns.push(b);
    nums.appendChild(b);
  }
  head.appendChild(nums);
  const AREA: { k: DiceKind; label: string }[] = [
    { k: 'attack', label: '攻' },
    { k: 'defense', label: '防' },
    { k: 'meditation', label: '冥' },
  ];
  const row = el('div', 'option-row');
  const areaBtns: HTMLButtonElement[] = [];
  for (const { k, label } of AREA) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn option-btn';
    b.dataset.k = k;
    b.textContent = label;
    b.addEventListener('click', () => {
      area = k;
      for (const bb of areaBtns) bb.classList.toggle('option-btn--on', bb.dataset.k === k);
      sync();
    });
    areaBtns.push(b);
    row.appendChild(b);
  }
  head.appendChild(row);
  panel.appendChild(head);
  confirm.addEventListener('click', () => {
    if (value == null || area == null) return;
    hooks.onAction({ t: 'yuanjianGain', value, area });
  });
  const actions = el('div', 'selector-actions');
  actions.appendChild(confirm);
  panel.appendChild(actions);
  return panel;
}
function youdiPanel(ctx: Ctx): HTMLElement {
  const { state, hooks } = ctx;
  const pd = state.pending;
  const who: PlayerId = pd && pd.kind === 'youdiMove' ? pd.player : 'A';
  const p = state.players[who];
  const AREAS: { k: DiceKind; label: string }[] = [
    { k: 'attack', label: '攻' },
    { k: 'defense', label: '防' },
    { k: 'meditation', label: '冥' },
  ];
  const KIND_SHORT: Record<DiceKind, string> = { attack: '攻', defense: '防', meditation: '冥' };
  let from: DiceKind | null = null;
  let to: DiceKind | null = null;
  const selected = new Set<string>();

  const panel = el('div', 'selector youdi-panel');
  const head = el('div', 'selector-head');
  const title = el('div', 'selector-title');
  title.textContent = '「诱敌」：将某区域最多 3 颗骰移到另一区域（保留点数）';
  head.appendChild(title);

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'btn btn-confirm';
  confirm.textContent = '确认';
  confirm.disabled = true;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-cancel';
  cancel.textContent = '不发动';
  cancel.addEventListener('click', () => hooks.onAction({ t: 'youdiMove', cancel: true }));

  const fromRow = el('div', 'option-row');
  const fromLab = el('span', 'selector-info');
  fromLab.textContent = '从';
  fromRow.appendChild(fromLab);
  const fromBtns: HTMLButtonElement[] = [];
  for (const { k, label } of AREAS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn option-btn';
    b.dataset.k = k;
    b.textContent = label;
    b.addEventListener('click', () => {
      from = k;
      selected.clear();
      if (to === from) to = null;
      for (const bb of fromBtns) bb.classList.toggle('option-btn--on', bb.dataset.k === k);
      rebuildDice();
      rebuildTo();
      refresh();
    });
    fromBtns.push(b);
    fromRow.appendChild(b);
  }
  head.appendChild(fromRow);

  const diceRow = el('div', 'pay-dice youdi-dice');
  head.appendChild(diceRow);

  const toRow = el('div', 'option-row');
  const toLab = el('span', 'selector-info');
  toLab.textContent = '到';
  toRow.appendChild(toLab);
  const toBtns: HTMLButtonElement[] = [];
  for (const { k, label } of AREAS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn option-btn';
    b.dataset.k = k;
    b.textContent = label;
    b.addEventListener('click', () => {
      to = k;
      for (const bb of toBtns) bb.classList.toggle('option-btn--on', bb.dataset.k === k);
      refresh();
    });
    toBtns.push(b);
    toRow.appendChild(b);
  }
  head.appendChild(toRow);

  const rebuildDice = (): void => {
    diceRow.innerHTML = '';
    if (!from) return;
    for (const d of p.areas[from]) {
      const chip = el('span', `pay-die die-${who} clickable`);
      chip.dataset.id = d.id;
      chip.textContent = `${KIND_SHORT[d.kind]}${d.value}`;
      if (selected.has(d.id)) chip.classList.add('youdi-die--on');
      chip.addEventListener('click', () => {
        if (selected.has(d.id)) selected.delete(d.id);
        else if (selected.size < 3) selected.add(d.id);
        chip.classList.toggle('youdi-die--on', selected.has(d.id));
        refresh();
      });
      diceRow.appendChild(chip);
    }
  };
  const rebuildTo = (): void => {
    for (const b of toBtns) {
      const off = from != null && b.dataset.k === from;
      b.disabled = off;
      if (off) b.classList.remove('option-btn--on');
    }
    if (to && to === from) to = null;
  };
  const refresh = (): void => {
    confirm.disabled = !(from && to && from !== to && selected.size >= 1 && selected.size <= 3);
  };

  confirm.addEventListener('click', () => {
    if (!(from && to && from !== to && selected.size >= 1)) return;
    hooks.onAction({ t: 'youdiMove', from, to, dieIds: [...selected] });
  });

  panel.appendChild(head);
  const actions = el('div', 'selector-actions');
  // 统一顺序：确认 → 取消（全站一致）
  actions.appendChild(confirm);
  actions.appendChild(cancel);
  panel.appendChild(actions);
  rebuildDice();
  return panel;
}

/** T18「适应」：把本次掷出/获得的其中 1 颗骰改为任意点数（快速操作栏内嵌选择面板） */
function shipeiPanel(ctx: Ctx): HTMLElement {
  const { state, hooks } = ctx;
  const pd = state.pending;
  const who: PlayerId = pd && pd.kind === 'shipeiPick' ? pd.player : 'A';
  const p = state.players[who];
  const dieIds = pd && pd.kind === 'shipeiPick' ? pd.dieIds : [];
  const KIND_SHORT: Record<DiceKind, string> = { attack: '攻', defense: '防', meditation: '冥' };
  const panel = el('div', 'selector shipei-panel');
  const head = el('div', 'selector-head');
  const title = el('div', 'selector-title');
  title.textContent = '「适应」：指定其中 1 颗骰的点数';
  head.appendChild(title);

  let selDie: string | null = null;
  let selVal: number | null = null;
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'btn btn-confirm';
  confirm.textContent = '确认';
  confirm.disabled = true;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-cancel';
  cancel.textContent = '不发动';
  cancel.addEventListener('click', () => hooks.onAction({ t: 'shipeiPick', cancel: true }));
  const refresh = (): void => {
    confirm.disabled = !(selDie && selVal != null);
  };

  const diceRow = el('div', 'pay-dice shipei-dice');
  const chips = new Map<string, HTMLElement>();
  for (const id of dieIds) {
    const d = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation].find((x) => x.id === id);
    if (!d) continue;
    const chip = el('span', `pay-die die-${who} clickable`);
    chip.textContent = `${KIND_SHORT[d.kind]}${d.value}`;
    chip.addEventListener('click', () => {
      selDie = id;
      for (const [k, c] of chips) c.classList.toggle('youdi-die--on', k === id);
      refresh();
    });
    chips.set(id, chip);
    diceRow.appendChild(chip);
  }
  head.appendChild(diceRow);

  const valRow = el('div', 'number-row');
  const vbtns: HTMLButtonElement[] = [];
  for (let n = 1; n <= 6; n++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn number-btn';
    b.dataset.n = String(n);
    b.textContent = String(n);
    b.addEventListener('click', () => {
      selVal = n;
      for (const bb of vbtns) bb.classList.toggle('number-btn--on', bb.dataset.n === String(n));
      refresh();
    });
    vbtns.push(b);
    valRow.appendChild(b);
  }
  head.appendChild(valRow);
  panel.appendChild(head);

  confirm.addEventListener('click', () => {
    if (!selDie || selVal == null) return;
    hooks.onAction({ t: 'shipeiPick', dieId: selDie, value: selVal });
  });
  const actions = el('div', 'selector-actions');
  // 统一顺序：确认 → 取消（全站一致）
  actions.appendChild(confirm);
  actions.appendChild(cancel);
  panel.appendChild(actions);
  return panel;
}

/** 联机·战斗界面「退出对局」二次确认（避免误触退掉整局） */
function onlineLeaveOverlay(ctx: Ctx): HTMLElement {
  const { hooks } = ctx;
  const overlay = el('div', 'online-modal-overlay');
  const modal = el('div', 'online-modal');
  const title = el('div', 'online-modal-title');
  title.textContent = '退出对局';
  const text = el('div', 'online-modal-text');
  text.textContent = '退出后本局作废，对方会看到你已离开。确定退出吗？';
  const foot = el('div', 'online-modal-foot');
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'online-modal-btn';
  ok.textContent = '退出对局';
  ok.addEventListener('click', () => {
    hooks.ui.onlineLeaveOpen = false;
    hooks.online?.onLeaveLobby();
  });
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'online-modal-btn online-modal-btn--ghost';
  cancel.textContent = '取消';
  cancel.addEventListener('click', () => {
    hooks.ui.onlineLeaveOpen = false;
    hooks.requestRender();
  });
  foot.append(ok, cancel);
  modal.append(title, text, foot);
  overlay.appendChild(modal);
  return overlay;
}

function gameOverModal(ctx: Ctx): HTMLElement {
  const { state, hooks } = ctx;
  const overlay = el('div', 'gameover-overlay');
  const modal = el('div', 'gameover-modal');

  const title = el('div', 'gameover-title');
  title.textContent = '游戏结束';
  modal.appendChild(title);

  const winner = el('div', 'gameover-winner');
  if (state.winner) {
    // 胜者名**按玩家色**（A 蓝 / B 红）；显示名走统一口径（标准＝玩家A/B；挑战＝昔日传奇；联机＝昵称）
    const span = el('span', `player-${state.winner}`);
    span.textContent = `${playerName(ctx, state.winner)} 获胜！`;
    winner.appendChild(span);
  } else {
    winner.textContent = '平局';
  }
  modal.appendChild(winner);

  const reason = el('div', 'gameover-reason');
  reason.textContent = state.dustfall >= 10 ? '尘落达到 10（生命更高者胜）' : '对方生命归零';
  modal.appendChild(reason);

  const foot = el('div', 'gameover-foot');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn setup-start gameover-restart';
  btn.textContent = '重新开始游戏';
  btn.addEventListener('click', () => hooks.onRestart());
  foot.appendChild(btn);
  // 「相同配置快速重开」：**仅左右互搏**（联机有两个真人 → 不提供，避免各点各的）
  if (hooks.onRestartSame && !hooks.online) {
    const same = document.createElement('button');
    same.type = 'button';
    same.className = 'btn gameover-restart-same';
    same.textContent = '相同配置快速重开';
    same.title = '用同样的配置（双方神器/战术牌/结算模式）重开一局，骰子重新随机';
    same.addEventListener('click', () => hooks.onRestartSame!());
    foot.appendChild(same);
  }
  if (hooks.online) {
    const lobby = document.createElement('button');
    lobby.type = 'button';
    lobby.className = 'btn gameover-lobby';
    lobby.textContent = '回大厅';
    lobby.addEventListener('click', () => hooks.online!.onLeaveLobby());
    foot.appendChild(lobby);
  }
  modal.appendChild(foot);

  overlay.appendChild(modal);
  return overlay;
}

/** 在任意玩家处查找神器 */
/** 把传奇英雄面板适配成 `Artifact` 形状（仅供只读详情浮窗复用，不写入对局状态） */
function legendAsArtifact(lg: LegendPanel): Artifact {
  return {
    id: lg.id,
    name: lg.name,
    column: 1,
    activeMarkerSide: 'left',
    armedSide: null,
    armedTurn: -1,
    count: lg.count,
    countCap: lg.countCap,
    continuousLost: lg.continuousLost,
    continuousLostThisTurn: lg.continuousLostThisTurn,
    chargeLayer: 0,
    skills: lg.skills,
  };
}

function findArtifactAnywhere(
  state: GameState,
  id: string,
  player?: PlayerId,
): { art: Artifact; owner: PlayerId } | null {
  const tryPlayer = (pid: PlayerId): { art: Artifact; owner: PlayerId } | null => {
    const art = state.players[pid].artifacts.find((a) => a.id === id);
    if (art) return { art, owner: pid };
    const lg = state.players[pid].legend;
    if (lg && lg.id === id) return { art: legendAsArtifact(lg), owner: pid };
    return null;
  };
  // 指定玩家优先（双方同名/同 id 神器：点对方卡图要显示**对方**的状态）
  if (player) return tryPlayer(player);
  return tryPlayer('A') ?? tryPlayer('B');
}

/** 卡图上的“查看技能详情”触发：点击 或 长按（手机友好） */
function attachDetailTrigger(node: HTMLElement, ctx: Ctx, artifactId: string, owner?: PlayerId): void {
  node.classList.add('detail-trigger');
  node.title = '右键 / 长按查看技能详情';
  const open = (): void => {
    const r = node.getBoundingClientRect();
    ctx.hooks.ui.detail = {
      artifactId,
      ...(owner ? { player: owner } : {}),
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    };
    ctx.hooks.requestRender();
  };
  let timer: number | null = null;
  const cancel = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    open();
  });
  node.addEventListener('pointerdown', () => {
    cancel();
    timer = window.setTimeout(() => {
      timer = null;
      open();
    }, 500);
  });
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointerleave', cancel);
  node.addEventListener('pointercancel', cancel);
  // 触屏：单击即看技能（战斗界面卡图不可选，不会与选定冲突）
  node.addEventListener('click', () => open());
}

function applyPrefs(ctx: Ctx, next: Prefs): void {
  ctx.hooks.ui.prefs = next;
  ctx.hooks.onPrefsChange?.(clonePrefs(next));
  ctx.hooks.requestRender();
}

function setPref<K extends keyof Prefs>(ctx: Ctx, key: K, value: Prefs[K]): void {
  // 手动改动任一项 → 预设转为「自定义」
  applyPrefs(ctx, { ...ctx.hooks.ui.prefs, [key]: value, preset: 'custom' });
}

function usePreset(ctx: Ctx, id: 'desktop' | 'touch'): void {
  const next = applyPreset(id);
  // 「动画速度」不随预设组合重置
  next.animSpeed = ctx.hooks.ui.prefs.animSpeed;
  applyPrefs(ctx, next);
}

/** 动画速度独立于「预设组合」：改它不把预设置为「自定义」。 */
function setAnimSpeed(ctx: Ctx, value: 'normal' | 'fast'): void {
  applyPrefs(ctx, { ...ctx.hooks.ui.prefs, animSpeed: value });
}

function resetPrefs(ctx: Ctx): void {
  applyPrefs(ctx, clonePrefs(DEFAULT_PREFS));
}

/** 设置面板（左上角「设置」按钮打开） */
/** 挑战模式「规则调整（技能削弱）」浮窗：数据唯一来源 `CHALLENGE_RULE_NOTES`。**居中**显示。
 *  版式＝**一个共享网格**（列1 神器+技能名 / 列2 调整说明）→ 各条说明的**第一个字必然左对齐**。 */
function challengeRulesPanel(ctx: Ctx): HTMLElement {
  const ui = ctx.hooks.ui;
  const overlay = el('div', 'settings-overlay challenge-rules-overlay');
  overlay.dataset.act = 'challengeRulesOverlay';
  const box = el('div', 'challenge-rules-panel');

  const head = el('div', 'settings-head');
  const title = el('div', 'challenge-rules-title');
  title.textContent = '挑战模式规则调整';
  head.appendChild(title);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-cancel settings-close';
  close.dataset.act = 'challengeRulesClose';
  close.textContent = '✕';
  close.addEventListener('click', () => {
    ui.challengeRulesOpen = false;
    ctx.hooks.requestRender();
  });
  head.appendChild(close);
  box.appendChild(head);

  const lead = el('div', 'challenge-rules-lead');
  lead.textContent = '本模式下以下技能按 FAQ 特殊处理（点设置旁的按钮随时可看）。';
  box.appendChild(lead);

  // 共享网格：每条 = 两个格子（列1 / 列2），分隔线由两格各自的 border-top 接成一条
  const body = el('div', 'challenge-rules-body');
  for (const note of CHALLENGE_RULE_NOTES) {
    const k = el('div', 'challenge-rules-key');
    k.textContent = note.title;
    const v = el('div', 'challenge-rules-text');
    v.textContent = note.text;
    body.appendChild(k);
    body.appendChild(v);
  }
  box.appendChild(body);
  overlay.appendChild(box);
  return overlay;
}

function settingsPanel(ctx: Ctx): HTMLElement {
  const ui = ctx.hooks.ui;
  const overlay = el('div', 'settings-overlay');
  const box = el('div', 'settings-panel');

  const head = el('div', 'settings-head');
  const title = el('div', 'settings-title');
  title.textContent = '设置';
  head.appendChild(title);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-cancel settings-close';
  close.dataset.act = 'settingsClose';
  close.textContent = '✕';
  close.addEventListener('click', () => {
    ui.settingsOpen = false;
    ctx.hooks.requestRender();
  });
  head.appendChild(close);
  box.appendChild(head);

  const row = (
    label: string,
    opts: { text: string; on: boolean; onClick: () => void; disabled?: boolean }[],
  ): void => {
    const r = el('div', 'settings-row');
    const lab = el('span', 'settings-label');
    lab.textContent = label;
    r.appendChild(lab);
    const wrap = el('div', 'settings-opts');
    for (const o of opts) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn settings-opt${o.on ? ' settings-opt--on' : ''}`;
      b.textContent = o.text;
      b.disabled = !!o.disabled;
      b.addEventListener('click', o.onClick);
      wrap.appendChild(b);
    }
    r.appendChild(wrap);
    box.appendChild(r);
  };

  // 传奇模式：战报常驻中段战报格（无"收起"概念）→ 战报栏设置无效
  const legendMode = !!(ctx.state.players.A.legend || ctx.state.players.B.legend);

  row('显示技能描述', [
    { text: '隐藏', on: !ui.prefs.showSkillText, onClick: () => setPref(ctx, 'showSkillText', false) },
    { text: '显示', on: ui.prefs.showSkillText, onClick: () => setPref(ctx, 'showSkillText', true) },
  ]);
  row('卡图', [
    { text: '缩略', on: ui.prefs.cardArt === 'thumb', onClick: () => setPref(ctx, 'cardArt', 'thumb') },
    { text: '完整', on: ui.prefs.cardArt === 'full', onClick: () => setPref(ctx, 'cardArt', 'full') },
  ]);
  row('界面密度', [
    { text: '紧凑', on: ui.prefs.density === 'compact', onClick: () => setPref(ctx, 'density', 'compact') },
    { text: '舒适', on: ui.prefs.density === 'comfortable', onClick: () => setPref(ctx, 'density', 'comfortable') },
  ]);
  row('动画速度', [
    { text: '正常', on: (ui.prefs.animSpeed ?? 'normal') === 'normal', onClick: () => setAnimSpeed(ctx, 'normal') },
    { text: '快', on: ui.prefs.animSpeed === 'fast', onClick: () => setAnimSpeed(ctx, 'fast') },
  ]);
  row('镜像神器摆放', [
    { text: '正常', on: !ui.prefs.mirrorEnemy, onClick: () => setPref(ctx, 'mirrorEnemy', false) },
    { text: '镜像', on: ui.prefs.mirrorEnemy, onClick: () => setPref(ctx, 'mirrorEnemy', true) },
  ]);
  // 预设组合：一键套用一组建议值
  const presetOpts: { text: string; on: boolean; onClick: () => void }[] = [
    { text: '电脑模式', on: ui.prefs.preset === 'desktop', onClick: () => usePreset(ctx, 'desktop') },
    { text: '触屏模式', on: ui.prefs.preset === 'touch', onClick: () => usePreset(ctx, 'touch') },
  ];
  if (ui.prefs.preset === 'custom') {
    presetOpts.push({ text: '自定义', on: true, onClick: () => {} });
  }
  row('预设组合', presetOpts);
  row('战报栏', [
    { text: '显示', on: !ui.prefs.logCollapsed, disabled: legendMode, onClick: () => setPref(ctx, 'logCollapsed', false) },
    { text: '收起', on: ui.prefs.logCollapsed, disabled: legendMode, onClick: () => setPref(ctx, 'logCollapsed', true) },
  ]);
  row('整屏缩放', [
    { text: '关', on: ui.prefs.zoomMode === 'off', onClick: () => setPref(ctx, 'zoomMode', 'off') },
    { text: '自动', on: ui.prefs.zoomMode === 'auto', onClick: () => setPref(ctx, 'zoomMode', 'auto') },
    { text: '手动', on: ui.prefs.zoomMode === 'manual', onClick: () => setPref(ctx, 'zoomMode', 'manual') },
  ]);
  if (ui.prefs.zoomMode === 'manual') {
    const r = el('div', 'settings-row');
    const lab = el('span', 'settings-label');
    lab.textContent = `缩放比例 ${ui.prefs.zoomPercent}%`;
    r.appendChild(lab);
    const wrap = el('div', 'settings-opts');
    const mk = (text: string, delta: number): void => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn settings-opt';
      b.textContent = text;
      b.addEventListener('click', () =>
        setPref(ctx, 'zoomPercent', Math.min(100, Math.max(10, ui.prefs.zoomPercent + delta))),
      );
      wrap.appendChild(b);
    };
    mk('缩小', -5);
    mk('放大', +5);
    r.appendChild(wrap);
    box.appendChild(r);
  }

  // 【排查·?diag=1】诊断日志入口（只在开启诊断时出现，正常游玩不显示）
  if (isDiagEnabled()) {
    row('诊断日志', [{ text: `查看（${diagCount()} 条）`, on: false, onClick: () => openDiagOverlay() }]);
  }

  const actions = el('div', 'settings-actions');
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn btn-cancel';
  reset.dataset.act = 'settingsReset';
  reset.textContent = '恢复默认';
  reset.addEventListener('click', () => resetPrefs(ctx));
  actions.appendChild(reset);
  box.appendChild(actions);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      ui.settingsOpen = false;
      ctx.hooks.requestRender();
    }
  });
  overlay.appendChild(box);
  return overlay;
}

/** 【排查·?diag=1】诊断日志浮层（复用设置浮层样式；一键复制，http 下浏览器禁用剪贴板 → 自动全选，Ctrl+C）。 */
function openDiagOverlay(): void {
  const overlay = el('div', 'settings-overlay');
  const box = el('div', 'settings-panel');

  const head = el('div', 'settings-head');
  const title = el('div', 'settings-title');
  title.textContent = '诊断日志（排查用）';
  head.appendChild(title);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-cancel settings-close';
  close.textContent = '✕';
  const bye = (): void => overlay.remove();
  close.addEventListener('click', bye);
  head.appendChild(close);
  box.appendChild(head);

  const note = el('div', 'settings-label');
  note.textContent = '把整段贴给开发者即可。为空＝还没记录（地址要带 ?diag=1；只记录挑战模式）。';
  note.style.margin = '4px 0 8px';
  box.appendChild(note);

  const ta = document.createElement('textarea');
  ta.readOnly = true;
  ta.value = diagDump();
  Object.assign(ta.style, {
    width: '100%',
    height: '220px',
    fontFamily: 'Consolas, monospace',
    fontSize: '12px',
    lineHeight: '1.4',
    whiteSpace: 'pre',
    background: '#fff',
    color: '#111',
    border: '1px solid #bbb',
    borderRadius: '4px',
    padding: '6px',
    boxSizing: 'border-box',
  });
  box.appendChild(ta);

  const actions = el('div', 'settings-actions');
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn';
  copy.textContent = '复制全部';
  copy.addEventListener('click', () => {
    const text = diagDump();
    const fallback = (): void => {
      ta.focus();
      ta.select();
      copy.textContent = '已全选 → 按 Ctrl+C';
    };
    const clip = navigator.clipboard;
    if (clip && typeof clip.writeText === 'function') {
      clip.writeText(text).then(
        () => {
          copy.textContent = '已复制 ✓';
        },
        fallback,
      );
    } else {
      fallback();
    }
  });
  actions.appendChild(copy);
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'btn btn-cancel';
  clear.textContent = '清空';
  clear.addEventListener('click', () => {
    diagClear();
    ta.value = '';
  });
  actions.appendChild(clear);
  box.appendChild(actions);

  overlay.appendChild(box);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) bye();
  });
  document.body.appendChild(overlay);
  ta.focus();
  ta.select();
}

/** 战报抽屉：从左侧滑出，点空白处关闭（窄屏或战报收起时使用） */
function logDrawer(ctx: Ctx): HTMLElement {
  const overlay = el('div', 'log-overlay');
  const panel = el('div', 'log-drawer');
  panel.appendChild(logPanel(ctx, true));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      ctx.hooks.ui.logOpen = false;
      ctx.hooks.requestRender();
    }
  });
  overlay.appendChild(panel);
  return overlay;
}

function detailSkillList(ctx: Ctx, art: Artifact, owner: PlayerId): HTMLElement {
  const box = el('div', 'skills');
  const isLegend = /^L\d{2}$/.test(art.id);
  const text = isLegend ? LEGEND_TEXT[art.id] : ARTIFACT_TEXT[art.id];
  if (!text) return box;
  const groups = new Map<string, typeof text.skills>();
  for (const s of text.skills) {
    const exists = groups.get(s.name);
    if (exists) exists.push(s);
    else groups.set(s.name, [s]);
  }
  for (const [groupName, parts] of groups) {
    const wrap = el('div', 'skill');
    const head = el('div', 'skill-head');
    const name = el('span', 'skill-name');
    name.textContent = groupName;
    head.appendChild(name);
    wrap.appendChild(head);
    for (const s of parts) {
      const lgOwner = isLegend
        ? (['A', 'B'] as PlayerId[]).find((id) => ctx.state.players[id].legend?.id === art.id)
        : undefined;
      const st =
        isLegend && lgOwner
          ? legendSkillState(ctx, ctx.state.players[lgOwner], ctx.state.players[lgOwner].legend!, s)
          : skillPartState(ctx, art, s);
      const cls =
        st === 'on'
          ? 'skill-part--on'
          : st === 'disabled'
            ? 'skill-part--disabled'
            : st === 'spent'
              ? 'skill-part--spent'
              : 'skill-part--off';
      const part = el('div', `skill-part ${cls}`);
      // 必杀用尽 → 与卡片同款"灰 + 删除线"（神器／传奇都补上；此前浮窗缺这条）
      const skey = isLegend ? (s as { key?: string }).key : findSkillKey(art, s.side, s.type);
      if (usedUltimateKey(ctx, owner, skey, s.type)) part.classList.add('skill-part--used');
      const pHead = el('div', 'skill-part-head');
      const badge = el('span', 'skill-type');
      badge.textContent = s.type;
      pHead.appendChild(badge);
      const body = el('div', 'skill-text');
      body.textContent = s.text;
      pHead.appendChild(body);
      part.appendChild(pHead);
      wrap.appendChild(part);
    }
    box.appendChild(wrap);
  }
  // 特典神器：技能描述**之后**追加一行提示（浮窗本来就带描述 → 恒显示）
  if (art.special) {
    const note = el('div', 'card-special-note');
    note.textContent = SPECIAL_ARTIFACT_NOTE;
    box.appendChild(note);
  }
  return box;
}

/** 只读技能详情浮窗：锚定触发卡片，内部可滚动 */
/** 详情浮窗定位（点击处附近；窄屏改底部抽屉，交由 CSS）——神器与战术牌共用 */
function layoutDetailBox(box: HTMLElement, rect: { left: number; top: number; width: number; height: number }): void {
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;
  if (vw > 0 && vw < 720) {
    box.classList.add('detail-popover--sheet');
    return;
  }
  const W = Math.min(vw >= 1024 ? 420 : 340, Math.max(220, vw - 24));
  let left = rect.left + rect.width + 8;
  if (left + W > vw - 8) left = rect.left - W - 8;
  left = Math.max(8, Math.min(left, vw - W - 8));
  // 下方放不下 → 向上展开；最后仍夹在视口内（手机底部触发时不被裁掉）
  const bh = box.scrollHeight || 240;
  let top = rect.top + rect.height + 8;
  if (top + bh > vh - 8) top = rect.top - bh - 8;
  top = Math.max(8, Math.min(top, vh - bh - 8));
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  box.style.width = `${W}px`;
  box.style.maxHeight = `${Math.max(160, vh - top - 16)}px`;
}

/**
 * 详情遮罩上的右键「转发」：临时让遮罩不接收指针 → `elementFromPoint` 取指针下方的触发区
 * （战术名 / 传奇卡 / 神器卡）→ 直接切换详情。做法同选择界面（`setupScreen` 的 elementFromPoint 手法），
 * 目的是**连续右键**在多个详情间切换，无需先左键关闭。左键点遮罩仍关闭（保留原行为）。
 */
function attachDetailOverlayForward(overlay: HTMLElement, ctx: Ctx): void {
  overlay.addEventListener('contextmenu', (e) => {
    const efp = typeof document.elementFromPoint === 'function' ? document.elementFromPoint : null;
    if (!efp) return;
    const prev = overlay.style.pointerEvents;
    overlay.style.pointerEvents = 'none';
    let hit: Element | null = null;
    try {
      hit = efp.call(document, e.clientX, e.clientY);
    } catch {
      hit = null; // jsdom 等未实现 elementFromPoint 时静默跳过（仅真机生效）
    } finally {
      overlay.style.pointerEvents = prev;
    }
    if (!hit) return;
    const tacticBtn = (hit.closest?.('.tactic-bar-name[data-tactic]') as HTMLElement | null) ?? null;
    const legendCard = (hit.closest?.('.card-legend[data-legend]') as HTMLElement | null) ?? null;
    const artCard = (hit.closest?.('.card[data-artifact]') as HTMLElement | null) ?? null;
    const id = tacticBtn?.dataset.tactic ?? legendCard?.dataset.legend ?? artCard?.dataset.artifact;
    if (!id) return;
    e.preventDefault();
    const trigger = tacticBtn ?? legendCard ?? artCard!;
    const r = trigger.getBoundingClientRect();
    const ownerEl = trigger.closest?.('.player[data-player]') as HTMLElement | null;
    const owner = (ownerEl?.dataset.player as PlayerId | undefined) ?? undefined;
    ctx.hooks.ui.detail = {
      artifactId: id,
      ...(owner ? { player: owner } : {}),
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    };
    ctx.hooks.requestRender();
  });
}

/** 战术牌详情浮窗：裁切卡图 + 名字 + 效果全文（与神器浮窗不同——此处含卡图） */
function tacticDetailPopover(
  ctx: Ctx,
  d: { artifactId: string; rect: { left: number; top: number; width: number; height: number } },
): HTMLElement {
  const ui = ctx.hooks.ui;
  const id = d.artifactId;
  const def = TACTIC_BY_ID[id];
  const overlay = el('div', 'detail-overlay');
  const box = el('div', 'detail-popover detail-popover--tactic');
  box.dataset.tactic = id;
  layoutDetailBox(box, d.rect);
  const head = el('div', 'detail-head');
  const title = el('div', 'detail-title');
  title.textContent = def?.name ?? id;
  head.appendChild(title);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-cancel detail-close';
  close.dataset.act = 'detailClose';
  close.textContent = '✕';
  close.addEventListener('click', () => {
    ui.detail = null;
    ctx.hooks.requestRender();
  });
  head.appendChild(close);
  box.appendChild(head);
  const img = document.createElement('img');
  img.className = 'detail-tactic-img';
  img.src = tacticImageUrl(id);
  img.alt = def?.name ?? id;
  img.draggable = false;
  box.appendChild(img);
  const eff = el('div', 'detail-tactic-eff');
  eff.textContent = def ? tacticDisplayText(def) : '（效果文本待转写）';
  box.appendChild(eff);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      ui.detail = null;
      ctx.hooks.requestRender();
    }
  });
  overlay.appendChild(box);
  attachDetailOverlayForward(overlay, ctx);
  return overlay;
}

function detailPopover(ctx: Ctx): HTMLElement | null {
  const d = ctx.hooks.ui.detail;
  if (!d) return null;
  if (isTacticId(d.artifactId)) return tacticDetailPopover(ctx, d);
  const found = findArtifactAnywhere(ctx.state, d.artifactId, d.player);
  if (!found) return null;
  const { art } = found;
  const isLegend = /^L\d{2}$/.test(art.id);
  const ui = ctx.hooks.ui;

  const overlay = el('div', 'detail-overlay');
  const box = el('div', 'detail-popover');
  box.dataset.artifact = art.id;
  layoutDetailBox(box, d.rect);

  const head = el('div', 'detail-head');
  const title = el('div', 'detail-title');
  title.textContent = isLegend
    ? art.name
    : `${art.name}${art.weapon ? `（${art.weapon}）` : ''}${art.special ? '　〔特典〕' : ''}`;
  head.appendChild(title);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-cancel detail-close';
  close.dataset.act = 'detailClose';
  close.textContent = '✕';
  close.addEventListener('click', () => {
    ui.detail = null;
    ctx.hooks.requestRender();
  });
  head.appendChild(close);
  box.appendChild(head);

  if (!isLegend) {
    const sub = el('div', 'detail-sub');
    const meta = metaParts(art, ctx.state.players[found.owner]);
    // 浮窗没有徽标：计数在此补上（与卡头徽标同文案，两个视图各自只出现一次）
    if (art.count > 0) meta.push(countText(art, ctx.state.players[found.owner]));
    appendParts(sub, meta);
    box.appendChild(sub);
  }

  if (!isLegend && art.activeMarkerSide) {
    const act = el('span', 'badge badge-active');
    act.textContent = `已激活·${
      sideDisplayName(art, art.activeMarkerSide) ?? sideDisplayName(art, 'only') ?? art.name
    }`;
    if (activeSideSpent(ctx, art)) act.classList.add('badge-active--spent');
    box.appendChild(act);
  }
  box.appendChild(detailSkillList(ctx, art, found.owner));

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      ui.detail = null;
      ctx.hooks.requestRender();
    }
  });
  overlay.appendChild(box);
  attachDetailOverlayForward(overlay, ctx);
  return overlay;
}

function convertAvailable(state: GameState, payer: PlayerId): boolean {
  if (!hasActiveSkill(state.players[payer], 'shenhong.sword')) return false;
  // Z12「不动菩提」：置换出的有效点数是 5 → 5 点被封锁时置换不可用
  if (isValueLocked(state, payer, 5)) return false;
  const p = state.players[payer];
  return p.areas.attack.length + p.areas.defense.length + p.areas.meditation.length >= 2;
}

/** 置换选骰的付款方：待决策 > 抵挡方（防守）> 当前行动方 —— 统一走 actorOf（禁止手写 activePlayer） */
function convertPickOwner(state: GameState): PlayerId {
  return actorOf(state);
}

function openConvertPick(ctx: Ctx, kind: 'attack' | 'block'): void {
  ctx.hooks.ui.convertPick = { kind, dieIds: [] };
  ctx.hooks.requestRender();
}

/** 选满 2 颗 → 提出待确认的攻击/抵挡动作（走统一确认条） */
function dispatchConvertPick(hooks: RenderHooks, cp: NonNullable<UiState['convertPick']>): void {
  const isAtk = cp.kind === 'attack';
  const action: Action = isAtk
    ? { t: 'attack', costSlots: [{ dieIds: [...cp.dieIds] }] }
    : { t: 'block', costSlots: [{ dieIds: [...cp.dieIds] }] };
  hooks.ui.convertPick = null;
  hooks.propose(
    action,
    isAtk
      ? '置换攻击：消耗 2 颗能力骰 → 1 颗攻击骰（点数按 5）'
      : '置换抵挡：消耗 2 颗能力骰 → 1 颗防御骰（点数按 5）',
  );
}

/** 切换置换选骰（骰区与面板骰片共享同一状态） */
function toggleConvertDie(hooks: RenderHooks, d: Die): void {
  const cp = hooks.ui.convertPick;
  if (!cp) return;
  const i = cp.dieIds.indexOf(d.id);
  if (i >= 0) cp.dieIds.splice(i, 1);
  else if (cp.dieIds.length < 2) cp.dieIds.push(d.id);
  if (cp.dieIds.length === 2) {
    dispatchConvertPick(hooks, cp);
    return;
  }
  hooks.requestRender();
}

/** 切换技能选择器「dice」步骤的选中骰 */
function toggleSelDie(hooks: RenderHooks, step: DiceStep, d: Die): void {
  const sel = hooks.ui.selection;
  if (!sel) return;
  if (sel.currentSel.has(d.id)) sel.currentSel.delete(d.id);
  else if (sel.currentSel.size < step.max) sel.currentSel.add(d.id);
  hooks.requestRender();
}

/** 切换锋芒选骰 */
function toggleFengmangDie(hooks: RenderHooks, d: Die): void {
  const fp = hooks.ui.fengmangPick;
  if (!fp) return;
  if (d.kind === 'attack') fp.attackDieId = fp.attackDieId === d.id ? undefined : d.id;
  else if (d.kind === 'meditation') fp.meditationDieId = fp.meditationDieId === d.id ? undefined : d.id;
  else return;
  hooks.requestRender();
}

/** 029 全知：判断当前勾选是否恰好构成一组（2 颗同点=防御 / 3 颗连续互不相同=攻击） */
function classifyQuanzhiGroup(dice: Die[]): 'defense' | 'attack' | null {
  if (dice.length === 2 && dice[0].value === dice[1].value) return 'defense';
  if (dice.length === 3) {
    const vs = [...new Set(dice.map((d) => d.value))].sort((a, b) => a - b);
    if (vs.length === 3 && vs[1] === vs[0] + 1 && vs[2] === vs[1] + 1) return 'attack';
  }
  return null;
}

/** 029 全知：切换勾选（骰区与面板骰片共享同一状态） */
function toggleQuanzhiDie(hooks: RenderHooks, d: Die): void {
  const qz = hooks.ui.quanzhi;
  if (!qz || qz.preview) return;
  const used = new Set(qz.groups.flatMap((g) => g.dieIds));
  if (used.has(d.id)) return;
  const i = qz.selected.indexOf(d.id);
  if (i >= 0) qz.selected.splice(i, 1);
  else qz.selected.push(d.id);
  hooks.requestRender();
}

/**
 * 029 真言·全知：专用分配面板。
 * 始终显示全部骰子 → 一组一组手动放（2 同点=防御 / 3 连续=攻击）→ 剩余自动进冥想 → 预览 → 确认/取消。
 */
function quanzhiPanel(ctx: Ctx): HTMLElement {
  const qz = ctx.hooks.ui.quanzhi!;
  const pd = ctx.state.pending;
  const player: PlayerId = pd && pd.kind === 'quanzhiAssign' ? pd.player : ctx.state.activePlayer;
  const p = ctx.state.players[player];
  const dice = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation];
  const kindCn = (k: DiceKind): string => (k === 'defense' ? '防御' : k === 'attack' ? '攻击' : '冥想');

  const panel = el('div', 'selector');
  const head = el('div', 'selector-head');
  const title = el('div', 'selector-title');
  title.textContent = '「全知」：分配能力骰';
  head.appendChild(title);
  const hint = el('div', 'selector-hint');
  head.appendChild(hint);
  panel.appendChild(head);
  if (!pd || pd.kind !== 'quanzhiAssign') return panel;

  const usedSet = new Set(qz.groups.flatMap((g) => g.dieIds));
  const selDice = qz.selected.map((id) => dice.find((d) => d.id === id)).filter((d): d is Die => d !== undefined);
  const buildAssign = (): Record<string, DiceKind> => {
    const assign: Record<string, DiceKind> = {};
    for (const g of qz.groups) for (const id of g.dieIds) assign[id] = g.kind;
    for (const d of dice) if (!assign[d.id]) assign[d.id] = 'meditation';
    return assign;
  };

  // ── 预览步 ─────────────────────────────────────────────
  if (qz.preview) {
    hint.textContent = '确认最终分布，或取消重新分配';
    const assign = buildAssign();
    for (const kind of ['defense', 'attack', 'meditation'] as DiceKind[]) {
      const row = el('div', 'selector-info');
      const lab = el('span', 'chip-label');
      const ids = dice.filter((d) => assign[d.id] === kind);
      lab.textContent = `${kindCn(kind)}骰区（${ids.length}）：`;
      row.appendChild(lab);
      for (const d of ids) {
        const chip = el('span', `pay-die die-${player}`);
        chip.textContent = String(d.value);
        row.appendChild(chip);
      }
      panel.appendChild(row);
    }
    const actions = el('div', 'selector-actions');
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn btn-confirm';
    ok.dataset.act = 'quanzhiConfirm';
    ok.textContent = '确认';
    ok.addEventListener('click', () => {
      const finalAssign = buildAssign();
      ctx.hooks.ui.quanzhi = null;
      ctx.hooks.onAction({ t: 'quanzhiAssign', assign: finalAssign });
    });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-cancel';
    cancel.dataset.act = 'quanzhiCancel';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => {
      ctx.hooks.ui.quanzhi = { groups: [], selected: [], preview: false };
      ctx.hooks.requestRender();
    });
    actions.appendChild(ok);
    actions.appendChild(cancel);
    panel.appendChild(actions);
    return panel;
  }

  // ── 选组步 ─────────────────────────────────────────────
  hint.textContent = '2 同点→防御 ｜ 3 连续→攻击';
  const diceBox = el('div', 'pay-dice');
  for (const d of dice) {
    const used = usedSet.has(d.id);
    const chip = el('span', `pay-die die-${player}`);
    chip.dataset.id = d.id;
    chip.textContent = `${KIND_SHORT[d.kind]}${d.value}`;
    if (used) {
      chip.classList.add('pay-die--used');
    } else {
      chip.classList.add('clickable');
      if (qz.selected.includes(d.id)) chip.classList.add('selected');
      chip.addEventListener('click', () => toggleQuanzhiDie(ctx.hooks, d));
    }
    diceBox.appendChild(chip);
  }
  panel.appendChild(diceBox);

  const cls = classifyQuanzhiGroup(selDice);
  const remainder = dice.filter((d) => !usedSet.has(d.id));
  const remainderHasGroup = quanzhiRemainderHasGroup(remainder);
  if (remainderHasGroup) {
    const warn = el('div', 'selector-hint selector-hint--bad');
    warn.textContent = '剩余仍可组合';
    panel.appendChild(warn);
  }

  const actions = el('div', 'selector-actions');
  const status = el('span', 'selector-info');
  status.textContent = cls === null && selDice.length > 0 ? '需 2 同点或 3 连续' : '';
  actions.appendChild(status);

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn-confirm';
  add.dataset.act = 'quanzhiAdd';
  add.textContent = cls ? `加入【${kindCn(cls)}】` : '加入';
  add.disabled = cls === null;
  add.addEventListener('click', () => {
    if (!classifyQuanzhiGroup(selDice)) return;
    qz.groups.push({ kind: cls!, dieIds: [...qz.selected] });
    qz.selected = [];
    ctx.hooks.requestRender();
  });
  actions.appendChild(add);

  const undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'btn btn-cancel';
  undo.dataset.act = 'quanzhiUndo';
  undo.textContent = '撤销';
  undo.disabled = qz.groups.length === 0;
  undo.addEventListener('click', () => {
    qz.groups.pop();
    ctx.hooks.requestRender();
  });
  actions.appendChild(undo);

  const auto = document.createElement('button');
  auto.type = 'button';
  auto.className = 'btn';
  auto.dataset.act = 'quanzhiAuto';
  auto.textContent = '自动补完';
  auto.disabled = !remainderHasGroup;
  auto.addEventListener('click', () => {
    // 贪心：先成对（同点 2 颗）→ 再顺点三连；反复直到剩余无可分组
    let guard = 0;
    while (guard++ < 200) {
      const assigned = new Set(qz.groups.flatMap((g) => g.dieIds));
      const rest = dice.filter((d) => !assigned.has(d.id));
      const byVal = new Map<number, Die[]>();
      for (const d of rest) {
        const arr = byVal.get(d.value) ?? [];
        arr.push(d);
        byVal.set(d.value, arr);
      }
      let paired = false;
      for (const [, arr] of byVal) {
        if (arr.length >= 2) {
          qz.groups.push({ kind: 'defense', dieIds: [arr[0].id, arr[1].id] });
          paired = true;
          break;
        }
      }
      if (paired) continue;
      let tripled = false;
      for (let v = 1; v <= 4; v++) {
        const a = byVal.get(v)?.[0];
        const b = byVal.get(v + 1)?.[0];
        const c = byVal.get(v + 2)?.[0];
        if (a && b && c) {
          qz.groups.push({ kind: 'attack', dieIds: [a.id, b.id, c.id] });
          tripled = true;
          break;
        }
      }
      if (!tripled) break;
    }
    qz.selected = [];
    ctx.hooks.requestRender();
  });
  actions.appendChild(auto);

  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'btn';
  done.dataset.act = 'quanzhiDone';
  done.textContent = '完成';
  done.disabled = remainderHasGroup;
  done.addEventListener('click', () => {
    qz.selected = [];
    qz.preview = true;
    ctx.hooks.requestRender();
  });
  actions.appendChild(done);

  panel.appendChild(actions);
  return panel;
}

function convertPickPanel(ctx: Ctx): HTMLElement {
  const cp = ctx.hooks.ui.convertPick!;
  const payer = ctx.state.players[convertPickOwner(ctx.state)];
  const isAtk = cp.kind === 'attack';
  const kindName = isAtk ? '攻击' : '防御';
  const wrap = el('div', 'convertpick');
  const title = el('span', 'convertpick-title');
  title.textContent = `使用「真实之剑」置换进行${isAtk ? '攻击' : '抵挡'}`;
  wrap.appendChild(title);
  const hint = el('span', 'convertpick-hint');
  hint.textContent = `请选择 2 颗能力骰（每 2 颗顶 1 颗${kindName}骰，点数按 5；已选 ${cp.dieIds.length}/2）`;
  wrap.appendChild(hint);
  const diceBox = el('div', 'pay-dice');
  for (const k of AREA_ORDER) {
    for (const d of payer.areas[k]) {
      const die = el('span', `pay-die clickable die-${payer.id}`);
      die.dataset.id = d.id;
      die.dataset.kind = d.kind;
      die.dataset.value = String(d.value);
      die.textContent = `${KIND_SHORT[d.kind]}${d.value}`;
      if (cp.dieIds.includes(d.id)) die.classList.add('selected');
      die.addEventListener('click', () => toggleConvertDie(ctx.hooks, d));
      diceBox.appendChild(die);
    }
  }
  wrap.appendChild(diceBox);
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-cancel';
  cancel.dataset.act = 'convertCancel';
  cancel.textContent = '取消';
  cancel.addEventListener('click', () => {
    ctx.hooks.ui.convertPick = null;
    ctx.hooks.requestRender();
  });
  wrap.appendChild(cancel);
  return wrap;
}

/** 锋芒（触发）：操作列表入口按钮 */
function fengmangButton(ctx: Ctx): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-skill';
  b.dataset.act = 'fengmangOpen';
  b.textContent = '发动「锋芒」';
  b.addEventListener('click', () => {
    ctx.hooks.ui.fengmangPick = {};
    ctx.hooks.requestRender();
  });
  return b;
}

/** 锋芒面板：选 1 颗攻击骰 + 1 颗冥想骰（不再枚举组合） */
function fengmangPanel(ctx: Ctx): HTMLElement {
  const fp = ctx.hooks.ui.fengmangPick!;
  const pd = ctx.state.pending;
  const owner: PlayerId = pd && pd.kind === 'fengmang' ? pd.player : ctx.state.activePlayer;
  const player = ctx.state.players[owner];
  const wrap = el('div', 'convertpick');
  const title = el('span', 'convertpick-title');
  title.textContent = '锋芒：选择消耗的 1 颗攻击骰与 1 颗冥想骰';
  wrap.appendChild(title);

  const group = (kind: DiceKind, label: string, chosen: string | undefined): void => {
    const lab = el('span', 'chip-label');
    lab.textContent = label;
    wrap.appendChild(lab);
    for (const d of player.areas[kind]) {
      const die = el('span', `pay-die clickable die-${owner}`);
      die.dataset.id = d.id;
      die.dataset.kind = d.kind;
      die.dataset.value = String(d.value);
      die.textContent = `${KIND_SHORT[d.kind]}${d.value}`;
      if (chosen === d.id) die.classList.add('selected');
      die.addEventListener('click', () => toggleFengmangDie(ctx.hooks, d));
      wrap.appendChild(die);
    }
    // 034 破障（持续）：神器上按分布视为本类型的存放骰（中性骰片）
    for (const h of heldDiceOfKind(ctx.state, owner, kind)) {
      const die = el('span', 'pay-die pay-die--held clickable');
      die.dataset.id = h.id;
      die.dataset.value = String(h.value);
      die.textContent = String(h.value);
      die.title = '「金刚·破障」：用神器上存放的骰';
      if (chosen === h.id) die.classList.add('selected');
      die.addEventListener('click', () => toggleFengmangDie(ctx.hooks, { id: h.id, value: h.value, kind }));
      wrap.appendChild(die);
    }
  };
  group('attack', '攻击', fp.attackDieId);
  group('meditation', '冥想', fp.meditationDieId);

  const ready = fp.attackDieId != null && fp.meditationDieId != null;
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'btn btn-confirm';
  ok.dataset.act = 'fengmangConfirm';
  ok.textContent = '确认';
  ok.disabled = !ready;
  ok.addEventListener('click', () => {
    if (!ready) return;
    const action = ctx.legal.find(
      (x): x is Extract<Action, { t: 'fengmang' }> =>
        x.t === 'fengmang' &&
        x.accept &&
        x.attackDieId === fp.attackDieId &&
        x.meditationDieId === fp.meditationDieId,
    );
    if (!action) return;
    ctx.hooks.ui.fengmangPick = null;
    ctx.hooks.propose(action, actionLabel(ctx, action) ?? '发动「锋芒」');
  });
  wrap.appendChild(ok);

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-cancel';
  cancel.dataset.act = 'fengmangCancel';
  cancel.textContent = '取消';
  cancel.addEventListener('click', () => {
    ctx.hooks.ui.fengmangPick = null;
    ctx.hooks.requestRender();
  });
  wrap.appendChild(cancel);
  return wrap;
}

function slotSummary(
  state: GameState,
  kinds: DiceKind[],
  modes: ('real' | 'convert')[],
  slots: string[][],
  i: number,
): string {
  const ids = slots[i];
  if (ids.length === 0) return '（未填）';
  const kindShort = KIND_SHORT[kinds[i]];
  const dice = ids.map((id) => findDie(state, id)).filter((d): d is Die => d !== undefined);
  if (modes[i] === 'real') {
    const d = dice[0];
    return d ? `${KIND_SHORT[d.kind]}${d.value}（真骰）` : '（真骰）';
  }
  const parts = dice.map((d) => `${KIND_SHORT[d.kind]}${d.value}`);
  const arrow = dice.length >= 2 ? ` → 视为${kindShort}5` : '';
  return `置换：${parts.join('+')}${arrow}`;
}

type SlotsStep = Extract<SelectStep, { kind: 'slots' }>;

function selSlotSize(mode: 'real' | 'convert'): number {
  return mode === 'real' ? 1 : 2;
}

function firstUnfilledSelSlot(sel: ActiveSelection, step: SlotsStep): number {
  for (let i = 0; i < step.kinds.length; i++) {
    if (sel.slots[i].length < selSlotSize(sel.slotModes[i])) return i;
  }
  return -1;
}

function allSelSlotsFilled(sel: ActiveSelection, step: SlotsStep): boolean {
  if (sel.slots.length !== step.kinds.length) return false;
  return sel.slots.every((_, i) => sel.slots[i].length >= selSlotSize(sel.slotModes[i]));
}

function assignSelDie(ctx: Ctx, sel: ActiveSelection, step: SlotsStep, d: Die): void {
  const i = firstUnfilledSelSlot(sel, step);
  if (i < 0) return;
  if (sel.slotModes[i] === 'real' && d.kind !== step.kinds[i]) return;
  if (sel.slots.flat().includes(d.id)) return;
  sel.slots[i].push(d.id);
  ctx.hooks.requestRender();
}

function convertButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-convert';
  b.dataset.act = 'convert';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

type DustFlow = NonNullable<UiState['dustFlow']>;

function totalDice(p: PlayerState): number {
  return p.areas.attack.length + p.areas.defense.length + p.areas.meditation.length;
}

/** 当前是否仍存在某神器的指定尘起支付变体（真骰 / 尘印） */
function hasDustVariant(ctx: Ctx, artifactId: string, variant: 'dice' | 'seal'): boolean {
  return ctx.legal.some(
    (x) =>
      x.t === 'dustRise' &&
      x.artifactId === artifactId &&
      (variant === 'seal' ? x.useSeal === true : !x.useSeal && (x.costSlots?.length ?? 0) > 0),
  );
}

function dispatchDustPay(ctx: Ctx, dieIds: string[]): void {
  const flow = ctx.hooks.ui.dustFlow;
  if (!flow) return;
  const action: DustRiseAction = { t: 'dustRise', artifactId: flow.artifactId, costSlots: [{ dieIds }] };
  if (flow.side) action.side = flow.side;
  ctx.hooks.ui.dustFlow = null;
  ctx.hooks.onAction(action);
}

function dispatchDustSeal(ctx: Ctx): void {
  const flow = ctx.hooks.ui.dustFlow;
  if (!flow) return;
  const action: DustRiseAction = { t: 'dustRise', artifactId: flow.artifactId, useSeal: true };
  if (flow.side) action.side = flow.side;
  ctx.hooks.ui.dustFlow = null;
  ctx.hooks.onAction(action);
}

/** 尘起「付款 / 真实之剑置换选骰」的统一入口（操作栏骰片与骰区骰子共用）。 */
function pickDustDie(ctx: Ctx, dieId: string): void {
  const flow = ctx.hooks.ui.dustFlow;
  if (!flow) return;
  // Z12「不动菩提」：被封锁点数的骰不可用于尘起支付（"付款步"的单颗/置换入口）
  {
    const owner = ctx.state.players[actorOf(ctx.state)];
    const dd = AREA_ORDER.flatMap((k) => owner.areas[k]).find((x) => x.id === dieId);
    if (dd && isValueLocked(ctx.state, owner.id, dd.value)) return;
  }
  if (flow.convertPick) {
    const pick = flow.convertPick;
    const i = pick.indexOf(dieId);
    if (i >= 0) pick.splice(i, 1);
    else if (pick.length < 2) pick.push(dieId);
    if (pick.length === 2) {
      dispatchDustPay(ctx, [...pick]);
      return;
    }
    ctx.hooks.requestRender();
    return;
  }
  dispatchDustPay(ctx, [dieId]);
}

function dustCancelButton(ctx: Ctx): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-cancel';
  b.dataset.act = 'dustCancel';
  b.textContent = '取消';
  b.addEventListener('click', () => {
    ctx.hooks.ui.dustFlow = null;
    ctx.hooks.requestRender();
  });
  return b;
}

function dustSideStep(ctx: Ctx, art: Artifact): HTMLElement {
  const flow = ctx.hooks.ui.dustFlow as DustFlow;
  const wrap = el('div', 'dustflow-side');
  const title = el('span', 'dustflow-title');
  title.textContent = `${DUST_KIND_LABEL[flow.kind]}「${art.name}」`;
  wrap.appendChild(title);
  const sep = el('span', 'dustflow-sep');
  sep.textContent = '·';
  wrap.appendChild(sep);
  const hint = el('span', 'dustflow-hint');
  hint.textContent = '选择启动的一侧：';
  wrap.appendChild(hint);
  let rendered = 0;
  for (const side of ['left', 'right'] as const) {
    // 023「畏惧」：**尘起/激活不限制**（对手没骰也能把这一侧切过来）——限制在"使用"（由 `legal` 过滤掉）
    rendered += 1;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn dustflow-side-btn';
    b.dataset.side = side;
    b.textContent = dustSideSkillName(art.id, side);
    b.addEventListener('click', () => {
      flow.side = side;
      if (flow.free) {
        // 免费尘起（019 / L05 复仇之灵）：选侧后直接派发（无需支付冥想骰）
        const action: DustRiseAction = {
          t: 'dustRise',
          artifactId: flow.artifactId,
          side,
          free: true,
          ...(flow.fuchou ? { fuchou: true } : {}),
        };
        ctx.hooks.ui.dustFlow = null;
        ctx.hooks.onAction(action);
        return;
      }
      flow.step = 'pay';
      ctx.hooks.requestRender();
    });
    wrap.appendChild(b);
  }
  if (rendered === 0) wrap.appendChild(dustCancelButton(ctx)); // 兜底：一侧都不可选时给"取消"，避免死路
  return wrap;
}

function dustPayStep(ctx: Ctx, payer: PlayerState): HTMLElement {
  const flow = ctx.hooks.ui.dustFlow as DustFlow;
  const wrap = el('div', 'dustflow-pay');

  if (flow.convertPick) {
    const hint = el('div', 'dustflow-hint');
    hint.textContent = `使用「真实之剑」置换：选择 2 颗能力骰（已选 ${flow.convertPick.length}/2）`;
    wrap.appendChild(hint);
    const diceBox = el('div', 'pay-dice');
    for (const k of AREA_ORDER) {
      for (const d of payer.areas[k]) {
        const die = el('span', `pay-die die-${payer.id}`);
        die.dataset.id = d.id;
        die.dataset.kind = d.kind;
        die.dataset.value = String(d.value);
        die.textContent = `${KIND_SHORT[d.kind]}${d.value}`;
        die.classList.add('clickable');
        if (flow.convertPick.includes(d.id)) die.classList.add('selected');
        die.addEventListener('click', () => pickDustDie(ctx, d.id));
        diceBox.appendChild(die);
      }
    }
    wrap.appendChild(diceBox);
    return wrap;
  }

  const medSection = el('div', 'dustflow-section');
  if (hasDustVariant(ctx, flow.artifactId, 'dice')) {
    const medLabel = el('div', 'dustflow-label');
    medLabel.textContent = '用 1 颗冥想骰';
    medSection.appendChild(medLabel);
    const medDice = el('div', 'pay-dice');
    for (const d of payer.areas.meditation) {
      const die = el('span', `pay-die die-${payer.id}`);
      die.dataset.id = d.id;
      die.dataset.kind = d.kind;
      die.dataset.value = String(d.value);
      die.textContent = `${KIND_SHORT[d.kind]}${d.value}`;
      if (isValueLocked(ctx.state, payer.id, d.value)) {
        die.classList.add('pay-die--used'); // Z12「不动菩提」：封锁点数的骰不可用于尘起支付
      } else {
        die.classList.add('clickable');
        die.addEventListener('click', () => pickDustDie(ctx, d.id));
      }
      medDice.appendChild(die);
    }
    // 034 破障（持续）：神器上按分布视为冥想骰的存放骰也可用于尘起支付
    const heldMed = heldDiceOfKind(ctx.state, payer.id, 'meditation');
    for (const h of heldMed) {
      const die = el('span', 'pay-die pay-die--held clickable');
      die.dataset.id = h.id;
      die.dataset.value = String(h.value);
      die.textContent = String(h.value);
      die.title = '「金刚·破障」：用神器上存放的骰';
      die.addEventListener('click', () => dispatchDustPay(ctx, [h.id]));
      medDice.appendChild(die);
    }
    if (payer.areas.meditation.length === 0 && heldMed.length === 0) {
      const empty = el('div', 'dustflow-empty');
      empty.textContent = '（无冥想骰）';
      medDice.appendChild(empty);
    }
    medSection.appendChild(medDice);
  }
  wrap.appendChild(medSection);

  const options = el('div', 'dustflow-options');
  if (payer.hasDustSeal && hasDustVariant(ctx, flow.artifactId, 'seal')) {
    const seal = document.createElement('button');
    seal.type = 'button';
    seal.className = 'btn btn-seal';
    seal.dataset.act = 'dustSeal';
    seal.textContent = '使用尘印标记';
    seal.addEventListener('click', () => dispatchDustSeal(ctx));
    options.appendChild(seal);
  }
  if (
    hasDustVariant(ctx, flow.artifactId, 'dice') &&
    hasActiveSkill(payer, 'shenhong.sword') &&
    totalDice(payer) >= 2
  ) {
    const conv = document.createElement('button');
    conv.type = 'button';
    conv.className = 'btn btn-convert';
    conv.dataset.act = 'dustConvert';
    conv.textContent = '使用「真实之剑」置换能力骰';
    conv.addEventListener('click', () => {
      flow.convertPick = [];
      ctx.hooks.requestRender();
    });
    options.appendChild(conv);
  }
  wrap.appendChild(options);
  return wrap;
}

function dustFlowView(ctx: Ctx): HTMLElement {
  const flow = ctx.hooks.ui.dustFlow as DustFlow;
  const payer = ctx.state.players[actorOf(ctx.state)];
  const art = payer.artifacts.find((a) => a.id === flow.artifactId);
  const box = el('div', 'dustflow');
  if (!art) {
    box.appendChild(dustCancelButton(ctx));
    return box;
  }
  if (flow.step === 'side') {
    box.classList.add('dustflow--side');
    box.appendChild(dustSideStep(ctx, art));
    box.appendChild(dustCancelButton(ctx));
    return box;
  }

  box.classList.add('dustflow--pay');
  const title = el('div', 'dustflow-title');
  title.textContent = `${DUST_KIND_LABEL[flow.kind]}「${art.name}」`;
  box.appendChild(title);
  box.appendChild(dustPayStep(ctx, payer));
  box.appendChild(dustCancelButton(ctx));
  return box;
}

/**
 * 本帧要播的**阶段横幅序列**（纯函数，便于测试）。
 *
 * - 引擎会「没得做就自动翻页」，一次动作可能跨过多个阶段 → 这里按 `STANDARD_PHASES` 顺序
 *   把**跨过/经过**的阶段横幅依次列出；`transient=true` ＝被跨越的**过渡段**（短停留）。
 * - 换手（`prev.active !== now.active`）→ 首段 `${玩家名} · 回合开始`，且从新回合的头算起。
 * - `prev = null`（首帧）或当前阶段不在标准阶段内（setup/tactics/initialReroll/gameOver）→ 空。
 */
export function phaseBannerSegs(
  prev: { active: PlayerId; phase: Phase } | null,
  now: { active: PlayerId; phase: Phase },
  nameOf: (p: PlayerId) => string,
  opts?: { legendActor?: boolean },
): { text: string; transient: boolean }[] {
  const segs: { text: string; transient: boolean }[] = [];
  const idxOf = (p: Phase): number => STANDARD_PHASES.indexOf(p as (typeof STANDARD_PHASES)[number]);
  const toIdx = idxOf(now.phase);
  if (!prev || toIdx < 0) return segs;
  const turnChanged = prev.active !== now.active;
  if (turnChanged) segs.push({ text: `${nameOf(now.active)} · 回合开始`, transient: false });
  // 挑战模式：传奇没有「尘起/主要」阶段 → 只保留「回合开始」这一段，不硬套阶段横幅
  if (opts?.legendActor) return segs;
  const fromIdx = turnChanged ? -1 : idxOf(prev.phase);
  for (let i = Math.max(0, fromIdx + 1); i <= toIdx; i++) {
    const ph = STANDARD_PHASES[i];
    if (ph === 'dustRise') segs.push({ text: '尘起阶段', transient: i < toIdx });
    else if (ph === 'main') segs.push({ text: '主要阶段', transient: i < toIdx });
  }
  return segs;
}

export function renderGame(state: GameState, root: HTMLElement, hooks: RenderHooks): void {
  root.classList.remove('setup-page'); // 离开设置页 → 恢复普通背景
  const legal = getLegalActions(state);
  // 任何重绘都先收起「结算模式」浮层（否则徽标换新元素、旧浮层会一直挡着）
  hideSettleTip();

  // ── 动效：动画速度 + 视角解耦 ───────────────────────────────────────
  // 左右互搏：操作者恒在下方（viewOwnerOf＝actorOf），换手会镜像整盘；联机：视角固定（viewOwnerOf 返回本机玩家）。
  // 为避免"换手＝整盘骰子飞过去换位"，把「已显示视角」与「目标视角」解耦：
  //   · 有骰子消耗 或 有生命变化 → 先用旧视角把动效播完，再瞬间切（两阶段）。
  //   · 纯获得骰子 → 先瞬间切，再在新视角里从中间飞入。
  //   · 无动效 → 直接瞬间切。联机（viewTarget 固定）永不触发。
  // 局面对象变了（新开局 / 重连收到快照）→ 先清掉动效残留（fx 克隆、延后获得队列），避免旧动画叠到新局面上
  if (lastStateRef !== state) {
    lastStateRef = state;
    resetMotionRuntime();
  }
  setMotionSpeed(speedOf(hooks.ui.prefs.animSpeed));
  const viewTarget: PlayerId = viewOwnerOf(state);
  const prevDice = snapshotDice(root);
  const prevStored = snapshotStored(root);
  const lifeDeltas = diffLife(state);
  const nextIds = areaDieIds(state);
  const setChanged = diceSetChanged(prevDice, nextIds);
  const prevView: PlayerId = lastView.get(state) ?? viewTarget;
  const removed = anyRemoved(prevDice, nextIds);

  // 生命反馈项：diffLife（掉血/实际回血）+ 引擎回血事件里"满血被削平(实际0)"→ 显示 +0。
  // （实际>0 已由 diffLife 反映；该玩家本帧已有生命变化则不重复。）
  const lifeItems: LifeDelta[] = [...lifeDeltas];
  const fxEvents = fxTake();
  // 挑战模式·传奇回合：本帧的"过场命令"（引擎只报事实，界面据此编排；标准模式永不出现）
  // 注：投掷（`legendRoll`）不需要界面插手——临时区骰子属于 `.die[data-id]`，通用「获得骰」已会播。
  // ⚠️ 用 `filter`（**全部** legendSkill），**不能**用 `find`：同一帧可能有多条——
  //    例：Z07「蛮王之牙」逐组"再次发动"时，[发动帧] 与 [deferred 收尾帧] 若被并进同一帧，
  //    `find` 只取第一条 → 第 2 次发动**不弹技能名**（真实事故 2026-10-11）。
  const legendSkillEvs = fxEvents.filter(
    (e): e is Extract<FxEvent, { kind: 'legendSkill' }> => e.kind === 'legendSkill',
  );
  for (const e of fxEvents) {
    if (e.kind !== 'heal' || e.actual > 0) continue;
    if (lifeItems.some((x) => x.player === e.player)) continue;
    lifeItems.push({ player: e.player, delta: 0, max: state.players[e.player].lifeMax });
  }
  // 「非伤害的下降」（033 抹零）：本帧该玩家**不抖**面板（其余保留：红 -N / 红光框 / 血条收缩 / 白墨线）
  for (const e of fxEvents) {
    if (e.kind !== 'trueLine' || !e.drop) continue;
    for (const it of lifeItems) if (it.player === e.target) it.calm = true;
  }
  // 010 真实之剑置换 / 用到存放骰的支付：把"本次支付"整包收集（源骰不参与普通"飞中间淡出"）
  const pays: PayInfo[] = fxEvents
    .filter((e): e is Extract<FxEvent, { kind: 'pay' }> => e.kind === 'pay')
    .map((e) => {
      const fc = new Set(e.fromCard ?? []); // 本笔支付里"来自卡头存放骰"的 id（灰骰飞行动效保持灰色）
      return {
        player: e.player,
        groups: e.groups,
        dice: e.removedIds
          .map((id) => {
            const pd = prevDice.get(id);
            if (pd) return { id, rect: pd.rect, value: pd.value };
            const ps = prevStored.get(id);
            return ps ? { id, rect: ps.rect, value: ps.value, held: fc.has(id) } : null;
          })
          .filter((d): d is PayDie => d != null),
      };
    })
    .filter((p) => p.dice.length > 0);

  // 取某笔支付里的"置换源"（给攻击池用；非置换 → null）
  const subOf = (pay: PayInfo | null, id?: string): { rects: Rect[]; values: number[] } | null => {
    if (!pay) return null;
    const g = id ? pay.groups.find((grp) => grp.includes(id)) : pay.groups[0];
    if (!g) return null;
    const dice = g.map((gid) => pay.dice.find((d) => d.id === gid)).filter((d): d is PayDie => !!d);
    if (dice.length !== g.length) return null;
    return { rects: dice.map((d) => d.rect), values: dice.map((d) => d.value) };
  };

  // 023 畏惧 · 响应池：发起方骰停中间等；被要求方骰到位并排 → 一起消失
  const weijuInit = fxEvents.find(
    (e): e is Extract<FxEvent, { kind: 'weiju' }> => e.kind === 'weiju' && e.mode === 'initiate',
  );
  const weijuPay = fxEvents.find(
    (e): e is Extract<FxEvent, { kind: 'weiju' }> => e.kind === 'weiju' && e.mode === 'pay',
  );
  // 001/C01 裁雨流：攻击骰先停在中间、不淡出（等玩家决定）
  const holdAttackDie = fxEvents.find(
    (e): e is Extract<FxEvent, { kind: 'holdAttackDie' }> => e.kind === 'holdAttackDie',
  );
  const weijuIds = new Set<string>();
  for (const e of fxEvents) if (e.kind === 'weiju') for (const id of e.dieIds) weijuIds.add(id);
  // 骰子旧位置（区域真骰或卡头存放骰）→ 供响应池起点
  const rectsOf = (ids: string[]): { rects: Rect[]; values: number[] } => {
    const rects: Rect[] = [];
    const values: number[] = [];
    for (const id of ids) {
      const pd = prevDice.get(id);
      const ps = prevStored.get(id);
      if (pd) {
        rects.push(pd.rect);
        values.push(pd.value);
      } else if (ps) {
        rects.push(ps.rect);
        values.push(ps.value);
      }
    }
    return { rects, values };
  };

  // 本次被重掷的骰子（无论点数是否变化，都要播"翻滚"动画）
  const rerollIds = new Set<string>();
  for (const e of fxEvents) if (e.kind === 'reroll') for (const id of e.dieIds) rerollIds.add(id);

  // P-D：尘起"开"气泡（切换/激活/充能） / 技能"用"气泡（发动/触发）
  const rises = fxEvents.filter((e): e is Extract<FxEvent, { kind: 'rise' }> => e.kind === 'rise');
  const fireds = fxEvents.filter((e): e is Extract<FxEvent, { kind: 'skillFired' }> => e.kind === 'skillFired');
  const hasBubble = rises.length > 0 || fireds.length > 0 || fxEvents.some((e) => e.kind === 'tacticFired');
  // P1/P2 护栏：「一颗骰只由一条动画负责」——本帧若有 `pay` 事件（置换 / 用到 034 存放骰），
  // 它 `removedIds` 里的骰子就**不再交给攻击池的"补骰 / park"动画**（否则 011 灵能屏障·触发 /
  // 034 不动菩提 park 抵挡 会出现两套动画同时驱动同一颗骰 → 重影 / 位置打架）。
  const paidIds = new Set<string>();
  for (const e of fxEvents) if (e.kind === 'pay') for (const id of e.removedIds) paidIds.add(id);
  const joinCoveredByPay = (dieIds: string[]): boolean => dieIds.some((id) => paidIds.has(id));
  // 攻击池"另一方补一颗骰"（011 / 034）：attackJoin 事件 + 034 让防御骰"停住"的 block.park
  const attackJoins = fxEvents.filter((e): e is Extract<FxEvent, { kind: 'attackJoin' }> => e.kind === 'attackJoin');
  const parkedBlock = fxEvents.find(
    (e): e is Extract<FxEvent, { kind: 'block' }> => e.kind === 'block' && !!e.park,
  );
  const hasAttackJoin = attackJoins.length > 0 || !!parkedBlock;

  // 抵挡骰 / 区域移动(029 等) / 027 寒光必杀
  const blockIds: string[] = [];
  const moveIds = new Set<string>();
  const fromCard = new Set<string>();
  const hanguangs: DiceMoveFx['hanguangs'] = [];
  for (const e of fxEvents) {
    if (e.kind === 'block') blockIds.push(...e.dieIds);
    else if (e.kind === 'move') {
      for (const id of e.dieIds) {
        moveIds.add(id);
        // 挑战模式：被**搬回区域**的传奇骰子（如 Z01「裁雨流」把飞出去的源骰移入防御区）
        // 必须解除隐藏——否则骰子留在区域里却永远不可见（真实事故 2026-10-18）。
        legendGoneIds.delete(id);
      }
      for (const id of e.fromCard ?? []) fromCard.add(id);
    } else if (e.kind === 'hanguang') {
      hanguangs.push({ player: e.player, mode: e.mode, heldId: e.heldId, ...(e.opponentId ? { opponentId: e.opponentId } : {}) });
    }
  }
  const diceFx: DiceMoveFx = { moveIds: [...moveIds], fromCard: [...fromCard], hanguangs };
  const hasMoveFx = diceFx.moveIds.length > 0 || diceFx.hanguangs.length > 0;

  // 攻击生命周期（提前判定）：**新发起攻击 / 攻击被解决** 也算"切换前必须等"的动画
  //（否则"不消耗骰子的虚拟攻击"会被判成"无动画"→ 没飞到中间就切了玩家）。
  const pa = state.pendingAttack;
  const prevPA = lastAttack.get(state) ?? null;
  lastAttack.set(state, pa);
  const isNewAttack = !!(pa && pa !== prevPA);
  // 上一段攻击"本帧被解决"——含"解决后**立刻又起下一段**"（多段攻击在同一动作里就 pump 出下一段，
  // 此时 pa 是新段、prevPA 是刚解决的那段）→ 也必须先播"攻击骰 + 防御骰并排消失"。
  const prevResolved = !!prevPA && pa !== prevPA;
  const attackChanging = isNewAttack || prevResolved;
  const defenderId: PlayerId = prevPA ? (prevPA.attacker === 'A' ? 'B' : 'A') : viewTarget;
  // 抵挡支付 = 含"抵挡骰"的那笔支付（按骰子重合识别，覆盖 置换抵挡 / 存放骰抵挡）
  const blockPay = prevResolved
    ? (pays.find((p) => p.dice.some((d) => blockIds.includes(d.id))) ?? null)
    : null;
  const blockSub = blockPay ? subOf(blockPay) : null;
  let blockDie: { id: string; player: PlayerId; value: number; rect: Rect; grey: boolean } | null = null;
  if (prevResolved && !blockSub && blockIds.length > 0) {
    const id = blockIds[0];
    const pd = prevDice.get(id);
    const ps = prevStored.get(id);
    if (pd) blockDie = { id, player: defenderId, value: pd.value, rect: pd.rect, grey: false };
    else if (ps) blockDie = { id, player: defenderId, value: ps.value, rect: ps.rect, grey: true };
  }

  const storedChanged = (() => {
    const nextStored = storedIdsOf(state);
    if (nextStored.size !== prevStored.size) return true;
    for (const id of nextStored) if (!prevStored.has(id)) return true;
    return false;
  })();
  // 点数/区变化（id 不变）：重掷、改点、换区
  const diceVisualChanging = areaDiceChanged(prevDice, state);
  const willAnimate =
    setChanged ||
    lifeItems.length > 0 ||
    attackChanging ||
    storedChanged ||
    diceVisualChanging ||
    rerollIds.size > 0 ||
    hasMoveFx ||
    !!weijuInit ||
    !!weijuPay ||
    hasBubble ||
    hasAttackJoin;
  const holdView =
    prevView !== viewTarget &&
    willAnimate &&
    (removed ||
      lifeItems.length > 0 ||
      attackChanging ||
      storedChanged ||
      diceVisualChanging ||
      rerollIds.size > 0 ||
      hasMoveFx ||
      !!weijuInit ||
      !!weijuPay ||
      hasBubble ||
      hasAttackJoin) &&
    canAnimate(root);
  const renderSelf: PlayerId = holdView ? prevView : viewTarget;
  const flipped = prevView !== renderSelf;
  // 「获得」按归属拆分：要换视角（`holdView`）时，**新视角那一方（`viewTarget`）**的获得延后到切换后播；
  // 其余（旧视角那方，如"你这回合技能给的骰"）在**切换前**随阶段③播完——二者不再并成一坨。
  const deferAddOwner: PlayerId | null = holdView ? viewTarget : null;
  lastView.set(state, renderSelf);

  const selfId: PlayerId = renderSelf;
  const enemyId: PlayerId = oppOf(selfId);

  const rerollAction = legal.find((a): a is Extract<Action, { t: 'reroll' }> => a.t === 'reroll');
  const maxReroll = rerollAction?.dieIds.length ?? 0;

  // 预设·带传奇：中段改为 [设置+战报][快速操作栏][双方生命值]，并移除左侧栏（腾出的宽度用于传奇框）
  const legendMode = !!(state.players.A.legend || state.players.B.legend);

  const sel = hooks.ui.selection;
  let selectionStep: SelectStep | null = null;
  let selectionOwner: PlayerId | null = null;
  let slotsStepOpen = false;
  if (sel && SKILL_SELECTION[sel.key]) {
    const steps = SKILL_SELECTION[sel.key].steps({
      state,
      player: actorOf(state),
      chosenDice: sel.chosenDice,
      options: sel.options,
      numbers: sel.numbers,
      slots: sel.slots,
    });
    const step = steps[sel.stepIndex];
    if (step && step.kind === 'dice') {
      selectionStep = step;
      // owner 相对的是「当前操作者」actorOf(state)（待决策玩家），而非总是 activePlayer
      selectionOwner = step.owner === 'self' ? selfId : enemyId;
    } else if (step && step.kind === 'slots') {
      slotsStepOpen = true;
    }
  }

  const areaPick: Ctx['areaPick'] = (() => {
    const cp = hooks.ui.convertPick;
    if (cp) {
      return {
        owner: convertPickOwner(state),
        kinds: ['attack', 'defense', 'meditation'],
        isSelected: (id: string) => cp.dieIds.includes(id),
        toggle: (d: Die) => toggleConvertDie(hooks, d),
        ignoreLock: true, // 010 置换源骰不算使用/消耗/弃置（有效 5 点由 convertAvailable 另行封锁）
      };
    }
    const fp = hooks.ui.fengmangPick;
    if (fp && state.pending && state.pending.kind === 'fengmang') {
      const owner = state.pending.player;
      return {
        owner,
        kinds: ['attack', 'meditation'],
        isSelected: (id: string) => fp.attackDieId === id || fp.meditationDieId === id,
        toggle: (d: Die) => toggleFengmangDie(hooks, d),
      };
    }
    const qz = hooks.ui.quanzhi;
    if (qz && state.pending && state.pending.kind === 'quanzhiAssign') {
      const owner = state.pending.player;
      const used = new Set(qz.groups.flatMap((g) => g.dieIds));
      return {
        owner,
        kinds: ['attack', 'defense', 'meditation'],
        filter: (d: Die) => !qz.preview && !used.has(d.id),
        isSelected: (id: string) => qz.selected.includes(id),
        toggle: (d: Die) => toggleQuanzhiDie(hooks, d),
        ignoreLock: true, // 分配新获得的骰到区域，不是使用/消耗/弃置
      };
    }
    if (selectionStep && selectionStep.kind === 'dice' && selectionOwner) {
      const step = selectionStep;
      return {
        owner: selectionOwner,
        kinds: step.areas,
        filter: step.filter ? (d: Die) => step.filter!(d) : undefined,
        isSelected: (id: string) => hooks.ui.selection?.currentSel.has(id) ?? false,
        toggle: (d: Die) => toggleSelDie(hooks, step, d),
        ignoreLock: step.ignoreLock,
      };
    }
    return null;
  })();

  const ctx: Ctx = {
    state,
    legal,
    hooks,
    maxReroll,
    selectionStep,
    selectionOwner,
    slotsStepOpen,
    dustFlowOpen: hooks.ui.dustFlow != null,
    areaPick,
    prefs: hooks.ui.prefs,
  };

  root.innerHTML = '';
  const stage = el('div', 'stage');
  const app = el(
    'div',
    `app density-${hooks.ui.prefs.density}${hooks.ui.prefs.logCollapsed ? ' log-collapsed' : ''}${legendMode ? ' legend-mode' : ''}`,
  );

  // 战报抽屉的贴边拉手（仅非传奇：侧栏收起 / 窄屏时显示）——左中细长竖条 + 小三角
  const logTab = document.createElement('button');
  logTab.type = 'button';
  logTab.className = 'log-tab';
  logTab.dataset.act = 'logOpen';
  logTab.title = '战报';
  const logTabTri = el('span', 'log-tab-tri');
  logTab.appendChild(logTabTri);
  logTab.addEventListener('click', () => {
    hooks.ui.logOpen = true;
    hooks.requestRender();
  });
  // 仅非传奇模式：传奇的战报常驻中段战报格，无需此拉手
  if (!legendMode) app.appendChild(logTab);

  // 设置按钮（左栏顶部 / 传奇模式中段战报栏顶部 共用）
  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'btn btn-settings';
  settingsBtn.dataset.act = 'settingsOpen';
  settingsBtn.textContent = '设置';
  settingsBtn.addEventListener('click', () => {
    hooks.ui.settingsOpen = true;
    hooks.requestRender();
  });

  // 左栏（非传奇模式）：战报（设置按钮已移到中段右侧空槽）
  if (!legendMode) {
    const sidebar = el('div', 'sidebar');
    sidebar.appendChild(logPanel(ctx, true));
    app.appendChild(sidebar);
  }

  // 主栏：敌方 / 中央操作区 / 自己
  const main = el('div', 'main');
  main.appendChild(
    state.mode === 'challenge'
      ? challengePanel(state.players[enemyId], ctx)
      : playerPanel(state.players[enemyId], 'enemy', true, ctx),
  );

  const centerband = el('div', 'centerband');
  // 传奇模式：中段最左格 = 战报（内置滚动；设置按钮已移到中段右侧空槽）
  if (legendMode) {
    const logcell = el('div', 'centerband-log');
    logcell.appendChild(logPanel(ctx, true));
    centerband.appendChild(logcell);
  }
  const left = el('div', 'centerband-left');
  left.appendChild(actionZone(ctx));
  centerband.appendChild(left);

  // 中段右侧槽：保留原先"双方生命"的占地（留空），放置「设置」按钮；高度随 stretch 与操作栏齐平
  const right = el('div', 'centerband-right');
  right.appendChild(settingsBtn);
  // 挑战模式：设置旁显示当前「结算模式」（有利/不利/自选）——悬浮显示说明、点击切换显隐（只读，不改模式）
  if (state.mode === 'challenge') {
    const sm = state.challenge?.settleMode ?? 'favor';
    const badge = el('span', 'settle-mode-badge');
    badge.dataset.settle = sm;
    badge.textContent = `结算：${sm === 'manual' ? '自选' : sm === 'favor' ? '有利' : '不利'}`;
    const modeId: 'favor' | 'against' | 'manual' = sm;
    let tipOn = false;
    const showTip = (): void => {
      showSettleTip(badge, modeId);
      tipOn = true;
    };
    const hideTip = (): void => {
      hideSettleTip();
      tipOn = false;
    };
    badge.addEventListener('mouseenter', showTip);
    badge.addEventListener('mouseleave', hideTip);
    badge.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showTip();
    });
    badge.addEventListener('click', () => {
      if (tipOn) hideTip();
      else showTip();
    });
    right.appendChild(badge);
  }
  // 挑战模式：设置旁加「挑战模式特殊规则」（浮窗＝本模式技能削弱清单）
  if (state.mode === 'challenge') {
    const rulesBtn = document.createElement('button');
    rulesBtn.type = 'button';
    rulesBtn.className = 'btn btn-settings';
    rulesBtn.dataset.act = 'challengeRulesOpen';
    rulesBtn.textContent = '挑战模式规则调整';
    rulesBtn.addEventListener('click', () => {
      hooks.ui.challengeRulesOpen = true;
      hooks.requestRender();
    });
    right.appendChild(rulesBtn);
  }
  // 联机：设置旁加「聊天」按钮（开右上聊天浮层）；再加「退出对局」（对局中途可退出，不会被困住）
  if (hooks.online && hooks.online.onChat) {
    const chatBtn = document.createElement('button');
    chatBtn.type = 'button';
    chatBtn.className = 'btn btn-settings online-chat-btn';
    chatBtn.dataset.act = 'onlineChat';
    chatBtn.textContent = '聊天';
    const unread = hooks.online.unread ?? 0;
    if (unread > 0) {
      const badge = el('span', 'chat-badge');
      badge.textContent = unread > 9 ? '9+' : String(unread);
      chatBtn.appendChild(badge);
    }
    chatBtn.addEventListener('click', () => hooks.online!.onChat!());
    right.appendChild(chatBtn);
  }
  if (hooks.online) {
    const quitBtn = document.createElement('button');
    quitBtn.type = 'button';
    quitBtn.className = 'btn btn-settings';
    quitBtn.dataset.act = 'onlineQuit';
    quitBtn.textContent = '退出对局';
    quitBtn.addEventListener('click', () => {
      hooks.ui.onlineLeaveOpen = true;
      hooks.requestRender();
    });
    right.appendChild(quitBtn);
  }
  centerband.appendChild(right);

  main.appendChild(centerband);
  main.appendChild(playerPanel(state.players[selfId], 'self', false, ctx));
  app.appendChild(main);

  stage.appendChild(app);
  root.appendChild(stage);
  // ?????"??????"?????????/????/??????????????
  restoreInFlightHides(root);

  if (state.phase === 'gameOver') {
    root.appendChild(gameOverModal(ctx));
  }
  if (hooks.ui.onlineLeaveOpen && hooks.online) {
    root.appendChild(onlineLeaveOverlay(ctx));
  }
  const tacticPending = state.pending?.kind;
  const isTacticPick =
    tacticPending === 'tacticDice' || tacticPending === 'tacticFirst' || tacticPending === 'tacticGuess';
  // 挑战模式建局**不经 `tactics` 阶段**（直接 initialReroll），但 T01/T13 的战前交互 pending 仍会挂 → 不能只按阶段显示
  if (state.phase === 'tactics' || isTacticPick) {
    // 联机·非本人操作 → 只读等待（不显示对方牌面）
    if (onlineNonActor(ctx)) {
      root.appendChild(tacticWaitOverlay(ctx));
    } else if (tacticPending === 'tacticDice') root.appendChild(tacticDiceOverlay(ctx));
    else if (tacticPending === 'tacticFirst') root.appendChild(tacticFirstOverlay(ctx));
    else if (tacticPending === 'tacticGuess') root.appendChild(tacticGuessOverlay(ctx));
    else if (state.phase === 'tactics') root.appendChild(tacticChooseOverlay(ctx));
  }
  if (hooks.ui.settingsOpen) {
    root.appendChild(settingsPanel(ctx));
  }
  if (hooks.ui.challengeRulesOpen) {
    root.appendChild(challengeRulesPanel(ctx));
  }
  if (hooks.ui.challengeSkillsOpen) {
    root.appendChild(challengeSkillsOverlay(ctx));
  }
  if (hooks.ui.logOpen) {
    root.appendChild(logDrawer(ctx));
  }
  if (hooks.ui.logPop) {
    root.appendChild(logPopModal(ctx));
  }
  if (hooks.ui.detail) {
    const pop = detailPopover(ctx);
    if (pop) root.appendChild(pop);
  }
  applyZoom(stage, hooks.ui.prefs);
  // 攻击支付 = 含"被支付攻击骰"的那笔支付（按骰子重合识别，覆盖 置换攻击 / 存放骰攻击）
  const attackPay =
    isNewAttack && pa!.sourceDieId
      ? (pays.find((p) => p.dice.some((d) => d.id === pa!.sourceDieId)) ?? null)
      : null;
  const otherPays = pays.filter(
    (p) => p !== attackPay && p !== blockPay && !p.dice.some((d) => weijuIds.has(d.id)),
  );

  // 由攻击池/支付整体动画接管（不参与普通"飞中间淡出"）：全部支付骰 + 抵挡骰 + 被支付骰 + 畏惧骰
  const excludeIds: string[] = [];
  if (isNewAttack && pa!.sourceDieId) excludeIds.push(pa!.sourceDieId);
  for (const id of blockIds) excludeIds.push(id);
  for (const p of pays) for (const d of p.dice) excludeIds.push(d.id);
  for (const id of weijuIds) excludeIds.push(id);
  for (const e of attackJoins) for (const id of e.dieIds) excludeIds.push(id);
  // A06 勾魂：落地那颗存放骰由专用飞行动画接管（不参与普通"新存放"动画）
  const gouhuns = fxEvents.filter((e): e is Extract<FxEvent, { kind: 'gouhun' }> => e.kind === 'gouhun');
  for (const g of gouhuns) excludeIds.push(g.chipId);
  // 001/C01 裁雨流：停在中间的那颗攻击骰**已落区** → 真骰排除出普通"获得动画"（由 releaseHeldAttackDie 收尾）
  {
    const hid = heldAttackDieId();
    if (hid && areaDieIds(state).has(hid)) excludeIds.push(hid);
  }
  // 挑战模式：本步被扣下的驱动骰由 `playLegendConsume`（临时区→中间→驱动骰槽→消失）接管 →
  // 排除出普通"消失"动画，否则同一颗骰会被两套动画驱动。
  for (const ev of legendSkillEvs) for (const c of ev.consumed) excludeIds.push(c.id);
  // 挑战模式「枭首」：这一帧"上一段攻击刚结算" → 它用的是攻击骰区里的真骰，此时才被引擎移除；
  // 那颗骰的"飞出去"动画早由攻击池负责 → 这里排除，别再补一次通用"飞中间淡出"（否则一飞两次）。
  if (state.mode === 'challenge' && prevResolved && prevPA?.sourceDieId) excludeIds.push(prevPA.sourceDieId);

  // 真伤白墨线：发动卡图 / 战术栏名 中心 → 受伤方生命条 中心（与攻击线同编排）。
  // 缺"发动卡"上下文（如 009/T09 延后真伤）→ 退回"来源玩家面板"锚点，保证仍有线。位置当场量取、按身份取元素。
  let trueLineDur = 0;
  const trueLineEvents = fxEvents.filter(
    (e): e is Extract<FxEvent, { kind: 'trueLine' }> => e.kind === 'trueLine',
  );
  if (trueLineEvents.length > 0) {
    const cardElOf = (card: FxSource | null): HTMLElement | null => {
      if (!card) return null;
      if ('tacticId' in card) {
        return root.querySelector<HTMLElement>(
          `.player[data-player="${card.player}"] .tactic-bar-name[data-tactic="${card.tacticId}"]`,
        );
      }
      return (
        // 挑战模式：传奇没有"神器卡"DOM → 真伤墨线起点＝**昔日卡图**正中央（通用规则：以后哪张 Z 卡真伤都生效）
        root.querySelector<HTMLElement>(`.player[data-player="${card.player}"] .challenge-thumb`) ??
        root.querySelector<HTMLElement>(
          `.player[data-player="${card.player}"] .card[data-artifact="${card.artifactId}"] .card-art`,
        ) ??
        root.querySelector<HTMLElement>(
          `.player[data-player="${card.player}"] .card-legend[data-legend="${card.artifactId}"] .card-legend-art`,
        )
      );
    };
    const lifeElOf = (p: PlayerId): HTMLElement | null =>
      root.querySelector<HTMLElement>(`.player[data-player="${p}"] .lifeline`) ??
      root.querySelector<HTMLElement>(`.lifeline[data-player="${p}"]`);
    for (const e of trueLineEvents) {
      const from =
        cardElOf(e.card) ??
        (state.mode === 'challenge' && e.source === 'B'
          ? root.querySelector<HTMLElement>('.panel--challenge .challenge-thumb')
          : null) ??
        root.querySelector<HTMLElement>(`.player[data-player="${e.source}"]`);
      trueLineDur = Math.max(trueLineDur, drawTrueLine(root, from, lifeElOf(e.target)));
    }
  }

  // 挑战模式 · 传奇回合的过场（引擎已在本帧 fx 里报出"这一步发生了什么"；标准模式永不出现）：
  //  ★ **顺序＝卡面顺序**：固定前缀（弹技能名 + 驱骰「临时区→中间→驱动骰槽→消失」）→ 再按卡面逐步执行。
  //  投掷（驱动骰→临时区）**不在这里做**：临时区骰子也是 `.die[data-id]`，通用「获得骰」动画已经会播
  //  （曾额外加一条 `playLegendRoll` → 同一动作播两遍）。
  //  驱动骰槽是**纯过场**：状态里不留骰（引擎只记 `pendingConsumed`）→ 界面全用影子演，落点后自然消失。
  let legendDur = 0;
  let legendConsumeEnd = 0; // 最后一次「驱骰进槽」的结束时刻（供攻击延迟）
  let legendLastSpawn = false; // 最后一条 legendSkill 是否"有新骰飞入"
  /** 挑战模式：本帧传奇**新得到**的骰子 → 它们不交给通用「获得骰」（`playLegendSpawn` 独占负责） */
  const legendAddIds = new Set<string>();
  for (const ev of legendSkillEvs) {
    const at = legendDur; // **串行**：同一帧多条 legendSkill 时，后一条从前一条播完处开始
    let end = at;
    // 技能名只在**"发动帧"**弹（由引擎 `announce` 决定）：∞/无槽技能（龙游万象 / 雨落狂流）也弹；
    // 续跑帧、遁入暗影的后续移骰步不弹（避免重复）。**不要**用 `consumed.length > 0` 当替身。
    if (ev.announce) {
      end = Math.max(end, playUltimate(root, ev.skillName, at, '', MOTION.legendUltimateHold));
    }
    // 驱动骰进槽过场：只在有消耗时演（∞/无槽技能没有）
    if (ev.consumed.length > 0) {
      const items: LegendConsumeItem[] = ev.consumed
        .map((c) => {
          const pd = prevDice.get(c.id);
          return pd ? { rect: pd.rect, value: c.value } : null;
        })
        .filter((x): x is LegendConsumeItem => !!x);
      // 落点＝**槽区域**（不是里面那个空的 `.dice`——空容器高度为 0，会算到快速操作栏去）
      const slotAreaEl = root.querySelector<HTMLElement>('.panel--challenge .area--driven');
      const d = playLegendConsume(root, items, slotAreaEl, at);
      end = Math.max(end, d);
      legendConsumeEnd = Math.max(legendConsumeEnd, d);
    }
    // 第二步：本步"新产生"的骰 → 中间冒出、飞入对应骰区。
    //   **动画隔离**：这几颗**只由 `playLegendSpawn` 负责**（从通用「获得骰」里排除），落点＝区里行尾并排，
    //   确定、唯一 → 不会再和通用"获得/让位"抢同一颗骰子（挤格/跳格就是这么来的）。
    const hasSpawn = ev.spawn.length > 0 && state.mode === 'challenge';
    if (hasSpawn) {
      for (const s of ev.spawn) legendAddIds.add(s.id);
      end = Math.max(
        end,
        playLegendSpawn(
          root,
          ev.spawn.map((s) => ({ value: s.value, area: s.area })),
          at,
          ev.spawn.map((s) => s.id),
        ),
      );
    }
    legendLastSpawn = hasSpawn;
    legendDur = Math.max(legendDur, end);
  }
  // 【先动画，再选择】这一帧要弹代决面板 → 记下"到什么时候才允许显示"（等 技能名 + 进槽 + 本步移骰 都播完）
  if (legendSkillEvs.length > 0 && state.pending?.kind === 'challengePick') {
    legendPickHoldUntil = performance.now() + legendDur + 30;
  }
  // 传奇这一步"触发攻击"时：攻击动画后移到「驱骰进槽」＋（本步有新骰则再等）「新骰飞入」之后。
  // ⚠️ 不再叠加"技能名横幅"的整段停留（此前 `legendDur + addsDuration()` 会被横幅(1.96s)撑满、
  //    且"本步无新骰"时仍白等 0.99s → 灰骰迟迟不出，就是"卡顿"）。
  const legendAttackDelay = legendSkillEvs.some((e) => e.attack)
    ? legendConsumeEnd + (legendLastSpawn ? addsDuration() : 0)
    : 0;

  // L04 重开：本帧是整盘重置 → 走"全部旧骰 → 中间合成一个 → 新骰从中间冒出"的专用动画
  const resetMerge = fxEvents.some((e) => e.kind === 'reset');
  // 非攻击/非抵挡的支付：整队并排 → 中间 → 停 → 每组合并成灰 5 → 全部有效骰一起淡出
  const payDur = playPayments(root, otherPays);

  // "代价组"时长：攻击由置换支付时由攻击池内部承担（costDur=0）；否则有其它代价骰＝消耗组时长
  // ⚠️ 抵挡骰/支付骰/被支付骰/畏惧骰（excludeIds）不算"本段代价"（多段攻击里它们是**上一段**的收尾）。
  const excludeSet = new Set(excludeIds);
  let costPresent = false;
  if (isNewAttack && !attackPay) {
    for (const id of prevDice.keys()) {
      if (excludeSet.has(id)) continue;
      if (!nextIds.has(id) && id !== pa!.sourceDieId) {
        costPresent = true;
        break;
      }
    }
  }
  const costDur = Math.max(costPresent ? removalGroupMs() : 0, moveFxDuration(diceFx));

  // 上一段（多段攻击的中间段）本帧先收尾：攻击骰 + 防御骰并排消失；随后本段攻击骰再起步。
  // （有 attackJoin（011/034）时由 join 接管，不走这里，避免抢掉池子）
  const resolveDur =
    prevResolved && !hasAttackJoin
      ? attackResolve(root, {
          defender: defenderId,
          blockDie: blockDie ? { value: blockDie.value, rect: blockDie.rect, grey: blockDie.grey } : null,
          substitution: blockSub,
          hold: holdAttackDie ? { dieId: holdAttackDie.dieId } : null,
        })
      : 0;

  // 001/C01 裁雨流：还在等玩家决定 → 攻击骰继续停在中间；待决策已解决 → 收尾
  //（已落区＝发动 → 中间翻面后飞回该区那颗真骰；不发动 → 淡出）
  const heldReleaseDur =
    !holdAttackDie && state.pending?.kind !== 'caiyuliu' && state.pending?.kind !== 'c01Caiyuliu'
      ? releaseHeldAttackDie(root)
      : 0;

  let attackDur = 0;
  if (isNewAttack) {
    attackDur = attackStart(root, {
      sig: pa,
      attacker: pa!.attacker,
      target: oppOf(pa!.attacker),
      value: pa!.baseValue ?? pa!.value,
      // 挑战模式·传奇的攻击：只有"来自攻击骰区真骰"的那次攻击用实体红骰（`dieStyle:'solid'`）；
      // 其余虚拟攻击（8 点不可抵挡 / 2 点遁入暗影）一律灰骰。
      virtual: pa!.dieStyle === 'solid' ? false : !pa!.physical,
      sourceRect: pa!.sourceDieId
        ? (prevDice.get(pa!.sourceDieId)?.rect ?? prevStored.get(pa!.sourceDieId)?.rect ?? null)
        : null,
      fromCard: pa!.sourceDieId ? prevStored.has(pa!.sourceDieId) : false,
      costDur: resolveDur + costDur + legendAttackDelay, // 先等上一段收尾（整组播完），再等本段代价；挑战模式再等"先出骰后攻击"
      substitution: subOf(attackPay, pa!.sourceDieId ?? undefined),
    });
    // 挑战模式「枭首」：这颗骰**开飞那一刻**起就不该再出现在攻击骰区（数据层排除；不用 CSS hidden）
    if (state.mode === 'challenge' && pa!.sourceDieId) {
      const id = pa!.sourceDieId;
      // 与 attackStart 的"开飞时刻"完全一致（costDur 到点）
      const at = resolveDur + costDur + legendAttackDelay;
      window.setTimeout(() => {
        // 定时器真正触发时校验：只有"这颗仍是**当前待抵挡**的源骰"才隐藏。
        // 若攻击已结算（`pendingAttack` 清空——尤其 Z01「裁雨流」把源骰搬回防御区），
        // 迟到的隐藏会把已经回到区域/被揭出的骰子重新藏起来（2026-10-18 真实事故）。
        if (state.pendingAttack?.sourceDieId !== id) return;
        hideLegendFlownDie(root, id);
      }, Math.max(0, at));
    }
  } else if (prevResolved && !hasAttackJoin) {
    attackDur = resolveDur;
  } else if (pa) {
    attackHold(root);
  }

  // 挑战模式「枭首」：**每次渲染**都执行——把"已飞出去"的骰子从攻击骰区**数据层排除**（唯一入口）。
  // 这样挑战者点抵挡/不抵挡触发重绘时，它也不会"复活"；而"开飞当下"由定时器调用同一入口去掉，不会停留。
  if (state.mode === 'challenge') {
    for (const id of [...legendGoneIds]) hideLegendFlownDie(root, id);
    // 自清理：只保留"此刻还在攻击骰区/防御骰区里"的 id，其余自动解除（换了局面就不再隐藏）
    //   · 枭首/裁雨流/无上剑术/战车，或真实之剑·甲：源骰可能在防御骰区
    const alive = new Set(
      [...state.players.B.areas.attack, ...state.players.B.areas.defense].map((d) => d.id),
    );
    for (const id of [...legendGoneIds]) if (!alive.has(id)) legendGoneIds.delete(id);
  } else {
    legendGoneIds.clear();
  }

  // 攻击池"另一方补一颗骰"（011 spend / 034 park·cancel）：并排、不遮挡 → 按 then 处理
  let joinDur = 0;
  for (const e of attackJoins) {
    if (joinCoveredByPay(e.dieIds)) continue; // 该骰已由"支付整体"动画接管 → 不重复补骰
    const id = e.dieIds[0];
    const pdv = id ? prevDice.get(id) : undefined;
    const psv = id ? prevStored.get(id) : undefined;
    const rect = pdv?.rect ?? psv?.rect;
    if (!rect) continue;
    joinDur = Math.max(
      joinDur,
      attackJoin(root, {
        rect,
        value: e.value,
        grey: !!psv,
        player: e.player,
        then: e.mode === 'spend' ? 'spend' : 'fadeAll',
      }),
    );
  }
  if (parkedBlock && !joinCoveredByPay(parkedBlock.dieIds)) {
    const id = parkedBlock.dieIds[0];
    const pdv = id ? prevDice.get(id) : undefined;
    const psv = id ? prevStored.get(id) : undefined;
    const rect = pdv?.rect ?? psv?.rect;
    if (rect) {
      joinDur = Math.max(
        joinDur,
        attackJoin(root, {
          rect,
          value: pdv?.value ?? psv?.value ?? 0,
          grey: !!psv,
          player: parkedBlock.player,
          then: 'park',
        }),
      );
    }
  }

  // 023 畏惧 · 响应池：发起方骰停中间等 → 被要求方骰到位并排 → 一起消失
  let weijuDur = 0;
  if (weijuInit) {
    const src = rectsOf(weijuInit.dieIds);
    weijuDur = weijuStart(root, {
      player: weijuInit.player,
      value: weijuInit.value,
      sourceRects: src.rects,
      values: src.values,
    });
  } else if (weijuPay) {
    const src = rectsOf(weijuPay.dieIds);
    weijuDur = weijuResolve(root, {
      player: weijuPay.player,
      value: weijuPay.value,
      sourceRects: src.rects,
      values: src.values,
    });
  } else if (state.pending?.kind === 'weijuPay') {
    weijuHold(root);
  }

  // A06 勾魂：攻击骰从中间飞向神器标题栏 → 变灰存放
  const gouhunDur = playGouhun(root, gouhuns);

  // 本帧"获得"必须等它播完的时长：
  //  · 常态 = 支付整体（payDur）——维持原样；
  //  · **「幽魂不散」帧** = 支付 / 攻击池 / 补骰 / 畏惧池 / 勾魂 / 裁雨流收尾 取最大
  //    （否则"使用/弃置的骰"还在飞，幽魂获得的骰就从中间飞进来 → 同帧重叠）。
  // 池动画都已在 runBoardMotions **之前**登记好了（见上），所以这里能拿到它们的时长。
  const youhunFired = fxEvents.some((e) => e.kind === 'skillFired' && e.skillKey === 'xuyu.alt.youhun');
  const beforeAddsMs = youhunFired
    ? Math.max(payDur, attackDur, weijuDur, joinDur, gouhunDur, heldReleaseDur)
    : payDur;
  const settleDice = runBoardMotions(
    root,
    prevDice,
    lifeItems,
    flipped,
    deferAddOwner,
    excludeIds,
    prevStored,
    rerollIds,
    diceFx,
    beforeAddsMs,
    resetMerge,
    legendAddIds, // 挑战模式：这些新骰的"获得"动画由 playLegendSpawn 独占负责
  );

  // P-D · 技能气泡：开＝单字（白底）/ 用＝技能名（黑底）；锚点在**卡图**正中央
  const artElOf = (player: PlayerId, artifactId: string): HTMLElement | null =>
    root.querySelector<HTMLElement>(`.player[data-player="${player}"] .card[data-artifact="${artifactId}"] .card-art`) ??
    root.querySelector<HTMLElement>(`.player[data-player="${player}"] .card-legend[data-legend="${artifactId}"] .card-legend-art`) ??
    root.querySelector<HTMLElement>(`.player[data-player="${player}"] .card[data-artifact="${artifactId}"] .card-head`) ??
    root.querySelector<HTMLElement>(`.player[data-player="${player}"]`);
  const skillNameOf = (
    player: PlayerId,
    artifactId: string,
    side: 'left' | 'right' | 'only',
    skillKey?: string,
  ): string => {
    const pl = state.players[player];
    const a = pl.artifacts.find((x) => x.id === artifactId);
    if (a) return sideDisplayName(a, side) ?? a.name; // 神器：按"侧"取名（同侧同名）
    if (pl.legend && pl.legend.id === artifactId) return legendSkillNameOf(pl.legend, skillKey); // 传奇：按 key 精确定名
    return '';
  };
  let bubbleDur = 0;
  const bubbleBusy = new Map<string, number>(); // key → 可再弹的最早时刻（performance.now）
  const schedule = (
    key: string,
    target: HTMLElement | null,
    text: string,
    variant: BubbleVariant,
    opts: BubbleOpts = {},
  ): void => {
    const dur = bubbleDuration(variant);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const free = bubbleBusy.get(key) ?? 0;
    const delay = Math.max(0, free - now);
    // 元素**立即创建**、只用 WAAPI `delay` 延后出场 → 不跨重绘持旧元素（否则换视角/重绘时气泡会被吞）
    playBubble(root, target, text, variant, { ...opts, delayMs: delay });
    bubbleBusy.set(key, Math.max(now, free) + dur);
    bubbleDur = Math.max(bubbleDur, delay + dur);
  };
  // 开＝单字（白底）；用＝技能名（黑底）。（同一动作内去重；同卡自动串行）
  const seenRise = new Set<string>();
  for (const e of rises) {
    const k = `${e.player}:${e.artifactId}`;
    if (seenRise.has(k)) continue;
    seenRise.add(k);
    const verb = e.mode === 'switch' ? '切换' : e.mode === 'activate' ? '激活' : '充能';
    schedule(k, artElOf(e.player, e.artifactId), verb, 'open');
  }
  let ultimateDur = 0;
  const cardBubbleDur = new Map<PlayerId, number>(); // 本帧已排的卡图气泡时长（供"跨卡顺序"：先气泡、后必杀横幅）
  const seenFire = new Set<string>();
  for (const e of fireds) {
    // 去重键含 **skillKey**：同一张卡同一侧的**不同技能**（如 018 持续「漆黑绽放」+ 必杀「漆黑绽放」同帧）
    // 不再互相顶掉（此前只按「玩家:神器:侧」去重 → 必杀横幅被持续的卡图气泡吃掉）。
    const k = `${e.player}:${e.artifactId}:${e.side}:${e.skillKey ?? ''}`;
    if (seenFire.has(k)) continue;
    seenFire.add(k);
    const name = skillNameOf(e.player, e.artifactId, e.side, e.skillKey) || '技能';
    if (skillKindOf(state, e.player, e.artifactId, e.skillKey) === 'ultimate') {
      // 必杀 → 大横幅；若同帧该玩家已有卡图气泡（如「没有怜悯」）→ 横幅延后到气泡之后（先气泡、再必杀）
      const delay = cardBubbleDur.get(e.player) ?? 0;
      ultimateDur = Math.max(ultimateDur, playUltimate(root, name, delay));
    } else {
      // 与「开」共用同一 key → 激活/充能时先「激活/充能」、再技能名（同卡自动串行）
      schedule(`${e.player}:${e.artifactId}`, artElOf(e.player, e.artifactId), name, 'use');
      cardBubbleDur.set(e.player, (cardBubbleDur.get(e.player) ?? 0) + bubbleDuration('use'));
    }
  }
  // 战术气泡：盖在「战术名＋战术药丸」上
  const seenTactic = new Set<string>();
  for (const e of fxEvents) {
    if (e.kind !== 'tacticFired') continue;
    const k = `tac:${e.player}:${e.tacticId}`;
    if (seenTactic.has(k)) continue;
    seenTactic.add(k);
    const nameEl = root.querySelector<HTMLElement>(
      `.player[data-player="${e.player}"] .tactic-bar-name[data-tactic="${e.tacticId}"]`,
    );
    if (!nameEl) continue;
    const pillEl = nameEl.parentElement?.querySelector<HTMLElement>('.tactic-bar-kind') ?? null;
    const nr = nameEl.getBoundingClientRect();
    const pr = pillEl?.getBoundingClientRect();
    const left = nr.left;
    const right = pr ? pr.right : nr.right;
    const tname = TACTIC_BY_ID[e.tacticId]?.name ?? e.tacticId;
    schedule(k, nameEl, tname, 'tactic', {
      width: Math.max(nr.width, right - left),
      center: { x: (left + right) / 2, y: nr.top + nr.height / 2 },
    });
  }

  // P-D · 阶段横幅（「回合开始 / 尘起阶段 / 主要阶段」）。
  // 引擎会「没得做就自动翻页」——一次动作可能跨过多个阶段 → 这里按阶段顺序**依次补播**被跨过的阶段横幅
  // （短停留），最后一段＝当前真实阶段（正常停留）。**三段绝不互相吞、绝不重叠**（串行）。
  // 时机：延后到本帧其它动画播完 + 视角切换之后开始。
  const prevSnap = lastPhaseSnap.get(state);
  lastPhaseSnap.set(state, { active: state.activePlayer, phase: state.phase });
  const bannerSegs = phaseBannerSegs(
    prevSnap ?? null,
    { active: state.activePlayer, phase: state.phase },
    (p) => playerName(ctx, p),
    // 挑战模式·传奇回合：不硬套「尘起/主要」阶段横幅
    state.mode === 'challenge' && state.activePlayer === 'B' ? { legendActor: true } : undefined,
  );

  // 切换等待：普通动效 / 支付整体 / 攻击池 / 畏惧响应池 / 气泡 … 取最大（整组播完才切 AB）
  // 注：阶段横幅**不计入** settle（切换不去等横幅）；横幅在「切换之后」另起延后播。
  const settle = Math.max(settleDice, payDur, attackDur, weijuDur, bubbleDur, joinDur, ultimateDur, trueLineDur, heldReleaseDur, gouhunDur, legendDur);
  let frameEnd = settle;
  if (bannerSegs.length > 0) {
    let at = settle + 30;
    for (const seg of bannerSegs) {
      const end = playBanner(root, seg.text, at, seg.transient ? MOTION.bannerHoldTransient : undefined);
      // 串行：下一段从本段结束点开始（无动画环境返回 0 → 用等长步长兜底；反正无视觉）
      at = end > 0 ? end : at + (MOTION.micro + MOTION.bannerHold + MOTION.fade);
    }
    frameEnd = Math.max(frameEnd, at);
  }
  // 本帧动效总时长（含阶段横幅）——`main.ts` 用它给"挑战模式自动推进"配速（每步播完再走下一步）
  lastFrameMs = frameEnd;

  // 【排查·?diag=1，全模式】数据里有、画面上没有的骰子（＝"隐形骰子"）→ 记一条 DOM-MISSING。
  // 刻意隐藏的（挑战模式的 legendGoneIds）属正常，不报。
  if (isDiagEnabled()) {
    const areas = [
      ...state.players.A.areas.attack,
      ...state.players.A.areas.defense,
      ...state.players.A.areas.meditation,
      ...state.players.B.areas.attack,
      ...state.players.B.areas.defense,
    ];
    const dataIds = areas.map((d) => d.id);
    const dataVals: Record<string, number> = {};
    for (const d of areas) dataVals[d.id] = d.value;
    const dieEls = Array.from(root.querySelectorAll<HTMLElement>('.die[data-id]'));
    const domIds = dieEls.map((e) => e.dataset.id ?? '');
    const missing = missingDiceInDom(dataIds, domIds).filter((id) => !legendGoneIds.has(id));
    if (missing.length > 0) {
      diag('DOM-MISSING', { missing, gone: [...legendGoneIds], snap: gameSnapshot(state, [...legendGoneIds]) });
    }
    // 元素在 DOM 里、但**被 CSS 藏了**（visibility/display/opacity）—— DOM-MISSING 抓不到
    const invisible: string[] = [];
    const domVals: Record<string, string> = {};
    for (const el of dieEls) {
      const id = el.dataset.id ?? '';
      if (el.dataset.value != null) domVals[id] = el.dataset.value;
      const cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
      if (cs && (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0')) invisible.push(id);
    }
    if (invisible.length > 0) {
      diag('DOM-INVISIBLE', {
        ids: invisible,
        gone: [...legendGoneIds],
        inline: invisible.map((id) => {
          const el = dieEls.find((e) => e.dataset.id === id);
          return `${id}@${el ? el.getAttribute('style') ?? '' : ''}`;
        }),
      });
    }
    // 画面值 ≠ 数据值（"显示的是过时骰子"）—— 用户报的 4/5 就是这一类
    const stale = staleDice(dataVals, domVals);
    if (stale.length > 0) {
      diag('DOM-STALE', { stale, gone: [...legendGoneIds], snap: gameSnapshot(state, [...legendGoneIds]) });
    }
  }

  if (holdView) {
    // 两阶段：先在本视角把动效播完，再瞬间切到新视角（切的那一帧无动效）
    const doFlip = (): void => {
      lastView.set(state, viewTarget);
      hooks.requestRender();
    };
    if (settle > 0) window.setTimeout(doFlip, settle + 30);
    else if (typeof requestAnimationFrame === 'function') requestAnimationFrame(doFlip);
    else window.setTimeout(doFlip, 0);
  }
}

/** 整屏缩放：关 / 自动（内容高于视口时缩到一屏，下限 0.8）/ 手动 */
function applyZoom(stage: HTMLElement, prefs: Prefs): void {
  if (prefs.zoomMode === 'off') {
    stage.style.transform = '';
    stage.style.width = '';
    delete stage.dataset.zoomStamp;
    delete stage.dataset.zoomK;
    return;
  }
  stage.style.transformOrigin = 'top left';
  if (prefs.zoomMode === 'manual') {
    const k = Math.min(1, Math.max(0.1, prefs.zoomPercent / 100));
    stage.style.transform = k === 1 ? '' : `scale(${k})`;
    stage.style.width = k === 1 ? '' : `${100 / k}%`;
    return;
  }
  // 自动：只在「布局视口尺寸 / 密度」变化时重算，避免内容一变（如确认条出现/消失）就来回抖动
  const doc = typeof document !== 'undefined' ? document.documentElement : null;
  const vw = doc ? doc.clientWidth : 0;
  const vh = doc ? doc.clientHeight : 0;
  const stamp = `${vw}x${vh}:${prefs.density}`;
  if (stage.dataset.zoomStamp !== stamp) {
    stage.style.transform = 'none';
    stage.style.width = '100%';
    const h = stage.scrollHeight || 0;
    let k = 1;
    if (h > 0 && vh > 0 && h > vh) k = Math.max(0.8, Math.min(1, vh / h));
    stage.dataset.zoomStamp = stamp;
    stage.dataset.zoomK = String(k);
  }
  const k = Number(stage.dataset.zoomK ?? '1') || 1;
  stage.style.transform = k === 1 ? '' : `scale(${k})`;
  stage.style.width = k === 1 ? '' : `${100 / k}%`;
}
