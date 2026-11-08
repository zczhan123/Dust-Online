import { ARTIFACTS, isAltArtifact, makeArtifact } from '../core/content/artifacts';
import { ARTIFACT_TEXT } from '../core/content/artifactText';
import { getLegalActions } from '../core/engine/game';
import { fxPeek, fxTake, type FxEvent } from '../core/engine/fx';
import { castTeamVote, createDefenseVote, type TeamVoteState } from '../core/engine/teamVote';
import type { Action, Artifact, DiceKind, GameState, PendingAttack, PlayerId } from '../core/model/types';
import { SKILL_SELECTION, compactNumbers, type SelectStep, type SkillSelection } from './skillSelection';
import { enemiesOf } from '../core/model/participants';
import type { TwoVTwoSeat, TwoVTwoSetup, TwoVTwoTeam } from '../core/model/twoVTwo';
import { loadPrefs, savePrefs, speedOf, type Prefs } from './prefs';
import { SEAT_COLOR, SEAT_INK, TEAM_COLOR } from './seatColors';
import { isActivatableType, skillPartState } from './shared/skillState';
import { renderChipRow, renderRerollButton } from './shared/actionControls';
import { MOTION, anyRemoved, attackJoin, attackResolve, attackStart, attackWatchDelay, bubbleDuration, bumpEl, createBubbleQueue, drawTrueLine, heldAttackDieId, playBanner, playGouhun, playLifeFloats, playPayments, playUltimate, releaseHeldAttackDie, restoreInFlightHides, runBoardMotions, setMotionSpeed, snapshotDice, snapshotStored, weijuHold, weijuResolve, weijuStart, type DiceMoveFx, type LifeDelta, type PayDie, type PayInfo, type Rect } from './motion';
import { actionDieSegmentsOf, actionLabelOf, advanceLabel, appendParts, applyZoom as applyZoomShared, attackInfoParts, convertAvailable, countText, dustEntryLabel, fengmangPanel, metaParts, pendingActionLabel, PHASE_LABEL, phaseBannerSegs, renderArtifactDetailOverlay, renderConvertPickHost, renderDiceChips, renderDustFlowHost, renderHintHost, renderQuanzhiHost, renderSettingsPanel, renderSlotsStepHost, skillBubbleName, skillKindOf, startDustFlowHost, type DustFlowState, type QuanzhiHostState } from './render';
import { artifactDetailNote } from './shared/artifactDetail';
import { previewPendingAttack } from './attackPreview';
import { diag, isDiagEnabled, setDumpProbe } from './diag';

const SEATS: TwoVTwoSeat[] = ['A1', 'A2', 'B1', 'B2'];
const TEAM_OF: Record<TwoVTwoSeat, TwoVTwoTeam> = { A1: 'A', A2: 'A', B1: 'B', B2: 'B' };
const seatName = (seat: PlayerId): string => `玩家${seat}`;
const TEAM_MEMBERS: Record<TwoVTwoTeam, TwoVTwoSeat[]> = { A: ['A2', 'A1'], B: ['B1', 'B2'] };
const lastTeamLife = new WeakMap<GameState, Record<TwoVTwoTeam, { life: number; max: number }>>();
const lastAttack2v2 = new WeakMap<GameState, GameState['pendingAttack']>();
const lastViewTeam2v2 = new WeakMap<GameState, TwoVTwoTeam>();
const lastCount2v2 = new WeakMap<GameState, Map<string, number>>();
const lastPhase2v2 = new WeakMap<GameState, { active: PlayerId; phase: GameState['phase'] }>();
/** ── 排查（?diag=1）：2v2 点击链路 ────────────────────────────────────────────
 * `gen2v2`：整页重建的编号。一次点击的日志里带着它，就能看出"点的时候是哪一代界面"、
 * "点完有没有被重建换掉"。
 * `lastStep2v2`：上一次 `ui-step` 的指纹（只在变化时记，避免刷屏）。
 */
let gen2v2 = 0;
let lastStep2v2 = '';
const diagClickBound = new WeakSet<HTMLElement>();

/** 把被点的元素翻译成可读身份（**只读**，绝不改行为）。 */
function describeClickTarget(t: EventTarget | null, x: number, y: number): Record<string, unknown> {
  const el = t instanceof Element ? t : null;
  if (!el) return { tag: null };
  const cls = el.getAttribute('class') ?? '';
  const pick = (sel: string, attr: string): string | null =>
    el.closest<HTMLElement>(sel)?.getAttribute(attr) ?? null;
  const top =
    typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
  return {
    tag: el.tagName.toLowerCase(),
    cls: cls.slice(0, 60),
    act: pick('[data-act]', 'data-act'),
    choice: pick('[data-choice]', 'data-choice'),
    art: pick('.card[data-artifact]', 'data-artifact'),
    die: pick('.die[data-id]', 'data-id'),
    seat: pick('[data-player]', 'data-player'),
    txt: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 16) || null,
    // 坐标下**最顶层**的元素：不是按钮本身 → 有东西盖住了它（透明层/残影/遮罩）。
    top: top ? `${top.tagName.toLowerCase()}.${(top.getAttribute('class') ?? '').slice(0, 40)}` : null,
    topOk: !!top && (top === el || el.contains(top) || top.contains(el)),
    at: [Math.round(x), Math.round(y)],
  };
}

/** 给 2v2 根节点绑一次捕获阶段监听（`down` + `click` 分开记 → 能看出"按下有、点击没有"）。 */
function bindDiagClicks(root: HTMLElement): void {
  if (diagClickBound.has(root)) return;
  diagClickBound.add(root);
  const log = (ev: string) => (e: Event) => {
    if (!isDiagEnabled()) return;
    const me = e as MouseEvent;
    diag(ev === 'click' ? 'ui-click' : 'ui-down', {
      gen: gen2v2,
      ...describeClickTarget(e.target, me.clientX ?? 0, me.clientY ?? 0),
    });
  };
  root.addEventListener('pointerdown', log('down'), true);
  root.addEventListener('click', log('click'), true);
}

const AREA_ORDER_BOTTOM: DiceKind[] = ['defense', 'attack', 'meditation'];
const AREA_ORDER_TOP: DiceKind[] = ['meditation', 'attack', 'defense'];
const AREA_CN: Record<DiceKind, string> = { attack: '攻击', defense: '防御', meditation: '冥想' };
/**
 * 操作列表里**有专用渲染入口**的动作类型 → 通用循环必须跳过（否则同一动作会被渲染两次）。
 * 新增任何"在循环外单独渲染"的动作时，**必须**登记到这里。
 *
 * ⚠️ 只登记「循环**外**有专用分支」的动作。`dustRise` 是在通用循环**内部**专门处理的
 * （`seenDust` 去重 + `startDustFlowHost`），**不得**放进这里——否则会被提前 `continue` 掉，
 * 尘起按钮全部消失（真实事故：2v2 尘起阶段一个入口都没有）。
 */
const BESPOKE_ACTS = new Set<string>(['attack', 'block', 'skill', 'fengmang']);
/**
 * 「真实之剑」置换的确认条文案：与 1v1 `dispatchConvertPick` **逐字一致**（唯一口径）。
 * 2v2 只在后面追加 ` → 玩家X`（打谁）。
 */
const CONVERT_ATTACK_LABEL = '置换攻击：消耗 2 颗能力骰 → 1 颗攻击骰（点数按 5）';
const CONVERT_BLOCK_LABEL = '置换抵挡：消耗 2 颗能力骰 → 1 颗防御骰（点数按 5）';
const MOCK_DICE: Record<TwoVTwoSeat, Record<DiceKind, number[]>> = {
  A1: { attack: [4], defense: [2, 5], meditation: [1, 3] },
  A2: { attack: [3, 6], defense: [1], meditation: [2] },
  B1: { attack: [6], defense: [4], meditation: [1, 2] },
  B2: { attack: [2, 5], defense: [3], meditation: [6] },
};
type Stance = 'attackPicks' | 'defensePicks';

interface SkillWizard {
  /** 待决策选择器（endDiscard / wanzhangDiscard / tiaolingPick）没有技能动作 → null */
  action: Extract<Action, { t: 'skill' }> | null;
  key: string;
  spec: SkillSelection;
  step: number;
  chosenDice: string[][];
  options: string[];
  numbers: number[];
  slots: string[][];
  slotModes: ('real' | 'convert')[];
  target?: TwoVTwoSeat;
  /** 非空＝这是「待决策」选择器（直接派发对应动作，不派发 skill） */
  pendingKind?:
    | 'endDiscard'
    | 'wanzhangDiscard'
    | 'tiaolingPick'
    | 'guwangCancelConvert'
    | 'dunwuHalveConvert'
    | 'weijuPayConvert';
  /** 骰子归属座位（待决策时 = 该待决策的 player，对齐 1v1 的 `actorOf`） */
  ownerSeat?: TwoVTwoSeat;
}

/**
 * 2v2 的「进行中的操作」状态：**必须跨整页重建存活**（与 1v1 存在 `main.ts` 的 `ui` 上同构）。
 *
 * 2v2 每次换视角 / 每次派发都会 `render2v2Game` 整页重建；这些状态原来只活在该次调用的闭包里，
 * 一旦重建就全部归零 —— 用户看到的就是「点了目标/发动，确认条一闪就没了」＝「点了没反应」。
 * 现在改成：进入渲染时从这里**恢复**，每次 `draw()` 结束**写回**，派发前**清空**。
 */
interface Step2v2 {
  combatView: 'attacker' | 'defender';
  selected: Action | null;
  attackTarget: TwoVTwoSeat | null;
  chargeTarget: TwoVTwoSeat | null;
  convertPick: { kind: 'attack' | 'block'; dieIds: string[] } | null;
  rerollSelected: Set<string>;
  wizard: SkillWizard | null;
  pendingSkillTarget: Action | null;
  defenseVote: TeamVoteState | null;
  defenseVoteFor: Action | null;
  /** 守方投票面板上展示的"这一刀"（引擎试算结果；投票结束即清空）。 */
  defenseInfo: PendingAttack | null;
  dustFlow: DustFlowState | null;
  quanzhiState: QuanzhiHostState | null;
  settingsOpen: boolean;
  logOpen: boolean;
  pendingConfirm: { action: Action; label: string } | null;
  fengmangPick: { attackDieId?: string; meditationDieId?: string } | null;
}
const step2v2 = new WeakMap<GameState, Step2v2>();
const emptyStep2v2 = (): Step2v2 => ({
  combatView: 'attacker',
  selected: null,
  attackTarget: null,
  chargeTarget: null,
  convertPick: null,
  rerollSelected: new Set<string>(),
  wizard: null,
  pendingSkillTarget: null,
  defenseVote: null,
  defenseVoteFor: null,
  defenseInfo: null,
  dustFlow: null,
  quanzhiState: null,
  settingsOpen: false,
  logOpen: false,
  pendingConfirm: null,
  fengmangPick: null,
});
const stepOf2v2 = (g: GameState): Step2v2 => {
  let s = step2v2.get(g);
  if (!s) {
    s = emptyStep2v2();
    step2v2.set(g, s);
  }
  return s;
};


interface SeatView {
  seat: TwoVTwoSeat;
  team: TwoVTwoTeam;
  color: string;
  artifacts: {
    id: string;
    name: string;
    column: number;
    count?: number;
    countCap?: number;
    chargeLayer?: number;
    chargeReq?: number;
    activeMarkerSide?: 'left' | 'right' | null;
    allSidesActiveThisTurn?: boolean;
    continuousLost?: boolean;
    heldDice?: { id: string; value: number }[];
  }[];
  dice: Record<DiceKind, number[]>;
  /** 真实骰 id；缺省时（mock/旧视觉壳）退回座位-区域-下标。 */
  diceIds?: Record<DiceKind, string[]>;
  hasSeal?: boolean;
}

interface TeamView {
  life: number;
  lifeMax: number;
}

interface LogLine {
  actor: TwoVTwoSeat;
  text: string;
  turn?: number;
  phase?: GameState['phase'];
}

interface ViewState {
  seats: Record<TwoVTwoSeat, SeatView>;
  teams: Record<TwoVTwoTeam, TeamView>;
  activeSeat: TwoVTwoSeat;
  log: LogLine[];
}

const el = (tag: string, cls = ''): HTMLElement => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
};

const button = (cls: string, text: string): HTMLButtonElement => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  return b;
};

const image = (src: string, alt: string): HTMLImageElement => {
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt;
  return img;
};

/** 壳内 mock：每组第一个技能为绿；接引擎后换成真实 skillPartState。 */
const previewSkillOn = (_id: string, index: number): boolean => index === 0;

type SkillPartVisual = 'on' | 'off' | 'disabled' | 'spent';

/**
 * 卡面「技能行」点击：返回 null＝这一行不可点。
 * 判断口径与 1v1 的 `artifactCard` 一致（类型可发动 + 引擎给了这条技能动作），
 * 另加一条 2v2 专有：**只点亮当前行动座位**（四席都渲染，同名神器不能串）。
 */
type SkillRowClickHandler = (
  seat: TwoVTwoSeat,
  artifactId: string,
  side: 'left' | 'right' | 'only',
  type: string,
) => (() => void) | null;

function skillPart(
  s: { side: 'left' | 'right' | 'only'; name: string; type: string; text: string },
  state: SkillPartVisual,
  showText: boolean,
  onActivate?: () => void,
): HTMLElement {
  const part = el('div', `skill-part skill-part--${state}`);
  part.dataset.side = s.side;
  const glyphs = Array.from(s.name).length;
  const shortName = glyphs <= 5;
  const noWrapName = s.side !== 'only' && glyphs <= 7;
  const head = el(
    'div',
    `skill-part-head ${shortName ? 'skill-part-head--short' : 'skill-part-head--long'}${noWrapName ? ' skill-part-head--nowrap' : ''}`,
  );
  const type = el('span', 'skill-type');
  type.textContent = s.type;
  const name = el('span', `skill-name ${shortName ? 'skill-name--short' : 'skill-name--long'}`);
  name.textContent = s.name;
  const line = el('span', 'skill-line');
  line.appendChild(name);
  if (showText) {
    const body = el('span', 'skill-text');
    body.textContent = s.text;
    line.appendChild(body);
  }
  head.append(type, line);
  part.appendChild(head);
  // 可点＝与 1v1 完全同一套表现（小手 / 蓝框 / 悬停淡蓝 + 「点击启动技能」提示）
  if (onActivate) {
    part.classList.add('clickable');
    part.dataset.act = 'skill';
    part.title = '点击启动技能';
    part.addEventListener('click', onActivate);
  }
  return part;
}

function skillsBlock(
  skills: { side: 'left' | 'right' | 'only'; name: string; type: string; text: string }[],
  showText: boolean,
  id: string,
  _artifact?: unknown,
  state?: GameState,
  actual?: Artifact,
  rowClick?: (side: 'left' | 'right' | 'only', type: string) => (() => void) | null,
): HTMLElement {
  const allOnly = skills.every((s) => s.side === 'only');
  const box = el('div', showText ? 'skills' : `skills skills--inline${allOnly ? ' skills--inline--only' : ''}`);
  const groups = new Map<string, typeof skills>();
  for (const s of skills) {
    const g = groups.get(s.name);
    if (g) g.push(s);
    else groups.set(s.name, [s]);
  }
  let idx = 0;
  let borrow = false;
  for (const [name, parts] of groups) {
    const wide = !showText && parts.some((p) => p.side !== 'only' && Array.from(p.name).length > 4);
    const skill = el('div', `skill skill--${parts[0]?.side ?? 'only'}${wide ? ' skill--name-wide' : ''}`);
    if (wide) borrow = true;
    for (const s of parts) {
      const visual: SkillPartVisual =
        state && actual
          ? skillPartState({ state }, actual, s)
          : previewSkillOn(id, idx)
            ? 'on'
            : 'off';
      const onClick = rowClick?.(s.side, s.type) ?? undefined;
      skill.appendChild(skillPart({ ...s, name }, visual, showText, onClick));
      idx += 1;
    }
    box.appendChild(skill);
  }
  if (borrow) box.classList.add('skills--borrow');
  return box;
}

function cardArt(id: string, name: string, prefs: Prefs): HTMLElement {
  const art = el('div', `card-art${prefs.cardArt === 'thumb' ? ' card-art--thumb' : ''}`);
  const img = image(`./cards/${id}.jpg`, name);
  img.className = 'card-art-img';
  art.appendChild(img);
  if (isAltArtifact(id)) {
    const badge = el('span', 'card-alt-badge');
    badge.textContent = '异相';
    art.appendChild(badge);
  }
  if (ARTIFACTS[id]?.special) {
    const badge = el('span', 'card-special-badge');
    badge.textContent = '特典';
    art.appendChild(badge);
  }
  return art;
}

