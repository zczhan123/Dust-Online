import type {
  Action,
  Artifact,
  DiceKind,
  Die,
  GameState,
  Phase,
  PlayerId,
  PlayerState,
  SkillDef,
} from '../core/model/types';
import { ARTIFACT_TEXT } from '../core/content/artifactText';
import { getLegalActions } from '../core/engine/game';
import { hasActiveSkill } from '../core/engine/skill-state';
import { SKILL_SELECTION, type SelectStep } from './skillSelection';
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
  };
  pendingConfirm: null | { action: Action; label: string };
  /** 尘起 2 步流程：选择（激活时）启动侧 → 支付代价 */
  dustFlow: null | {
    artifactId: string;
    kind: 'activate' | 'switch' | 'charge';
    side?: 'left' | 'right';
    step: 'side' | 'pay';
    /** 「真实之剑」置换：已选中的 2 颗能力骰 */
    convertPick?: string[];
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
  /** 界面偏好（与对局状态解耦；由宿主负责持久化） */
  prefs: Prefs;
  /** 设置面板是否打开 */
  settingsOpen: boolean;
  /** 战报抽屉是否打开（战报栏收起时用） */
  logOpen: boolean;
  /** 技能详情浮窗（只读）：锚定触发卡片的屏幕矩形 */
  detail: null | {
    artifactId: string;
    rect: { left: number; top: number; width: number; height: number };
  };
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
  return undefined;
}

