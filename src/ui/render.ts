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
import { SKILL_SELECTION, type SelectStep } from './skillSelection';

const AREA_LABEL: Record<DiceKind, string> = {
  attack: '攻击骰区',
  defense: '防御骰区',
  meditation: '冥想骰区',
};

const AREA_ORDER: DiceKind[] = ['attack', 'defense', 'meditation'];
// 敌方区域镜像：攻击骰区与冥想骰区对调
const AREA_ORDER_MIRRORED: DiceKind[] = ['meditation', 'defense', 'attack'];

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
  };
  pendingConfirm: null | { action: Action; label: string };
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

type DustRiseAction = Extract<Action, { t: 'dustRise' }>;
type SkillAction = Extract<Action, { t: 'skill' }>;

function dustRiseLabel(a: Artifact, act: DustRiseAction): string {
  let label: string;
  if (a.column === 3) {
    label = '充能';
  } else if (a.activeMarkerSide == null) {
    label = act.side === 'right' ? '激活·右' : '激活·左';
  } else {
    label = '切换到另一侧';
  }
  if (act.useSeal) label += '（尘印）';
  return label;
}

function dustRiseActionLabel(ctx: Ctx, act: DustRiseAction): string {
  const art = ctx.state.players[ctx.state.activePlayer].artifacts.find((x) => x.id === act.artifactId);
  const base = art ? dustRiseLabel(art, act) : '尘起';
  const v = dieValue(ctx.state, act.meditationDieId);
  if (!act.useSeal && v !== undefined) return `${base}：消耗 1 颗冥想骰（${v}点）`;
  return base;
}

function skillName(state: GameState, a: SkillAction): string {
  const art = state.players[state.activePlayer].artifacts.find((x) => x.id === a.artifactId);
  const skill = art?.skills.find(
    (s) => s.side === a.side && (s.kind === 'activate' || s.kind === 'ultimate'),
  );
  return skillLabel(art, a.side, skill?.kind) ?? skill?.key ?? '技能';
}

function skillActionLabel(ctx: Ctx, a: SkillAction): string {
  const name = skillName(ctx.state, a);
  const params = a.params ?? {};
  const parts: string[] = [];

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
    const steps = spec.steps({ state: ctx.state, player, chosenDice: [], options: [] });
    if (steps.length === 0) {
      const params = spec.buildParams({ state: ctx.state, player, chosenDice: [], options: [], numbers: [] });
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
  };
  ctx.hooks.requestRender();
}

