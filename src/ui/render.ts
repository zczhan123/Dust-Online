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
    currentSel: Set<string>;
    numbers: number[];
  };
}

export interface RenderHooks {
  onAction: (a: Action) => void;
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
  b.addEventListener('click', () => hooks.onAction(action));
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

function canSelectForReroll(player: PlayerState, ctx: Ctx): boolean {
  return ctx.state.phase === 'reroll' && player.id === ctx.state.activePlayer && ctx.maxReroll > 0;
}

function startSkillSelection(ctx: Ctx, action: SkillAction, key: string): void {
  const spec = SKILL_SELECTION[key];
  if (spec) {
    const player = ctx.state.activePlayer;
    const steps = spec.steps({ state: ctx.state, player, chosenDice: [] });
    if (steps.length === 0) {
      const params = spec.buildParams({ state: ctx.state, player, chosenDice: [], numbers: [] });
      ctx.hooks.onAction({ t: 'skill', artifactId: action.artifactId, side: action.side, params });
      return;
    }
  }
  ctx.hooks.ui.selection = {
    key,
    artifactId: action.artifactId,
    side: action.side,
    stepIndex: 0,
    chosenDice: [],
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
  name.textContent = a.name;
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
    charge.textContent = `充能 ${a.chargeLayer}/${a.chargeReq}`;
    head.appendChild(charge);
  }
  if (a.count > 0) {
    const count = el('span', 'badge badge-count');
    count.textContent = `计数 ${a.count}`;
    head.appendChild(count);
  }
  card.appendChild(head);

  const art = el('div', 'card-art');
  art.textContent = '（卡图占位）';
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

      const sHead = el('div', 'skill-head');
      const badge = el('span', 'skill-type');
      badge.textContent = s.type;
      const sname = el('span', 'skill-name');
      sname.textContent = s.name;
      sHead.appendChild(badge);
      sHead.appendChild(sname);
      box.appendChild(sHead);
      const body = el('div', 'skill-text');
      body.textContent = s.text;
      box.appendChild(body);

      const skillAction = ctx.legal.find(
        (x): x is SkillAction =>
          x.t === 'skill' && x.artifactId === a.id && x.side === s.side,
      );
      if (skillAction && isActivatableType(s.type)) {
        box.classList.add('clickable');
        box.dataset.act = 'skill';
        box.title = '点击启动技能';
        const skillKey = key;
        box.addEventListener('click', () => {
          if (skillKey && SKILL_SELECTION[skillKey]) {
            startSkillSelection(ctx, skillAction, skillKey);
          } else {
            ctx.hooks.onAction(skillAction);
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
      actions.appendChild(button(dustRiseLabel(a, act), act, ctx.hooks));
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
    const die = el('span', 'die');
    die.dataset.id = d.id;
    die.dataset.value = String(d.value);
    die.textContent = String(d.value);

    if (diceStep) {
      const step = diceStep;
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
    } else {
      const attackAction = ctx.legal.find((x) => x.t === 'attack' && x.dieId === d.id);
      const blockAction = ctx.legal.find((x) => x.t === 'block' && x.dieId === d.id);
      if (attackAction) {
        die.classList.add('clickable');
        die.dataset.act = 'attack';
        die.title = '点击发起攻击';
        die.addEventListener('click', () => ctx.hooks.onAction(attackAction));
      } else if (blockAction) {
        die.classList.add('clickable');
        die.dataset.act = 'block';
        die.title = '点击抵挡';
        die.addEventListener('click', () => ctx.hooks.onAction(blockAction));
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
  const title = el('span', 'player-title');
  title.textContent = `玩家${player.id}`;
  header.appendChild(title);
  const life = el('span', 'player-life');
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

function centerBar(state: GameState): HTMLElement {
  const center = el('div', 'center');

  const dustfall = el('div', 'dustfall');
  dustfall.textContent = `尘落 ${state.dustfall} / 10`;
  center.appendChild(dustfall);

  const rollzone = el('div', 'rollzone');
  rollzone.textContent = '投掷区 / 供应堆';
  center.appendChild(rollzone);

  return center;
}

function phaseHint(ctx: Ctx): string {
  const { state } = ctx;
  const pd = state.pending;
  if (pd && pd.kind === 'caiyuliu') return '裁雨流：选择该骰去向。';
  if (pd && pd.kind === 'fengmang') return '锋芒：可发动（消耗 1 攻击骰 + 1 冥想骰）或不发动。';
  if (state.pendingAttack) return '对方可抵挡：在操作列表选「抵挡：用 X 点防御骰」或「不抵挡」。';
  switch (state.phase) {
    case 'reroll':
      return '重掷阶段：点击你的骰子选择，再点「重掷选中」；或跳过。';
    case 'dustRise':
      return '尘起阶段：点卡上的尘起按钮，或结束该阶段（不行动会 +尘落）。';
    case 'main':
      return '主要阶段：用下方操作列表攻击/启动技能，完成后结束回合。';
    case 'gameOver':
      return `游戏结束，胜者：${state.winner ?? '—'}。`;
    default:
      return '';
  }
}

function statusBar(ctx: Ctx): HTMLElement {
  const { state } = ctx;
  const bar = el('div', 'status');

  const turn = el('span', 'status-item');
  turn.textContent = `当前回合：玩家${state.activePlayer}`;
  bar.appendChild(turn);

  const phase = el('span', 'status-item');
  phase.textContent = `阶段：${PHASE_LABEL[state.phase]}`;
  bar.appendChild(phase);

  const dust = el('span', 'status-item');
  dust.textContent = `尘落 ${state.dustfall}/10`;
  bar.appendChild(dust);

  if (state.phase === 'gameOver') {
    const winner = el('span', 'status-item status-winner');
    winner.textContent = `胜者：${state.winner ?? '—'}`;
    bar.appendChild(winner);
  }

  const restart = document.createElement('button');
  restart.type = 'button';
  restart.className = 'btn btn-restart';
  restart.dataset.act = 'restart';
  restart.textContent = '重开';
  restart.addEventListener('click', () => ctx.hooks.onRestart());
  bar.appendChild(restart);

  const hint = el('div', 'hint');
  hint.textContent = phaseHint(ctx);
  bar.appendChild(hint);

  return bar;
}

function advanceLabel(phase: Phase): string {
  switch (phase) {
    case 'dustRise':
      return '结束尘起阶段';
    case 'reroll':
      return '跳过重掷';
    case 'main':
      return '结束回合';
    default:
      return '跳过';
  }
}

function actionBar(ctx: Ctx): HTMLElement {
  const bar = el('div', 'actionbar');
  const reroll = ctx.legal.find((x): x is Extract<Action, { t: 'reroll' }> => x.t === 'reroll');
  if (!reroll) return bar;

  const count = ctx.hooks.ui.rerollSelected.size;
  const rb = document.createElement('button');
  rb.type = 'button';
  rb.className = 'btn btn-reroll';
  rb.dataset.act = 'reroll';
  rb.textContent = `重掷选中(${count})`;
  rb.disabled = count === 0;
  rb.addEventListener('click', () => {
    if (ctx.hooks.ui.rerollSelected.size === 0) return;
    ctx.hooks.onAction({ t: 'reroll', dieIds: [...ctx.hooks.ui.rerollSelected] });
  });
  bar.appendChild(rb);

  return bar;
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
    case 'reroll':
    case 'skill':
      return null;
  }
}

function skillButton(ctx: Ctx, a: SkillAction): HTMLElement {
  const { state, hooks } = ctx;
  const art = state.players[state.activePlayer].artifacts.find((x) => x.id === a.artifactId);
  const skill = art?.skills.find(
    (s) => s.side === a.side && (s.kind === 'activate' || s.kind === 'ultimate'),
  );
  const key = skill?.key;
  const name = skillLabel(art, a.side, skill?.kind) ?? key ?? '技能';
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

function operationList(ctx: Ctx): HTMLElement {
  const box = el('div', 'actionlist');
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
  const steps = spec.steps({ state, player: state.activePlayer, chosenDice: sel.chosenDice });
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
  const satisfied =
    step.kind === 'dice'
      ? sel.currentSel.size >= step.min && sel.currentSel.size <= step.max
      : Number.isInteger(chosenNum) && chosenNum >= step.min && chosenNum <= step.max;

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
  const steps = spec.steps({ state, player, chosenDice: sel.chosenDice });
  const step = steps[sel.stepIndex];
  if (!step) {
    hooks.ui.selection = null;
    hooks.requestRender();
    return;
  }

  if (step.kind === 'dice') {
    sel.chosenDice.push([...sel.currentSel]);
    sel.currentSel = new Set<string>();
  }
  sel.stepIndex += 1;

  const nextSteps = spec.steps({ state, player, chosenDice: sel.chosenDice });
  if (sel.stepIndex >= nextSteps.length) {
    const numberIdx = nextSteps
      .map((s, i) => (s.kind === 'number' ? i : -1))
      .filter((i) => i >= 0);
    const numbers = numberIdx.map((i) => sel.numbers[i]);
    const params = spec.buildParams({ state, player, chosenDice: sel.chosenDice, numbers });
    const action: Action = { t: 'skill', artifactId: sel.artifactId, side: sel.side, params };
    hooks.ui.selection = null;
    hooks.onAction(action);
  }
  hooks.requestRender();
}

function logPanel(ctx: Ctx): HTMLElement {
  const box = el('div', 'log');
  const recent = ctx.state.log.slice(-20);
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
    });
    const step = steps[sel.stepIndex];
    if (step && step.kind === 'dice') {
      selectionStep = step;
      selectionOwner = step.owner === 'self' ? state.activePlayer : enemyId;
    }
  }

  const ctx: Ctx = { state, legal, hooks, maxReroll, selectionStep, selectionOwner };

  root.innerHTML = '';
  const board = el('div', 'board');
  board.appendChild(statusBar(ctx));
  board.appendChild(playerPanel(state.players[enemyId], 'enemy', true, ctx));
  board.appendChild(centerBar(state));
  board.appendChild(playerPanel(state.players[selfId], 'self', false, ctx));

  if (hooks.ui.selection) {
    const chooser = chooserPanel(ctx);
    if (chooser) board.appendChild(chooser);
  } else {
    board.appendChild(actionBar(ctx));
    board.appendChild(operationList(ctx));
  }

  board.appendChild(logPanel(ctx));
  root.appendChild(board);
}