function dieValue(state: GameState, id: unknown): number | undefined {
  return typeof id === 'string' ? findDie(state, id)?.value : undefined;
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

/** 激活侧是否为「激活」类技能、且当前已不可用（用于「已激活·xx」徽标变灰） */
function activeSideSpent(ctx: Ctx, a: Artifact): boolean {
  const side = a.activeMarkerSide;
  if (!side) return false;
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
function skillPartState(
  ctx: Ctx,
  a: Artifact,
  s: { side: SkillDef['side']; type: string },
): 'on' | 'off' | 'disabled' | 'spent' {
  const key = findSkillKey(a, s.side, s.type);
  const markerOk = a.activeMarkerSide != null && (s.side === a.activeMarkerSide || s.side === 'only');
  if (key != null && s.type.includes('必杀') && ctx.state.ultimatesUsed.includes(key)) return 'disabled';
  if (key === 'buxiang.cuilian' && a.count >= 3) return 'disabled';
  if (a.column === 3 && s.type.includes('充能') && a.chargeLayer >= (a.chargeReq ?? 0)) return 'disabled';
  // 「激活」类：只有被“切入该侧”的当回合、且本回合未用过时才可用；否则为“已用完”（灰底 + 保留绿色左边线）
  if (s.type.includes('激活') && markerOk) {
    const armedNow =
      a.armedTurn === ctx.state.turnIndex && a.armedSide === (s.side === 'only' ? 'left' : s.side);
    const used = key != null && ctx.state.skillsUsedThisTurn.includes(key);
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

function dustEntryLabel(a: Artifact): string {
  return `${DUST_KIND_LABEL[dustFlowKind(a)]}「${a.name}」`;
}

function skillName(state: GameState, a: SkillAction): string {
  const art = state.players[state.activePlayer].artifacts.find((x) => x.id === a.artifactId);
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

function skillActionLabel(ctx: Ctx, a: SkillAction): string {
  const name = skillName(ctx.state, a);
  const params = a.params ?? {};
  const parts: string[] = [];

  if (Array.isArray(params.costSlots) && params.costSlots.length) {
    const fills = params.costSlots as { dieIds?: string[] }[];
    const converted = fills.filter((f) => (f.dieIds ?? []).length > 1).length;
    const art = ctx.state.players[ctx.state.activePlayer].artifacts.find((x) => x.id === a.artifactId);
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
    const x = typeof params.x === 'number' ? `，X=${params.x}` : '';
    parts.push(v !== undefined ? `降低 1 颗骰（${v}点）${x}` : '降低骰子点数');
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

function startSkillSelection(ctx: Ctx, action: SkillAction, key: string): void {
  const spec = SKILL_SELECTION[key];
  if (spec) {
    const player = ctx.state.activePlayer;
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
  };
  ctx.hooks.requestRender();
}

function openDustFlow(ctx: Ctx, a: Artifact): void {
  const kind = dustFlowKind(a);
  ctx.hooks.ui.dustFlow = {
    artifactId: a.id,
    kind,
    step: kind === 'activate' ? 'side' : 'pay',
  };
  ctx.hooks.requestRender();
}

function artifactCard(a: Artifact, ctx: Ctx): HTMLElement {
  const card = el('div', 'card');
  card.dataset.artifact = a.id;

  const head = el('div', 'card-head');
  const name = el('span', 'card-name');
  name.textContent = a.weapon ? `${a.name}（${a.weapon}）` : a.name;
  head.appendChild(name);

  const subs: string[] = [`第${a.column}列`];
  if (a.speed !== undefined) subs.push(`速度 ${a.speed}`);
  if (a.will !== undefined) subs.push(`意志 ${a.will}`);
  if (a.life !== undefined) subs.push(`生命 ${a.life}`);
  if (a.chargeReq !== undefined) subs.push(`充能需求 ${a.chargeReq}`);
  if (a.distribution) {
    subs.push(
      `分布 防${a.distribution.defense.join('/')} 攻${a.distribution.attack.join('/')} 冥${a.distribution.meditation.join('/')}`,
    );
  }
  const sub = el('span', 'card-sub');
  sub.textContent = subs.join('　');
  head.appendChild(sub);

  if (a.activeMarkerSide) {
    const act = el('span', 'badge badge-active');
    const activeName =
      sideDisplayName(a, a.activeMarkerSide) ?? sideDisplayName(a, 'only') ?? a.name;
    act.textContent = `已激活·${activeName}`;
    if (activeSideSpent(ctx, a)) act.classList.add('badge-active--spent');
    head.appendChild(act);
  }
  if (a.chargeReq !== undefined) {
    const charge = el('span', 'badge badge-charge');
    const full = a.chargeLayer >= a.chargeReq;
    charge.textContent = full
      ? `充能 ${a.chargeLayer}/${a.chargeReq}（已满）`
      : `充能 ${a.chargeLayer}/${a.chargeReq}`;
    if (full) charge.classList.add('badge-charge--full');
    head.appendChild(charge);
  }
  if (a.count > 0) {
    const count = el('span', 'badge badge-count');
    count.textContent = `计数 ${a.count}`;
    head.appendChild(count);
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
          key != null && s.type.includes('必杀') && ctx.state.ultimatesUsed.includes(key);
        if (isUsedUltimate) part.classList.add('skill-part--used');

        const isFull = key === 'buxiang.cuilian' && a.count >= 3;
        if (isFull) part.classList.add('skill-part--full');

        const pHead = el('div', 'skill-part-head');
        const badge = el('span', 'skill-type');
        badge.textContent = s.type;
        pHead.appendChild(badge);
        // 技能名与类型徽标同行（隐藏描述时这就是那一行的主体，也是点击发动的目标）
        const nameEl = el('span', 'skill-name');
        nameEl.textContent = groupName;
        pHead.appendChild(nameEl);
        if (isUsedUltimate) {
          const used = el('span', 'badge badge-used');
          used.textContent = '已使用';
          pHead.appendChild(used);
        }
        if (isFull) {
          const full = el('span', 'badge badge-full');
          full.textContent = '已满';
          pHead.appendChild(full);
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
        if (skillAction && isActivatableType(s.type) && !isUsedUltimate && !isFull) {
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

/** 玩家面板：只保留骰区与神器卡（不再显示「玩家A/B」头部——身份由生命值栏呈现） */
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
  const artifacts =
    mirrored && ctx.prefs.mirrorEnemy ? [...player.artifacts].reverse() : player.artifacts;
  for (const a of artifacts) cards.appendChild(artifactCard(a, ctx));

  const areas = el('div', 'areas');
  const order = mirrored ? AREA_ORDER_MIRRORED : AREA_ORDER;
  for (const k of order) areas.appendChild(areaBox(k, player, ctx));

  // 骰子区域贴近中央战场：敌人放在最下、自己放在最上
  const seq: HTMLElement[] = role === 'enemy' ? [cards, areas] : [areas, cards];
  for (const node of seq) panel.appendChild(node);

  return panel;
}

/** 提示栏分段：color = 用该玩家配色高亮（用于技能名） */
interface HintPart {
  text: string;
  color?: PlayerId;
}

function phaseHint(ctx: Ctx): HintPart[] {
  const { state } = ctx;
  const pd = state.pending;
  if (pd && pd.kind === 'caiyuliu') {
    return [{ text: '裁雨流', color: pd.player }, { text: '：选择该骰去向。' }];
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
  if (state.pendingAttack) {
    return [{ text: '对方可抵挡：在操作列表选「抵挡：用 X 点防御骰」或「不抵挡」。' }];
  }
  switch (state.phase) {
    case 'initialReroll':
      return [{ text: '初始重掷：可点选任意数量的骰子后点「重掷选中」，或点「跳过」。' }];
    case 'reroll':
      return [{ text: '重掷阶段：点击你的骰子选择，再点「重掷选中」；或跳过。' }];
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
  if (state.pendingAttack) return state.pendingAttack.attacker === 'A' ? 'B' : 'A';
  if (state.pending) return state.pending.player;
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
  const selfId: PlayerId = state.activePlayer;
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
  const segs = actionDieSegments(ctx, a);
  if (segs) return segsToText(ctx, segs);
  const { state } = ctx;
  switch (a.t) {
    case 'advance':
      return advanceLabel(state.phase);
    case 'block':
      return '不抵挡';
    case 'dustRise': {
      const art = state.players[state.activePlayer].artifacts.find((x) => x.id === a.artifactId);
      return art ? dustEntryLabel(art) : '尘起';
    }
    case 'caiyuliu':
      return a.to === 'defense' ? '移到防御骰区' : a.to === 'meditation' ? '移到冥想骰区' : '不移动';
    case 'guwangCharge':
      return '不变更';
    case 'guwangCancel':
      return '承受伤害';
    case 'dunwuHalve':
      return '不减半';
    case 'fengmang': {
      if (!a.accept) return '不发动';
      const pd = state.pending;
      const pp = pd && pd.kind === 'fengmang' ? state.players[pd.player] : state.players[state.activePlayer];
      const av = pp.areas.attack.find((d) => d.id === a.attackDieId)?.value ?? '?';
      const mv = pp.areas.meditation.find((d) => d.id === a.meditationDieId)?.value ?? '?';
      return `发动（消耗 攻击${av} 与 冥想${mv}）`;
    }
    case 'shenhongKill':
      return a.accept ? '发动杀意（3 真伤 + 回2）' : '不发动';
    case 'leibaoReroll':
      return a.accept ? '发动「雷暴」进行额外重掷' : '不发动「雷暴」';
    case 'dunwuPulse': {
      const pd = state.pending;
      const amount = pd && pd.kind === 'dunwuPulse' ? pd.amount : 0;
      return a.accept ? `发动脉冲（${amount} 点真实伤害）` : '不发动';
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
  const key = a.t === 'skill'
    ? state.players[state.activePlayer].artifacts
        .find((x) => x.id === a.artifactId)
        ?.skills.find((s) => s.side === a.side && (s.kind === 'activate' || s.kind === 'ultimate'))
        ?.key
    : undefined;
  const name = skillName(state, a);
  if (key && SKILL_SELECTION[key]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-skill';
    b.dataset.act = 'skill';
    b.textContent = `启动技能：${name}`;
    b.addEventListener('click', () => startSkillSelection(ctx, a, key));
    return b;
  }
  return button(`启动技能：${name}`, a, hooks, 'btn-skill');
}

function rerollButton(ctx: Ctx): HTMLButtonElement | null {
  const reroll = ctx.legal.find((x): x is Extract<Action, { t: 'reroll' }> => x.t === 'reroll');
  if (!reroll) return null;
  const count = ctx.hooks.ui.rerollSelected.size;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-reroll';
  b.dataset.act = 'reroll';
  b.textContent = `重掷选中(${count})`;
  b.disabled = count === 0;
  b.addEventListener('click', () => {
    const n = ctx.hooks.ui.rerollSelected.size;
    if (n === 0) return;
    ctx.hooks.propose(
      { t: 'reroll', dieIds: [...ctx.hooks.ui.rerollSelected] },
      `重掷 ${n} 颗`,
    );
  });
  return b;
}

function dustEntryButton(ctx: Ctx, a: Artifact): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-dust';
  b.dataset.act = 'dustRise';
  b.dataset.artifact = a.id;
  b.textContent = dustEntryLabel(a);
  b.addEventListener('click', () => openDustFlow(ctx, a));
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
      return { parts: ['取消（消耗 ', '）'], dice: [{ id: a.defenseDieId, owner }] };
    }
    case 'dunwuHalve': {
      if (!a.accept || !a.meditationDieId) return null;
      const pd = state.pending;
      const owner: PlayerId = pd && pd.kind === 'dunwuHalve' ? pd.player : state.activePlayer;
      return { parts: ['伤害减半（消耗 ', '）'], dice: [{ id: a.meditationDieId, owner }] };
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
  items.forEach(({ a, die }, i) => {
    const d = findDie(ctx.state, die.id);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `pay-die clickable die-${die.owner}`;
    chip.dataset.id = die.id;
    chip.dataset.act = a.t;
    chip.textContent = d ? `${KIND_SHORT[d.kind]}${d.value}` : '?';
    chip.addEventListener('click', () => ctx.hooks.propose(a, actionLabel(ctx, a) ?? ''));
    row.appendChild(chip);
    const tail = parts[i + 1] ?? '';
    if (tail) {
      const t = el('span', 'chip-label');
      t.textContent = tail;
      row.appendChild(t);
    }
  });
  return row;
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
  const groups = new Map<string, { parts: string[]; items: { a: Action; die: DieSeg }[] }>();
  const plain: Action[] = [];
  for (const a of ctx.legal) {
    if (a.t === 'reroll') continue;
    if (a.t === 'skill') {
      const sig = `${a.artifactId}:${a.side}`;
      if (seenSkill.has(sig)) continue;
      seenSkill.add(sig);
      box.appendChild(skillButton(ctx, a));
      continue;
    }
    if (a.t === 'dustRise') {
      if (seenDust.has(a.artifactId)) continue;
      seenDust.add(a.artifactId);
      const art = state.players[state.activePlayer].artifacts.find((x) => x.id === a.artifactId);
      if (art) box.appendChild(dustEntryButton(ctx, art));
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

  const payer = state.players[state.activePlayer];
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
  const ownerId = step.owner === 'self' ? ctx.state.activePlayer : oppOf(ctx.state.activePlayer);
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
  return box;
}

function chooserPanel(ctx: Ctx): HTMLElement | null {
  const sel: ActiveSelection | null = ctx.hooks.ui.selection;
  if (!sel) return null;
  const spec = SKILL_SELECTION[sel.key];
  if (!spec) return null;
  const { state, hooks } = ctx;
  const steps = spec.steps({ state, player: state.activePlayer, chosenDice: sel.chosenDice, options: sel.options, numbers: sel.numbers, slots: sel.slots });
  const step = steps[sel.stepIndex];
  const panel = el('div', 'selector');
  if (!step) return panel;

  const head = el('div', 'selector-head');
  const title = el('div', 'selector-title');
  title.textContent = `步骤 ${sel.stepIndex + 1}/${steps.length} · ${step.label}`;
  head.appendChild(title);

  if (step.kind === 'dice') {
    const info = el('div', 'selector-info');
    info.textContent = `已选 ${sel.currentSel.size}（需 ${step.min}–${step.max} 颗）`;
    head.appendChild(info);
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
    satisfied = sel.currentSel.size >= step.min && sel.currentSel.size <= step.max;
  } else if (step.kind === 'option') {
    satisfied = step.options.some((o) => o.value === sel.options[sel.stepIndex]);
  } else if (step.kind === 'slots') {
    satisfied = allSelSlotsFilled(sel, step);
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
  const player = state.activePlayer;
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
  }
  sel.stepIndex += 1;

  const nextSteps = spec.steps({ state, player, chosenDice: sel.chosenDice, options: sel.options, numbers: sel.numbers, slots: sel.slots });
  if (sel.stepIndex >= nextSteps.length) {
    const numberIdx = nextSteps
      .map((s, i) => (s.kind === 'number' ? i : -1))
      .filter((i) => i >= 0);
    const numbers = numberIdx.map((i) => sel.numbers[i]);
    const params = spec.buildParams({ state, player, chosenDice: sel.chosenDice, options: sel.options, numbers, slots: sel.slots });
    const action: SkillAction = { t: 'skill', artifactId: sel.artifactId, side: sel.side, params };
    hooks.ui.selection = null;
    hooks.propose(action, skillActionLabel(ctx, action));
  }
  hooks.requestRender();
}

function logPanel(ctx: Ctx): HTMLElement {
  const box = el('div', 'log');
  const recent = ctx.state.log.slice(-30).reverse();
  if (recent.length === 0) {
    box.textContent = '（暂无记录）';
  } else {
    for (const entry of recent) {
      const line = el('div', 'log-line');
      line.textContent = `T${entry.turn}·${PHASE_LABEL[entry.phase]}：${entry.text}`;
      box.appendChild(line);
    }
  }
  return box;
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
function findArtifactAnywhere(state: GameState, id: string): { art: Artifact; owner: PlayerId } | null {
  for (const pid of ['A', 'B'] as PlayerId[]) {
    const art = state.players[pid].artifacts.find((a) => a.id === id);
    if (art) return { art, owner: pid };
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

/** 设置面板（左上角 ⚙ 打开） */
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
  set.textContent = '⚙ 设置';
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

function detailSummary(art: Artifact): string {
  const parts: string[] = [`第${art.column}列`];
  if (art.speed !== undefined) parts.push(`速度 ${art.speed}`);
  if (art.will !== undefined) parts.push(`意志 ${art.will}`);
  if (art.life !== undefined) parts.push(`生命 ${art.life}`);
  if (art.chargeReq !== undefined) parts.push(`充能 ${art.chargeLayer}/${art.chargeReq}`);
  if (art.count > 0) parts.push(`计数 ${art.count}`);
  return parts.join('　');
}

/** 浮窗里的技能全文（始终显示描述） */
function detailSkillList(ctx: Ctx, art: Artifact): HTMLElement {
  const box = el('div', 'skills');
  const text = ARTIFACT_TEXT[art.id];
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
      const st = skillPartState(ctx, art, s);
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
  title.textContent = `${art.name}${art.weapon ? `（${art.weapon}）` : ''}`;
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

  const sub = el('div', 'detail-sub');
  sub.textContent = detailSummary(art);
  box.appendChild(sub);

  if (art.activeMarkerSide) {
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

/** 置换选骰的付款方：抵挡时是防守方，否则是当前行动方 */
function convertPickOwner(state: GameState): PlayerId {
  if (state.pendingAttack) return state.pendingAttack.attacker === 'A' ? 'B' : 'A';
  return state.activePlayer;
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
    if (payer.areas.meditation.length === 0) {
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
  const payer = ctx.state.players[ctx.state.activePlayer];
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
  const legal = getLegalActions(state);
  const selfId: PlayerId = state.activePlayer;
  const enemyId: PlayerId = oppOf(selfId);

  const rerollAction = legal.find((a): a is Extract<Action, { t: 'reroll' }> => a.t === 'reroll');
  const maxReroll = rerollAction?.dieIds.length ?? 0;

  const sel = hooks.ui.selection;
  let selectionStep: SelectStep | null = null;
  let selectionOwner: PlayerId | null = null;
  let slotsStepOpen = false;
  if (sel && SKILL_SELECTION[sel.key]) {
    const steps = SKILL_SELECTION[sel.key].steps({
      state,
      player: state.activePlayer,
      chosenDice: sel.chosenDice,
      options: sel.options,
      numbers: sel.numbers,
      slots: sel.slots,
    });
    const step = steps[sel.stepIndex];
    if (step && step.kind === 'dice') {
      selectionStep = step;
      selectionOwner = step.owner === 'self' ? state.activePlayer : enemyId;
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
    `app density-${hooks.ui.prefs.density}${hooks.ui.prefs.logCollapsed ? ' log-collapsed' : ''}`,
  );

  // 贴边按钮组（战报栏收起 / 窄屏时可见）：设置 + 战报
  const edgeBar = el('div', 'edge-bar');
  const edgeSettings = document.createElement('button');
  edgeSettings.type = 'button';
  edgeSettings.className = 'btn edge-btn';
  edgeSettings.dataset.act = 'edgeSettingsOpen';
  edgeSettings.textContent = '⚙ 设置';
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

  // 左栏：设置 + 战报
  const sidebar = el('div', 'sidebar');
  const sidebarHead = el('div', 'sidebar-head');
  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'btn btn-settings';
  settingsBtn.dataset.act = 'settingsOpen';
  settingsBtn.textContent = '⚙ 设置';
  settingsBtn.addEventListener('click', () => {
    hooks.ui.settingsOpen = true;
    hooks.requestRender();
  });
  sidebarHead.appendChild(settingsBtn);
  sidebar.appendChild(sidebarHead);
  sidebar.appendChild(logPanel(ctx));
  app.appendChild(sidebar);

  // 主栏：敌方 / 中央操作区 / 自己
  const main = el('div', 'main');
  main.appendChild(playerPanel(state.players[enemyId], 'enemy', true, ctx));

  const centerband = el('div', 'centerband');
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
