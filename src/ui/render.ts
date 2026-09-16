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
}

export interface RenderHooks {
  onAction: (a: Action) => void;
  /** 提出一个待确认操作；由宿主写入 ui.pendingConfirm 后重绘 */
  propose: (action: Action, label: string) => void;
  ui: UiState;
  requestRender: () => void;
  onRestart: () => void;
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
  if (type.includes('启动')) return 'activate';
  if (type.includes('必杀')) return 'ultimate';
  if (type.includes('充能')) return 'charge';
  if (type.includes('持续')) return 'continuous';
  if (type.includes('触发')) return 'trigger';
  return undefined;
}

function isActivatableType(type: string): boolean {
  return type.includes('启动') || type.includes('必杀');
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

/** 该神器某侧显示名（不区分技能类型），用于名称兜底 */
function sideDisplayName(a: Artifact | undefined, side: 'left' | 'right' | 'only'): string | undefined {
  if (!a) return undefined;
  return ARTIFACT_TEXT[a.id]?.skills.find((s) => s.side === side)?.name;
}

/** 内部 key 形如 `wansha.ultimate`，绝不应出现在界面上 */
function looksLikeInternalKey(s: string): boolean {
  return /^[a-z0-9]+(\.[a-z0-9]+)+$/i.test(s.trim());
}

/** 单条技能行的展示状态：可用(绿) / 未激活(浅灰) / 不能再使用(深灰) */
function skillPartState(
  ctx: Ctx,
  a: Artifact,
  s: { side: SkillDef['side']; type: string },
): 'on' | 'off' | 'disabled' {
  const key = findSkillKey(a, s.side, s.type);
  const markerOk = a.activeMarkerSide != null && (s.side === a.activeMarkerSide || s.side === 'only');
  if (key != null && s.type.includes('必杀') && ctx.state.ultimatesUsed.includes(key)) return 'disabled';
  if (key === 'buxiang.cuilian' && a.count >= 3) return 'disabled';
  if (a.column === 3 && s.type.includes('充能') && a.chargeLayer >= (a.chargeReq ?? 0)) return 'disabled';
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

  const art = el('div', 'card-art');
  const artImg = document.createElement('img');
  artImg.className = 'card-art-img';
  artImg.src = `/cards/${a.id}.jpg`;
  artImg.alt = `${a.name}${a.weapon ? `（${a.weapon}）` : ''}`;
  artImg.addEventListener('error', () => {
    art.classList.add('card-art--missing');
    art.textContent = '（卡图占位）';
  });
  art.appendChild(artImg);
  card.appendChild(art);

  const text = ARTIFACT_TEXT[a.id];
  if (text) {
    const skills = el('div', 'skills');
    const groups = new Map<string, typeof text.skills>();
    for (const s of text.skills) {
      const existing = groups.get(s.name);
      if (existing) existing.push(s);
      else groups.set(s.name, [s]);
    }
    for (const [groupName, parts] of groups) {
      const box = el('div', 'skill');
      const sHead = el('div', 'skill-head');
      const sname = el('span', 'skill-name');
      sname.textContent = groupName;
      sHead.appendChild(sname);
      box.appendChild(sHead);

      for (const s of parts) {
        const pstate = skillPartState(ctx, a, s);
        const pcls =
          pstate === 'on'
            ? 'skill-part--on'
            : pstate === 'disabled'
              ? 'skill-part--disabled'
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
        const body = el('div', 'skill-text');
        body.textContent = s.text;
        pHead.appendChild(body);
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

  return box;
}

function playerPanel(
  player: PlayerState,
  role: 'enemy' | 'self',
  mirrored: boolean,
  ctx: Ctx,
): HTMLElement {
  const panel = el('div', `player player--${role}`);
  panel.dataset.player = player.id;

  const header = el('div', 'player-header');
  const dot = el('span', `dot dot-${player.id}`);
  header.appendChild(dot);
  const title = el('span', 'player-title');
  title.textContent = `玩家${player.id}`;
  header.appendChild(title);
  const life = el('span', `player-life life-${player.id}`);
  life.textContent = `生命 ${player.life}/${player.lifeMax}`;
  header.appendChild(life);
  if (player.hasDustSeal) {
    const seal = el('span', 'badge badge-seal');
    seal.textContent = '尘印标记';
    header.appendChild(seal);
  }

  const cards = el('div', 'cards');
  for (const a of player.artifacts) cards.appendChild(artifactCard(a, ctx));

  const areas = el('div', 'areas');
  const order = mirrored ? AREA_ORDER_MIRRORED : AREA_ORDER;
  for (const k of order) areas.appendChild(areaBox(k, player, ctx));

  // 骰子区域贴近中央战场：敌人放在最下、自己放在最上（骰区在生命值之上）
  const seq: HTMLElement[] = role === 'enemy' ? [header, cards, areas] : [areas, cards, header];
  for (const node of seq) panel.appendChild(node);

  return panel;
}

function phaseHint(ctx: Ctx): string {
  const { state } = ctx;
  const pd = state.pending;
  if (pd && pd.kind === 'caiyuliu') return '裁雨流：选择该骰去向。';
  if (pd && pd.kind === 'fengmang') return '锋芒：可发动（消耗 1 攻击骰 + 1 冥想骰）或不发动。';
  if (pd && pd.kind === 'guwangCharge') return '孤王·高塔铁幕：可将对方 1 个攻击骰点数改为 1。';
  if (pd && pd.kind === 'guwangCancel') return `孤王·高塔铁幕：受到 ${pd.amount} 点真实伤害，可消耗 1 个防御骰取消。`;
  if (pd && pd.kind === 'shenhongKill') return '深红·杀意：本回合补充≤3，可造成 3 点真实伤害并回复 2 点生命。';
  if (pd && pd.kind === 'dunwuHalve') return '顿悟·灵能屏障：可消耗 1 个冥想骰，使本次攻击伤害减半。';
  if (pd && pd.kind === 'dunwuPulse') return `顿悟·灵能脉冲：可造成 ${pd.amount} 点真实伤害（本回合消耗 ${pd.amount} 颗能力骰）。`;
  if (state.pendingAttack) return '对方可抵挡：在操作列表选「抵挡：用 X 点防御骰」或「不抵挡」。';
  switch (state.phase) {
    case 'initialReroll':
      return '初始重掷：可点选任意数量的骰子后点「重掷选中」，或点「跳过」。';
    case 'reroll':
      return '重掷阶段：点击你的骰子选择，再点「重掷选中」；或跳过。';
    case 'dustRise':
      return '尘起阶段：点卡上的尘起按钮，或结束该阶段（不行动会 +尘落）。';
    case 'main':
      return '主要阶段：可启动技能、发动攻击（顺序不限）；完成后「结束回合」。';
    case 'gameOver':
      return `游戏结束，胜者：${state.winner ?? '—'}。`;
    default:
      return '';
  }
}

function actorOf(state: GameState): PlayerId {
  if (state.pendingAttack) return state.pendingAttack.attacker === 'A' ? 'B' : 'A';
  if (state.pending) return state.pending.player;
  return state.activePlayer;
}

function hintBox(ctx: Ctx): HTMLElement {
  const hint = el('div', 'hint');
  const actor = actorOf(ctx.state);
  const turn = el('span', 'hint-turn');
  turn.appendChild(document.createTextNode('轮到 '));
  const who = el('span', `hint-player player-${actor}`);
  who.textContent = `玩家${actor}`;
  turn.appendChild(who);
  turn.appendChild(document.createTextNode(' 操作'));
  hint.appendChild(turn);
  const phase = el('span', 'hint-phase');
  phase.textContent = phaseHint(ctx);
  hint.appendChild(phase);
  return hint;
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
  };

  root.innerHTML = '';
  const app = el('div', 'app');

  // 左栏：战报
  const sidebar = el('div', 'sidebar');
  const logTitle = el('div', 'log-title');
  logTitle.textContent = '战报';
  sidebar.appendChild(logTitle);
  sidebar.appendChild(logPanel(ctx));
  app.appendChild(sidebar);

  // 主栏：敌方 / 中央操作区 / 自己
  const main = el('div', 'main');
  main.appendChild(playerPanel(state.players[enemyId], 'enemy', true, ctx));

  const centerband = el('div', 'centerband');
  const left = el('div', 'centerband-left');
  left.appendChild(hintBox(ctx));

  if (hooks.ui.convertPick) {
    left.appendChild(convertPickPanel(ctx));
  } else if (hooks.ui.fengmangPick && hooks.ui.pendingConfirm == null) {
    left.appendChild(fengmangPanel(ctx));
  } else if (hooks.ui.dustFlow) {
    left.appendChild(dustFlowView(ctx));
  } else {
    const confirm = confirmRow(ctx);
    if (confirm) {
      left.appendChild(confirm);
    } else if (hooks.ui.selection) {
      const chooser = chooserPanel(ctx);
      if (chooser) left.appendChild(chooser);
    } else {
      left.appendChild(operationList(ctx));
    }
  }
  centerband.appendChild(left);

  const right = el('div', 'centerband-right');
  const dustfall = el('div', 'dustfall');
  dustfall.textContent = `尘落 ${state.dustfall} / 10`;
  right.appendChild(dustfall);

  const restart = document.createElement('button');
  restart.type = 'button';
  restart.className = 'btn btn-restart';
  restart.dataset.act = 'restart';
  restart.textContent = '重开';
  restart.addEventListener('click', () => hooks.onRestart());
  right.appendChild(restart);
  centerband.appendChild(right);

  main.appendChild(centerband);
  main.appendChild(playerPanel(state.players[selfId], 'self', false, ctx));
  app.appendChild(main);

  root.appendChild(app);

  if (state.phase === 'gameOver') {
    root.appendChild(gameOverModal(ctx));
  }
}
