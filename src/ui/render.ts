import type {
  Action,
  Artifact,
  DiceKind,
  Die,
  GameState,
  LegendPanel,
  Phase,
  PlayerId,
  PlayerState,
  SkillDef,
} from '../core/model/types';
import { ARTIFACT_TEXT } from '../core/content/artifactText';
import { isAltArtifact } from '../core/content/artifacts';
import { legendImageUrl } from '../core/content/legends';
import { LEGEND_TEXT } from '../core/content/legendText';
import { getLegalActions, legendSkillReady, quanzhiRemainderHasGroup } from '../core/engine/game';
import { effectiveSpeed, effectiveWill, rerollAllowance } from '../core/engine/derive';
import { areaOf } from '../core/model/dice';
import { hasActiveSkill, skillUseKey } from '../core/engine/skill-state';
import { artifactWithSkill, attackDamageBonus } from '../core/engine/combat';
import { battleNotes } from '../core/engine/battleNotes';
import { SKILL_SELECTION, hasSword, type SelectStep } from './skillSelection';
import { DEFAULT_PREFS, applyPreset, clonePrefs, type Prefs } from './prefs';

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
  initialReroll: '初始重掷',
  refill: '补充',
  reroll: '重掷',
  dustRise: '尘起',
  main: '主要',
  end: '结束',
  gameOver: '结束',
};

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
  /** 战报抽屉是否打开（战报栏收起时用） */
  logOpen: boolean;
  /** 战报放大弹窗（右键战报栏打开，全量、大空间） */
  logPop: boolean;
  /** 技能详情浮窗（只读）：锚定触发卡片的屏幕矩形 */
  detail: null | {
    artifactId: string;
    rect: { left: number; top: number; width: number; height: number };
  };
  /** UI 层的临时错误提示（非法操作等）——**只属于界面**，绝不写进引擎状态/战报 */
  error: string | null;
}

export interface RenderHooks {
  onAction: (a: Action) => void;
  /** 提出一个待确认操作；由宿主写入 ui.pendingConfirm 后重绘 */
  propose: (action: Action, label: string) => void;
  ui: UiState;
  requestRender: () => void;
  onRestart: () => void;
  /** 偏好变化时回调（宿主负责写入 localStorage） */
  onPrefsChange?: (p: Prefs) => void;
}

type ActiveSelection = NonNullable<UiState['selection']>;
type DiceStep = Extract<SelectStep, { kind: 'dice' }>;

const oppOf = (p: PlayerId): PlayerId => (p === 'A' ? 'B' : 'A');

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
  } | null;
  /** 界面偏好 */
  prefs: Prefs;
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