function artifactCard(
  artifact: {
    id: string;
    name: string;
    column: number;
    count?: number;
    countCap?: number;
    chargeLayer?: number;
    chargeReq?: number;
    activeMarkerSide?: 'left' | 'right' | null;
    allSidesActiveThisTurn?: boolean;
    continuousLost?: boolean;
    heldDice?: { id: string; value: number }[];
  },
  team: TwoVTwoTeam,
  prefs: Prefs,
  state?: GameState,
  seat?: TwoVTwoSeat,
  onSkillClick?: SkillRowClickHandler,
): HTMLElement {
  const card = el('div', 'card');
  card.dataset.artifact = artifact.id;
  const a = ARTIFACTS[artifact.id];
  const text = ARTIFACT_TEXT[artifact.id];
  const actual = state && seat ? state.players[seat].artifacts.find((x) => x.id === artifact.id) : undefined;
  if (!a) return card;

  const head = el('div', 'card-head');
  const name = el('span', 'card-name');
  name.textContent = a.name;
  head.appendChild(name);
  const runtimeArt = actual ?? makeArtifact(artifact.id);
  const player = seat ? state?.players[seat] ?? null : null;
  const sub = el('span', 'card-sub');
  appendParts(sub, metaParts(runtimeArt, player, state));
  head.appendChild(sub);

  if (runtimeArt.count > 0) {
    const count = el('span', 'badge badge-count');
    count.textContent = countText(runtimeArt, player);
    const key = `${seat ?? team}:${artifact.id}`;
    const counts = state ? (lastCount2v2.get(state) ?? new Map<string, number>()) : new Map<string, number>();
    const prev = counts.get(key);
    if (prev !== undefined && prev !== runtimeArt.count) bumpEl(count);
    counts.set(key, runtimeArt.count);
    if (state) lastCount2v2.set(state, counts);
    head.appendChild(count);
  }
  const heldDice = runtimeArt.heldDice ?? artifact.heldDice ?? [];
  if (heldDice.length > 0) {
    head.classList.add('card-head--held');
    const held = el('div', 'pay-dices card-held card-held--head');
    held.addEventListener('click', (e) => e.stopPropagation());
    held.addEventListener('pointerdown', (e) => e.stopPropagation());
    for (const h of heldDice) {
      const d = el('span', 'pay-die pay-die--held');
      d.dataset.id = h.id;
      d.dataset.value = String(h.value);
      d.textContent = String(h.value);
      held.appendChild(d);
    }
    head.appendChild(held);
  }

  card.appendChild(head);
  card.appendChild(cardArt(artifact.id, a.name, prefs));
  if (text?.skills?.length) {
    const rowClick =
      onSkillClick && seat
        ? (side: 'left' | 'right' | 'only', type: string) => onSkillClick(seat, artifact.id, side, type)
        : undefined;
    card.appendChild(
      skillsBlock(text.skills, prefs.showSkillText, artifact.id, artifact, state, actual, rowClick),
    );
  }
  const specialNote = artifactDetailNote(artifact.id);
  if (specialNote) {
    const note = el('div', 'card-special-note');
    note.textContent = specialNote;
    card.appendChild(note);
  }
  return card;
}

function buildView(setup: TwoVTwoSetup): ViewState {
  const seats = {} as Record<TwoVTwoSeat, SeatView>;
  const teams: Record<TwoVTwoTeam, TeamView> = {
    A: { life: 0, lifeMax: 0 },
    B: { life: 0, lifeMax: 0 },
  };
  for (const seat of SEATS) {
    const team = TEAM_OF[seat];
    const artifacts = setup.seats[seat].map((id, index) => ({
      id,
      name: makeArtifact(id).name,
      column: index + 1,
    }));
    seats[seat] = {
      seat,
      team,
      color: SEAT_COLOR[seat],
      artifacts,
      dice: MOCK_DICE[seat],
    };
    const thirdLife = makeArtifact(setup.seats[seat][2]).life ?? 0;
    teams[team].lifeMax += thirdLife;
  }
  for (const team of ['A', 'B'] as TwoVTwoTeam[]) {
    teams[team].lifeMax = Math.max(1, teams[team].lifeMax);
    teams[team].life = teams[team].lifeMax;
  }
  return {
    seats,
    teams,
    activeSeat: setup.firstTeam === 'A' ? 'A1' : 'B1',
    log: [
      { actor: 'A1', text: '回合开始，获得并重掷初始能力骰。' },
      { actor: 'B1', text: '完成尘起阶段，尘落 +1。' },
      { actor: 'A2', text: '启动「王家之拳」，获得 2 个攻击骰。' },
      { actor: 'B2', text: '攻击 A 队，造成 4 点伤害。' },
    ],
  };
}

function areaRow(seat: SeatView, top: boolean, onDieClick?: (id: string) => void, selected?: Set<string>): HTMLElement {
  const row = el('div', 'areas');
  for (const kind of top ? AREA_ORDER_TOP : AREA_ORDER_BOTTOM) {
    const values = seat.dice[kind];
    const ids = seat.diceIds?.[kind];
    const area = el('div', 'area');
    area.dataset.kind = kind;
    const label = el('div', 'area-label');
    label.textContent = `${AREA_CN[kind]}（${values.length}）`;
    const dice = el('div', 'dice');
    values.forEach((value, index) => {
      const die = el('span', `die die-${seat.seat}${onDieClick ? ' clickable' : ''}${selected?.has(ids?.[index] ?? '') ? ' selected' : ''}`);
      die.dataset.id = ids?.[index] ?? `${seat.seat}-${kind}-${index}`;
      die.dataset.value = String(value);
      die.style.background = seat.color;
      die.style.color = SEAT_INK[seat.seat];
      die.textContent = String(value);
      if (onDieClick) die.addEventListener('click', (ev) => { ev.stopPropagation(); onDieClick(die.dataset.id ?? ''); });
      dice.appendChild(die);
    });
    area.append(label, dice);
    if ((seat.hasSeal ?? seat.seat === 'B2') && kind === 'meditation') {
      const seal = el('span', 'badge badge-seal area-seal');
      seal.textContent = '尘印';
      area.appendChild(seal);
    }
    row.appendChild(area);
  }
  return row;
}

function playerPanel(seat: SeatView, view: ViewState, top: boolean, prefs: Prefs, state?: GameState, onDieClick?: (seat: TwoVTwoSeat, id: string) => void, selected?: Set<string>, onSkillClick?: SkillRowClickHandler): HTMLElement {
  const panel = el('div', `player player--2v2 ${top ? 'player--enemy' : 'player--self'}`);
  panel.dataset.player = seat.seat;
  panel.style.setProperty('--pc', seat.color);
  if (seat.seat === view.activeSeat) panel.classList.add('player--acting');

  const body = el('div', 'pbody');
  const cards = el('div', 'cards');
  const artifacts = prefs.mirrorEnemy && top ? [...seat.artifacts].reverse() : seat.artifacts;
  for (const artifact of artifacts) cards.appendChild(artifactCard(artifact, seat.team, prefs, state, seat.seat, onSkillClick));

  // 传奇/战术预留槽：现在隐藏、不占空间；接传奇/战术时填入并解除 hidden。
  const legendSlot = el('div', 'b2v2-legend-slot');
  legendSlot.dataset.role = 'legend-tactic-slot';
  legendSlot.hidden = true;

  const areas = areaRow(seat, top, onDieClick ? (id) => onDieClick(seat.seat, id) : undefined, selected);
  if (top) {
    body.append(cards, legendSlot);
    panel.append(body, areas);
  } else {
    panel.append(areas, body);
    body.append(legendSlot, cards);
  }
  return panel;
}

function sideRow(team: TwoVTwoTeam, view: ViewState, top: boolean, prefs: Prefs): HTMLElement {
  const row = el('div', 'side-row');
  for (const seat of TEAM_MEMBERS[team]) {
    row.appendChild(playerPanel(view.seats[seat], view, top, prefs));
  }
  return row;
}

function teamRow(team: TwoVTwoTeam, view: ViewState, top: boolean): HTMLElement {
  const row = el('div', `team-row team-row--${team}`);
  for (const seat of TEAM_MEMBERS[team]) {
    const head = el(
      'div',
      `team-head ${top ? 'team-head--top' : 'team-head--bottom'}${seat === 'A1' || seat === 'B2' ? ' team-head--right' : ''}`,
    );
    head.dataset.player = seat;
    head.style.setProperty('--pc', SEAT_COLOR[seat]);
    const dot = el('span', 'dot');
    const who = el('span', 'team-seat');
    who.textContent = seatName(seat);
    const tag = el('span', 'ptag');
    tag.textContent = `${team} 队`;
    head.append(dot, who, tag);
    if (seat === view.activeSeat) {
      head.classList.add('team-head--acting');
      const acting = el('span', 'ph-right ph-right--active');
      acting.textContent = '行动中';
      head.appendChild(acting);
    }
    row.appendChild(head);
  }

  const line = el('div', 'lifeline lifeline--team');
  line.dataset.player = team;
  line.dataset.team = team;
  const who = el('span', `lifeline-who player-${team}`);
  who.textContent = `${team} 队`;
  const track = el('span', 'lifeline-track');
  const fill = el('span', `lifeline-fill bg-${team}`);
  fill.style.background = TEAM_COLOR[team];
  const { life, lifeMax } = view.teams[team];
  fill.style.transform = `scaleX(${life / Math.max(1, lifeMax)})`;
  track.appendChild(fill);
  const hp = el('span', 'lifeline-hp');
  hp.textContent = `生命 ${life}/${lifeMax}`;
  line.append(who, track, hp);
  row.appendChild(line);
  return row;
}

function stanceToken(stance: Stance, onToggle: () => void): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'stance-token';
  b.dataset.side = stance === 'attackPicks' ? 'atk' : 'def';
  b.dataset.act = 'stanceToggle';
  b.title = `攻守标记：${stance === 'attackPicks' ? '攻方选择' : '守方选择'}`;
  b.setAttribute('aria-label', b.title);
  b.appendChild(image(stance === 'attackPicks' ? './ui/stance-atk.png' : './ui/stance-def.png', ''));
  b.addEventListener('click', onToggle);
  return b;
}

function votePanel(
  view: ViewState,
  votes: Partial<Record<TwoVTwoSeat, TwoVTwoSeat>>,
  onVote: (voter: TwoVTwoSeat, choice: TwoVTwoSeat) => void,
): HTMLElement {
  const defenderTeam: TwoVTwoTeam = TEAM_OF[view.activeSeat] === 'A' ? 'B' : 'A';
  const voters = TEAM_MEMBERS[defenderTeam];
  const panel = el('div', 'b2v2-vote');
  panel.dataset.role = 'team-vote';

  // 提示 + 两个投票人（各自的座位按钮）。
  // 折行规则（用户 2026-11-07 定）：**有位置就一行**；不够时＝提示一行、**两个投票组一起**下一行
  //（所以两组包在 `.b2v2-vote-groups` 里，永远同进退，不会被拆成三行）。
  const line = el('div', 'b2v2-vote-line');
  const tip = el('span', 'b2v2-vote-tip');
  tip.textContent = '请两位守方玩家投票决定由谁承受本次攻击；投票不一致会重新选择。';
  line.appendChild(tip);
  const groups = el('span', 'b2v2-vote-groups');
  for (const voter of voters) {
    const col = el('span', 'b2v2-vote-col');
    col.dataset.voter = voter;
    const who = el('span', `b2v2-vote-who hint-player player-${voter}`);
    who.textContent = seatName(voter);
    const arrow = el('span', 'b2v2-vote-arrow');
    arrow.textContent = '▸';
    const row = el('span', 'option-row');
    for (const choice of voters) {
      const b = button(`btn option-btn player-${choice}`, seatName(choice));
      b.dataset.choice = choice;
      if (votes[voter] === choice) b.classList.add('option-btn--on');
      b.addEventListener('click', () => onVote(voter, choice));
      row.appendChild(b);
    }
    col.append(who, arrow, row);
    groups.appendChild(col);
  }
  line.appendChild(groups);
  panel.appendChild(line);

  return panel;
}

function centerband(
  view: ViewState,
  stance: Stance,
  votes: Partial<Record<TwoVTwoSeat, TwoVTwoSeat>>,
  message: string,
  onStance: () => void,
  onVote: (voter: TwoVTwoSeat, choice: TwoVTwoSeat) => void,
  onSettings: () => void,
): HTMLElement {
  const center = el('div', 'centerband');
  const left = el('div', 'centerband-left');
  const zone = el('div', 'actionzone');

  const hint = el('div', 'hint');
  const hintLeft = el('div', 'hint-left');
  const turn = el('span', 'hint-turn');
  turn.textContent = '轮到 ';
  const who = el('span', 'hint-player');
  who.textContent = seatName(view.activeSeat);
  who.style.color = SEAT_COLOR[view.activeSeat];
  who.style.fontWeight = '700';
  turn.appendChild(who);
  turn.appendChild(document.createTextNode(' 行动'));
  const phase = el('span', 'hint-phase');
  phase.textContent = '主要阶段 · 演示';
  const notes = el('div', 'hint-notes');
  notes.textContent =
    stance === 'attackPicks'
      ? '攻守标记：攻方选择（攻方点名目标）'
      : `守方投票：${message}`;
  hintLeft.append(turn, phase, notes);
  hint.appendChild(hintLeft);

  const list = el('div', 'actionlist');
  if (stance === 'defensePicks') {
    list.appendChild(votePanel(view, votes, onVote));
  } else {
    const attack = button('btn btn-skill', '攻击（演示）');
    attack.disabled = true;
    attack.title = '战斗引擎接入中';
    const end = button('btn', '结束回合（演示）');
    end.disabled = true;
    end.title = '战斗引擎接入中';
    list.append(attack, end);
  }

  zone.append(hint, list);
  const side = el('div', 'zone-side');
  const dust = el('span', 'hint-dust');
  const dustLabel = el('span', 'hint-dust-label');
  dustLabel.textContent = '尘落';
  const dustNum = el('span', 'hint-dust-num');
  dustNum.textContent = '0';
  const dustMax = el('span', 'hint-dust-max');
  dustMax.textContent = '/ 10';
  dust.append(dustLabel, dustNum, dustMax);
  side.append(dust, stanceToken(stance, onStance));
  zone.appendChild(side);
  left.appendChild(zone);
  center.appendChild(left);

  const right = el('div', 'centerband-right');
  const settings = button('btn btn-settings', '设置');
  settings.dataset.act = 'settingsOpen';
  settings.addEventListener('click', onSettings);
  right.appendChild(settings);
  center.appendChild(right);
  return center;
}

function appendColoredLog2v2(row: HTMLElement, text: string): void {
  const re = /(玩家A1|玩家A2|玩家B1|玩家B2|「[^」]+」)/g;
  let last = '';
  let at = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > at) row.appendChild(document.createTextNode(text.slice(at, m.index)));
    const token = m[0];
    if (token.startsWith('玩家')) {
      last = token.slice(2);
      const span = document.createElement('span');
      span.className = `log-actor player-${last}`;
      span.textContent = token;
      row.appendChild(span);
    } else {
      const span = document.createElement('span');
      span.className = last ? `log-skill player-${last}` : 'log-skill';
      span.textContent = token;
      row.appendChild(span);
    }
    at = m.index + token.length;
  }
  if (at < text.length) row.appendChild(document.createTextNode(text.slice(at)));
}
function logContent(view: ViewState): HTMLElement {
  const log = el('div', 'log');
  for (const line of view.log) {
    const row = el('div', 'log-line');
    if (line.turn !== undefined && line.phase) {
      const prefix = el('span', 'log-prefix');
      prefix.textContent = `T${line.turn}·${PHASE_LABEL[line.phase]}：`;
      row.appendChild(prefix);
    }
    appendColoredLog2v2(row, line.text);
    log.appendChild(row);
  }
  return log;
}

function logTab(open: () => void): HTMLElement {
  const b = button('log-tab', '');
  b.dataset.act = 'logOpen';
  b.title = '战报';
  const tri = el('span', 'log-tab-tri');
  b.appendChild(tri);
  b.addEventListener('click', open);
  return b;
}

function logDrawer(view: ViewState, close: () => void): HTMLElement {
  const overlay = el('div', 'log-overlay');
  const drawer = el('div', 'log-drawer');
  drawer.appendChild(logContent(view));
  overlay.appendChild(drawer);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  return overlay;
}

