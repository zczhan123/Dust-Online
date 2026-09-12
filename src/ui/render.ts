import type {
  Action,
  Artifact,
  DiceKind,
  GameState,
  Phase,
  PlayerId,
  PlayerState,
  SkillDef,
} from '../core/model/types';
import { ARTIFACT_TEXT } from '../core/content/artifactText';
import { getLegalActions } from '../core/engine/game';

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

export interface RenderHooks {
  onAction: (a: Action) => void;
}

interface Ctx {
  state: GameState;
  legal: Action[];
  hooks: RenderHooks;
  selected: Set<string>;
  maxReroll: number;
  rerollRef: { current: HTMLButtonElement | null };
  refreshReroll: () => void;
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

type DustRiseAction = Extract<Action, { t: 'dustRise' }>;

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

function toggleSelect(die: HTMLElement, id: string, ctx: Ctx): void {
  if (ctx.selected.has(id)) {
    ctx.selected.delete(id);
    die.classList.remove('selected');
  } else if (ctx.selected.size < ctx.maxReroll) {
    ctx.selected.add(id);
    die.classList.add('selected');
  }
  ctx.refreshReroll();
}

function canSelectForReroll(player: PlayerState, ctx: Ctx): boolean {
  return ctx.state.phase === 'reroll' && player.id === ctx.state.activePlayer && ctx.maxReroll > 0;
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
        (x) => x.t === 'skill' && x.artifactId === a.id && x.side === s.side,
      );
      if (skillAction && isActivatableType(s.type)) {
        box.classList.add('clickable');
        box.dataset.act = 'skill';
        box.title = '点击启动技能';
        box.addEventListener('click', () => ctx.hooks.onAction(skillAction));
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
  for (const d of player.areas[kind]) {
    const die = el('span', 'die');
    die.dataset.id = d.id;
    die.dataset.value = String(d.value);
    die.textContent = String(d.value);

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
      die.addEventListener('click', () => toggleSelect(die, d.id, ctx));
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
  title.textContent = `${role === 'enemy' ? '敌人' : '自己'}（${player.id}）`;
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

function statusBar(ctx: Ctx): HTMLElement {
  const { state } = ctx;
  const bar = el('div', 'status');

  const turn = el('span', 'status-item');
  const enemyId: PlayerId = state.activePlayer === 'A' ? 'B' : 'A';
  turn.textContent = `回合：自己（${state.activePlayer}） / 敌人（${enemyId}）`;
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
  const blockNone = ctx.legal.find((x) => x.t === 'block' && !x.dieId);
  const advance = ctx.legal.find((x) => x.t === 'advance');
  const reroll = ctx.legal.find((x) => x.t === 'reroll');

  if (blockNone) bar.appendChild(button('不抵挡', blockNone, ctx.hooks));

  if (reroll) {
    const rb = document.createElement('button');
    rb.type = 'button';
    rb.className = 'btn btn-reroll';
    rb.dataset.act = 'reroll';
    rb.textContent = '重掷选中(0)';
    rb.disabled = true;
    rb.addEventListener('click', () => {
      if (ctx.selected.size === 0) return;
      ctx.hooks.onAction({ t: 'reroll', dieIds: [...ctx.selected] });
    });
    ctx.rerollRef.current = rb;
    bar.appendChild(rb);
    if (advance) bar.appendChild(button('跳过重掷', advance, ctx.hooks));
  } else if (advance) {
    bar.appendChild(button(advanceLabel(ctx.state.phase), advance, ctx.hooks));
  }

  return bar;
}

function promptPanel(ctx: Ctx): HTMLElement | null {
  const { state, legal, hooks } = ctx;
  const pd = state.pending;

  if (pd && pd.kind === 'caiyuliu') {
    const p = el('div', 'prompt');
    const text = el('div', 'prompt-text');
    text.textContent = `裁雨流：选择「${pd.value}」点骰的去向`;
    p.appendChild(text);
    const row = el('div', 'prompt-actions');
    for (const a of legal) {
      if (a.t !== 'caiyuliu') continue;
      const label = a.to === 'defense' ? '移到防御骰区' : a.to === 'meditation' ? '移到冥想骰区' : '不移动';
      row.appendChild(button(label, a, hooks));
    }
    p.appendChild(row);
    return p;
  }

  if (pd && pd.kind === 'fengmang') {
    const p = el('div', 'prompt');
    const text = el('div', 'prompt-text');
    text.textContent = '锋芒：可消耗 1 攻击骰与 1 冥想骰，取消该防御骰效果并追加 2 点真实伤害';
    p.appendChild(text);
    const row = el('div', 'prompt-actions');
    for (const a of legal) {
      if (a.t !== 'fengmang') continue;
      if (!a.accept) {
        row.appendChild(button('不发动', a, hooks));
        continue;
      }
      const pp = state.players[pd.player];
      const av = pp.areas.attack.find((d) => d.id === a.attackDieId)?.value ?? '?';
      const mv = pp.areas.meditation.find((d) => d.id === a.meditationDieId)?.value ?? '?';
      row.appendChild(button(`发动（消耗 攻击${av} 与 冥想${mv}）`, a, hooks));
    }
    p.appendChild(row);
    return p;
  }

  if (state.pendingAttack) {
    const p = el('div', 'prompt');
    const text = el('div', 'prompt-text');
    text.textContent = '对方可抵挡：点击对方防御骰进行抵挡，或点击「不抵挡」';
    p.appendChild(text);
    return p;
  }

  return null;
}

function logPanel(ctx: Ctx): HTMLElement {
  const box = el('div', 'log');
  const recent = ctx.state.log.slice(-12);
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
  const enemyId: PlayerId = selfId === 'A' ? 'B' : 'A';

  const selected = new Set<string>();
  const rerollRef: { current: HTMLButtonElement | null } = { current: null };
  const rerollAction = legal.find((a) => a.t === 'reroll') as
    | { t: 'reroll'; dieIds: string[] }
    | undefined;
  const maxReroll = rerollAction?.dieIds.length ?? 0;
  const refreshReroll = () => {
    const b = rerollRef.current;
    if (!b) return;
    b.textContent = `重掷选中(${selected.size})`;
    b.disabled = selected.size === 0;
  };
  const ctx: Ctx = { state, legal, hooks, selected, maxReroll, rerollRef, refreshReroll };

  root.innerHTML = '';
  const board = el('div', 'board');
  board.appendChild(statusBar(ctx));
  board.appendChild(playerPanel(state.players[enemyId], 'enemy', true, ctx));
  board.appendChild(centerBar(state));
  board.appendChild(playerPanel(state.players[selfId], 'self', false, ctx));
  board.appendChild(actionBar(ctx));
  const prompt = promptPanel(ctx);
  if (prompt) board.appendChild(prompt);
  board.appendChild(logPanel(ctx));
  root.appendChild(board);
}