function startDustRiseSelection(ctx: Ctx, act: DustRiseAction): void {
  ctx.hooks.ui.selection = {
    key: '@dustRise',
    artifactId: act.artifactId,
    side: act.side ?? 'left',
    stepIndex: 0,
    chosenDice: [],
    options: [],
    currentSel: new Set<string>(),
    numbers: [],
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
    act.textContent = `已激活·${a.activeMarkerSide === 'left' ? '左' : '右'}侧`;
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
    for (const s of text.skills) {
      const isActive = a.activeMarkerSide != null && (s.side === a.activeMarkerSide || s.side === 'only');
      const box = el('div', `skill ${isActive ? 'skill--on' : 'skill--off'}`);
      box.dataset.side = s.side;
      const key = findSkillKey(a, s.side, s.type);
      if (key) box.dataset.key = key;

      const isUsedUltimate =
        key != null && s.type.includes('必杀') && ctx.state.ultimatesUsed.includes(key);
      if (isUsedUltimate) box.classList.add('skill--used');

      const isFull = key === 'buxiang.cuilian' && a.count >= 3;
      if (isFull) box.classList.add('skill--full');

      const sHead = el('div', 'skill-head');
      const badge = el('span', 'skill-type');
      badge.textContent = s.type;
      const sname = el('span', 'skill-name');
      sname.textContent = s.name;
      sHead.appendChild(badge);
      sHead.appendChild(sname);
      if (isUsedUltimate) {
        const used = el('span', 'badge badge-used');
        used.textContent = '已使用';
        sHead.appendChild(used);
      }
      if (isFull) {
        const full = el('span', 'badge badge-full');
        full.textContent = '已满';
        sHead.appendChild(full);
      }
      box.appendChild(sHead);
      const body = el('div', 'skill-text');
      body.textContent = s.text;
      box.appendChild(body);

      const skillAction = ctx.legal.find(
        (x): x is SkillAction =>
          x.t === 'skill' && x.artifactId === a.id && x.side === s.side,
      );
      if (skillAction && isActivatableType(s.type) && !isUsedUltimate && !isFull) {
        box.classList.add('clickable');
        box.dataset.act = 'skill';
        box.title = '点击启动技能';
        const skillKey = key;
        box.addEventListener('click', () => {
          if (skillKey && SKILL_SELECTION[skillKey]) {
            startSkillSelection(ctx, skillAction, skillKey);
          } else {
            ctx.hooks.propose(skillAction, `启动技能：${skillName(ctx.state, skillAction)}`);
          }
        });
      }

      skills.appendChild(box);
    }
    card.appendChild(skills);
  }

  const dustActions = ctx.legal.filter(
    (x): x is DustRiseAction => x.t === 'dustRise' && x.artifactId === a.id,
  );
  if (dustActions.length) {
    const actions = el('div', 'card-actions');
    for (const act of dustActions) {
      const label = dustRiseLabel(a, act);
      if (act.useSeal) {
        actions.appendChild(button(label, act, ctx.hooks));
      } else {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn';
        b.dataset.act = 'dustRise';
        b.textContent = label;
        b.title = '选择 1 颗冥想骰作为尘起代价';
        b.addEventListener('click', () => startDustRiseSelection(ctx, act));
        actions.appendChild(b);
      }
    }
    card.appendChild(actions);
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
  const diceStep: DiceStep | null =
    ctx.selectionStep &&
    ctx.selectionStep.kind === 'dice' &&
    ctx.selectionOwner === player.id &&
    ctx.selectionStep.areas.includes(kind)
      ? ctx.selectionStep
      : null;

  for (const d of player.areas[kind]) {
    const die = el('span', `die die-${player.id}`);
    die.dataset.id = d.id;
    die.dataset.value = String(d.value);
    die.textContent = String(d.value);

    if (diceStep) {
      const step = diceStep;
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
    } else {
      const attackAction = ctx.legal.find((x) => x.t === 'attack' && x.dieId === d.id);
      const blockAction = ctx.legal.find((x) => x.t === 'block' && x.dieId === d.id);
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
  const { state } = ctx;
  switch (a.t) {
    case 'advance':
      return advanceLabel(state.phase);
    case 'attack': {
      const v = findDie(state, a.dieId)?.value ?? '?';
      return `攻击：用 ${v} 点攻击骰`;
    }
    case 'block': {
      if (!a.dieId) return '不抵挡';
      const v = findDie(state, a.dieId)?.value ?? '?';
      return `抵挡：用 ${v} 点防御骰`;
    }
    case 'dustRise': {
      const art = state.players[state.activePlayer].artifacts.find((x) => x.id === a.artifactId);
      return art ? dustRiseLabel(art, a) : '尘起';
    }
    case 'caiyuliu':
      return a.to === 'defense' ? '移到防御骰区' : a.to === 'meditation' ? '移到冥想骰区' : '不移动';
    case 'fengmang': {
      if (!a.accept) return '不发动';
      const pd = state.pending;
      const pp = pd && pd.kind === 'fengmang' ? state.players[pd.player] : state.players[state.activePlayer];
      const av = pp.areas.attack.find((d) => d.id === a.attackDieId)?.value ?? '?';
      const mv = pp.areas.meditation.find((d) => d.id === a.meditationDieId)?.value ?? '?';
      return `发动（消耗 攻击${av} 与 冥想${mv}）`;
    }
    case 'guwangCharge': {
      if (!a.dieId) return '不变更';
      const pd = state.pending;
      const opp: PlayerId = pd && pd.kind === 'guwangCharge' ? (pd.player === 'A' ? 'B' : 'A') : state.activePlayer;
      const v = state.players[opp].areas.attack.find((d) => d.id === a.dieId)?.value ?? '?';
      return `改为1（${v}点）`;
    }
    case 'guwangCancel': {
      if (!a.cancel || !a.defenseDieId) return '承受伤害';
      const pd = state.pending;
      const defender: PlayerId = pd && pd.kind === 'guwangCancel' ? pd.player : state.activePlayer;
      const v = state.players[defender].areas.defense.find((d) => d.id === a.defenseDieId)?.value ?? '?';
      return `取消（消耗 防御${v}）`;
    }
    case 'reroll':
    case 'skill':
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

function operationList(ctx: Ctx): HTMLElement {
  const box = el('div', 'actionlist');

  const rb = rerollButton(ctx);
  if (rb) box.appendChild(rb);

  const seenSkill = new Set<string>();
  for (const a of ctx.legal) {
    if (a.t === 'reroll') continue;
    if (a.t === 'skill') {
      const sig = `${a.artifactId}:${a.side}`;
      if (seenSkill.has(sig)) continue;
      seenSkill.add(sig);
      box.appendChild(skillButton(ctx, a));
      continue;
    }
    const label = actionLabel(ctx, a);
    if (label === null) continue;
    if (a.t === 'dustRise' && !a.useSeal) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.dataset.act = 'dustRise';
      b.textContent = label;
      b.title = '选择 1 颗冥想骰作为尘起代价';
      b.addEventListener('click', () => startDustRiseSelection(ctx, a));
      box.appendChild(b);
      continue;
    }
    box.appendChild(button(label, a, ctx.hooks));
  }
  if (box.childElementCount === 0) {
    const empty = el('div', 'actionlist-empty');
    empty.textContent = '（无可用操作）';
    box.appendChild(empty);
  }
  return box;
}

function chooserPanel(ctx: Ctx): HTMLElement | null {
  const sel: ActiveSelection | null = ctx.hooks.ui.selection;
  if (!sel) return null;
  const spec = SKILL_SELECTION[sel.key];
  if (!spec) return null;
  const { state, hooks } = ctx;
  const steps = spec.steps({ state, player: state.activePlayer, chosenDice: sel.chosenDice, options: sel.options });
  const step = steps[sel.stepIndex];
  const panel = el('div', 'selector');
  if (!step) return panel;

  const title = el('div', 'selector-title');
  title.textContent = `步骤 ${sel.stepIndex + 1}/${steps.length} · ${step.label}`;
  panel.appendChild(title);

  if (step.kind === 'dice') {
    const info = el('div', 'selector-info');
    info.textContent = `已选 ${sel.currentSel.size}（需 ${step.min}–${step.max} 颗）`;
    panel.appendChild(info);
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
    panel.appendChild(row);
  } else {
    const nums = el('div', 'number-row');
    for (let n = step.min; n <= step.max; n++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn number-btn';
      if (sel.numbers[sel.stepIndex] === n) b.classList.add('number-btn--on');
      b.textContent = String(n);
      b.addEventListener('click', () => {
        sel.numbers[sel.stepIndex] = n;
        hooks.requestRender();
      });
      nums.appendChild(b);
    }
    panel.appendChild(nums);
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
  const steps = spec.steps({ state, player, chosenDice: sel.chosenDice, options: sel.options });
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
  }
  sel.stepIndex += 1;

  const nextSteps = spec.steps({ state, player, chosenDice: sel.chosenDice, options: sel.options });
  if (sel.stepIndex >= nextSteps.length) {
    if (sel.key === '@dustRise') {
      const medId = sel.chosenDice.flat()[0];
      const built: DustRiseAction = {
        t: 'dustRise',
        artifactId: sel.artifactId,
        side: sel.side === 'only' ? undefined : sel.side,
        meditationDieId: medId,
      };
      hooks.ui.selection = null;
      hooks.propose(built, dustRiseActionLabel(ctx, built));
      hooks.requestRender();
      return;
    }
    const numberIdx = nextSteps
      .map((s, i) => (s.kind === 'number' ? i : -1))
      .filter((i) => i >= 0);
    const numbers = numberIdx.map((i) => sel.numbers[i]);
    const params = spec.buildParams({ state, player, chosenDice: sel.chosenDice, options: sel.options, numbers });
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

export function renderGame(state: GameState, root: HTMLElement, hooks: RenderHooks): void {
  const legal = getLegalActions(state);
  const selfId: PlayerId = state.activePlayer;
  const enemyId: PlayerId = oppOf(selfId);

  const rerollAction = legal.find((a): a is Extract<Action, { t: 'reroll' }> => a.t === 'reroll');
  const maxReroll = rerollAction?.dieIds.length ?? 0;

  const sel = hooks.ui.selection;
  let selectionStep: SelectStep | null = null;
  let selectionOwner: PlayerId | null = null;
  if (sel && SKILL_SELECTION[sel.key]) {
    const steps = SKILL_SELECTION[sel.key].steps({
      state,
      player: state.activePlayer,
      chosenDice: sel.chosenDice,
      options: sel.options,
    });
    const step = steps[sel.stepIndex];
    if (step && step.kind === 'dice') {
      selectionStep = step;
      selectionOwner = step.owner === 'self' ? state.activePlayer : enemyId;
    }
  }

  const ctx: Ctx = { state, legal, hooks, maxReroll, selectionStep, selectionOwner };

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

  const confirm = confirmRow(ctx);
  if (confirm) {
    left.appendChild(confirm);
  } else if (hooks.ui.selection) {
    const chooser = chooserPanel(ctx);
    if (chooser) left.appendChild(chooser);
  } else {
    left.appendChild(operationList(ctx));
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