export function render2v2Battle(root: HTMLElement, setup: TwoVTwoSetup, onBack: () => void): void {
  const view = buildView(setup);
  let prefs: Prefs = loadPrefs();
  let stance: Stance = 'attackPicks';
  let votes: Partial<Record<TwoVTwoSeat, TwoVTwoSeat>> = {};
  let message = '等待双方投票…';
  let settingsOpen = false;
  let logOpen = false;

  document.documentElement.classList.add('mode-2v2');
  root.classList.remove('setup-page', 'setup-2v2', 'setup-2v2-test');
  root.classList.add('battle2v2-root');
  root.innerHTML = '';

  const stage = el('div', 'stage');
  const board = el('div', 'board--2v2');
  stage.appendChild(board);
  const overlayLayer = el('div', 'preview-overlays');
  root.append(stage, overlayLayer);

  const activeTeam = TEAM_OF[view.activeSeat];
  const topTeam: TwoVTwoTeam = activeTeam === 'A' ? 'B' : 'A';
  const bottomTeam = activeTeam;
  const defenderTeam: TwoVTwoTeam = topTeam;
  const voters = TEAM_MEMBERS[defenderTeam];

  const onVote = (voter: TwoVTwoSeat, choice: TwoVTwoSeat): void => {
    votes = { ...votes, [voter]: choice };
    if (voters.every((v) => votes[v])) {
      const chosen = new Set(voters.map((v) => votes[v]));
      if (chosen.size === 1) {
        message = `已决定：${seatName(choice)}`;
      } else {
        message = '选择不一致，请重新投票';
        votes = {};
      }
    } else {
      message = '等待另一票…';
    }
    draw();
  };

  const draw = (): void => {
    board.innerHTML = '';
    overlayLayer.innerHTML = '';
    board.className = `board--2v2 density-${prefs.density}${prefs.showSkillText ? ' show-text' : ''}${prefs.cardArt === 'full' ? ' card-art-full' : ''}`;

    if (!prefs.logCollapsed) {
      const sidebar = el('div', 'sidebar');
      sidebar.appendChild(logContent(view));
      board.appendChild(sidebar);
    } else {
      board.appendChild(logTab(() => {
        logOpen = true;
        draw();
      }));
    }

    const main = el('div', 'main');
    const topbar = el('div', 'b2v2-topbar');
    const back = button('btn b2v2-back', '← 返回左右互搏');
    back.dataset.act = 'b2v2Back';
    back.addEventListener('click', () => {
      document.documentElement.classList.remove('mode-2v2');
      root.classList.remove('battle2v2-root');
      onBack();
    });
    const title = el('span', 'b2v2-title');
    title.textContent = '团队作战 · 2v2';
    const badge = el('span', 'b2v2-badge');
    badge.textContent = '战斗引擎接入中（界面壳）';
    topbar.append(back, title, badge);
    main.appendChild(topbar);

    main.appendChild(sideRow(topTeam, view, true, prefs));
    main.appendChild(teamRow(topTeam, view, false));
    main.appendChild(
      centerband(
        view,
        stance,
        votes,
        message,
        () => {
          stance = stance === 'attackPicks' ? 'defensePicks' : 'attackPicks';
          draw();
        },
        onVote,
        () => {
          settingsOpen = true;
          draw();
        },
      ),
    );
    main.appendChild(teamRow(bottomTeam, view, true));
    main.appendChild(sideRow(bottomTeam, view, false, prefs));
    board.appendChild(main);

    applyZoomShared(stage, prefs);

    if (logOpen && prefs.logCollapsed) {
      overlayLayer.appendChild(logDrawer(view, () => {
        logOpen = false;
        draw();
      }));
    }
    if (settingsOpen) {
      overlayLayer.appendChild(
        renderSettingsPanel(
          { players: {} } as unknown as GameState,
          prefs,
          (next) => {
            prefs = next;
            savePrefs(next);
            draw();
          },
          () => {
            settingsOpen = false;
            draw();
          },
        ),
      );
    }
  };

  draw();
}

/** 阶段 6A：真实 2v2 对局的最小可操作界面。 */
export interface TwoVTwoGameHooks {
  onAction: (a: Action) => void;
  onBack: () => void;
  onRestart?: () => void;
  requestRender?: () => void;
  error?: string | null;
}

function dieValueOf(state: GameState, id: string): number | undefined {
  for (const p of Object.values(state.players)) {
    for (const k of ['attack', 'defense', 'meditation'] as DiceKind[]) {
      const d = p.areas[k].find((x) => x.id === id);
      if (d) return d.value;
    }
    for (const card of p.artifacts) {
      const h = card.heldDice?.find((x) => x.id === id);
      if (h) return h.value;
    }
  }
  return undefined;
}

function dieText2v2(state: GameState, id: string): string {
  for (const p of Object.values(state.players)) {
    for (const kind of ['attack', 'defense', 'meditation'] as DiceKind[]) {
      const d = p.areas[kind].find((x) => x.id === id);
      if (d) return `${AREA_CN[kind][0]}${d.value}`;
    }
    for (const card of p.artifacts) {
      const h = card.heldDice?.find((x) => x.id === id);
      if (h) return String(h.value);
    }
  }
  return '?';
}
function actionLabel(state: GameState, a: Action): string {
  if (a.t === 'attack') {
    const id = a.costSlots?.[0]?.dieIds?.[0];
    const die = id ? dieText2v2(state, id) : '?';
    return a.target ? `攻击：${die} → ${a.target}` : `攻击：${die}`;
  }
  if (a.t === 'block') return a.costSlots?.some((s) => s.dieIds.length > 0) ? '抵挡' : '不抵挡';
  if (a.t === 'dustRise') {
    const art = state.players[state.activePlayer]?.artifacts.find((x) => x.id === a.artifactId);
    if (art) return dustEntryLabel(art, !!a.free);
    return ARTIFACTS[a.artifactId]?.name ?? '尘起';
  }
  if (a.t === 'advance') return advanceLabel(state.phase);

  if (a.t === 'skill') {
    const key = skillKeyForAction(state, a);
    const name = skillBubbleName(state, state.activePlayer, a.artifactId, a.side, key) || '技能';
    const kind = skillKindOf(state, state.activePlayer, a.artifactId, key);
    if (kind === 'activation') return `结算「${name}」（激活·立即生效）`;
    if (kind === 'ultimate') return `发动必杀：「${name}」`;
    return `启动技能：${name}`;
  }
  // 待决策 / 触发类：**文案唯一来源是 1v1 的 `pendingActionLabel`**（不发动「X」等），
  // 这里只补 2v2 独有的"打谁"后缀。禁止在本文件另写一套待决策文案。
  const pend = pendingActionLabel(state, a);
  if (pend !== null) {
    const tgt = (a as unknown as { target?: unknown }).target;
    return typeof tgt === 'string' ? `${pend} → ${seatName(tgt as PlayerId)}` : pend;
  }
  const labels: Partial<Record<string, string>> = {
    reroll: '重掷',
    weimu: '帷幕',
    zhihaiReroll: '至黑·重掷',
    chenaiFreeRise: '尘哀·免费尘起',
    kongYuluo: '雨落狂流',
    anyexiongshen: '暗夜凶神',
    bacheng: '拔城',
    wufaraoshu: '无法饶恕',
    yuanwu: '圆舞',
    shizushouhun: '始祖兽魂',
    shangjin: '只为赏金而来',
    dizuidaijianshu: '涤罪大剑术',
    nudengzuiren: '汝等罪人',
    tacticPick: '选择战术',
    tacticDice: '自定初始骰',
    tacticFirst: '选择先手',
    tacticGuess: '远见·猜测',
    yuhuiPlace: '迂回',
    yingziPick: '影子·选点',
    yuanjianGain: '远见·奖励',
    youdiMove: '诱敌',
    shipeiPick: '适应',
    challengePick: '代决',
    challengeStep: '推进',
    shouhunCancel: '兽魂',
    weiyaPick: '威压',
    xianzhenResolve: '陷阵',
    hengguan: '横贯',
    hanguangPick: '凛冽之音',
    quanzhiAssign: '全知',
    kuyuResolve: '低语',
    tiaolingResolve: '死亡亦逝',
    endDiscardResolve: '结束弃骰',
    wanzhangDiscard: '万丈明光',
    putiResolve: '不动菩提',
  };
  const base = labels[a.t] ?? '选择';
  const extra: string[] = [];
  const raw = a as unknown as Record<string, unknown>;
  for (const key of ['dieId', 'defenseDieId', 'meditationDieId', 'attackDieId', 'targetDieId']) {
    const id = raw[key];
    if (typeof id === 'string') {
      const v = dieValueOf(state, id);
      if (v !== undefined) {
        extra.push(
          `${key === 'defenseDieId' ? '防御' : key === 'meditationDieId' ? '冥想' : '骰'}${v}`,
        );
      }
    }
  }
  const choiceLabels: Record<string, string> = {
    none: '不发动',
    unblockable: '伤害 +1 且不可抵挡',
    bonus5: '伤害 +5',
    gain: '获得',
    discard: '弃置',
    decline: '不发动',
    diff: '全不同',
    same: '全相同',
    move: '移入区域',
    block: '抵挡',
    attack: '攻击',
    defense: '防御',
    meditation: '冥想',
  };
  for (const key of ['pick', 'choice', 'to', 'area']) {
    const value = raw[key];
    if (typeof value === 'string' && choiceLabels[value]) extra.push(choiceLabels[value]);
  }
  if (Array.isArray(raw.dieIds)) extra.push(`${raw.dieIds.length} 颗`);
  if (raw.accept === false) extra.push('不发动');
  if (raw.accept === true) extra.push('发动');
  if (typeof raw.target === 'string') extra.push(`→${seatName(raw.target as PlayerId)}`);
  return extra.length ? `${base}（${extra.join('，')}）` : base;
}

function skillKeyForAction(state: GameState, a: Extract<Action, { t: 'skill' }>): string | undefined {
  const card = state.players[state.activePlayer]?.artifacts.find((x) => x.id === a.artifactId);
  const isChargeCtx =
    state.pending?.kind === 'chargeResolve' && state.pending.artifactId === a.artifactId;
  return card?.skills.find(
    (s) =>
      s.side === a.side &&
      (isChargeCtx
        ? s.kind === 'charge'
        : s.kind === 'activate' || s.kind === 'activation' || s.kind === 'ultimate'),
  )?.key;
}

/** 目标候选只从技能自己的 seat 步骤取；绝不退回“场上全座位”。 */
function skillSeatCandidates(state: GameState, a: Extract<Action, { t: 'skill' }>): TwoVTwoSeat[] {
  const key = skillKeyForAction(state, a);
  const spec = key ? SKILL_SELECTION[key] : undefined;
  if (!spec) return [];
  try {
    const steps = spec.steps({
      state,
      player: state.activePlayer,
      chosenDice: [],
      options: [],
      numbers: [],
      slots: [],
    });
    const seat = steps.find((s) => s.kind === 'seat');
    return seat ? (seat.candidates as TwoVTwoSeat[]) : [];
  } catch {
    return [];
  }
}

function actionTargets(state: GameState, a: Action): TwoVTwoSeat[] {
  if (a.t === 'attack') return enemiesOf(state, state.activePlayer) as TwoVTwoSeat[];
  if (a.t === 'skill') return skillSeatCandidates(state, a);
  if (a.t === 'aidao' || a.t === 'shenhongKill' || a.t === 'dunwuPulse') {
    // 待决策的"打谁"由**决策人**决定；不要写死 activePlayer（跨回合强制触发时两者可能不同）。
    const owner = (state.pending?.player ?? state.activePlayer) as PlayerId;
    return enemiesOf(state, owner) as TwoVTwoSeat[];
  }
  if (a.t === 'weiyaPick') {
    return [
      state.activePlayer as TwoVTwoSeat,
      ...(enemiesOf(state, state.activePlayer) as TwoVTwoSeat[]),
    ];
  }
  return [];
}

/**
 * **纯选对象型待决策**（按"动作形状"判定，**不按卡号**）。
 *
 * 命中条件：引擎给的动作只有「接受 / 放弃」，且"接受"除了**打谁**之外没有任何其它参数
 * （没有骰子 id、没有 `costSlots`、没有 pick/选项…），并且目标候选 > 1。
 *
 * 命中的一律摊成**一行**：`目标 [玩家B1] [玩家B2] [不发动「X」]`（点目标即提出动作，少一步）。
 * 现在的成员：010 杀意 / 011 灵能脉冲 / A02 哀悼（对方无防御骰那版）。
 *
 * **反例（不得合并，保持原样）**：
 * - 纯是/否、**没有对象**（雷暴·重掷 / 慈悲）→ 保留「发动」入口；
 * - 还要选骰或选组合（009 高塔铁幕 / 011 灵能屏障 / 004 锋芒 / 026 威压）→ 不是"纯选对象"。
 *
 * 新增同形状 pending **不需要**改这里，自动适用；新增"既要选对象又要选骰"的 pending 也不会被误合并。
 */
function pureTargetPending(state: GameState, a: Action): boolean {
  if ((a as { accept?: boolean }).accept === false) return false; // "放弃"不是"选对象"
  if (
    a.t === 'attack' ||
    a.t === 'block' ||
    a.t === 'skill' ||
    a.t === 'advance' ||
    a.t === 'dustRise' ||
    a.t === 'reroll'
  ) {
    return false;
  }
  for (const k of Object.keys(a)) {
    if (k === 't' || k === 'accept' || k === 'target') continue;
    return false; // 还有别的参数（骰 / 代价 / 选项）→ 不是"纯选对象"
  }
  return actionTargets(state, a).length > 1; // 只有一个候选时不需要对象步
}

function teamLifeDeltas2v2(state: GameState): LifeDelta[] {
  const cur: Record<TwoVTwoTeam, { life: number; max: number }> = {
    A: { life: state.teams?.A?.life ?? 0, max: state.teams?.A?.lifeMax ?? 1 },
    B: { life: state.teams?.B?.life ?? 0, max: state.teams?.B?.lifeMax ?? 1 },
  };
  const prev = lastTeamLife.get(state);
  lastTeamLife.set(state, cur);
  if (!prev) return [];
  const out: LifeDelta[] = [];
  for (const team of ['A', 'B'] as const) {
    const delta = cur[team].life - prev[team].life;
    if (delta !== 0) out.push({ player: team, delta, max: cur[team].max });
  }
  return out;
}

/** 生命变化要抖动的面板：`team` 是**队**（A/B），映射到该队全部座位（A1/A2）。攻击/真伤两条路径共用。 */
function teamPanelsOf2v2(root: HTMLElement): (team: string) => HTMLElement[] {
  return (team) => Array.from(root.querySelectorAll<HTMLElement>(`.player[data-player^="${team}"]`));
}

function artEl2v2(root: HTMLElement, seat: PlayerId, artifactId: string): HTMLElement | null {
  return (
    root.querySelector<HTMLElement>(`.player[data-player="${seat}"] .card[data-artifact="${artifactId}"] .card-art`) ??
    root.querySelector<HTMLElement>(`.player[data-player="${seat}"] .card[data-artifact="${artifactId}"] .card-head`) ??
    root.querySelector<HTMLElement>(`.player[data-player="${seat}"]`)
  );
}