function button(label: string, action: Action, hooks: RenderHooks, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${cls}`.trim();
  b.dataset.act = action.t;
  b.textContent = label;
  b.addEventListener('click', () => hooks.propose(action, label));
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
function metaParts(art: Artifact, player: PlayerState | null): (string | HTMLElement)[] {
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
  if (art.life !== undefined) parts.push(`生命 ${art.life}`);
  if (art.chargeReq !== undefined) {
    // 「充能」为纯文本（与「生命」同样式）；y/x 用旧黄色药丸（`充能 ` 末尾保留半角空格 → 文案仍是「充能 0/1」）
    parts.push('充能 ');
    const charge = el('span', 'sub-charge');
    charge.textContent = `${art.chargeLayer}/${art.chargeReq}`;
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
  appendParts(sub, metaParts(a, player));
  head.appendChild(sub);

  if (a.activeMarkerSide) {
    const act = el('span', 'badge badge-active');
    const activeName =
      sideDisplayName(a, a.activeMarkerSide) ?? sideDisplayName(a, 'only') ?? a.name;
    act.textContent = `已激活·${activeName}`;
    if (activeSideSpent(ctx, a)) act.classList.add('badge-active--spent');
    head.appendChild(act);
  }
  if (a.count > 0) {
    const count = el('span', 'badge badge-count');
    count.textContent = countText(a, player);
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
  attachDetailTrigger(head, ctx, a.id);

  // 卡图（缩略 / 完整）；卡片头部也可点击/长按查看技能详情
  const art = el('div', `card-art${ctx.prefs.cardArt === 'thumb' ? ' card-art--thumb' : ''}`);
  const artImg = document.createElement('img');
  artImg.className = 'card-art-img';
  artImg.src = `/cards/${a.id}.jpg`;
  artImg.alt = `${a.name}${a.weapon ? `（${a.weapon}）` : ''}`;
  artImg.addEventListener('error', () => {
    art.classList.add('card-art--missing');
    art.textContent = '（卡图占位）';
  });
  art.appendChild(artImg);
  attachDetailTrigger(art, ctx, a.id);
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
  card.appendChild(art);

  const text = ARTIFACT_TEXT[a.id];
  if (text) {
    const skills = el('div', `skills${ctx.prefs.showSkillText ? '' : ' skills--inline'}`);
    const groups = new Map<string, typeof text.skills>();
    for (const s of text.skills) {
      const existing = groups.get(s.name);
      if (existing) existing.push(s);
      else groups.set(s.name, [s]);
    }
    for (const [groupName, parts] of groups) {
      const box = el('div', 'skill');
      for (const s of parts) {
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

        const isUsedUltimate =
          key != null && s.type.includes('必杀') && ctx.state.ultimatesUsed.includes(skillUseKey(player.id, key));
        if (isUsedUltimate) part.classList.add('skill-part--used');
        const isForcedNow = zhihaiForcedFrame(ctx, a, s);

        const pHead = el('div', 'skill-part-head');
        const badge = el('span', 'skill-type');
        badge.textContent = s.type;
        pHead.appendChild(badge);
        // 技能名与类型徽标同行（隐藏描述时这就是那一行的主体，也是点击发动的目标）
        const nameEl = el('span', 'skill-name');
        nameEl.textContent = groupName;
        pHead.appendChild(nameEl);
        if (isForcedNow) {
          const forced = el('span', 'badge badge-forced');
          forced.textContent = '强制发动';
          pHead.appendChild(forced);
        } else if (isUsedUltimate) {
          const used = el('span', 'badge badge-used');
          used.textContent = '已使用';
          pHead.appendChild(used);
        }
        if (ctx.prefs.showSkillText) {
          const body = el('div', 'skill-text');
          body.textContent = s.text;
          pHead.appendChild(body);
        }
        part.appendChild(pHead);

        const skillAction = ctx.legal.find(
          (x): x is SkillAction =>
            x.t === 'skill' && x.artifactId === a.id && x.side === s.side,
        );
        if (skillAction && isActivatableType(s.type) && !isUsedUltimate) {
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

        box.appendChild(part);
      }

      skills.appendChild(box);
    }
    card.appendChild(skills);
  }

  return card;
}

/** 面板技能 key：**按文案条目在 `LEGEND_TEXT[id].skills` 里的下标**对应 `lg.skills` 同下标（两者同序）。
 *  不能用"按类型（kind）反查"——同一面板可能有**两个同类型**技能（如 L06 圆舞/死即新生都是持续、L08 蛇蝎之泪/没有怜悯都是持续），
 *  按类型会取到第一个、把第二行的 key 与状态判断都弄错。 */
function legendFindKey(lg: LegendPanel, s: { type?: string; name?: string }): string | undefined {
  const text = LEGEND_TEXT[lg.id];
  const i = text ? text.skills.indexOf(s as (typeof text.skills)[number]) : -1;
  if (i >= 0) return lg.skills[i]?.key;
  // 兜底（拿不到文案条目时）：保持旧行为，至少不要报错
  const kind = s.type ? kindFromType(s.type) : undefined;
  if (kind) {
    const def = lg.skills.find((x) => x.kind === kind);
    if (def) return def.key;
  }
  return lg.skills.find((x) => x.side === 'only')?.key;
}

/** 面板技能行状态：可发动条件与引擎**同一来源**（`legendSkillReady`：尘落前置 + 个别额外前提） */
function legendSkillState(
  ctx: Ctx,
  player: PlayerState,
  lg: LegendPanel,
  s: { type: string },
): 'on' | 'disabled' | 'off' {
  const key = legendFindKey(lg, s);
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
 * 传奇英雄面板（预选·带传奇）：外形沿用神器卡（`.card`）。
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
  if (lg.count > 0 || lg.countCap !== undefined) {
    const count = el('span', 'badge badge-count');
    count.textContent = lg.countCap ? `计数 ${lg.count}/${lg.countCap}` : `计数 ${lg.count}`;
    head.appendChild(count);
  }
  box.appendChild(head);

  // 面板图＝黑底板（同选择界面迷你头像规则：底色 #000、显示框 787:756＝满高740+上下各8px、图垂直居中、超出裁掉、无圆角）
  const art = el('div', 'card-legend-art');
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
  attachDetailTrigger(art, ctx, lg.id);
  attachDetailTrigger(head, ctx, lg.id);

  const text = LEGEND_TEXT[lg.id];
  if (text && text.skills.length) {
    const skills = el('div', `skills${ctx.prefs.showSkillText ? '' : ' skills--inline'}`);
    const groups = new Map<string, typeof text.skills>();
    for (const s of text.skills) {
      const g = groups.get(s.name);
      if (g) g.push(s);
      else groups.set(s.name, [s]);
    }
    for (const [groupName, parts] of groups) {
      const skillBox = el('div', 'skill');
      for (const s of parts) {
        const state = legendSkillState(ctx, player, lg, s);
        const cls =
          state === 'on' ? 'skill-part--on' : state === 'disabled' ? 'skill-part--disabled' : 'skill-part--off';
        const part = el('div', `skill-part ${cls}`);
        const key = legendFindKey(lg, s);
        if (key) part.dataset.key = key;
        const pHead = el('div', 'skill-part-head');
        const badge = el('span', 'skill-type');
        badge.textContent = s.type;
        pHead.appendChild(badge);
        const nameEl = el('span', 'skill-name');
        nameEl.textContent = groupName;
        pHead.appendChild(nameEl);
        if (ctx.prefs.showSkillText) {
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
        if (action && isActivatableType(s.type) && state === 'on') {
          part.classList.add('clickable');
          part.dataset.act = 'skill';
          part.title = '点击发动技能';
          const k2 = key;
          part.addEventListener('click', () => {
            if (k2 && SKILL_SELECTION[k2]) startSkillSelection(ctx, action, k2);
            else ctx.hooks.propose(action, `发动「${groupName}」`);
          });
        }
        skillBox.appendChild(part);
      }
      skills.appendChild(skillBox);
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
  const ap = ctx.areaPick;
  const areaPickable = ap != null && ap.owner === player.id && ap.kinds.includes(kind);

  for (const d of player.areas[kind]) {
    const die = el('span', `die die-${player.id}`);
    die.dataset.id = d.id;
    die.dataset.value = String(d.value);
    die.textContent = String(d.value);

    if (ap) {
      // 选骰面板开启：仅“可选集合已确定”的骰区可点（与面板骰片共享同一选中状态）
      if (areaPickable && (!ap.filter || ap.filter(d))) {
        die.classList.add('clickable');
        die.title = '点击选择该骰';
        if (ap.isSelected(d.id)) die.classList.add('selected');
        die.addEventListener('click', () => ap.toggle(d));
      }
    } else if (ctx.slotsStepOpen || ctx.dustFlowOpen) {
      // 第一列技能分格面板 / 尘起支付面板开启时（可选集合取决于未做的选择），区域骰不可点
    } else if (ctx.selectionStep) {
      const step = ctx.selectionStep;
      if (step.kind === 'dice' && ctx.selectionOwner === player.id && step.areas.includes(kind)) {
        const selectable = !step.filter || step.filter(d);
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
      } else if (blockAction) {
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

/** 玩家面板：只保留骰区与神器卡（不显示「玩家A/B」归属标签——身份由生命值栏/面板边线呈现） */
function playerPanel(
  player: PlayerState,
  role: 'enemy' | 'self',
  mirrored: boolean,
  ctx: Ctx,
): HTMLElement {
  const panel = el('div', `player player--${role}`);
  panel.dataset.player = player.id;

  const cards = el('div', 'cards');
  // 镜像神器摆放：敌方面板按「列3、列2、列1」显示（左右互搏下随上下角色自动跟随）
  const flip = mirrored && ctx.prefs.mirrorEnemy;
  const artifacts = flip ? [...player.artifacts].reverse() : player.artifacts;
  for (const a of artifacts) cards.appendChild(artifactCard(a, ctx, player));

  // 骰区顺序恒为「敌方镜像」，与镜像开关无关
  const areas = el('div', 'areas');
  const order = mirrored ? AREA_ORDER_MIRRORED : AREA_ORDER;
  for (const k of order) areas.appendChild(areaBox(k, player, ctx));

  // 传奇英雄面板（预选·带传奇）：作为面板**直接子节点**、占第 1 列并纵跨两行
  // （我方顶端＝骰区行顶；敌方＝神器行顶，维持现状）；镜像神器摆放开启时翻到第 4 列
  if (player.legend) {
    panel.classList.add('player--legend');
    if (flip) panel.classList.add('player--legend-right');
    panel.appendChild(legendBox(player, ctx));
  }

  // 骰子区域贴近中央战场：敌人放在最下、自己放在最上（行序由 CSS 网格按角色指定）
  const seq: HTMLElement[] = role === 'enemy' ? [cards, areas] : [areas, cards];
  for (const node of seq) panel.appendChild(node);

  return panel;
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
    out.push({ text: `玩家${owner}「凛冽之音」生效中——任何玩家重掷能力骰后，被重掷方受到等量真实伤害`, color: owner });
  }
  // A07 异相·历王之血之印：本回合双方所有持续式效果失效（全回合、双方可见）
  if ((['A', 'B'] as PlayerId[]).some((id) => state.players[id].artifacts.some((a) => a.continuousLostThisTurn))) {
    out.push({ text: `${out.length ? '　｜　' : ''}「历王之血之印」生效中——本回合双方所有持续式效果失效` });
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
      { text: `玩家${pd.player}`, color: pd.player },
      { text: ` 必须消耗 1 颗能力骰（对方已消耗 ${pd.initiatorValue} 点）——随后比较双方消耗的能力骰点数大小；1 视为大于 6；请选择` },
    ];
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
      { text: `玩家${pd.owner}`, color: pd.owner },
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
        text: `（玩家${pd.player} 的「哀歌」）：玩家${pd.player} 刚使用了 1 个能力骰（${weiyaReasonCn(pd.reason)}），可令自己或对方的 1 颗能力骰点数变为 ${pd.value}（保留原区域）；请选择`,
      },
    ];
  }
  if (pd && pd.kind === 'xianzhenPick') {
    return [
      { text: '陷阵', color: pd.owner },
      {
        text: `（玩家${pd.owner} 的「哀歌」）：玩家${pd.owner} 的重掷阶段结束，由生命最少的一方（玩家${pd.player}）选择弃置 玩家${pd.owner} 的 1 颗能力骰；随后 玩家${pd.owner} 获得另外两类各 1 颗；请选择`,
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
    if (pa.sourceValue !== undefined) {
      parts.push({ text: `被 ${pa.sourceValue} 点攻击骰攻击，本次 ${pa.value} 伤害` });
    } else if (pa.sourceSkill) {
      // 技能发起的攻击：写明"由该技能引起"，并区分「持有者自己发起 / 他人因该效果发起」
      parts.push({ text: `玩家${pa.attacker}`, color: pa.attacker });
      parts.push({
        text:
          pa.sourceSkillOwner === pa.attacker
            ? `「${pa.sourceSkill}」发起攻击，本次 ${pa.value} 伤害（无攻击骰）`
            : ` 因对方「${pa.sourceSkill}」效果而发起攻击，本次 ${pa.value} 伤害（无攻击骰）`,
      });
    } else {
      parts.push({ text: `本次 ${pa.value} 伤害（技能攻击，无攻击骰）` });
    }
    if (bonus.value > 0) {
      parts.push({ text: `（${bonus.label ? `「${bonus.label}」` : ''}加成 ${bonus.value} 伤害）` });
    }
    if (pa.halveReason) parts.push({ text: `（「${pa.halveReason}」减半）` });
    if (pa.unblockable) parts.push({ text: '（不可抵挡）' });
    // 028 天罚：说明"受哪张卡影响、只能用哪类骰抵挡"
    if (pa.blockKind) {
      const skillName = pa.blockKind === 'meditation' ? '白昼之火' : '陨落';
      const kindCn = pa.blockKind === 'meditation' ? '冥想' : '攻击';
      parts.push({ text: `（受 ` });
      parts.push({ text: `玩家${pa.attacker}`, color: pa.attacker });
      parts.push({ text: ` 的「${skillName}」影响：只能用${kindCn}骰抵挡）` });
    }
    parts.push({ text: '；请选择' });
    return parts;
  }
  if (pd) {
    if (pd.kind === 'kuyu') {
      return [{ text: `（玩家${pd.player} 的「梦魇」）：主要阶段结束，请宣称 1 个能力骰类型；请选择` }];
    }
    if (pd.kind === 'tiaolingPick') {
      return [{ text: `（「凋零」）：玩家${pd.player} 回合结束，请择①全相同/②全不同并弃置自己的能力骰；请选择` }];
    }
    if (pd.kind === 'endDiscard') {
      return [{ text: `（玩家${pd.player}）：结束阶段，能力骰总数超出意志上限，请自行选择要弃置的能力骰；请选择` }];
    }
    if (pd.kind === 'wanzhangDiscard') {
      return [{ text: `（玩家${pd.player} 的「千劫」）：主要阶段开始，请弃置 2 个能力骰；请选择` }];
    }
    if (pd.kind === 'putiPick') {
      return [
        {
          text: `（玩家${pd.player} 的「金刚」）：对方${pd.mode === 'block' ? '用防御骰抵挡' : '使用了攻击骰'}——可移除神器上 ${pd.value} 点存放骰以取消其效果；请选择`,
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
    case 'dustRise':
      return [{ text: '尘起阶段：点卡上的尘起按钮，或结束该阶段（不行动会 +尘落）。' }];
    case 'main':
      return [{ text: '主要阶段：可启动技能、发动攻击（顺序不限）；完成后「结束回合」。' }];
    case 'gameOver':
      return [{ text: `游戏结束，胜者：${state.winner ?? '—'}。` }];
    default:
      return [];
  }
}

function actorOf(state: GameState): PlayerId {
  // 待决策**优先**：它才是当前必须做决定的人。
  // （026 威压这类待决策会与「待抵挡」同时存在，且决策人可能是**攻击方**——旧的先判 pendingAttack 会把它算成防守方）
  if (state.pending) return state.pending.player;
  if (state.pendingAttack) return state.pendingAttack.attacker === 'A' ? 'B' : 'A';
  return state.activePlayer;
}

function hintBox(ctx: Ctx): HTMLElement {
  const hint = el('div', 'hint');
  const left = el('div', 'hint-left');
  const actor = actorOf(ctx.state);
  const turn = el('span', 'hint-turn');
  turn.appendChild(document.createTextNode('轮到 '));
  const who = el('span', `hint-player player-${actor}`);
  who.textContent = `玩家${actor}`;
  turn.appendChild(who);
  turn.appendChild(document.createTextNode(' 操作'));
  // 待决策属于非当前玩家（跨回合强制触发，如 018 强制必杀 / 017 帷幕）→ 明确标注
  if (ctx.state.pending && ctx.state.pending.player !== ctx.state.activePlayer) {
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
      const skill = el('span', `hint-skill player-${actor}`);
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
  // 尘落计数：操作栏右上角（零额外高度）
  const dust = el('span', 'hint-dust');
  dust.textContent = `尘落 ${ctx.state.dustfall} / 10`;
  hint.appendChild(dust);
  return hint;
}

/** 中央操作区：把「轮到谁 + 阶段提示」与下方的操作栏合并为一块 */
function actionZone(ctx: Ctx): HTMLElement {
  const zone = el('div', 'actionzone');
  zone.appendChild(hintBox(ctx));
  const ui = ctx.hooks.ui;
  if (ui.convertPick) {
    zone.appendChild(convertPickPanel(ctx));
  } else if (ui.quanzhi) {
    zone.appendChild(quanzhiPanel(ctx));
  } else if (ui.fengmangPick && ui.pendingConfirm == null) {
    zone.appendChild(fengmangPanel(ctx));
  } else if (ui.dustFlow) {
    zone.appendChild(dustFlowView(ctx));
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

/** 双方生命（两行；顺序与面板一致：上=敌方、下=自己 → 回合切换时上下掉转） */
function vitalsBar(ctx: Ctx): HTMLElement {
  const { state } = ctx;
  // 与玩家面板一致：以「现在轮到谁」（actorOf：待决策玩家优先）为"自己"的视角 → 上下顺序随之一致
  const selfId: PlayerId = actorOf(state);
  const enemyId: PlayerId = selfId === 'A' ? 'B' : 'A';
  const bar = el('div', 'vitals');
  for (const pid of [enemyId, selfId]) {
    const p = state.players[pid];
    const item = el('div', `vitals-item vitals-${pid}`);
    const dot = el('span', `dot dot-${pid}`);
    item.appendChild(dot);
    const who = el('span', 'vitals-who');
    who.textContent = `玩家${pid}`;
    item.appendChild(who);
    const hp = el('span', `vitals-life life-${pid}`);
    hp.textContent = `生命 ${p.life}/${p.lifeMax}`;
    item.appendChild(hp);
    bar.appendChild(item);
  }
  return bar;
}

function confirmRow(ctx: Ctx): HTMLElement | null {
  const pc = ctx.hooks.ui.pendingConfirm;
  if (!pc) return null;
  const row = el('div', 'confirm-row');

  const label = el('span', 'confirm-label');
  label.textContent = `${pc.label}？`;
  row.appendChild(label);

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

function operationList(ctx: Ctx): HTMLElement {
  const box = el('div', 'actionlist');

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
  if (state.pendingAttack && !state.pendingAttack.unblockable) {
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
    // 「真实之剑」(010) 置换入口：给 009 高塔铁幕·触发 / 011 灵能屏障·触发 / 023 畏惧·对方 的「消耗 1 颗」加「2 颗顶 1」
    if (
      (a.t === 'guwangCancel' || a.t === 'dunwuHalve' || a.t === 'weijuPay') &&
      hasSword(ctx.state, actorOf(ctx.state))
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
  for (const g of groups.values()) box.appendChild(actionChipRow(ctx, g.parts, g.items));
  for (const a of plain) {
    const label = actionLabel(ctx, a);
    if (label === null) continue;
    box.appendChild(button(label, a, ctx.hooks));
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
      if (!step.filter || step.filter(d)) {
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
        if (!step.filter || step.filter(hd)) {
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
  const panel = el('div', 'selector');
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
  actions.appendChild(cancel);

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
  ok.textContent = '确认';
  ok.disabled = !satisfied;
  ok.addEventListener('click', () => confirmSelection(ctx));
  actions.appendChild(ok);

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
        hooks.ui.selection = null;
        hooks.onAction({
          t: 'tiaolingResolve',
          pick: sel.options[0] === 'same' ? 'same' : 'diff',
          dieIds: sel.chosenDice[1] ?? [],
        });
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
    hooks.propose(action, skillActionLabel(ctx, action));
  }
  hooks.requestRender();
}

function logLines(box: HTMLElement, entries: GameState['log']): void {
  if (entries.length === 0) {
    box.textContent = '（暂无记录）';
    return;
  }
  for (const entry of entries) {
    const line = el('div', 'log-line');
    line.textContent = `T${entry.turn}·${PHASE_LABEL[entry.phase]}：${entry.text}`;
    box.appendChild(line);
  }
}

function logPanel(ctx: Ctx, zoomable = false): HTMLElement {
  const box = el('div', 'log');
  // 右键 → 战报放大弹窗（更大的空间看全量战报）
  if (zoomable) {
    box.classList.add('log--zoomable');
    box.title = '右键放大战报';
    box.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      ctx.hooks.ui.logPop = true;
      ctx.hooks.requestRender();
    });
  }
  logLines(box, ctx.state.log.slice(-30).reverse());
  return box;
}

/** 战报放大弹窗：全量战报、大空间（右键战报栏打开；点空白或 ✕ 关闭） */
function logPopModal(ctx: Ctx): HTMLElement {
  const overlay = el('div', 'logpop-overlay');
  const modal = el('div', 'logpop-modal');
  const head = el('div', 'logpop-head');
  const title = el('div', 'logpop-title');
  title.textContent = '战报';
  head.appendChild(title);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-cancel';
  close.dataset.act = 'logPopClose';
  close.textContent = '✕';
  close.addEventListener('click', () => {
    ctx.hooks.ui.logPop = false;
    ctx.hooks.requestRender();
  });
  head.appendChild(close);
  modal.appendChild(head);
  const body = el('div', 'log log--pop');
  logLines(body, [...ctx.state.log].reverse());
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

function gameOverModal(ctx: Ctx): HTMLElement {
  const { state, hooks } = ctx;
  const overlay = el('div', 'gameover-overlay');
  const modal = el('div', 'gameover-modal');

  const title = el('div', 'gameover-title');
  title.textContent = '游戏结束';
  modal.appendChild(title);

  const winner = el('div', 'gameover-winner');
  winner.textContent = state.winner ? `玩家${state.winner} 获胜！` : '平局';
  modal.appendChild(winner);

  const reason = el('div', 'gameover-reason');
  reason.textContent = state.dustfall >= 10 ? '尘落达到 10（生命更高者胜）' : '对方生命归零';
  modal.appendChild(reason);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn setup-start gameover-restart';
  btn.textContent = '重新开始游戏';
  btn.addEventListener('click', () => hooks.onRestart());
  modal.appendChild(btn);

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

function findArtifactAnywhere(state: GameState, id: string): { art: Artifact; owner: PlayerId } | null {
  for (const pid of ['A', 'B'] as PlayerId[]) {
    const art = state.players[pid].artifacts.find((a) => a.id === id);
    if (art) return { art, owner: pid };
    const lg = state.players[pid].legend;
    if (lg && lg.id === id) return { art: legendAsArtifact(lg), owner: pid };
  }
  return null;
}

/** 卡图上的“查看技能详情”触发：点击 或 长按（手机友好） */
function attachDetailTrigger(node: HTMLElement, ctx: Ctx, artifactId: string): void {
  node.classList.add('detail-trigger');
  node.title = '点击 / 长按查看技能详情';
  const open = (): void => {
    const r = node.getBoundingClientRect();
    ctx.hooks.ui.detail = {
      artifactId,
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
  node.addEventListener('click', open);
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
  applyPrefs(ctx, applyPreset(id));
}

function resetPrefs(ctx: Ctx): void {
  applyPrefs(ctx, clonePrefs(DEFAULT_PREFS));
}

/** 设置面板（左上角「设置」按钮打开） */
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

  const row = (label: string, opts: { text: string; on: boolean; onClick: () => void }[]): void => {
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
      b.addEventListener('click', o.onClick);
      wrap.appendChild(b);
    }
    r.appendChild(wrap);
    box.appendChild(r);
  };

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
    { text: '显示', on: !ui.prefs.logCollapsed, onClick: () => setPref(ctx, 'logCollapsed', false) },
    { text: '收起', on: ui.prefs.logCollapsed, onClick: () => setPref(ctx, 'logCollapsed', true) },
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
        setPref(ctx, 'zoomPercent', Math.min(100, Math.max(50, ui.prefs.zoomPercent + delta))),
      );
      wrap.appendChild(b);
    };
    mk('缩小', -5);
    mk('放大', +5);
    r.appendChild(wrap);
    box.appendChild(r);
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

/** 战报抽屉：从左侧滑出，点空白处关闭（窄屏或战报收起时使用） */
function logDrawer(ctx: Ctx): HTMLElement {
  const overlay = el('div', 'log-overlay');
  const panel = el('div', 'log-drawer');
  const head = el('div', 'log-drawer-head');
  const set = document.createElement('button');
  set.type = 'button';
  set.className = 'btn btn-settings';
  set.dataset.act = 'drawerSettingsOpen';
  set.textContent = '设置';
  set.addEventListener('click', () => {
    ctx.hooks.ui.logOpen = false;
    ctx.hooks.ui.settingsOpen = true;
    ctx.hooks.requestRender();
  });
  head.appendChild(set);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-cancel';
  close.dataset.act = 'logClose';
  close.textContent = '✕';
  close.addEventListener('click', () => {
    ctx.hooks.ui.logOpen = false;
    ctx.hooks.requestRender();
  });
  head.appendChild(close);
  panel.appendChild(head);
  panel.appendChild(logPanel(ctx));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      ctx.hooks.ui.logOpen = false;
      ctx.hooks.requestRender();
    }
  });
  overlay.appendChild(panel);
  return overlay;
}

function detailSkillList(ctx: Ctx, art: Artifact): HTMLElement {
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
  return box;
}

/** 只读技能详情浮窗：锚定触发卡片，内部可滚动 */
function detailPopover(ctx: Ctx): HTMLElement | null {
  const d = ctx.hooks.ui.detail;
  if (!d) return null;
  const found = findArtifactAnywhere(ctx.state, d.artifactId);
  if (!found) return null;
  const { art } = found;
  const isLegend = /^L\d{2}$/.test(art.id);
  const ui = ctx.hooks.ui;

  const overlay = el('div', 'detail-overlay');
  const box = el('div', 'detail-popover');
  box.dataset.artifact = art.id;

  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;
  // 窄屏（手机）：改为底部抽屉形态，交由 CSS 定位
  const narrow = vw > 0 && vw < 720;
  if (narrow) {
    box.classList.add('detail-popover--sheet');
  } else {
    const W = Math.min(340, Math.max(220, vw - 24));
    let left = d.rect.left + d.rect.width + 8;
    if (left + W > vw - 8) left = d.rect.left - W - 8;
    left = Math.max(8, Math.min(left, vw - W - 8));
    const top = Math.max(8, Math.min(d.rect.top, vh - 120));
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.width = `${W}px`;
    box.style.maxHeight = `${Math.max(160, vh - top - 16)}px`;
  }

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
  box.appendChild(detailSkillList(ctx, art));

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      ui.detail = null;
      ctx.hooks.requestRender();
    }
  });
  overlay.appendChild(box);
  return overlay;
}

function convertAvailable(state: GameState, payer: PlayerId): boolean {
  if (!hasActiveSkill(state.players[payer], 'shenhong.sword')) return false;
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
  for (const side of ['left', 'right'] as const) {
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
        die.addEventListener('click', () => {
          const pick = flow.convertPick;
          if (!pick) return;
          const i = pick.indexOf(d.id);
          if (i >= 0) pick.splice(i, 1);
          else if (pick.length < 2) pick.push(d.id);
          if (pick.length === 2) {
            dispatchDustPay(ctx, [...pick]);
            return;
          }
          ctx.hooks.requestRender();
        });
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
      die.classList.add('clickable');
      die.addEventListener('click', () => dispatchDustPay(ctx, [d.id]));
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

export function renderGame(state: GameState, root: HTMLElement, hooks: RenderHooks): void {
  root.classList.remove('setup-page'); // 离开设置页 → 恢复普通背景
  const legal = getLegalActions(state);
  const selfId: PlayerId = actorOf(state);
  const enemyId: PlayerId = oppOf(selfId);

  const rerollAction = legal.find((a): a is Extract<Action, { t: 'reroll' }> => a.t === 'reroll');
  const maxReroll = rerollAction?.dieIds.length ?? 0;

  // 预选·带传奇：中段改为 [设置+战报][快速操作栏][双方生命值]，并移除左侧栏（腾出的宽度用于传奇框）
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

  // 贴边按钮组（战报栏收起 / 窄屏时可见）：设置 + 战报
  const edgeBar = el('div', 'edge-bar');
  const edgeSettings = document.createElement('button');
  edgeSettings.type = 'button';
  edgeSettings.className = 'btn edge-btn';
  edgeSettings.dataset.act = 'edgeSettingsOpen';
  edgeSettings.textContent = '设置';
  edgeSettings.addEventListener('click', () => {
    hooks.ui.settingsOpen = true;
    hooks.requestRender();
  });
  edgeBar.appendChild(edgeSettings);
  const edgeLog = document.createElement('button');
  edgeLog.type = 'button';
  edgeLog.className = 'btn edge-btn';
  edgeLog.dataset.act = 'logOpen';
  edgeLog.textContent = '战报';
  edgeLog.addEventListener('click', () => {
    hooks.ui.logOpen = true;
    hooks.requestRender();
  });
  edgeBar.appendChild(edgeLog);
  app.appendChild(edgeBar);

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

  // 左栏（非传奇模式）：设置 + 战报
  if (!legendMode) {
    const sidebar = el('div', 'sidebar');
    const sidebarHead = el('div', 'sidebar-head');
    sidebarHead.appendChild(settingsBtn);
    sidebar.appendChild(sidebarHead);
    sidebar.appendChild(logPanel(ctx, true));
    app.appendChild(sidebar);
  }

  // 主栏：敌方 / 中央操作区 / 自己
  const main = el('div', 'main');
  main.appendChild(playerPanel(state.players[enemyId], 'enemy', true, ctx));

  const centerband = el('div', 'centerband');
  // 传奇模式：中段最左格 = 设置 + 战报（内置滚动）
  if (legendMode) {
    const logcell = el('div', 'centerband-log');
    const logHead = el('div', 'centerband-log-head');
    logHead.appendChild(settingsBtn);
    logcell.appendChild(logHead);
    logcell.appendChild(logPanel(ctx, true));
    centerband.appendChild(logcell);
  }
  const left = el('div', 'centerband-left');
  left.appendChild(actionZone(ctx));
  centerband.appendChild(left);

  const right = el('div', 'centerband-right');
  right.appendChild(vitalsBar(ctx));
  centerband.appendChild(right);

  main.appendChild(centerband);
  main.appendChild(playerPanel(state.players[selfId], 'self', false, ctx));
  app.appendChild(main);

  stage.appendChild(app);
  root.appendChild(stage);

  if (state.phase === 'gameOver') {
    root.appendChild(gameOverModal(ctx));
  }
  if (hooks.ui.settingsOpen) {
    root.appendChild(settingsPanel(ctx));
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
    const k = Math.min(1, Math.max(0.5, prefs.zoomPercent / 100));
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