function run2v2Motions(
  root: HTMLElement,
  state: GameState,
  prevDice: ReturnType<typeof snapshotDice>,
  prevStored: ReturnType<typeof snapshotStored>,
  fxEvents: FxEvent[],
  lifeDeltas: LifeDelta[],
  /** 换队帧：这些座位（＝**新视角那一队**）的「获得骰」延后到切换后播（1v1 同款：先切视角，再让骰子飞入） */
  deferAdds: readonly PlayerId[] | null = null,
): number {
  const pa = state.pendingAttack;
  const prevPa = lastAttack2v2.get(state) ?? null;
  const attacking = !!(pa || prevPa);
  const payIds = new Set<string>();
  const blockIds = new Set<string>();
  const moveIds = new Set<string>();
  const fromCard = new Set<string>();
  const hanguangs: { player: PlayerId; mode: 'move' | 'discard'; heldId: string; opponentId?: string }[] = [];
  const rerollIds = new Set<string>();
  const weijuIds = new Set<string>();
  let weijuInit: Extract<FxEvent, { kind: 'weiju' }> | null = null;
  let weijuPay: Extract<FxEvent, { kind: 'weiju' }> | null = null;
  for (const e of fxEvents) {
    if (e.kind === 'pay') for (const id of e.removedIds) payIds.add(id);
    else if (e.kind === 'block') for (const id of e.dieIds) blockIds.add(id);
    else if (e.kind === 'move') {
      for (const id of e.dieIds) moveIds.add(id);
      for (const id of e.fromCard ?? []) fromCard.add(id);
    } else if (e.kind === 'hanguang') hanguangs.push(e);
    else if (e.kind === 'reroll') for (const id of e.dieIds) rerollIds.add(id);
    else if (e.kind === 'weiju') {
      for (const id of e.dieIds) weijuIds.add(id);
      if (e.mode === 'initiate') weijuInit = e;
      else weijuPay = e;
    }
  }
  // P1/P2 护栏（照 1v1）：「一颗骰只由一条动画负责」——本帧若有 `pay` 事件（置换 / 用到 034 存放骰），
  // 它 `removedIds` 里的骰就**不再交给攻击池的补骰 / park 动画**（否则同一颗骰两套动画 → 重影）。
  const paidIds = new Set<string>();
  for (const e of fxEvents) if (e.kind === 'pay') for (const id of e.removedIds) paidIds.add(id);
  const joinCoveredByPay = (dieIds: string[]): boolean => dieIds.some((id) => paidIds.has(id));
  // 攻击池"另一方补一颗骰"（011 / 034）：attackJoin 事件 + 034 让防御骰"停住"的 block.park
  const attackJoins = fxEvents.filter(
    (e): e is Extract<FxEvent, { kind: 'attackJoin' }> => e.kind === 'attackJoin',
  );
  const parkedBlock = fxEvents.find(
    (e): e is Extract<FxEvent, { kind: 'block' }> => e.kind === 'block' && !!e.park,
  );
  // A06 勾魂：攻击骰飞向神器标题栏 → 落地变灰存放骰（专用飞行，1v1 有、2v2 必须同样有）
  const gouhuns = fxEvents.filter((e): e is Extract<FxEvent, { kind: 'gouhun' }> => e.kind === 'gouhun');
  const holdAttackDie = fxEvents.find(
    (e): e is Extract<FxEvent, { kind: 'holdAttackDie' }> => e.kind === 'holdAttackDie',
  );
  const heldId = heldAttackDieId();
  const heldReleaseDur =
    !holdAttackDie && state.pending?.kind !== 'caiyuliu' && state.pending?.kind !== 'c01Caiyuliu'
      ? releaseHeldAttackDie(root)
      : 0;
  const exclude = new Set<string>([...payIds, ...blockIds, ...weijuIds]);
  if (pa?.sourceDieId) exclude.add(pa.sourceDieId);
  // 裁雨流：已落区的真骰由 releaseHeldAttackDie 独占收尾，排除出通用“获得/让位”。
  if (
    heldId &&
    Object.values(state.players).some((p) =>
      (['attack', 'defense', 'meditation'] as const).some((k) =>
        p.areas[k].some((d) => d.id === heldId),
      ),
    )
  ) {
    exclude.add(heldId);
  }
  // 由攻击池接管：补骰（011/034）、A06 勾魂落地的存放骰 → 不参与通用"获得/让位"。
  for (const e of attackJoins) for (const id of e.dieIds) exclude.add(id);
  for (const g of gouhuns) exclude.add(g.chipId);
  const pays: PayInfo[] = [];
  for (const e of fxEvents) {
    if (e.kind !== 'pay') continue;
    const fc = new Set(e.fromCard ?? []);
    const dice = e.removedIds
      .map((id) => {
        const pd = prevDice.get(id);
        const ps = prevStored.get(id);
        if (pd) return { id, rect: pd.rect, value: pd.value };
        if (ps) return { id, rect: ps.rect, value: ps.value, held: fc.has(id) };
        return null;
      })
      .filter((d): d is NonNullable<typeof d> => d != null);
    if (dice.length) pays.push({ player: e.player, groups: e.groups, dice });
  }
  // 攻击支付 = 含"被支付攻击骰"的那笔支付（按骰子重合识别，覆盖 置换攻击 / 存放骰攻击）；其余走 playPayments。
  const attackPay =
    pa && pa.sourceDieId ? (pays.find((p) => p.dice.some((d) => d.id === pa.sourceDieId)) ?? null) : null;
  // 抵挡支付 = 含"抵挡骰"的那笔支付（按骰子重合识别，覆盖 **置换抵挡** / 存放骰抵挡）。
  // 与 1v1 同一口径：置换抵挡时**不能**再走通用 playPayments（会在中间合并成灰 5、盖住停在中间的攻击骰），
  // 必须交给攻击池的 `attackResolve({substitution})`，让它与攻击骰**左右并排**。
  const prevResolved = !!prevPa && prevPa !== pa;
  const blockPay = prevResolved
    ? (pays.find((p) => p.dice.some((d) => blockIds.has(d.id))) ?? null)
    : null;
  const otherPays = pays.filter(
    (p) => p !== attackPay && p !== blockPay && !p.dice.some((d) => weijuIds.has(d.id)),
  );
  // 取某笔支付里的"置换源"（给攻击池用；非置换 → null）
  const subOf = (pay: PayInfo | null, id?: string): { rects: Rect[]; values: number[] } | null => {
    if (!pay) return null;
    const grp = id ? pay.groups.find((gr) => gr.includes(id)) : pay.groups[0];
    if (!grp) return null;
    const dice = grp.map((gid) => pay.dice.find((d) => d.id === gid)).filter((d): d is PayDie => !!d);
    if (dice.length !== grp.length) return null;
    return { rects: dice.map((d) => d.rect), values: dice.map((d) => d.value) };
  };
  const blockSub = blockPay ? subOf(blockPay) : null;
  // 本帧仍在区域里的骰（2v2 有 4 个座位，**不能**用只遍历 A/B 的 `areaDieIds`）。
  const nextIds = new Set<string>();
  for (const seat of SEATS) {
    const p = state.players[seat];
    if (!p) continue;
    for (const k of ['defense', 'attack', 'meditation'] as const) for (const d of p.areas[k]) nextIds.add(d.id);
  }
  const payDur = playPayments(root, otherPays);
  const diceFx: DiceMoveFx = { moveIds: [...moveIds], fromCard: [...fromCard], hanguangs };
  const boardDur = runBoardMotions(
    root,
    prevDice,
    attacking ? [] : lifeDeltas,
    false,
    deferAdds,
    [...exclude],
    prevStored,
    rerollIds,
    diceFx,
    payDur,
    false,
    new Set(),
    true,
    teamPanelsOf2v2(root),
  );
  const targetOf = (p: NonNullable<GameState['pendingAttack']>): PlayerId =>
    p.defender ?? enemiesOf(state, p.attacker)[0];
  let attackDur = 0;
  let resolveDur = 0;
  if (prevPa && prevPa !== pa) {
    const blockId = [...blockIds][0];
    const pd = blockId ? prevDice.get(blockId) : undefined;
    const ps = blockId ? prevStored.get(blockId) : undefined;
    resolveDur = attackResolve(root, {
      defender: targetOf(prevPa),
      // 置换抵挡：不画单颗防御骰，改由 `substitution` 把 2 颗源骰合并成灰 5、与攻击骰并排
      blockDie: blockSub ? null : pd || ps ? { value: (pd ?? ps)!.value, rect: (pd ?? ps)!.rect } : null,
      substitution: blockSub,
      hold: holdAttackDie ? { dieId: holdAttackDie.dieId } : null,
    });
    attackDur = Math.max(attackDur, resolveDur);
  }
  if (pa && pa !== prevPa) {
    const value = pa.baseValue ?? pa.value;
    // 「代价先于效果」：上一帧有、这一帧没了的骰（且不归攻击池/支付/抵挡/畏惧池接管）＝本段代价
    // → 攻击骰必须等它（和搬家组）播完才起步。写死 `costDur: 0` 会让灰骰与玩家色骰同时飞（重影）。
    let costPresent = false;
    for (const id of prevDice.keys()) {
      if (exclude.has(id)) continue;
      if (!nextIds.has(id) && id !== pa.sourceDieId) {
        costPresent = true;
        break;
      }
    }
    const watchDur = attackWatchDelay({ costPresent, diceFx, resolveDur });
    const source = pa.sourceDieId ? (prevDice.get(pa.sourceDieId) ?? prevStored.get(pa.sourceDieId)) : null;
    attackDur = Math.max(attackDur, attackStart(root, {
      sig: pa,
      attacker: pa.attacker,
      target: targetOf(pa),
      value,
      virtual: !pa.physical,
      sourceRect: source?.rect ?? null,
      fromCard: !!(pa.sourceDieId && prevStored.has(pa.sourceDieId)),
      costDur: watchDur,
      substitution: subOf(attackPay, pa.sourceDieId ?? undefined),
      // 黑线在攻击起步时画（攻方在下方）；若这一帧随后要换视角，`settle` 会等它播完再切。
      line: true,
    }));
  }
  // 攻击池"另一方补一颗骰"（011 spend / 034 park·cancel）：并排、不遮挡 → 按 then 处理
  let joinDur = 0;
  for (const e of attackJoins) {
    if (joinCoveredByPay(e.dieIds)) continue;
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
  // A06 勾魂：攻击骰从中间飞向神器标题栏 → 变灰存放
  const gouhunDur = playGouhun(root, gouhuns);

  const rectsOf2v2 = (ids: string[]): { rects: { left: number; top: number; width: number; height: number }[]; values: number[] } => {
    const rects: { left: number; top: number; width: number; height: number }[] = [];
    const values: number[] = [];
    for (const id of ids) {
      const pd = prevDice.get(id);
      const ps = prevStored.get(id);
      const d = pd ?? ps;
      if (!d) continue;
      rects.push(d.rect);
      values.push(d.value);
    }
    return { rects, values };
  };
  let weijuDur = 0;
  if (weijuInit) {
    const src = rectsOf2v2(weijuInit.dieIds);
    weijuDur = weijuStart(root, { player: weijuInit.player, value: weijuInit.value, sourceRects: src.rects, values: src.values });
  } else if (weijuPay) {
    const src = rectsOf2v2(weijuPay.dieIds);
    weijuDur = weijuResolve(root, { player: weijuPay.player, value: weijuPay.value, sourceRects: src.rects, values: src.values });
  } else if (state.pending?.kind === 'weijuPay') {
    weijuHold(root);
  }
  // 攻击帧的受伤浮动是**单独**排在攻击动画之后播的（1v1 没有这条分支：它交给 `runBoardMotions`）。
  // ⚠️ 它的时长**必须计入 `settle`**——否则换视角的整页重建会在浮动/抖动刚开始时把面板元素换掉：
  //    数字画在独立 fx 层还能看到，但**抖动作用在已被移除的元素上 → 抖动丢失**
  //    （真实事故 2026-11-08：日志里每次"不抵挡"后 438/690/421ms 的第二次重建正好切在抖动上）。
  //    1v1 对应时长由 `runBoardMotions` 的返回值携带（`motion.ts` 的 `lifeSpan`），所以 1v1 没这个问题。
  let lifeFxDur = 0;
  if (attacking && lifeDeltas.length > 0) {
    lifeFxDur = playLifeFloats(
      root,
      document.getElementById('fx-layer') ?? document.body,
      lifeDeltas,
      attackDur,
      teamPanelsOf2v2(root),
    );
  }
  lastAttack2v2.set(state, pa);

  // 技能气泡：与 1v1 共用「同卡串行队列」——先「充能/激活/切换」，再技能名（同 key 排队）。
  const bubbles = createBubbleQueue(root);
  const seenRise = new Set<string>();
  for (const e of fxEvents) {
    if (e.kind !== 'rise') continue;
    const k = `${e.player}:${e.artifactId}`;
    if (seenRise.has(k)) continue;
    seenRise.add(k);
    bubbles.play(k, artEl2v2(root, e.player, e.artifactId), e.mode === 'switch' ? '切换' : e.mode === 'activate' ? '激活' : '充能', 'open');
  }
  let ultimateDur = 0;
  const cardBubbleDur = new Map<PlayerId, number>();
  const seenFire = new Set<string>();
  for (const e of fxEvents) {
    if (e.kind !== 'skillFired') continue;
    const k = `${e.player}:${e.artifactId}:${e.side}:${e.skillKey ?? ''}`;
    if (seenFire.has(k)) continue;
    seenFire.add(k);
    const name = skillBubbleName(state, e.player, e.artifactId, e.side, e.skillKey) || '技能';
    if (skillKindOf(state, e.player, e.artifactId, e.skillKey) === 'ultimate') {
      ultimateDur = Math.max(ultimateDur, playUltimate(root, name, cardBubbleDur.get(e.player) ?? 0));
    } else {
      bubbles.play(`${e.player}:${e.artifactId}`, artEl2v2(root, e.player, e.artifactId), name, 'use');
      cardBubbleDur.set(e.player, (cardBubbleDur.get(e.player) ?? 0) + bubbleDuration('use'));
    }
  }

  let trueLineDur = 0;
  for (const e of fxEvents) {
    if (e.kind !== 'trueLine') continue;
    const cardId = e.card && 'artifactId' in e.card ? e.card.artifactId : '';
    const from =
      root.querySelector<HTMLElement>(`.player[data-player="${e.source}"] .card[data-artifact="${cardId}"] .card-art`) ??
      root.querySelector<HTMLElement>(`.player[data-player="${e.source}"]`);
    const team = e.target[0];
    const to = root.querySelector<HTMLElement>(`.lifeline[data-team="${team}"]`) ??
      root.querySelector<HTMLElement>(`.lifeline[data-player="${team}"]`);
    trueLineDur = Math.max(trueLineDur, drawTrueLine(root, from, to, e.target));
  }
  return Math.max(payDur, boardDur, attackDur, joinDur, gouhunDur, heldReleaseDur, weijuDur, bubbles.total, ultimateDur, trueLineDur, lifeFxDur);
}
export function render2v2Game(root: HTMLElement, state: GameState, hooks: TwoVTwoGameHooks): void {
  let prefs = loadPrefs();
  document.documentElement.classList.add('mode-2v2');
  root.classList.remove('setup-page', 'setup-2v2', 'setup-2v2-test');
  root.classList.add('battle2v2-root');
  // ── 排查（?diag=1）：整页重建编号 + 重建前"屏幕上本来有什么" ──
  // 若某次点击之后紧跟着一条 `ui-rebuild`，且重建前还有确认条，就能证明"状态被重建清掉了"。
  const gen = ++gen2v2;
  if (isDiagEnabled()) {
    diag('ui-rebuild', {
      gen,
      prevStep: lastStep2v2 || null,
      hadConfirmRow: !!root.querySelector('.confirm-row'),
      hadSelector: !!root.querySelector('.selector, .paypanel, .convertpick'),
      hadActionBtns: root.querySelectorAll('.actionlist button').length,
    });
    bindDiagClicks(root);
  }
  // 动作后 main 会整页重建：必须在清空 root 之前保存旧骰子，否则首帧会把所有骰子当成新增。
  const initialPrevDice = snapshotDice(root);
  const initialPrevStored = snapshotStored(root);
  let firstDraw = true;
  root.innerHTML = '';

  const stage = el('div', 'stage');
  const board = el('div', `board--2v2 density-${prefs.density}${prefs.showSkillText ? ' show-text' : ''}`);
  const overlayLayer = el('div', 'preview-overlays');
  const main = el('div', 'main');
  const realView = buildRealView(state);
  /**
   * 2v2 的「谁在下方」＝**决策人那一队**，与 1v1 同口径（`viewOwnerOf` = `actorOf`）：
   * **待决策人 → 防守方 → 回合玩家**。
   * ⚠️ 不能直接调 1v1 的 `actorOf`：它在 1v1 缺省分支会返回 `'A'/'B'`，在 2v2 里那不是座位。
   */
  const deciderSeat2v2 = ((): TwoVTwoSeat => {
    const pend = state.pending?.player as TwoVTwoSeat | undefined;
    if (pend && TEAM_OF[pend]) return pend;
    const def = state.pendingAttack?.defender as TwoVTwoSeat | undefined;
    if (def && TEAM_OF[def]) return def;
    return state.activePlayer as TwoVTwoSeat;
  })();
  const viewTarget = TEAM_OF[deciderSeat2v2];
  const prevView = lastViewTeam2v2.get(state) ?? viewTarget;
  /**
   * 换视角要不要"先播完这一帧的动画再切"。
   * ⚠️ **只有骰子类动画才值得等**：生命浮动是锚定在面板/生命条上的，换视角后再播位置照样正确。
   * 否则会出现「待决策已弹出、画面还停在上一队」近 1 秒（真实事故 2026-11-08：高塔铁幕 / 灵能屏障询问）。
   * 判定集合与 1v1（`render.ts` 的 `holdView`）**逐项对齐**：旧坐标动画（消耗/抵挡/搬家/重掷/支付/气泡/攻击起步）
   * → 等；**纯获得骰、纯生命浮动 → 不等**。
   */
  const diceFxNow = ((): boolean => {
    // ⚠️ 此刻 `root` 已被清空（上面 `root.innerHTML = ''` 之前抓的是 `initialPrevDice`）——
    //    必须用清空前的那份快照，否则"区域里只要有任何骰子"就会被判成有动画。
    const nextIds = new Set<string>();
    for (const seat of SEATS) {
      const p = state.players[seat];
      if (!p) continue;
      for (const k of ['defense', 'attack', 'meditation'] as const) for (const d of p.areas[k]) nextIds.add(d.id);
    }
    // 被消耗/弃置/让位（旧坐标 → 飞中间）
    if (anyRemoved(initialPrevDice, nextIds)) return true;
    // 点数/区/归属变化（重掷、改点、换区；id 不变）
    // ⚠️ **不能调 `motion.ts` 的 `areaDiceChanged`**——它只遍历 1v1 的 `'A'/'B'`，2v2 会读到 undefined。
    for (const seat of SEATS) {
      const p = state.players[seat];
      if (!p) continue;
      for (const k of ['defense', 'attack', 'meditation'] as const) {
        for (const d of p.areas[k]) {
          const pd = initialPrevDice.get(d.id);
          if (!pd) continue; // 新增由"被消耗/让位"或攻击动画覆盖
          if (pd.value !== d.value || pd.kind !== k || pd.owner !== seat) return true;
        }
      }
    }
    // 存放骰（027/034/A06 的卡头骰 / T15 战术栏）进出
    // ⚠️ 同样不能用 `motion.ts` 的 `storedIdsOf`（只遍历 1v1 的 'A'/'B'）。
    const nextStored = new Set<string>();
    for (const seat of SEATS) {
      const p = state.players[seat];
      if (!p) continue;
      for (const a of p.artifacts) for (const h of a.heldDice ?? []) nextStored.add(h.id);
      if (p.tacticHeldDie) nextStored.add(p.tacticHeldDie.id);
    }
    if (nextStored.size !== initialPrevStored.size) return true;
    for (const id of nextStored) if (!initialPrevStored.has(id)) return true;
    // 攻击起步 / 攻击被解决（含"不消耗骰子的虚拟攻击"）
    if (state.pendingAttack || lastAttack2v2.get(state)) return true;
    // 本帧真正的骰子类 fx（与 `run2v2Motions` 会播的那几类一一对应）
    return fxPeek().some(
      (e) =>
        e.kind === 'pay' ||
        e.kind === 'block' ||
        e.kind === 'move' ||
        e.kind === 'hanguang' ||
        e.kind === 'reroll' ||
        e.kind === 'weiju' ||
        e.kind === 'attackJoin' ||
        e.kind === 'gouhun' ||
        e.kind === 'holdAttackDie' ||
        e.kind === 'rise' ||
        e.kind === 'skillFired' ||
        e.kind === 'tacticFired',
    );
  })();
  const holdView = prevView !== viewTarget && diceFxNow;
  if (!holdView) lastViewTeam2v2.set(state, viewTarget);
  let viewTeam: TwoVTwoTeam = holdView ? prevView : viewTarget;
  let viewSwitchScheduled = false;
  // ── 进行中的操作状态：从持久层恢复（跨整页重建）──
  const st = stepOf2v2(state);
  let combatView = st.combatView;
  let selected = st.selected;
  let attackTarget = st.attackTarget;
  let chargeTarget = st.chargeTarget; // 009 充能：先选「发动对象」（敌人座位），再列该对象的攻击骰
  let convertPick = st.convertPick; // 010 真实之剑：置换选骰（与 1v1 同一份面板）
  let rerollSelected = st.rerollSelected;
  let wizard = st.wizard;
  /** 技能步骤已跑完、等**攻方选目标**（守方选择时直接进投票，不留在这里）。 */
  let pendingSkillTarget = st.pendingSkillTarget;
  let defenseVote = st.defenseVote;
  let defenseVoteFor = st.defenseVoteFor;
  /** 守方投票面板上展示的"这一刀"（引擎试算结果；投完即清）。 */
  let defenseInfo = st.defenseInfo;
  let dustFlow = st.dustFlow;
  let quanzhiState = st.quanzhiState;
  let settingsOpen = st.settingsOpen;
  let logOpen = st.logOpen;
  let pendingConfirm = st.pendingConfirm;
  let fengmangPick = st.fengmangPick;
  /** 把当前步骤状态写回持久层（每次 `draw()` 末尾 + 派发前清空后各调一次）。 */
  const syncStep = (): void => {
    st.combatView = combatView;
    st.selected = selected;
    st.attackTarget = attackTarget;
    st.chargeTarget = chargeTarget;
    st.convertPick = convertPick;
    st.rerollSelected = rerollSelected;
    st.wizard = wizard;
    st.pendingSkillTarget = pendingSkillTarget;
    st.defenseVote = defenseVote;
    st.defenseVoteFor = defenseVoteFor;
    st.defenseInfo = defenseInfo;
    st.dustFlow = dustFlow;
    st.quanzhiState = quanzhiState;
    st.settingsOpen = settingsOpen;
    st.logOpen = logOpen;
    st.pendingConfirm = pendingConfirm;
    st.fengmangPick = fengmangPick;
  };

  /**
   * 排查（?diag=1）：当前"进行中的操作"快照。
   * 左边是**界面的步骤状态**，右边（`legalTypes` / `buttons`）是"引擎允许什么 vs 画面摆了什么"——
   * 卡死时一眼就能看出是「引擎没给动作」还是「给了但没画出来 / 画了但点不到」。
   */
  const snapshotUi2v2 = (legalActs?: Action[]): Record<string, unknown> => {
    const confirmEl = root.querySelector<HTMLElement>('.confirm-row');
    const rect = confirmEl?.getBoundingClientRect();
    let legalTypes: string[] = [];
    try {
      legalTypes = [...new Set((legalActs ?? getLegalActions(state)).map((a) => a.t))];
    } catch {
      legalTypes = ['<throw>'];
    }
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button'))
      .map((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 18))
      .slice(0, 14);
    return {
      gen: gen2v2,
      phase: state.phase,
      active: state.activePlayer,
      stance: state.stance ?? null,
      pending: state.pending ? { kind: state.pending.kind, player: state.pending.player } : null,
      pa: state.pendingAttack
        ? {
            attacker: state.pendingAttack.attacker,
            defender: state.pendingAttack.defender ?? null,
            value: state.pendingAttack.value,
          }
        : null,
      confirm: pendingConfirm ? pendingConfirm.label : null,
      confirmInDom: !!confirmEl,
      // 宽高为 0 ＝ 在 DOM 里但看不见（父层被隐藏 / 被挤没）
      confirmRect: rect ? [Math.round(rect.width), Math.round(rect.height)] : null,
      selected: selected ? selected.t : null,
      attackTarget: attackTarget ?? null,
      chargeTarget: chargeTarget ?? null,
      wizard: wizard ? { key: wizard.key, step: wizard.step, target: wizard.target ?? null } : null,
      pendingSkillTarget: pendingSkillTarget ? pendingSkillTarget.t : null,
      convert: convertPick ? { kind: convertPick.kind, n: convertPick.dieIds.length } : null,
      vote: defenseVote ? { votes: Object.keys(defenseVote.votes ?? {}).length } : null,
      dust: !!dustFlow,
      quanzhi: !!quanzhiState,
      fengmang: fengmangPick ? { ...fengmangPick } : null,
      legalTypes,
      buttons,
    };
  };

  /**
   * 注册「导出那一刻」的现场快照：玩家点「设置 → 诊断日志 → 复制全部」时，
   * 由 `diagDump()` 追加一条 `ui-now` —— 卡死时无需任何额外操作即可取证。
   */
  setDumpProbe(() => snapshotUi2v2());

  /**
   * 开「守方投票」＝唯一入口（普通攻击 / 置换攻击 / 技能攻击 三者共用）。
   *
   * 投票发生在**派发之前**：还没确定"由谁应对"，但守方需要先知道这一刀有多重。
   * 所以这里用 `previewPendingAttack` 在**状态副本**上试算一次，拿到引擎算好的点数/伤害/加成
   * （绝不另写一份伤害公式）；投完再真正派发。
   */
  const beginDefenseVote = (action: Action): void => {
    combatView = 'defender';
    defenseVote = createDefenseVote(state, state.activePlayer as TwoVTwoSeat);
    defenseVoteFor = action;
    // 试算要在"没有任何待消费旁路事件"的时刻做（此刻还没派发任何动作）——
    // `previewPendingAttack` 内部会在副本上跑 applyAction 并丢弃副本产生的 fx。
    defenseInfo = previewPendingAttack(state, action);
    draw();
  };

  const propose = (a: Action, label: string): void => {
    pendingConfirm = { action: a, label };
    if (isDiagEnabled()) {
      diag('ui-propose', { gen: gen2v2, t: a.t, target: (a as { target?: unknown }).target ?? null, label });
    }
    draw();
  };

  const dispatch = (a: Action): void => {
    try {
      if (isDiagEnabled()) diag('ui-dispatch', { gen: gen2v2, t: a.t });
      pendingConfirm = null;
      // ⚠️ `hooks.onAction` 会**同步**触发 main 的整页重建 → 必须先把步骤状态清空并写回持久层，
      //    否则新一帧会从持久层把旧确认条 / 旧向导又"恢复"出来（比原来更糟）。
      selected = null;
      attackTarget = null;
      chargeTarget = null;
      convertPick = null;
      pendingSkillTarget = null;
      rerollSelected = new Set();
      dustFlow = null;
      quanzhiState = null;
      fengmangPick = null;
      wizard = null;
      defenseVote = null;
      defenseVoteFor = null;
      defenseInfo = null;
      combatView = 'attacker';
      settingsOpen = false; // 与 1v1 的 `resetUi()` 同口径：每次派发都关设置
      syncStep();
      hooks.onAction(a);
    } catch (e) {
      hooks.error = e instanceof Error ? e.message : String(e);
      // 排查（?diag=1）：派发异常**现在只写提示栏、日志里看不见** → 必须留痕。
      diag('ui-throw', {
        where: 'dispatch',
        gen: gen2v2,
        t: a.t,
        message: e instanceof Error ? e.message : String(e),
        stack:
          e instanceof Error
            ? (e.stack ?? '').split('\n').slice(0, 4).map((s) => s.trim()).join(' | ')
            : null,
      });
    }
  };

  const wizardArgs = (w: SkillWizard) => ({
    state,
    player: w.ownerSeat ?? state.activePlayer,
    chosenDice: w.chosenDice,
    options: w.options,
    numbers: w.numbers,
    slots: w.slots,
    target: (w.target ?? undefined) as PlayerId | undefined,
  });

  const wizardSteps = (w: SkillWizard): SelectStep[] => w.spec.steps(wizardArgs(w));

  /**
   * 防御（2026-11-07）：从持久层恢复的向导若已经**作废**（步骤跑完 / 状态已变），直接丢弃。
   * 否则 `wizardPanel` 会画出"只有标题、一个按钮都没有"的僵尸面板，把整个操作栏挡掉
   * （真实事故：灵能脉冲·激活之后操作栏全空；`finishWizard` 走 `dispatch` 是主修，这里是保险）。
   */
  if (wizard) {
    const w0 = wizard;
    const alive = (() => {
      try {
        const steps = wizardSteps(w0);
        return steps.length > 0 && w0.step < steps.length;
      } catch {
        return false;
      }
    })();
    if (!alive) wizard = null;
  }

  /** 待决策选择器「完成」后的动作（与 1v1 的派发口径逐字一致）。 */
  const pendingSelectionAction = (w: SkillWizard, params: unknown): Action | null => {
    const p = (params ?? {}) as { pick?: 'same' | 'diff'; dieIds?: string[] };
    if (w.pendingKind === 'endDiscard') return { t: 'endDiscardResolve', dieIds: w.chosenDice[0] ?? [] };
    if (w.pendingKind === 'wanzhangDiscard') return { t: 'wanzhangDiscard', dieIds: w.chosenDice[0] ?? [] };
    if (w.pendingKind === 'tiaolingPick')
      return { t: 'tiaolingResolve', pick: p.pick === 'same' ? 'same' : 'diff', dieIds: p.dieIds ?? [] };
    // 010「真实之剑」置换支付：2 颗任意骰 → 1 颗（视为 5）。动作形状与 1v1 逐字一致。
    if (w.pendingKind === 'guwangCancelConvert')
      return { t: 'guwangCancel', cancel: true, costSlots: [{ dieIds: w.chosenDice[0] ?? [] }] };
    if (w.pendingKind === 'dunwuHalveConvert')
      return { t: 'dunwuHalve', accept: true, costSlots: [{ dieIds: w.chosenDice[0] ?? [] }] };
    if (w.pendingKind === 'weijuPayConvert')
      return { t: 'weijuPay', costSlots: [{ dieIds: w.chosenDice[0] ?? [] }] };
    return null;
  };

  const finishWizard = (w: SkillWizard): boolean => {
    try {
      const steps = wizardSteps(w);
      if (w.step < steps.length) return false;
      // 与 1v1 同一口径：`buildParams` 只看到「按步骤压缩后的数字」，不是步骤绝对下标
      const args = { ...wizardArgs(w), numbers: compactNumbers(steps, w.numbers) };
      const params = w.spec.buildParams(args);
      wizard = null;
      if (w.pendingKind) {
        const action = pendingSelectionAction(w, params);
        // ⚠️ 必须走 `dispatch`（唯一派发入口）：它会先清空并写回持久层。
        // 直接 `hooks.onAction` 会让"已作废的向导"留在持久层 → 重建后画出一个只有标题、
        // 没有任何按钮的僵尸面板，把整个操作栏挡掉（真实事故：灵能脉冲·激活之后操作栏全空）。
        if (action) dispatch(action);
        return true;
      }
      const base = w.action;
      if (!base) return false;
      const action = {
        ...base,
        params,
        ...(w.target ? { target: w.target } : {}),
      } as Action;
      if (w.spec.attackTarget) {
        // 目标不由 `steps` 决定（会挤占 chosenDice 下标）→ 技能步骤跑完后按攻守标记处理
        if (state.stance === 'defensePicks') {
          // 技能发起的攻击＝技能效果会**真改骰子数据**（改点/移区），不派发就演不出来。
          // 所以这里只开投票（谁去挡），骰子变形 / 灰骰 / 黑线全部留到派发后按 1v1 顺序播。
          beginDefenseVote(action);
        } else {
          pendingSkillTarget = action;
          draw();
        }
        return true;
      }
      dispatch(action);
      return true;
    } catch (e) {
      hooks.error = e instanceof Error ? e.message : String(e);
      return false;
    }
  };

  const startWizard = (a: Extract<Action, { t: 'skill' }>, target?: TwoVTwoSeat): boolean => {
    const key = skillKeyForAction(state, a);
    const spec = key ? SKILL_SELECTION[key] : undefined;
    if (!key || !spec) return false;
    try {
      const probe: SkillWizard = {
        action: a,
        key,
        spec,
        step: 0,
        chosenDice: [],
        options: [],
        numbers: [],
        slots: [],
        slotModes: [],
        target,
      };
      const steps = spec.steps(wizardArgs(probe));

      wizard = probe;
      if (steps.length === 0) finishWizard(probe);
      draw();
      return true;
    } catch (e) {
      hooks.error = e instanceof Error ? e.message : String(e);
      // 排查（?diag=1）：选择器构造失败＝"点了技能只闪一下/什么都没开"，日志必须留痕。
      diag('ui-guard', {
        where: 'start-wizard',
        gen: gen2v2,
        key,
        message: e instanceof Error ? e.message : String(e),
      });
      return false;
    }
  };

  /**
   * 待决策选择器（结束弃骰 / 万丈明光 / 死亡亦逝）：**必须先点入口按钮**，再进 1v1 同款选骰面板。
   * 入口按钮文案/class 与 1v1 完全一致；面板用 `.pay-die` 骰片（不是 `.option-btn` 文字按钮）。
   */
  const startPendingWizard = (
    key: string,
    pendingKind: NonNullable<SkillWizard['pendingKind']>,
    ownerSeat: TwoVTwoSeat,
  ): boolean => {
    const spec = SKILL_SELECTION[key];
    if (!spec) return false;
    try {
      const probe: SkillWizard = {
        action: null,
        key,
        spec,
        step: 0,
        chosenDice: [],
        options: [],
        numbers: [],
        slots: [],
        slotModes: [],
        pendingKind,
        ownerSeat,
      };
      const steps = spec.steps(wizardArgs(probe));
      wizard = probe;
      if (steps.length === 0) finishWizard(probe);
      draw();
      return true;
    } catch (e) {
      hooks.error = e instanceof Error ? e.message : String(e);
      return false;
    }
  };

  const advanceWizard = (): void => {
    if (!wizard) return;
    const steps = wizardSteps(wizard);
    wizard.step += 1;
    if (wizard.step >= steps.length) {
      if (!finishWizard(wizard)) draw();
    } else {
      draw();
    }
  };

  const wizardPanel = (w: SkillWizard): HTMLElement => {
    const steps = wizardSteps(w);
    const step = steps[w.step];
    // 与 1v1 的 chooserPanel 一致：骰片步只用 head-row，不再套一个块状 body。
    const panel = el('div', `selector${step?.kind === 'dice' ? ' selector--head-row' : ''}`);
    const head = el('div', 'selector-head');
    const title = el('span', 'selector-title');
    // 待决策选择器与 1v1 `chooserPanel` 同款标题（`步骤 N/M · …`）；技能向导保留原格式。
    title.textContent = !step
      ? w.pendingKind
        ? '选择'
        : '技能'
      : w.pendingKind
        ? `步骤 ${w.step + 1}/${steps.length} · ${step.label}`
        : `技能 ${w.step + 1}/${steps.length} ${step.label}`;
    head.appendChild(title);
    panel.appendChild(head);
    if (!step) return panel;

    if (step.kind === 'seat') {
      const row = el('div', 'option-row');
      for (const seat of step.candidates as TwoVTwoSeat[]) {
        const b = button(`btn option-btn b2v2-target player-${seat}`, seatName(seat));
        b.dataset.choice = seat;
        if (w.target === seat) b.classList.add('option-btn--on');
        b.addEventListener('click', () => {
          if (!step.candidates.includes(seat)) return;
          w.target = seat;
          advanceWizard();
        });
        row.appendChild(b);
      }
      panel.appendChild(row);
    } else if (step.kind === 'option') {
      const row = el('div', 'option-row');
      for (const opt of step.options) {
        const b = button('btn option-btn', opt.label);
        b.dataset.choice = opt.value;
        if (w.options[w.step] === opt.value) b.classList.add('option-btn--on');
        b.addEventListener('click', () => {
          w.options[w.step] = opt.value;
          advanceWizard();
        });
        row.appendChild(b);
      }
      panel.appendChild(row);
    } else if (step.kind === 'dice') {
      const owner: TwoVTwoSeat =
        (step.ownerSeat as TwoVTwoSeat | undefined) ??
        w.ownerSeat ??
        (step.owner === 'self' ? (state.activePlayer as TwoVTwoSeat) : (w.target ?? (state.activePlayer as TwoVTwoSeat)));
      const picked = w.chosenDice[w.step] ?? [];
      const info = el('span', 'selector-info');
      info.textContent = `已选 ${picked.length}，需 ${step.min}–${step.max} 颗`;
      head.appendChild(info);
      panel.appendChild(
        renderDiceChips(state, owner, step, new Set(picked), (die) => {
          const on = picked.includes(die.id);
          const next = on ? picked.filter((id) => id !== die.id) : [...picked, die.id].slice(0, step.max);
          w.chosenDice[w.step] = next;
          draw();
        }),
      );
      const pickedDice = (['attack', 'defense', 'meditation'] as DiceKind[])
        .flatMap((kind) =>
          state.players[owner].areas[kind].map((d) => ({ id: d.id, value: d.value, kind })),
        )
        .filter((d) => picked.includes(d.id));
      const validation = step.validate?.(pickedDice);
      if (validation?.hint) {
        const vh = el('div', 'selector-hint');
        vh.textContent = validation.hint;
        if (!validation.ok) vh.classList.add('selector-hint--bad');
        panel.appendChild(vh);
      }
      const confirm = w.pendingKind
        ? button('btn btn-confirm', '确认')
        : button('btn btn-skill', step.max === 1 ? '确定' : '下一步');
      confirm.disabled =
        picked.length < step.min || picked.length > step.max || validation?.ok === false;
      confirm.addEventListener('click', advanceWizard);
      panel.appendChild(confirm);
    } else if (step.kind === 'number') {
      const row = el('div', 'option-row');
      for (let n = step.min; n <= step.max; n += 1) {
        const b = button('btn option-btn', step.fmt ? step.fmt(n) : String(n));
        b.dataset.choice = String(n);
        b.addEventListener('click', () => {
          w.numbers[w.step] = n;
          advanceWizard();
        });
        row.appendChild(b);
      }
      panel.appendChild(row);
    } else if (step.kind === 'pips') {
      const picked = w.chosenDice[w.step] ?? [];
      const row = el('div', 'option-row');
      for (let n = 1; n <= 6; n += 1) {
        const on = picked.includes(String(n));
        const b = button(`btn option-btn${on ? ' option-btn--on' : ''}`, String(n));
        b.dataset.choice = String(n);
        b.addEventListener('click', () => {
          const next = on
            ? picked.filter((x) => x !== String(n))
            : [...picked, String(n)].slice(0, step.max);
          w.chosenDice[w.step] = next;
          draw();
        });
        row.appendChild(b);
      }
      panel.appendChild(row);
      const confirm = button('btn btn-skill', '确定');
      confirm.disabled = picked.length < step.min || picked.length > step.max;
      confirm.addEventListener('click', advanceWizard);
      panel.appendChild(confirm);
    } else if (step.kind === 'slots') {
      if (w.slotModes.length !== step.kinds.length) {
        w.slotModes = step.kinds.map(() => 'real');
        w.slots = step.kinds.map(() => []);
      }
      panel.appendChild(renderSlotsStepHost(state, w.slots, w.slotModes, step.kinds, draw));
      const confirm = button('btn btn-skill', '下一步');
      confirm.disabled = step.kinds.some((_, i) => {
        const need = w.slotModes[i] === 'convert' ? 2 : 1;
        return (w.slots[i]?.length ?? 0) < need;
      });
      confirm.addEventListener('click', advanceWizard);
      panel.appendChild(confirm);
    } else {
      const hint = el('div', 'selector-hint');
      hint.textContent = '该选择步骤暂未接入';
      panel.appendChild(hint);
    }
    const cancel = button('btn btn-cancel', '取消');
    cancel.addEventListener('click', () => {
      wizard = null;
      draw();
    });
    panel.appendChild(cancel);
    return panel;
  };


  const openArtifactDetail = (
    artifactId: string,
    owner: PlayerId | undefined,
    trigger: HTMLElement,
  ): void => {
    const r = trigger.getBoundingClientRect();
    let overlay: HTMLElement | null = null;
    overlay = renderArtifactDetailOverlay(
      state,
      {
        artifactId,
        ...(owner ? { player: owner } : {}),
        rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      },
      () => overlay?.remove(),
    );
    if (overlay) overlayLayer.appendChild(overlay);
  };

  const onDefenseVote = (voter: TwoVTwoSeat, choice: TwoVTwoSeat): void => {
    if (!defenseVote || !defenseVoteFor) {
      // 排查（?diag=1）：投票面板还在、投票状态却已被清（被重绘重建过）→ 点了没反应。
      diag('ui-guard', {
        where: 'defense-vote',
        gen: gen2v2,
        voter,
        hasVote: !!defenseVote,
        hasAction: !!defenseVoteFor,
      });
      return;
    }
    const { vote, outcome } = castTeamVote(defenseVote, voter, choice);
    defenseVote = vote;
    if (outcome.status === 'resolved') {
      const action = defenseVoteFor;
      defenseVote = null;
      defenseVoteFor = null;
      defenseInfo = null;
      combatView = 'attacker';
      // ⚠️ 投票期间视觉是"守方在下"（combatView），而下一帧要按"攻方在下"量骰子起飞点。
      // 先还原视觉 + 重排一次（同步执行，浏览器不会在中间绘制），否则源骰坐标会来自投票布局
      // → 骰子"飞出在上、飞回在下"（真实事故 2026-11-07）。
      viewTeam = TEAM_OF[state.activePlayer as TwoVTwoSeat];
      lastViewTeam2v2.set(state, viewTeam);
      draw();
      dispatch({ ...action, target: outcome.choice } as Action);
      return;
    }
    draw();
  };

  /**
   * 发动一个技能动作——**操作列表的「启动技能」按钮与卡面技能行共用这一处**。
   * （1v1 也是这一套：有选择步骤 → 开选择器；没步骤 → 直接派发/先选目标。）
   */
  const fireSkillAction = (a: Extract<Action, { t: 'skill' }>): void => {
    if (startWizard(a)) return;
    const key = skillKeyForAction(state, a);
    if (key && SKILL_SELECTION[key]) {
      draw();
      return;
    }
    const nextTargets = actionTargets(state, a);
    if (nextTargets.length > 1) {
      selected = a;
      draw();
    } else {
      propose(
        { ...a, ...(nextTargets[0] ? { target: nextTargets[0] } : {}) } as Action,
        actionLabel(state, a),
      );
    }
  };

  const draw = (): void => {
    const prevDice = firstDraw ? initialPrevDice : snapshotDice(root);
    const prevStored = firstDraw ? initialPrevStored : snapshotStored(root);
    firstDraw = false;
    setMotionSpeed(speedOf(prefs.animSpeed));
    const fxEvents = fxTake();
    const lifeDeltas = teamLifeDeltas2v2(state);
    const legal = getLegalActions(state);
    /**
     * 卡面技能行是否可点：与 1v1 同一口径（类型可发动 + 引擎给了这条动作），
     * 外加 2v2 专有的一条——**只点亮当前行动座位**（四席都渲染，同名神器不能串），
     * 且**待决策/待抵挡优先**，卡面可点也不能越过引擎。
     */
    const cardSkillRow: SkillRowClickHandler = (seat, artifactId, side, type) => {
      if (!isActivatableType(type)) return null;
      if (seat !== state.activePlayer) return null;
      if (state.pending || state.pendingAttack) return null;
      const a = legal.find(
        (x): x is Extract<Action, { t: 'skill' }> =>
          x.t === 'skill' && x.artifactId === artifactId && x.side === side,
      );
      if (!a) return null;
      return () => fireSkillAction(a);
    };
    const canPickReroll = (state.phase === 'initialReroll' || state.phase === 'reroll') && !state.pending && !state.pendingAttack;
    // 初始重掷是准备阶段，规则为任意数量；回合内重掷才按速度。
    // 直接取引擎给本次 reroll 动作的可选骰数，避免两套口径。
    const rerollMax = legal.find((a) => a.t === 'reroll')?.dieIds.length ?? 0;
    if (rerollSelected.size > rerollMax) {
      rerollSelected = new Set([...rerollSelected].slice(0, rerollMax));
    }
    // 骰区高亮：向导「骰片步」＝该步已选（与骰片共享同一选中状态）；否则＝重掷已选。
    const wizardPick = (() => {
      if (!wizard) return null;
      const st = wizardSteps(wizard)[wizard.step];
      return st && st.kind === 'dice' ? new Set(wizard.chosenDice[wizard.step] ?? []) : null;
    })();
    const boardDieSel = wizardPick ?? rerollSelected;
    /**
     * 向导「骰片步」的骰区双入口（与骰片共享同一选中状态）——1v1 是 `toggleSelDie`，2v2 必须同样可点骰区。
     * 返回 true＝这次点击被向导消费了（不要再当重掷）。
     */
    const toggleWizardDie = (seat: TwoVTwoSeat, id: string): boolean => {
      if (!wizard) return false;
      const steps = wizardSteps(wizard);
      const step = steps[wizard.step];
      if (!step || step.kind !== 'dice') return false;
      const owner: TwoVTwoSeat =
        (step.ownerSeat as TwoVTwoSeat | undefined) ??
        wizard.ownerSeat ??
        (step.owner === 'self'
          ? (state.activePlayer as TwoVTwoSeat)
          : (wizard.target ?? (state.activePlayer as TwoVTwoSeat)));
      if (seat !== owner) return false;
      const die = (['attack', 'defense', 'meditation'] as DiceKind[])
        .flatMap((kind) => state.players[owner].areas[kind].map((d) => ({ ...d, kind })))
        .find((d) => d.id === id);
      if (!die || !step.areas.includes(die.kind)) return false;
      if (step.filter && !step.filter(die)) return false;
      const picked = wizard.chosenDice[wizard.step] ?? [];
      if (picked.includes(id)) wizard.chosenDice[wizard.step] = picked.filter((x) => x !== id);
      else if (picked.length < step.max) wizard.chosenDice[wizard.step] = [...picked, id];
      else return true;
      draw();
      return true;
    };
    const onDieClick = (seat: TwoVTwoSeat, id: string): void => {
      if (toggleWizardDie(seat, id)) return;
      if (!canPickReroll || seat !== state.activePlayer) {
        // 排查（?diag=1）：点了骰子却什么都不发生时的原因。
        diag('ui-guard', {
          where: 'die',
          gen: gen2v2,
          seat,
          active: state.activePlayer,
          canPickReroll,
          wizard: !!wizard,
        });
        return;
      }
      if (rerollSelected.has(id)) rerollSelected.delete(id);
      else if (rerollSelected.size < rerollMax) rerollSelected.add(id);
      draw();
    };
    board.innerHTML = '';
    overlayLayer.innerHTML = '';
    main.innerHTML = '';
    const visualEnemy: TwoVTwoTeam = viewTeam === 'A' ? 'B' : 'A';
    const topTeam: TwoVTwoTeam = combatView === 'defender' ? viewTeam : visualEnemy;
    const bottomTeam: TwoVTwoTeam = combatView === 'defender' ? visualEnemy : viewTeam;
    board.className = `board--2v2 density-${prefs.density}${prefs.showSkillText ? ' show-text' : ''}${prefs.cardArt === 'full' ? ' card-art-full' : ''}`;
    if (!prefs.logCollapsed) {
      const sidebar = el('div', 'sidebar');
      sidebar.appendChild(logContent(realView));
      board.appendChild(sidebar);
    } else {
      board.appendChild(logTab(() => {
        logOpen = true;
        draw();
      }));
    }
    main.appendChild(sideRowReal(topTeam, realView, true, prefs, state, onDieClick, boardDieSel, cardSkillRow));
    main.appendChild(teamRow(topTeam, realView, false));

    const center = el('div', 'centerband');
    const left = el('div', 'centerband-left');
    const zone = el('div', 'actionzone');
    const hint = renderHintHost(state, prefs, hooks.error ?? null);
    const list = el('div', 'actionlist');
    if (pendingConfirm) {
      const row = el('div', 'confirm-row');
      const label = el('span', 'confirm-label');
      label.textContent = `${pendingConfirm.label}？`;
      const ok = button('btn btn-skill', '确定');
      ok.dataset.act = 'confirm';
      ok.addEventListener('click', () => dispatch(pendingConfirm!.action));
      const cancel = button('btn btn-cancel', '取消');
      cancel.dataset.act = 'cancel';
      cancel.addEventListener('click', () => { pendingConfirm = null; draw(); });
      row.append(label, ok, cancel);
      list.appendChild(row);
    } else if (wizard) {
      // 选择器优先于普通操作列表（1v1：`ui.selection` → `chooserPanel` 直接替换操作区）。
      // ⚠️ 必须排在 pending 入口按钮**之前**：否则"待决策入口按钮"会盖住刚打开的选择面板
      //    （真实事故：点「结束阶段：弃置…」后什么都不出现）。
      list.appendChild(wizardPanel(wizard));
    } else if (convertPick) {
      // 010 真实之剑：与 1v1 共用同一份置换选骰面板。
      // 2v2 有两个敌人 → "打谁"直接在**同一行**里追加（不另起一行、也不退回普通攻击界面）。
      const enemySeats = enemiesOf(state, state.activePlayer) as TwoVTwoSeat[];
      const needTarget =
        convertPick.kind === 'attack' &&
        convertPick.dieIds.length === 2 &&
        state.stance !== 'defensePicks' &&
        enemySeats.length > 1;
      let extra: HTMLElement | null = null;
      if (needTarget) {
        extra = el('div', 'convertpick-targets');
        const lab = el('span', 'selector-hint');
        lab.textContent = '目标';
        extra.appendChild(lab);
        for (const seat of enemySeats) {
          const b = button(`btn option-btn b2v2-target player-${seat}`, seatName(seat));
          b.dataset.choice = seat;
          b.addEventListener('click', () => {
            if (!convertPick) return;
            const ids = [...convertPick.dieIds];
            convertPick = null;
            propose(
              { t: 'attack', costSlots: [{ dieIds: ids }], target: seat } as Action,
              `${CONVERT_ATTACK_LABEL} → ${seatName(seat)}`,
            );
          });
          extra.appendChild(b);
        }
      }
      list.appendChild(
        renderConvertPickHost(
          state,
          convertPick,
          (d) => {
            if (!convertPick) return;
            const i = convertPick.dieIds.indexOf(d.id);
            if (i >= 0) convertPick.dieIds.splice(i, 1);
            else if (convertPick.dieIds.length < 2) convertPick.dieIds.push(d.id);
            if (convertPick.dieIds.length < 2) {
              draw();
              return;
            }
            const ids = [...convertPick.dieIds];
            const kind = convertPick.kind;
            if (kind === 'block') {
              convertPick = null;
              const defender = state.pendingAttack?.defender;
              propose(
                {
                  t: 'block',
                  costSlots: [{ dieIds: ids }],
                  ...(defender ? { by: defender } : {}),
                } as Action,
                CONVERT_BLOCK_LABEL,
              );
              return;
            }
            // 攻击：守方选择 → 先投票"谁去挡"（不摆目标）；单敌 → 直接确认；
            // 两敌（攻方选择）→ **保留 convertPick**，重绘后由上面的 `extra` 在同一行摆出目标。
            if (state.stance === 'defensePicks') {
              convertPick = null;
              beginDefenseVote({ t: 'attack', costSlots: [{ dieIds: ids }] } as Action);
              return;
            }
            if (enemySeats.length === 1) {
              convertPick = null;
              propose(
                { t: 'attack', costSlots: [{ dieIds: ids }], target: enemySeats[0] } as Action,
                `${CONVERT_ATTACK_LABEL} → ${seatName(enemySeats[0])}`,
              );
              return;
            }
            draw();
          },
          () => {
            convertPick = null;
            draw();
          },
          extra,
          { layout: 'stacked' },
        ),
      );
    } else if (state.pending?.kind === 'fengmang' && fengmangPick) {
      const ui = { fengmangPick, prefs };
      const ctx = {
        state,
        legal,
        hooks: {
          ui,
          requestRender: () => {
            fengmangPick = ui.fengmangPick;
            draw();
          },
          propose: (a: Action, label: string) => {
            fengmangPick = null;
            propose(a, label);
          },
        },
      } as unknown as Parameters<typeof fengmangPanel>[0];
      list.appendChild(fengmangPanel(ctx));
    } else if ((state.phase === 'initialReroll' || state.phase === 'reroll') && !state.pending && !state.pendingAttack) {
      const reroll = legal.find((a) => a.t === 'reroll');
      if (reroll) {
        list.appendChild(renderRerollButton({
          selectedCount: rerollSelected.size,
          onClick: () => {
            if (rerollSelected.size === 0) return;
            propose({ t: 'reroll', dieIds: [...rerollSelected] } as Action, `重掷 ${rerollSelected.size} 颗`);
          },
        }));
      }
      const skip = button('btn', state.phase === 'initialReroll' ? '跳过' : '跳过重掷');
      skip.addEventListener('click', () => propose({ t: 'advance' } as Action, advanceLabel(state.phase)));
      list.appendChild(skip);
    } else if (state.pending?.kind === 'quanzhiAssign') {
      quanzhiState ??= { groups: [], selected: [], preview: false };
      list.appendChild(renderQuanzhiHost(state, quanzhiState, draw, dispatch));
    } else if (state.pending?.kind === 'tiaolingPick') {
      // 033 凋零·死亡亦逝：与 1v1 一致——**先点入口按钮**，再进 1v1 同款选骰面板（`.pay-die` 骰片）。
      const owner = (state.pending.owner ?? state.pending.player) as TwoVTwoSeat;
      const open = button('btn btn-skill', '「死亡亦逝」：弃置自己的能力骰');
      open.dataset.act = 'tiaolingOpen';
      open.addEventListener('click', () => startPendingWizard('@tiaolingPick', 'tiaolingPick', owner));
      list.appendChild(open);
    } else if (state.pending?.kind === 'wanzhangDiscard') {
      // 035 千劫·万丈明光：与 1v1 一致——入口按钮 + 选骰面板
      const owner = state.pending.player as TwoVTwoSeat;
      const open = button('btn btn-skill', '「万丈明光」：弃置能力骰');
      open.dataset.act = 'wanzhangOpen';
      open.addEventListener('click', () => startPendingWizard('@wanzhangDiscard', 'wanzhangDiscard', owner));
      list.appendChild(open);
    } else if (state.pending?.kind === 'endDiscard') {
      // 结束阶段·超出意志上限：与 1v1 完全一致——入口按钮（`btn btn-skill`）+ 选骰面板（`.pay-die`）。
      const owner = state.pending.player as TwoVTwoSeat;
      const open = button('btn btn-skill', '结束阶段：弃置超出意志上限的能力骰');
      open.dataset.act = 'endDiscardOpen';
      open.addEventListener('click', () => startPendingWizard('@endDiscard', 'endDiscard', owner));
      list.appendChild(open);
    } else if (state.pending?.kind === 'guwangCharge') {
      // 009 高塔铁幕·充能：**先选发动对象（敌人座位）→ 再列该对象的攻击骰**（与 005/007 的 seat→dice 一致）。
      const pd = state.pending;
      const candidates = (pd.target ? [pd.target] : enemiesOf(state, pd.player)) as TwoVTwoSeat[];
      const withDice = candidates.filter((s) => (state.players[s]?.areas.attack.length ?? 0) > 0);
      // 只有一个候选（或引擎已定 target）→ 自动跳过"选对象"这一步，不留空步骤。
      if (chargeTarget == null && withDice.length === 1) chargeTarget = withDice[0]!;
      if (chargeTarget != null && !withDice.includes(chargeTarget)) chargeTarget = null;
      if (chargeTarget == null) {
        const row = el('div', 'option-row');
        const label = el('span', 'selector-hint');
        label.textContent = '选择发动对象';
        row.appendChild(label);
        for (const seat of withDice) {
          const b = button(`btn option-btn b2v2-target player-${seat}`, seatName(seat));
          b.dataset.choice = seat;
          b.addEventListener('click', () => {
            chargeTarget = seat;
            draw();
          });
          row.appendChild(b);
        }
        list.appendChild(row);
      } else {
        const owner = chargeTarget;
        const acts = legal.filter(
          (a): a is Extract<Action, { t: 'guwangCharge' }> =>
            a.t === 'guwangCharge' &&
            !!a.dieId &&
            state.players[owner].areas.attack.some((d) => d.id === a.dieId),
        );
        if (acts.length > 0) {
          list.appendChild(
            renderChipRow(
              `「高塔铁幕」：改为 1 点（${seatName(owner)}）`,
              acts.map((a) => {
                const id = a.dieId!;
                return {
                  id,
                  act: 'guwangCharge',
                  className: `pay-die clickable die-${owner}`,
                  text: dieText2v2(state, id),
                  onClick: () =>
                    propose(a, `高塔铁幕：把 ${seatName(owner)} 的 ${dieText2v2(state, id)} 改为 1 点`),
                };
              }),
            ),
          );
        }
        const skipCharge = legal.find((a) => a.t === 'guwangCharge' && !a.dieId);
        if (skipCharge) {
          const b = button('btn', '不变更');
          b.dataset.act = 'guwangCharge';
          b.addEventListener('click', () => propose(skipCharge, '不变更攻击骰'));
          list.appendChild(b);
        }
        // 有多个候选时给一条"重选对象"的退路（与向导的取消同性质）
        if (withDice.length > 1) {
          const back = button('btn btn-cancel', '重选对象');
          back.dataset.act = 'guwangChargeBack';
          back.addEventListener('click', () => {
            chargeTarget = null;
            draw();
          });
          list.appendChild(back);
        }
      }
    } else if (state.pending?.kind === 'guwangCancel') {
      // 009 高塔铁幕·触发：受真实伤害时消耗 1 个防御骰（含 034 存放骰）取消它。
      const pd = state.pending;
      const acts = legal.filter(
        (a): a is Extract<Action, { t: 'guwangCancel' }> =>
          a.t === 'guwangCancel' && a.cancel === true && !!a.defenseDieId,
      );
      if (acts.length > 0) {
        // ⚠️ 文案/结构**必须与 1v1 逐字一致**：标题「发动「高塔铁幕」取消（消耗 」＋骰片＋「）」，
        //    取自**共享分段** `actionDieSegmentsOf`（1v1 同一份）；2v2 不得自写。
        //    门禁：`tests/pendingParity1v1v2v2.test.ts`。
        const seg = actionDieSegmentsOf(state, acts[0]!);
        list.appendChild(
          renderChipRow(
            seg?.parts[0] ?? '发动「高塔铁幕」取消（消耗 ',
            acts.map((a) => {
              const id = a.defenseDieId!;
              const held = !state.players[pd.player].areas.defense.some((d) => d.id === id);
              return {
                id,
                act: 'guwangCancel',
                className: held ? 'pay-die clickable pay-die--held' : `pay-die clickable die-${pd.player}`,
                text: dieText2v2(state, id),
                onClick: () => propose(a, actionLabelOf(state, a) ?? ''),
              };
            }),
            seg ? seg.parts[seg.parts.length - 1] : '）',
          ),
        );
      }
      const skipCancel = legal.find((a) => a.t === 'guwangCancel' && a.cancel === false);
      if (skipCancel) {
        // 「不发动「高塔铁幕」」＝1v1 `pendingActionLabel` 的同一句（不再写「不取消」）
        const label = actionLabelOf(state, skipCancel) ?? '不发动「高塔铁幕」';
        const b = button('btn', label);
        b.dataset.act = 'guwangCancel';
        b.addEventListener('click', () => propose(skipCancel, label));
        list.appendChild(b);
      }
      // 010 真实之剑：2 颗任意骰代替「消耗 1 颗防御骰」（与 1v1 同款入口 + 同一个选择器）
      if (convertAvailable(state, pd.player)) {
        const c = button('btn btn-convert', '用「真实之剑」置换：2 颗任意骰代替 1 颗');
        c.dataset.act = 'convert';
        c.addEventListener('click', () =>
          startPendingWizard('@guwangCancelConvert', 'guwangCancelConvert', pd.player as TwoVTwoSeat),
        );
        list.appendChild(c);
      }
    } else if (state.pending?.kind === 'dunwuHalve') {
      // 011 灵能屏障·触发：消耗 1 个冥想骰 → 该次伤害减半。与 1v1 一样用骰片（不是文字按钮）。
      const pd = state.pending;
      const acts = legal.filter(
        (a): a is Extract<Action, { t: 'dunwuHalve' }> =>
          a.t === 'dunwuHalve' && a.accept === true && !!a.meditationDieId,
      );
      if (acts.length > 0) {
        // 同 009：标题/结构取自共享分段（1v1 同一份），2v2 不得自写文案。
        const seg = actionDieSegmentsOf(state, acts[0]!);
        list.appendChild(
          renderChipRow(
            seg?.parts[0] ?? '发动「灵能屏障」伤害减半（消耗 ',
            acts.map((a) => {
              const id = a.meditationDieId!;
              const held = !state.players[pd.player].areas.meditation.some((d) => d.id === id);
              return {
                id,
                act: 'dunwuHalve',
                className: held ? 'pay-die clickable pay-die--held' : `pay-die clickable die-${pd.player}`,
                text: dieText2v2(state, id),
                onClick: () => propose(a, actionLabelOf(state, a) ?? ''),
              };
            }),
            seg ? seg.parts[seg.parts.length - 1] : '）',
          ),
        );
      }
      const skipHalve = legal.find((a) => a.t === 'dunwuHalve' && a.accept === false);
      if (skipHalve) {
        // 按钮文案与 1v1 一致：走 `actionLabelOf`（＝`pendingActionLabel`「不发动「灵能屏障」」）
        const label = actionLabelOf(state, skipHalve) ?? '不发动「灵能屏障」';
        const b = button('btn', label);
        b.dataset.act = 'dunwuHalve';
        b.addEventListener('click', () => propose(skipHalve, label));
        list.appendChild(b);
      }
      // 010 真实之剑：2 颗任意骰代替「消耗 1 颗冥想骰」
      if (convertAvailable(state, pd.player)) {
        const c = button('btn btn-convert', '用「真实之剑」置换：2 颗任意骰代替 1 颗');
        c.dataset.act = 'convert';
        c.addEventListener('click', () =>
          startPendingWizard('@dunwuHalveConvert', 'dunwuHalveConvert', pd.player as TwoVTwoSeat),
        );
        list.appendChild(c);
      }
    } else if (dustFlow) {
      const dust = renderDustFlowHost({
        state,
        legal,
        flow: dustFlow,
        setFlow: (flow) => {
          dustFlow = flow;
        },
        onAction: dispatch,
        requestRender: draw,
      });
      if (dust) list.appendChild(dust);
    } else if (defenseVote) {
      // 守方投票：**没有「取消」**——挡不挡是守方的决定，不能把控制权退回给攻击方。
      // 第 1 行「这一刀」：文案与 1v1 提示栏**同一来源**（`attackInfoParts`），只多"攻击方名字 + 预计"。
      if (defenseInfo) {
        const info = el('div', 'b2v2-vote-info');
        for (const part of attackInfoParts(state, defenseInfo, seatName, {
          showAttacker: true,
          estimated: true,
        })) {
          if (part.strong) {
            const b = el('b', 'b2v2-strong');
            b.textContent = part.text;
            info.appendChild(b);
          } else if (part.color) {
            const s = el('span', `hint-skill player-${part.color}`);
            s.textContent = part.text;
            info.appendChild(s);
          } else {
            info.appendChild(document.createTextNode(part.text));
          }
        }
        list.appendChild(info);
      }
      // 第 2 行：提示 + 两位投票人（同一行，窄屏才折）
      list.appendChild(
        votePanel(
          realView,
          defenseVote.votes as Partial<Record<TwoVTwoSeat, TwoVTwoSeat>>,
          onDefenseVote,
        ),
      );
    } else if (pendingSkillTarget) {
      // 2v2·攻方选择：技能步骤跑完 → 先选目标 → 确认条 → 派发（虚拟骰动画只出一次）
      const row = el('div', 'option-row');
      const label = el('span', 'selector-hint');
      label.textContent = '目标';
      row.appendChild(label);
      for (const seat of enemiesOf(state, state.activePlayer) as TwoVTwoSeat[]) {
        const b = button(`btn option-btn b2v2-target player-${seat}`, seatName(seat));
        b.dataset.choice = seat;
        b.addEventListener('click', () => {
          const next = { ...pendingSkillTarget!, target: seat } as Action;
          propose(next, actionLabel(state, next));
        });
        row.appendChild(b);
      }
      list.appendChild(row);
      const cancel = button('btn btn-cancel', '取消');
      cancel.addEventListener('click', () => {
        pendingSkillTarget = null;
        draw();
      });
      list.appendChild(cancel);
    } else {
      // 010「真实之剑」置换入口（与 1v1 同序：重掷之后、技能按钮之前）。
      // ⚠️ 不按攻守标记过滤：标记只决定"谁去应对这一击"，不限制谁能发起攻击
      //    （《2v2 目标判定参考》§3.1）。守方选择时选满 2 颗会先走投票。
      if (
        state.phase === 'main' &&
        !state.pending &&
        !state.pendingAttack &&
        convertAvailable(state, state.activePlayer)
      ) {
        const b = button('btn btn-convert', '使用「真实之剑」置换进行攻击');
        b.dataset.act = 'convert';
        b.addEventListener('click', () => {
          convertPick = { kind: 'attack', dieIds: [] };
          draw();
        });
        list.appendChild(b);
      }
      if (state.pendingAttack && !state.pendingAttack.unblockable && !state.pending) {
        const def = state.pendingAttack.defender;
        if (def && convertAvailable(state, def)) {
          const b = button('btn btn-convert', '使用「真实之剑」置换进行抵挡');
          b.dataset.act = 'convert';
          b.addEventListener('click', () => {
            convertPick = { kind: 'block', dieIds: [] };
            draw();
          });
          list.appendChild(b);
        }
      }
      // 技能按钮排在攻击骰之前（与 1v1 操作列表一致）。
      const seenTopSkill = new Set<string>();
      let seenFengmangOpen = false;
      /** 与 1v1 一致：「不发动」**收集到最后再画**（1v1 的 `plain` 也是循环后统一追加）→ 顺序永远是「发动」在前。 */
      let fengmangDecline: Action | null = null;
      for (const a of legal) {
        if (a.t === 'fengmang') {
          if (!a.accept) {
            // 与 1v1 一致：普通 `btn` + 文案「不发动」；顺序见下方补画
            if (!fengmangDecline) fengmangDecline = a;
          } else if (!fengmangPick && !seenFengmangOpen) {
            seenFengmangOpen = true;
            const b = button('btn btn-skill', '发动「锋芒」');
            b.dataset.act = 'fengmangOpen';
            b.addEventListener('click', () => {
              fengmangPick = {};
              draw();
            });
            list.appendChild(b);
          }
          continue;
        }
        if (a.t !== 'skill') continue;
        const sig = `${a.artifactId}:${a.side}:${a.params?.legendKey ?? ''}`;
        if (seenTopSkill.has(sig)) continue;
        seenTopSkill.add(sig);
        const b = button('btn btn-skill', actionLabel(state, a));
        b.dataset.act = 'skill';
        b.addEventListener('click', () => fireSkillAction(a));
        list.appendChild(b);
      }
      const attackActs = legal.filter(
        (a): a is Extract<Action, { t: 'attack' }> =>
          a.t === 'attack' && !!a.costSlots?.[0]?.dieIds?.length,
      );
      if (attackActs.length > 0) {
        list.appendChild(
          renderChipRow(
            '攻击',
            attackActs.map((a) => {
              const id = a.costSlots[0].dieIds[0];
              return {
                id,
                act: 'attack',
                className: `pay-die clickable die-${state.activePlayer as TwoVTwoSeat}${
                  selected?.t === 'attack' && selected.costSlots[0]?.dieIds[0] === id ? ' selected' : ''
                }`,
                text: a.costSlots[0]?.treated ? `${dieText2v2(state, id)} → 攻击` : dieText2v2(state, id),
                onClick: () => {
                  if (state.stance === 'defensePicks') {
                    // 守方选择：先投票"谁去应对"（不播预览；投完派发时才演这一刀）
                    beginDefenseVote(a);
                    return;
                  }
                  if (attackTarget) {
                    const next = { ...a, target: attackTarget } as Action;
                    propose(next, actionLabel(state, next));
                    return;
                  }
                  selected = a;
                  draw();
                },
              };
            }),
          ),
        );
      }
      const defender = state.pendingAttack?.defender;
      const blockActs = state.pendingAttack
        ? legal.filter((a): a is Extract<Action, { t: 'block' }> =>
            a.t === 'block' && !!a.costSlots?.[0]?.dieIds?.length,
          )
        : [];
      if (blockActs.length > 0 && defender) {
        list.appendChild(
          renderChipRow(
            '抵挡',
            blockActs.map((a) => {
              const id = a.costSlots![0].dieIds[0];
              return {
                id,
                act: 'block',
                className: `pay-die clickable die-${defender}`,
                text: dieText2v2(state, id),
                onClick: () => propose({ ...a, by: defender } as Action, actionLabel(state, a)),
              };
            }),
          ),
        );
      }
      const blockHasDice = legal.some(
        (a) => a.t === 'block' && (a.costSlots?.[0]?.dieIds?.length ?? 0) > 0,
      );
      const noBlock = legal.find((a) => a.t === 'block' && !a.costSlots?.[0]?.dieIds?.length);
      if (noBlock && defender) {
        const b = button('btn', '不抵挡');
        b.dataset.act = 'block';
        b.addEventListener('click', () => {
          const action = { ...noBlock, by: defender } as Action;
          if (blockHasDice) propose(action, '不抵挡');
          else dispatch(action);
        });
        list.appendChild(b);
      }
      // 010 真实之剑：023 畏惧·支付的「2 颗顶 1」入口
      // （011 屏障·触发有自己的专用分支，入口在那里，避免两处渲染）
      const pk = state.pending;
      if (pk && pk.kind === 'weijuPay' && convertAvailable(state, pk.player)) {
        const c = button('btn btn-convert', '用「真实之剑」置换：2 颗任意骰代替 1 颗');
        c.dataset.act = 'convert';
        c.addEventListener('click', () =>
          startPendingWizard('@weijuPayConvert', 'weijuPayConvert', pk.player as TwoVTwoSeat),
        );
        list.appendChild(c);
      }
      const attackPicks = state.stance !== 'defensePicks';
      if (attackPicks && !selected && attackActs.length > 0) {
        const row = el('div', 'option-row');
        const label = el('span', 'selector-hint');
        label.textContent = '目标';
        row.appendChild(label);
        for (const seat of actionTargets(state, attackActs[0])) {
          const chosen = attackTarget === seat;
          const b = button(
            `btn option-btn b2v2-target player-${seat}${chosen ? ' option-btn--on' : ''}`,
            seatName(seat),
          );
          b.dataset.choice = seat;
          b.addEventListener('click', () => {
            attackTarget = seat;
            draw();
          });
          row.appendChild(b);
        }
        list.appendChild(row);
      }
      if (attackPicks && selected) {
        const row = el('div', 'option-row');
        const label = el('span', 'selector-hint');
        label.textContent = '目标';
        row.appendChild(label);
        for (const seat of actionTargets(state, selected)) {
          const chosen = selected.t === 'attack' && attackTarget === seat;
          const b = button(
            `btn option-btn b2v2-target player-${seat}${chosen ? ' option-btn--on' : ''}`,
            seatName(seat),
          );
          b.dataset.choice = seat;
          b.addEventListener('click', () => {
            if (selected!.t === 'skill') {
              const key = skillKeyForAction(state, selected as Extract<Action, { t: 'skill' }>);
              if (key && SKILL_SELECTION[key]) {
                startWizard(selected as Extract<Action, { t: 'skill' }>, seat);
                return;
              }
            }
            const next = { ...selected!, target: seat } as Action;
            propose(next, actionLabel(state, next));
          });
          row.appendChild(b);
        }
        list.appendChild(row);
      }
      // ── 通用规则：**纯选对象型待决策**合成一行 ──────────────────────────────
      // `目标 [玩家B1] [玩家B2] [不发动「杀意」]`：目标直接摆出来，一个"放弃"按钮收尾。
      // 一次写对 → 全部同形状技能自动适用（不按卡号判定，见 `pureTargetPending`）。
      // 提示栏的「轮到 X 操作 技能名：…」由 1v1 共用的 `renderHintHost` 负责，这里不重复。
      const pureTargets = new Map<string, Action>();
      for (const a of legal) {
        if (pureTargetPending(state, a) && !pureTargets.has(a.t)) pureTargets.set(a.t, a);
      }
      for (const [type, yes] of pureTargets) {
        const no = legal.find(
          (x) => x.t === type && (x as { accept?: boolean }).accept === false,
        );
        const row = el('div', 'option-row option-row--decide');
        const rowLabel = el('span', 'selector-hint');
        rowLabel.textContent = '目标';
        row.appendChild(rowLabel);
        for (const seat of actionTargets(state, yes)) {
          const b = button(`btn option-btn b2v2-target player-${seat}`, seatName(seat));
          b.dataset.act = type;
          b.dataset.choice = seat;
          b.addEventListener('click', () => {
            const next = { ...yes, target: seat } as Action;
            propose(next, actionLabel(state, next));
          });
          row.appendChild(b);
        }
        if (no) {
          // 按钮文案必须带技能名（原本技能名挂在"发动"按钮上，合并后它没了）→ 走 1v1 唯一来源
          const b = button('btn', pendingActionLabel(state, no) ?? '不发动');
          b.dataset.act = type;
          b.dataset.choice = 'decline';
          b.addEventListener('click', () => propose(no, actionLabel(state, no)));
          row.appendChild(b);
        }
        list.appendChild(row);
      }
      const seenDust = new Set<string>();
      for (const a of legal) {
        // ⚠️ **一个动作只有一个渲染来源**：这些动作已由上面的专用分支渲染，通用循环必须跳过。
        // 漏跳 fengmang → 引擎枚举的每条「攻×冥」组合都会变成按钮（真实事故：2v2 锋芒泄漏一堆组合按钮）。
        // 漏跳 endDiscard/万丈明光/死亡亦逝 → 会多出一个纯文字的重复按钮（它们由上面的入口按钮负责）。
        if (
          BESPOKE_ACTS.has(a.t) ||
          // 纯选对象型：已由上面的**单行**统一渲染（`目标 [B1] [B2] [不发动「X」]`）
          pureTargets.has(a.t) ||
          a.t === 'endDiscardResolve' ||
          a.t === 'wanzhangDiscard' ||
          a.t === 'tiaolingResolve'
        ) {
          continue;
        }
        if (a.t === 'dustRise') {
          if (seenDust.has(a.artifactId)) continue;
          seenDust.add(a.artifactId);
        }
        const b = button('btn', actionLabel(state, a));
        b.dataset.act = a.t;
        const targets = actionTargets(state, a);
        b.addEventListener('click', () => {
          if (a.t === 'dustRise') {
            const flow = startDustFlowHost(
              {
                state,
                legal,
                setFlow: (next) => {
                  dustFlow = next;
                },
                onAction: dispatch,
                requestRender: draw,
              },
              a.artifactId,
              !!a.free,
              !!a.fuchou,
            );
            if (flow) {
              dustFlow = flow;
              draw();
            }
            return;
          }
          if (targets.length > 1) {
            selected = a;
            draw();
          } else {
            propose({ ...a, ...(targets[0] ? { target: targets[0] } : {}) } as Action, actionLabel(state, a));
          }
        });
        list.appendChild(b);
      }
      // 「不发动」补画在**最后**（1v1 的 `plain` 同口径）→ 与 1v1 顺序一致：发动在前、不发动在后。
      if (fengmangDecline) {
        const label = actionLabelOf(state, fengmangDecline) ?? '不发动';
        const b = button('btn', label);
        b.dataset.act = 'fengmangDecline';
        b.addEventListener('click', () => propose(fengmangDecline!, label));
        list.appendChild(b);
      }
    }
    zone.append(hint, list);
    const side = el('div', 'zone-side');
    side.append(stanceToken(state.stance ?? 'attackPicks', () => {}));
    zone.appendChild(side);
    left.appendChild(zone);
    center.appendChild(left);
    const right = el('div', 'centerband-right');
    const settings = button('btn btn-settings', '设置');
    settings.dataset.act = 'settingsOpen';
    settings.addEventListener('click', () => {
      settingsOpen = true;
      draw();
    });
    right.appendChild(settings);
    center.appendChild(right);
    main.appendChild(center);
    main.appendChild(teamRow(bottomTeam, realView, true));
    main.appendChild(sideRowReal(bottomTeam, realView, false, prefs, state, onDieClick, boardDieSel, cardSkillRow));
    board.appendChild(main);
    stage.appendChild(board);
    for (const cardEl of Array.from(board.querySelectorAll<HTMLElement>('.card[data-artifact]'))) {
      const open = (): void => {
        const id = cardEl.dataset.artifact;
        if (!id) return;
        const ownerEl = cardEl.closest<HTMLElement>('.player[data-player]');
        const owner = ownerEl?.dataset.player as TwoVTwoSeat | undefined;
        openArtifactDetail(id, owner, cardEl);
      };
      cardEl.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        open();
      });
      cardEl.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        open();
      });
      let holdTimer: number | null = null;
      const cancelHold = (): void => {
        if (holdTimer != null) window.clearTimeout(holdTimer);
        holdTimer = null;
      };
      cardEl.addEventListener('pointerdown', () => {
        cancelHold();
        holdTimer = window.setTimeout(open, 450);
      });
      cardEl.addEventListener('pointerup', cancelHold);
      cardEl.addEventListener('pointerleave', cancelHold);
      cardEl.addEventListener('pointercancel', cancelHold);
    }
    root.innerHTML = '';
    root.append(stage, overlayLayer);
    // 重绘后把"还在飞的骰子"重新藏起来（与 1v1 同一位置、同一函数）。
    // ⚠️ 少了这一行：只要动画期间重绘一次（2v2 换视角那一帧必然重绘），
    //    骰区就会重建出**可见**的真骰 → 替身还在中间飞，骰区已经显示（真实事故）。
    restoreInFlightHides(root);
    applyZoomShared(stage, prefs);
    // 换队帧：把**新视角那一队**的「获得骰」延后到切换后播。
    // ⚠️ 少了这一条，就是"上家刚结束、下家补充的骰在旧视角里飞完，才切画面"（真实事故）。
    const deferAdds: PlayerId[] | null = holdView
      ? SEATS.filter((s) => TEAM_OF[s] === viewTarget)
      : null;
    const settle = run2v2Motions(root, state, prevDice, prevStored, fxEvents, lifeDeltas, deferAdds);
    if (holdView && !viewSwitchScheduled) {
      viewSwitchScheduled = true;
      const finishViewSwitch = (): void => {
        // 旧闭包已过期（这期间又重建过）→ 丢掉，别拿旧 DOM 覆盖新界面。
        if (gen !== gen2v2) return;
        lastViewTeam2v2.set(state, viewTarget);
        if (hooks.requestRender) hooks.requestRender();
        else {
          viewTeam = viewTarget;
          draw();
        }
      };
      window.setTimeout(finishViewSwitch, Math.max(0, settle) + 20);
    }
    const prevSnap = lastPhase2v2.get(state) ?? null;
    lastPhase2v2.set(state, { active: state.activePlayer, phase: state.phase });
    const bannerSegs = phaseBannerSegs(
      prevSnap,
      { active: state.activePlayer, phase: state.phase },
      (p) => seatName(p),
    );
    if (bannerSegs.length > 0) {
      let at = settle + 30;
      for (const seg of bannerSegs) {
        const end = playBanner(root, seg.text, at, seg.transient ? MOTION.bannerHoldTransient : undefined);
        at = end > 0 ? end : at + (MOTION.micro + MOTION.bannerHold + MOTION.fade);
      }
    }
    if (logOpen && prefs.logCollapsed) {
      overlayLayer.appendChild(
        logDrawer(realView, () => {
          logOpen = false;
          draw();
        }),
      );
    }
    if (settingsOpen) {
      overlayLayer.appendChild(
        renderSettingsPanel(
          state,
          prefs,
          (next) => {
            prefs = next;
            savePrefs(next);
            draw();
          },
          () => {
            settingsOpen = false;
            draw();
          },
        ),
      );
    }
    if (state.phase === 'gameOver') {
      const winner =
        state.winner === 'A' || state.winner === 'B'
          ? state.winner
          : TEAM_OF[state.activePlayer as TwoVTwoSeat];
      const overlay = el('div', 'gameover-overlay');
      const panel = el('div', 'gameover-modal b2v2-gameover');
      const title = el('div', 'gameover-title');
      title.textContent = '游戏结束';
      const who = el('div', 'gameover-winner b2v2-gameover-winner');
      const whoText = el('span', `player-${winner}`);
      whoText.textContent = `${winner} 队胜利`;
      who.appendChild(whoText);
      const reason = el('div', 'gameover-reason');
      reason.textContent =
        state.dustfall >= 10 ? '尘落达到 10，按团队生命判定胜负' : '对方团队生命归零';
      const actions = el('div', 'gameover-foot');
      if (hooks.onRestart) {
        const again = button('btn setup-start gameover-restart', '再来一局');
        again.addEventListener('click', hooks.onRestart);
        actions.appendChild(again);
      }
      const back = button('btn', '返回');
      back.addEventListener('click', hooks.onBack);
      actions.appendChild(back);
      panel.append(title, who, reason, actions);
      overlay.appendChild(panel);
      overlayLayer.appendChild(overlay);
    }
    // 把"进行中的操作"写回持久层：下一次整页重建（换视角/派发）从这里恢复，
    // 确认条 / 向导 / 投票不会再被重建清掉。
    syncStep();
    // ── 排查（?diag=1）：本帧"进行中的操作"快照（只在变化时记一条，避免刷屏）──
    if (isDiagEnabled()) {
      const snap = snapshotUi2v2(legal);
      const key = JSON.stringify(snap);
      if (key !== lastStep2v2) {
        lastStep2v2 = key;
        diag('ui-step', snap);
      }
    }
  };

  draw();
}

function sideRowReal(
  team: TwoVTwoTeam,
  view: ViewState,
  top: boolean,
  prefs: Prefs,
  state?: GameState,
  onDieClick?: (seat: TwoVTwoSeat, id: string) => void,
  selected?: Set<string>,
  onSkillClick?: SkillRowClickHandler,
): HTMLElement {
  const row = el('div', 'side-row');
  for (const seat of TEAM_MEMBERS[team]) row.appendChild(playerPanel(view.seats[seat], view, top, prefs, state, onDieClick, selected, onSkillClick));
  return row;
}

export function realLogPanel(state: GameState): HTMLElement {
  const log = el('div', 'log');
  const entries = state.log.slice(-80).reverse();
  if (entries.length === 0) {
    const empty = el('div', 'log-line');
    empty.textContent = '暂无战报';
    log.appendChild(empty);
  } else {
    for (const entry of entries) {
      const row = el('div', 'log-line');
      const prefix = el('span', 'log-prefix');
      prefix.textContent = `T${entry.turn}·${PHASE_LABEL[entry.phase]}：`;
      row.appendChild(prefix);
      appendColoredLog2v2(row, entry.text);
      log.appendChild(row);
    }
  }
  return log;
}
function buildRealView(state: GameState): ViewState {
  const seats = {} as Record<TwoVTwoSeat, SeatView>;
  const teams: Record<TwoVTwoTeam, TeamView> = {
    A: { life: state.teams?.A?.life ?? 0, lifeMax: state.teams?.A?.lifeMax ?? 1 },
    B: { life: state.teams?.B?.life ?? 0, lifeMax: state.teams?.B?.lifeMax ?? 1 },
  };
  for (const seat of SEATS) {
    const player = state.players[seat];
    seats[seat] = {
      seat,
      team: TEAM_OF[seat],
      color: SEAT_COLOR[seat],
      artifacts: player.artifacts.map((a) => (
        {
          id: a.id,
          name: a.name,
          column: a.column,
          count: a.count,
          countCap: a.countCap,
          chargeLayer: a.chargeLayer,
          chargeReq: a.chargeReq,
          activeMarkerSide: a.activeMarkerSide,
          allSidesActiveThisTurn: a.allSidesActiveThisTurn,
          continuousLost: a.continuousLost,
          heldDice: a.heldDice?.map((d) => ({ id: d.id, value: d.value })),
        }
      )),
      dice: {
        attack: player.areas.attack.map((d) => d.value),
        defense: player.areas.defense.map((d) => d.value),
        meditation: player.areas.meditation.map((d) => d.value),
      },
      diceIds: {
        attack: player.areas.attack.map((d) => d.id),
        defense: player.areas.defense.map((d) => d.id),
        meditation: player.areas.meditation.map((d) => d.id),
      },
      hasSeal: player.hasDustSeal,
    };
  }
  /**
   * 「行动中」药丸 + 黄框归属：与**视角同源**（待决策人 → 防守方 → 回合玩家），
   * 不能只看 `state.activePlayer`——否则 009/011 待决策、或轮到守方时，标记还停在攻方（真实反馈 2026-11-07）。
   */
  const decider = ((): PlayerId => {
    const pend = state.pending?.player;
    if (pend && pend in seats) return pend;
    const def = state.pendingAttack?.defender;
    if (def && def in seats) return def;
    return state.activePlayer;
  })();
  const activeSeat = (decider in seats ? decider : (state.roster?.[0] ?? 'A1')) as TwoVTwoSeat;
  return {
    seats,
    teams,
    activeSeat,
    log:
      state.log.length > 0
        ? state.log.slice(-80).reverse().map((entry) => ({
            actor: (entry.text.match(/(A[12]|B[12])/)?.[1] as TwoVTwoSeat | undefined) ?? activeSeat,
            text: entry.text,
            turn: entry.turn,
            phase: entry.phase,
          }))
        : [{ actor: activeSeat, text: '暂无战报' }],
  };
}
