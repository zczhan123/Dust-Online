import type { GameState, PlayerId } from '../core/model/types';

/**
 * 战斗界面动效。
 *
 * 约束（见 `..\plans\战斗界面动画计划.md`）：
 * - 总闸 / 时长 / 缓动集中在此；只动 `transform/opacity`；`prefers-reduced-motion` 自动降级。
 * - 动画速度由设置项驱动（正常=1 / 快=2，时长 = base / 倍率）。
 * - 无真实布局（jsdom/测试）整体跳过。
 * - **顺序**：一次重绘内分两阶段——① 生命 + 消耗/弃置/让位（旧坐标）② 获得；两阶段**串行不重叠**。
 *   若同时要换视角：阶段①在旧视角播完 → 切 → 阶段②在新视角播（"先减后加 + 切在中间"）。
 * - 全局：位移/出现/消失类结尾都"顿一下"。
 */

export interface MotionTokens {
  press: number;
  micro: number;
  move: number;
  hold: number;
  fade: number;
  settle: number;
  emphasis: number;
  /** 气泡：从小变大浮现 → 停 → 原地淡出 */
  emerge: number;
  bubbleHold: number;
  bubbleOut: number;
  /** 阶段横幅停留时长（「回合开始 / 尘起阶段 / 主要阶段」） */
  bannerHold: number;
  /** 被自动跳过的阶段：横幅停留时长（比 bannerHold 短，供"顺序补播"用） */
  bannerHoldTransient: number;
  /** 徽标跳动（计数变化） */
  bump: number;
  /** 必杀横幅停留时长 */
  ultimateHold: number;
}

export const MOTION: MotionTokens = {
  press: 90,
  micro: 140,
  move: 450,
  hold: 200,
  fade: 200,
  settle: 200,
  emphasis: 550,
  emerge: 220,
  bubbleHold: 1100,
  bubbleOut: 240,
  bannerHold: 1400,
  bannerHoldTransient: 600,
  bump: 180,
  ultimateHold: 1500,
};

export const EASE = {
  enter: 'cubic-bezier(0.16, 1, 0.3, 1)',
  move: 'cubic-bezier(0.4, 0, 0.2, 1)',
  pop: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;

let speedFactor = 1;

export function setMotionSpeed(factor: number): void {
  speedFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
}

function ms(base: number): number {
  return Math.max(40, Math.round(base / speedFactor));
}

let masterEnabled = true;

export function setMotionEnabled(v: boolean): void {
  masterEnabled = v;
}

export function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

function moveScale(): number {
  return prefersReducedMotion() ? 0 : 1;
}

export function canAnimate(host: HTMLElement | null): host is HTMLElement {
  if (!masterEnabled) return false;
  if (!host || !host.isConnected) return false;
  try {
    return host.getBoundingClientRect().width > 0;
  } catch {
    return false;
  }
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PrevDie {
  rect: Rect;
  html: string;
  owner: PlayerId | null;
  kind: 'attack' | 'defense' | 'meditation' | null;
  value: number;
}

export type PrevDice = Map<string, PrevDie>;

export function snapshotDice(root: HTMLElement): PrevDice {
  const map: PrevDice = new Map();
  root.querySelectorAll<HTMLElement>('.die[data-id]').forEach((el) => {
    const id = el.dataset.id;
    if (!id) return;
    const r = el.getBoundingClientRect();
    const clone = el.cloneNode(true) as HTMLElement;
    clone.removeAttribute('style');
    const owner: PlayerId | null = el.classList.contains('die-A')
      ? 'A'
      : el.classList.contains('die-B')
        ? 'B'
        : null;
    const kind = (el.closest('.area') as HTMLElement | null)?.dataset.kind as
      | 'attack'
      | 'defense'
      | 'meditation'
      | undefined;
    map.set(id, {
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      html: clone.outerHTML,
      owner,
      kind: kind ?? null,
      value: Number(el.dataset.value ?? ''),
    });
  });
  return map;
}

export interface StoredDie {
  rect: Rect;
  html: string;
  value: number;
}
export type StoredDice = Map<string, StoredDie>;

/** 存放骰（027/034/A06 的卡头存放骰 + T15 战术栏存放骰）——**不在区域**，单独快照。 */
export function snapshotStored(root: HTMLElement): StoredDice {
  const map: StoredDice = new Map();
  root
    .querySelectorAll<HTMLElement>('.card-held--head .pay-die--held[data-id], .tactic-held-die[data-id]')
    .forEach((el) => {
      const id = el.dataset.id;
      if (!id) return;
      const r = el.getBoundingClientRect();
      const clone = el.cloneNode(true) as HTMLElement;
      clone.removeAttribute('style');
      map.set(id, {
        rect: { left: r.left, top: r.top, width: r.width, height: r.height },
        html: clone.outerHTML,
        value: Number(el.dataset.value ?? ''),
      });
    });
  return map;
}

/** 从游戏状态列出"存放骰"id（供"切换前是否要等"判定）。 */
export function storedIdsOf(state: GameState): Set<string> {
  const s = new Set<string>();
  for (const p of ['A', 'B'] as const) {
    for (const a of state.players[p].artifacts) for (const h of a.heldDice ?? []) s.add(h.id);
    const t = state.players[p].tacticHeldDie;
    if (t) s.add(t.id);
  }
  return s;
}

/** 上一帧的骰子相对 `state`：**点数/所属区/玩家**有没有变（用于门槛——重掷/改点/换区 id 不变也要做动画）。 */
export function areaDiceChanged(prev: PrevDice, state: GameState): boolean {
  for (const p of ['A', 'B'] as const) {
    for (const k of ['attack', 'defense', 'meditation'] as const) {
      for (const d of state.players[p].areas[k]) {
        const pd = prev.get(d.id);
        if (!pd) continue; // 新增由"id 集合变化"覆盖
        if (pd.value !== d.value || pd.kind !== k || pd.owner !== p) return true;
      }
    }
  }
  return false;
}

export function areaDieIds(state: GameState): Set<string> {
  const s = new Set<string>();
  for (const p of ['A', 'B'] as const) {
    for (const k of ['defense', 'attack', 'meditation'] as const) {
      for (const d of state.players[p].areas[k]) s.add(d.id);
    }
  }
  return s;
}

export function diceSetChanged(prev: PrevDice, ids: Set<string>): boolean {
  if (ids.size !== prev.size) return true;
  for (const id of ids) if (!prev.has(id)) return true;
  return false;
}

/** 上一帧存在、这一帧没有了（＝被消耗/弃置/移动走）→ 需要"飞向中间淡出"。 */
export function anyRemoved(prev: PrevDice, ids: Set<string>): boolean {
  for (const id of prev.keys()) if (!ids.has(id)) return true;
  return false;
}

/** 这一帧新出现（＝获得/补给）。 */
export function anyAdded(prev: PrevDice, ids: Set<string>): boolean {
  for (const id of ids) if (!prev.has(id)) return true;
  return false;
}

/**
 * 池化点（"中间"）＝快速操作栏 `.actionzone` 正中心；无则 `.centerband`；再退视口中心。每次播放实时测量。
 */
export function poolPoint(root: HTMLElement): { x: number; y: number } {
  const pick = (sel: string): HTMLElement | null => root.querySelector<HTMLElement>(sel);
  const el = pick('.actionzone') ?? pick('.centerband') ?? pick('.centerband-left');
  if (el) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
  return { x: vw / 2, y: vh / 2 };
}

export interface LifeDelta {
  player: PlayerId;
  /** 变化量；>0 回血、<0 掉血、**=0 表示"回血已结算但满血被削平"→ 显示 +0** */
  delta: number;
  /** 当前生命上限（用于"血条平滑变长"换算） */
  max: number;
  /** 「非伤害的下降」（033 抹零）：面板**不抖**（其余反馈照旧）。 */
  calm?: boolean;
}

interface LifeSnap {
  life: number;
  max: number;
}

const lastLife = new WeakMap<GameState, Record<PlayerId, LifeSnap>>();

export function diffLife(state: GameState): LifeDelta[] {
  const prev = lastLife.get(state);
  const cur: Record<PlayerId, LifeSnap> = {
    A: { life: state.players.A.life, max: state.players.A.lifeMax },
    B: { life: state.players.B.life, max: state.players.B.lifeMax },
  };
  lastLife.set(state, cur);
  if (!prev) return [];
  const out: LifeDelta[] = [];
  for (const p of ['A', 'B'] as const) {
    const d = cur[p].life - prev[p].life;
    if (d !== 0) out.push({ player: p, delta: d, max: cur[p].max });
  }
  return out;
}

const raf = (fn: () => void): void => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(fn));
  } else {
    setTimeout(fn, 16);
  }
};

function ensureFxLayer(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  let layer = document.getElementById('fx-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'fx-layer';
    layer.className = 'fx-layer';
    document.body.appendChild(layer);
  }
  return layer;
}

function rectCenter(r: Rect): { x: number; y: number } {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** 玩家色（硬编码，与骰子/骰片一致；黑白世界里唯一的彩色点缀）。 */
export const PLAYER_COLOR: Record<PlayerId, string> = { A: '#2563eb', B: '#dc2626' };

/** 骰子视觉尺寸与并排缝隙——**所有"并排"共用**：骰宽 + 8px 缝、居中排开。 */
const DIE_W = 26;
const DIE_GAP = 8;

/** 以 centerX 居中、count 个、间距＝dieW+8，返回各中心 x。 */
function sideBySideXs(centerX: number, count: number, dieW: number): number[] {
  const spacing = dieW + DIE_GAP;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(centerX + (i - (count - 1) / 2) * spacing);
  return out;
}

export interface AttackStartInfo {
  /** 本次攻击标识（`pendingAttack` 对象引用）——识别"新的一次攻击" */
  sig: unknown;
  attacker: PlayerId;
  /** 本次攻击的目标（2v2 用；默认＝1v1 对方）。动画只用"攻击方面板→目标面板"两个**身份**，与朝向无关。 */
  target?: PlayerId;
  /** 本次攻击点数（实体＝骰点；虚拟＝技能指定点数） */
  value: number;
  /** 虚拟攻击（技能发起、无实体骰）→ 用灰色幽灵骰 */
  virtual: boolean;
  /** 本攻击骰来自"存放骰"（卡头/战术栏）→ 也用灰色骰（与存放骰外观一致） */
  fromCard?: boolean;
  /** 物理攻击：被支付那颗骰子的旧位置（起点）；无则用攻击方攻击骰区中心 */
  sourceRect: Rect | null;
  /** "代价组"的完整时长（ms）：攻击骰延迟这么久才起步（＝代价先于效果）；无代价=0 */
  costDur: number;
  /** 本次攻击由"真实之剑置换"支付：先 2 骰并排→中间→停顿→合并成灰 5 停住（不另建攻击骰） */
  substitution?: { rects: Rect[]; values: number[] } | null;
}

interface AttackPool {
  sig: unknown;
  /** 池中骰（1..3，按格从左到右）。第一颗＝攻击骰，其后＝并排补入的骰（011/034）。 */
  dice: { el: HTMLElement; ox: number; oy: number }[];
  /** 当前对齐格数（1＝正中；2/3＝并排居中）。 */
  slots: number;
  parked: boolean;
}

let attackPool: AttackPool | null = null;

function makeDieEl(player: PlayerId, value: number): HTMLElement {
  const d = document.createElement('div');
  d.className = `fx-die fx-die--${player}`;
  d.textContent = String(value);
  return d;
}

function makeGhostEl(player: PlayerId, value: number): HTMLElement {
  const d = document.createElement('div');
  d.className = 'fx-ghost-die';
  d.style.borderColor = PLAYER_COLOR[player];
  d.textContent = String(value);
  return d;
}

/** 存放骰（灰）飞行动效元素：**保持中性灰**，不染玩家色（与卡头/战术栏上的存放骰一致）。 */
function makeHeldEl(value: number): HTMLElement {
  const d = document.createElement('div');
  d.className = 'fx-die fx-die--held';
  d.textContent = String(value);
  return d;
}

/** 飞行动效的骰子"外观种类"：存放骰→held（灰） / 虚拟→virtual（玩家色描边） / 实体→solid（玩家色填充）。 */
export function flyingDieKind(opts: { held?: boolean; virtual?: boolean }): 'held' | 'virtual' | 'solid' {
  return opts.held ? 'held' : opts.virtual ? 'virtual' : 'solid';
}

function makeFlyingDie(kind: 'held' | 'virtual' | 'solid', player: PlayerId, value: number): HTMLElement {
  return kind === 'held' ? makeHeldEl(value) : kind === 'virtual' ? makeGhostEl(player, value) : makeDieEl(player, value);
}

/**
 * 把一颗"真骰"临时换成 fx 层的**影子替身**（用于"飞中间"的**改点 / 换区 / 搬家**动画）。
 * 影子在 `.fx-layer` → 天然压过**必杀横幅（层内最底）/技能名气泡**、也压过**快速操作栏**；
 * 真骰先隐藏、动画收尾再揭出。若 `el` 已在 fx 层（如 027 已自建影子）→ 原样返回、不重复包装。
 * 返回 `{ 可动画的元素, 收尾揭出真骰 }`。无布局（jsdom）时退回真骰。
 */
function ghostifyDie(el: HTMLElement): { el: HTMLElement; reveal: () => void } {
  if (el.closest('#fx-layer')) return { el, reveal: () => {} };
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return { el, reveal: () => {} };
  const player: PlayerId | null = el.classList.contains('die-A') ? 'A' : el.classList.contains('die-B') ? 'B' : null;
  const value = Number(el.textContent) || Number(el.dataset.value) || 1;
  const g = makeFlyingDie('solid', player ?? 'A', value);
  g.style.left = `${r.left}px`;
  g.style.top = `${r.top}px`;
  const layer = ensureFxLayer();
  (layer ?? document.body).appendChild(g);
  el.style.visibility = 'hidden';
  return {
    el: g,
    reveal: () => {
      el.style.visibility = '';
      g.remove();
    },
  };
}

function fadeEl(el: HTMLElement, dur: number): void {
  if (typeof el.animate === 'function') {
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: 'ease-in', fill: 'forwards' });
  } else {
    el.style.opacity = '0';
  }
  window.setTimeout(() => el.remove(), dur + 80);
}

/** 画一条连接线：**画 160 → 停 200 → 淡出 180**（从起点向终点"划出"）。返回时长。`className` 决定颜色/粗细。 */
function drawConnLine(
  layer: HTMLElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  className: string,
): number {
  const len = Math.max(1, Math.hypot(x2 - x1, y2 - y1));
  const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const drawDur = ms(160);
  const holdDur = ms(200);
  const fadeDur = ms(180);
  const total = drawDur + holdDur + fadeDur;
  const reduce = prefersReducedMotion();
  const line = document.createElement('div');
  line.className = className;
  line.style.left = `${x1}px`;
  line.style.top = `${y1}px`;
  line.style.width = `${len}px`;
  line.style.transformOrigin = '0 50%';
  line.style.transform = reduce ? `rotate(${ang}deg)` : `rotate(${ang}deg) scaleX(0)`;
  layer.appendChild(line);
  if (typeof line.animate === 'function') {
    line.animate(
      reduce
        ? [
            { opacity: 0, offset: 0 },
            { opacity: 1, offset: drawDur / total },
            { opacity: 1, offset: (drawDur + holdDur) / total },
            { opacity: 0, offset: 1 },
          ]
        : [
            { transform: `rotate(${ang}deg) scaleX(0)`, opacity: 0, offset: 0 },
            { transform: `rotate(${ang}deg) scaleX(1)`, opacity: 1, offset: drawDur / total },
            { transform: `rotate(${ang}deg) scaleX(1)`, opacity: 1, offset: (drawDur + holdDur) / total },
            { transform: `rotate(${ang}deg) scaleX(1)`, opacity: 0, offset: 1 },
          ],
      { duration: total, easing: 'ease-out' },
    );
  }
  window.setTimeout(() => line.remove(), total + 80);
  return total;
}

/** 攻击**连接线**（攻击方攻击骰区中心 → 被攻击方生命条中心）；不是骰子的运动路径。 */
function drawLinkLine(layer: HTMLElement, atk: HTMLElement | null, def: HTMLElement | null): number {
  if (!atk || !def) return 0;
  const start = atk.querySelector<HTMLElement>('.area[data-kind="attack"]') ?? atk;
  const end = def.querySelector<HTMLElement>('.lifeline') ?? def;
  const s = start.getBoundingClientRect();
  const e = end.getBoundingClientRect();
  return drawConnLine(layer, s.left + s.width / 2, s.top + s.height / 2, e.left + e.width / 2, e.top + e.height / 2, 'fx-line');
}

/**
 * 真伤**墨线**：**白色**从「发动卡图 / 战术栏中文名」中心 连到「受伤方生命条」中心。
 * 与攻击线同一编排（画 160 / 停 200 / 淡出 180），只换颜色与锚点。返回时长（供"整组播完才切视角"取 max）。
 * 位置**当场量取 DOM**、按**身份**取元素 → 联机 / 左右互搏都正确（不写死朝向）。
 */
export function drawTrueLine(root: HTMLElement, fromEl: HTMLElement | null, toEl: HTMLElement | null): number {
  if (!canAnimate(root) || !fromEl || !toEl) return 0;
  const layer = ensureFxLayer();
  if (!layer) return 0;
  const s = fromEl.getBoundingClientRect();
  const e = toEl.getBoundingClientRect();
  return drawConnLine(
    layer,
    s.left + s.width / 2,
    s.top + s.height / 2,
    e.left + e.width / 2,
    e.top + e.height / 2,
    'fx-line fx-line--truth',
  );
}

/**
 * 新攻击：画连接线 + 攻击骰（物理＝被支付骰的残影 / 虚拟＝灰骰）移到中间**停住**等对方响应。
 * `hasCost` 时延迟起步（＝代价动画先播完，满足"代价先于效果"）。
 */
export function attackStart(root: HTMLElement, info: AttackStartInfo): number {
  if (!canAnimate(root)) return 0;
  const layer = ensureFxLayer();
  if (!layer) return 0;
  if (attackPool && attackPool.sig === info.sig) {
    attackHold(root);
    return 0;
  }
  if (attackPool) {
    for (const d of attackPool.dice) d.el.remove();
    attackPool = null;
  }
  if (info.substitution) {
    return attackStartSubstituted(root, layer, info);
  }
  const defId: PlayerId = info.target ?? (info.attacker === 'A' ? 'B' : 'A');
  const atk = root.querySelector<HTMLElement>(`.player[data-player="${info.attacker}"]`);
  const pool = poolPoint(root);
  let ox = pool.x;
  let oy = pool.y;
  if (info.sourceRect) {
    ox = info.sourceRect.left + info.sourceRect.width / 2;
    oy = info.sourceRect.top + info.sourceRect.height / 2;
  } else if (atk) {
    const a = atk.querySelector<HTMLElement>('.area[data-kind="attack"]') ?? atk;
    const r = a.getBoundingClientRect();
    ox = r.left + r.width / 2;
    oy = r.top + r.height / 2;
  }

  const die = makeFlyingDie(flyingDieKind({ virtual: info.virtual, held: info.fromCard }), info.attacker, info.value);
  die.style.left = `${ox - 13}px`;
  die.style.top = `${oy - 13}px`;
  die.style.opacity = '0'; // 先不可见：等"代价整组播完"再出现
  layer.appendChild(die);
  attackPool = { sig: info.sig, dice: [{ el: die, ox, oy }], slots: 1, parked: false };

  const costDur = info.costDur;
  const flyDur = ms(MOTION.move) + ms(MOTION.settle);
  const inDur = ms(MOTION.micro);

  // 代价整组播完（含消失）后，才：画连接线（**重查当前元素**）+ 攻击骰淡入并飞向中间停住
  window.setTimeout(() => {
    const atkNow = root.querySelector<HTMLElement>(`.player[data-player="${info.attacker}"]`);
    const defNow = root.querySelector<HTMLElement>(`.player[data-player="${defId}"]`);
    drawLinkLine(layer, atkNow, defNow);
    die.style.transition = `opacity ${inDur}ms linear, transform ${flyDur}ms ${EASE.move}`;
    die.style.opacity = '1';
    const p = poolPoint(root);
    die.style.transform = `translate(${p.x - ox}px, ${p.y - oy}px)`;
  }, costDur);
  window.setTimeout(() => {
    if (attackPool && attackPool.dice[0]?.el === die) attackPool.parked = true;
  }, costDur + flyDur);

  return costDur + flyDur;
}

/** 攻击由"真实之剑置换"支付：2 骰并排→中间→停顿→合并成灰 5，之后灰 5 停在中间等抵挡。 */
function attackStartSubstituted(root: HTMLElement, layer: HTMLElement, info: AttackStartInfo): number {
  const sub = info.substitution!;
  const defId: PlayerId = info.target ?? (info.attacker === 'A' ? 'B' : 'A');
  const pool = poolPoint(root);
  const moveDur = ms(MOTION.move);
  const holdDur = ms(MOTION.hold);
  const popDur = ms(MOTION.micro);
  const xs = sideBySideXs(pool.x, sub.rects.length, DIE_W);
  // ① 2 颗源骰并排 → 中间
  sub.rects.forEach((r, i) => {
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const g = makeDieEl(info.attacker, sub.values[i] ?? 0);
    g.style.left = `${cx - 13}px`;
    g.style.top = `${cy - 13}px`;
    g.style.transition = `transform ${moveDur}ms ${EASE.move}`;
    layer.appendChild(g);
    raf(() => {
      g.style.transform = `translate(${xs[i] - cx}px, ${pool.y - cy}px)`;
    });
    window.setTimeout(() => g.remove(), moveDur + holdDur + 40);
  });
  // ② 停顿后合并成灰 5（＝停在中间等抵挡的攻击骰）
  const grey = makeGhostEl(info.attacker, info.value || 5);
  grey.style.left = `${pool.x - 13}px`;
  grey.style.top = `${pool.y - 13}px`;
  grey.style.opacity = '0';
  grey.style.transform = 'scale(.5)';
  layer.appendChild(grey);
  attackPool = { sig: info.sig, dice: [{ el: grey, ox: pool.x, oy: pool.y }], slots: 1, parked: false };
  const tMerge = moveDur + holdDur;
  window.setTimeout(() => {
    const atkNow = root.querySelector<HTMLElement>(`.player[data-player="${info.attacker}"]`);
    const defNow = root.querySelector<HTMLElement>(`.player[data-player="${defId}"]`);
    drawLinkLine(layer, atkNow, defNow);
    grey.style.transition = `opacity ${popDur}ms linear, transform ${popDur}ms ${EASE.pop}`;
    grey.style.opacity = '1';
    grey.style.transform = 'scale(1)';
  }, tMerge);
  window.setTimeout(() => {
    if (attackPool && attackPool.dice[0]?.el === grey) attackPool.parked = true;
  }, tMerge + popDur);
  return tMerge + popDur;
}

/** 等待期间每次重绘：把停在中间的骰（可能多颗）对齐当前中间（布局可能变）。 */
export function attackHold(root: HTMLElement): void {
  if (!attackPool || !attackPool.parked || !canAnimate(root)) return;
  const p = poolPoint(root);
  const xs = sideBySideXs(p.x, attackPool.slots, DIE_W);
  attackPool.dice.forEach((d, i) => {
    d.el.style.transition = 'none';
    d.el.style.transform = `translate(${xs[i] - d.ox}px, ${p.y - d.oy}px)`;
  });
}

/** 响应解决：不抵挡 → 攻击骰淡出；抵挡 → 防御骰到中间并排 → 一起淡出。 */
export interface AttackResolveOpts {
  defender: PlayerId;
  /** 普通抵挡：消耗的那颗骰（点数 + 旧位置；可能来自区域或卡头存放骰，`grey`＝来自卡头） */
  blockDie: { value: number; rect: Rect; grey?: boolean } | null;
  /** 置换抵挡：2 颗源骰（先合并成灰「5」再与攻击骰并排淡出） */
  substitution: { rects: Rect[]; values: number[] } | null;
  /** 攻击骰**先停在中间不淡出**（001/C01 裁雨流：等玩家决定；`dieId` 供落区判定） */
  hold?: { dieId: string } | null;
}

/** 被"停在中间等裁雨流决定"的攻击骰（临时 fx 元素）。`ox/oy`＝该临时骰的**未平移中心**
 *  （它的 `left/top` 就定在 `(ox,oy)`，再用 transform 平移到中间）——收尾飞回真骰时按它算**绝对平移**。 */
let heldAttackDie: { el: HTMLElement; dieId: string; ox: number; oy: number } | null = null;

/** 当前是否有"停在中间等裁雨流决定"的攻击骰（供 render 把真骰排除出普通获得动画）。 */
export function heldAttackDieId(): string | null {
  return heldAttackDie?.dieId ?? null;
}

/**
 * 收尾"停在中间的攻击骰"时所需的 `transform: translate(dx,dy)`：
 * 必须相对该临时骰的**未平移中心 `(ox,oy)`**（不是相对"当前位置"）——因为 `left/top` 定在 `(ox,oy)`、
 * 位置全靠 transform 表达；终点＝`真骰中心 − (ox,oy)`。
 * （真实事故：曾把"当前位置→真骰"的**差值**当 transform 设上去 → 少算"中间 − 原点"那一段，裁雨流飞偏、没落进区域。）
 */
export function heldReleaseOffset(
  realX: number,
  realY: number,
  ox: number,
  oy: number,
): { dx: number; dy: number } {
  return { dx: realX - ox, dy: realY - oy };
}

/**
 * 收尾"停在中间等裁雨流决定"的攻击骰（待决策解决后调用）：
 * - 已落区（发动）→ 在中间**翻面**（点数变了就翻滚）→ **飞回该区那颗真骰的位置**（期间真骰先隐身、到位再露）；
 * - 未落区（不发动）→ 淡出消失。返回时长。
 */
export function releaseHeldAttackDie(root: HTMLElement): number {
  if (!heldAttackDie) return 0;
  const { el, dieId, ox, oy } = heldAttackDie;
  heldAttackDie = null;
  if (!canAnimate(root)) {
    el.remove();
    return 0;
  }
  const realEl = root.querySelector<HTMLElement>(`.die[data-id="${dieId}"]`);
  if (!realEl) {
    const d = ms(MOTION.fade);
    fadeEl(el, d);
    return d;
  }
  const oldVal = Number(el.textContent);
  const newVal = Number(realEl.dataset.value);
  const rr = realEl.getBoundingClientRect();
  // **绝对平移**（相对临时骰的未平移中心 ox/oy）——不能用"当前位置→真骰"的差值（会飞偏）。
  const { dx, dy } = heldReleaseOffset(rr.left + rr.width / 2, rr.top + rr.height / 2, ox, oy);
  const needRoll = Number.isFinite(newVal) && Number.isFinite(oldVal) && newVal !== oldVal;
  const rollDur = needRoll ? ms(MOTION.hold) : 0;
  const flyDur = ms(MOTION.move) + ms(MOTION.settle);
  realEl.style.opacity = '0'; // 真骰先隐身，临时骰飞到位再露
  let timer: number | null = null;
  if (needRoll) {
    timer = window.setInterval(() => {
      el.textContent = String(1 + Math.floor(Math.random() * 6));
    }, 60);
  }
  window.setTimeout(() => {
    if (timer != null) window.clearInterval(timer);
    el.textContent = String(newVal);
    el.style.transition = `transform ${flyDur}ms ${EASE.move}`;
    el.style.transform = `translate(${dx}px, ${dy}px)`;
  }, rollDur);
  window.setTimeout(() => {
    el.remove();
    realEl.style.opacity = '';
  }, rollDur + flyDur + 40);
  return rollDur + flyDur;
}

/** 响应解决：不抵挡 → 攻击骰淡出；抵挡 → 防御骰（真骰/置换灰 5）到中间**并排** → 一起淡出。 */
export function attackResolve(root: HTMLElement, opts: AttackResolveOpts): number {
  if (!attackPool) return 0;
  const layer = ensureFxLayer();
  const poolDice = attackPool.dice;
  const el = attackPool.dice[0].el;
  const aox = attackPool.dice[0].ox;
  const aoy = attackPool.dice[0].oy;
  attackPool = null;
  if (!layer || !canAnimate(root)) {
    el.remove();
    return 0;
  }
  const p = poolPoint(root);
  const xs = sideBySideXs(p.x, 2, DIE_W); // [左, 右]
  const moveDur = ms(MOTION.move);
  const popDur = ms(MOTION.micro);
  const fadeDur = ms(MOTION.fade);

  if (opts.substitution) {
    // 攻击骰 → 左位
    el.style.transition = `transform ${moveDur}ms ${EASE.move}`;
    raf(() => {
      el.style.transform = `translate(${xs[0] - aox}px, ${p.y - aoy}px)`;
    });
    // 2 颗源骰 → 汇聚到右位 → 合并成灰「5」
    const ghosts = opts.substitution.rects.map((r, i) => {
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const g = makeDieEl(opts.defender, opts.substitution!.values[i] ?? 0);
      g.style.left = `${cx - 13}px`;
      g.style.top = `${cy - 13}px`;
      g.style.transition = `transform ${moveDur}ms ${EASE.move}`;
      layer.appendChild(g);
      raf(() => {
        g.style.transform = `translate(${xs[1] - cx}px, ${p.y - cy}px)`;
      });
      return g;
    });
    let grey: HTMLElement | null = null;
    window.setTimeout(() => {
      for (const g of ghosts) g.remove();
      const d5 = makeGhostEl(opts.defender, 5);
      d5.style.left = `${xs[1] - 13}px`;
      d5.style.top = `${p.y - 13}px`;
      d5.style.transform = 'scale(.5)';
      d5.style.transition = `transform ${popDur}ms ${EASE.pop}`;
      layer.appendChild(d5);
      grey = d5;
      raf(() => {
        d5.style.transform = 'scale(1)';
      });
    }, moveDur);
    window.setTimeout(() => {
      fadeEl(el, fadeDur);
      if (grey) fadeEl(grey, fadeDur);
    }, moveDur + popDur);
    return moveDur + popDur + fadeDur;
  }

  if (opts.blockDie) {
    el.style.transition = `transform ${moveDur}ms ${EASE.move}`;
    raf(() => {
      el.style.transform = `translate(${xs[0] - aox}px, ${p.y - aoy}px)`;
    });
    const bx = opts.blockDie.rect.left + opts.blockDie.rect.width / 2;
    const by = opts.blockDie.rect.top + opts.blockDie.rect.height / 2;
    const bdie = makeFlyingDie(flyingDieKind({ held: opts.blockDie.grey }), opts.defender, opts.blockDie.value);
    bdie.style.left = `${bx - 13}px`;
    bdie.style.top = `${by - 13}px`;
    layer.appendChild(bdie);
    bdie.style.transition = `transform ${moveDur}ms ${EASE.move}`;
    raf(() => {
      bdie.style.transform = `translate(${xs[1] - bx}px, ${p.y - by}px)`;
    });
    window.setTimeout(() => {
      fadeEl(el, fadeDur);
      fadeEl(bdie, fadeDur);
    }, moveDur);
    return moveDur + fadeDur;
  }

  // 001/C01 裁雨流：攻击骰先**停在中间、不淡出**（等玩家决定是否移回区域）
  if (opts.hold) {
    heldAttackDie = { el, dieId: opts.hold.dieId, ox: aox, oy: aoy };
    return ms(MOTION.hold);
  }

  // 不抵挡（或池中已有并排骰未处理）：池里所有骰一起淡出
  const d = ms(MOTION.hold) + ms(MOTION.fade);
  for (const pd of poolDice) fadeEl(pd.el, d);
  return d;
}

export interface AttackJoinOpts {
  /** 新骰的旧位置（起点：区域骰 / 卡头存放骰） */
  rect: Rect;
  value: number;
  /** 灰色骰（来自卡头存放骰 / 034） */
  grey?: boolean;
  player: PlayerId;
  /** `spend`＝只它消失（011）；`park`＝并排停住（034 防御骰等 034）；`fadeAll`＝与池中骰一起消失（034 取消）。 */
  then: 'spend' | 'park' | 'fadeAll';
}

/** 攻击池"另一方补一颗骰"：已有骰重排到左各格、新骰飞到末格（**并排、不遮挡**）→ 停 → 按 `then` 处理。 */
export function attackJoin(root: HTMLElement, opts: AttackJoinOpts): number {
  if (!attackPool || !canAnimate(root)) return 0;
  const layer = ensureFxLayer();
  if (!layer) return 0;
  const pool = poolPoint(root);
  const N = attackPool.dice.length;
  const slots = N + 1;
  const xs = sideBySideXs(pool.x, slots, DIE_W);
  const moveDur = ms(MOTION.move);
  const holdDur = ms(MOTION.hold);
  const fadeDur = ms(MOTION.fade);
  // 已有骰重排到左侧各格
  attackPool.dice.forEach((d, i) => {
    d.el.style.transition = `transform ${moveDur}ms ${EASE.move}`;
    raf(() => {
      d.el.style.transform = `translate(${xs[i] - d.ox}px, ${pool.y - d.oy}px)`;
    });
  });
  // 新骰飞到末格
  const cx = opts.rect.left + opts.rect.width / 2;
  const cy = opts.rect.top + opts.rect.height / 2;
  const nd = opts.grey ? makeGhostEl(opts.player, opts.value) : makeDieEl(opts.player, opts.value);
  nd.style.left = `${cx - 13}px`;
  nd.style.top = `${cy - 13}px`;
  nd.style.transition = `transform ${moveDur}ms ${EASE.move}`;
  layer.appendChild(nd);
  raf(() => {
    nd.style.transform = `translate(${xs[N] - cx}px, ${pool.y - cy}px)`;
  });
  attackPool.slots = slots;
  if (opts.then === 'park') {
    // 新骰并入池、并排停住（等 034 决定）
    attackPool.dice.push({ el: nd, ox: cx, oy: cy });
    return moveDur;
  }
  if (opts.then === 'spend') {
    // 只新骰消失；攻击骰"留位"（保持并排格数，供之后的防御骰进来）
    window.setTimeout(() => {
      fadeEl(nd, fadeDur);
      if (attackPool) attackPool.slots = Math.max(attackPool.slots, 2);
    }, moveDur + holdDur);
    return moveDur + holdDur + fadeDur;
  }
  // fadeAll：新骰并入后全部一起消失
  attackPool.dice.push({ el: nd, ox: cx, oy: cy });
  const all = attackPool.dice;
  window.setTimeout(() => {
    for (const d of all) fadeEl(d.el, fadeDur);
    if (attackPool) attackPool = null;
  }, moveDur + holdDur);
  return moveDur + holdDur + fadeDur;
}

// ── 023 蛇蝎·畏惧 · 「响应池」（常驻、跨重绘；照攻击池 attackPool）─────────────────
// 发起方骰 → 中间左位停住等对方；被要求方骰 → 中间右位并排 → 顿 → 两颗一起淡出（+ 比大小飘字）。

export interface WeijuStartInfo {
  /** 发起方（023 持有者） */
  player: PlayerId;
  /** 发起方骰的有效点数（比大小用） */
  value: number;
  /** 发起方被消耗骰子的旧位置（1 颗；用 010 置换＝2 颗源骰） */
  sourceRects: Rect[];
  /** 上述每颗骰的点数（置换＝各源骰点数） */
  values: number[];
}

interface WeijuPool {
  el: HTMLElement;
  ox: number;
  oy: number;
  parked: boolean;
  /** 发起方点数（供结果飘字） */
  value: number;
}

let weijuPool: WeijuPool | null = null;

/** 发起方骰 → 中间左位 → 停住，等对方响应。返回时长。 */
export function weijuStart(root: HTMLElement, info: WeijuStartInfo): number {
  if (!canAnimate(root)) return 0;
  const layer = ensureFxLayer();
  if (!layer) return 0;
  if (weijuPool) {
    weijuPool.el.remove();
    weijuPool = null;
  }
  const pool = poolPoint(root);
  const moveDur = ms(MOTION.move);
  const holdDur = ms(MOTION.hold);
  const popDur = ms(MOTION.micro);

  // 单颗（无置换）：发起方骰残影从旧位移到中间停住
  if (info.sourceRects.length < 2) {
    const r = info.sourceRects[0];
    let ox = pool.x;
    let oy = pool.y;
    if (r) {
      ox = r.left + r.width / 2;
      oy = r.top + r.height / 2;
    }
    const die = makeDieEl(info.player, info.value);
    die.style.left = `${ox - 13}px`;
    die.style.top = `${oy - 13}px`;
    die.style.transition = `transform ${moveDur}ms ${EASE.move}`;
    layer.appendChild(die);
    weijuPool = { el: die, ox, oy, parked: false, value: info.value };
    raf(() => {
      die.style.transform = `translate(${pool.x - ox}px, ${pool.y - oy}px)`;
    });
    window.setTimeout(() => {
      if (weijuPool && weijuPool.el === die) weijuPool.parked = true;
    }, moveDur);
    return moveDur;
  }

  // 置换（2 颗）：源骰并排 → 中间 → 合并成灰「5」停住
  const xs = sideBySideXs(pool.x, info.sourceRects.length, DIE_W);
  info.sourceRects.forEach((rc, i) => {
    const cx = rc.left + rc.width / 2;
    const cy = rc.top + rc.height / 2;
    const g = makeDieEl(info.player, info.values[i] ?? 0);
    g.style.left = `${cx - 13}px`;
    g.style.top = `${cy - 13}px`;
    g.style.transition = `transform ${moveDur}ms ${EASE.move}`;
    layer.appendChild(g);
    raf(() => {
      g.style.transform = `translate(${xs[0] - cx}px, ${pool.y - cy}px)`;
    });
    window.setTimeout(() => g.remove(), moveDur + holdDur + 40);
  });
  const grey = makeGhostEl(info.player, info.value || 5);
  grey.style.left = `${pool.x - 13}px`;
  grey.style.top = `${pool.y - 13}px`;
  grey.style.opacity = '0';
  grey.style.transform = 'scale(.5)';
  layer.appendChild(grey);
  weijuPool = { el: grey, ox: pool.x, oy: pool.y, parked: false, value: info.value };
  const tMerge = moveDur + holdDur;
  window.setTimeout(() => {
    grey.style.transition = `opacity ${popDur}ms linear, transform ${popDur}ms ${EASE.pop}`;
    grey.style.opacity = '1';
    grey.style.transform = 'scale(1)';
  }, tMerge);
  window.setTimeout(() => {
    if (weijuPool && weijuPool.el === grey) weijuPool.parked = true;
  }, tMerge + popDur);
  return tMerge + popDur;
}

/** 等待期间每次重绘：把停在中间的发起方骰对齐当前中间。 */
export function weijuHold(root: HTMLElement): void {
  if (!weijuPool || !weijuPool.parked || !canAnimate(root)) return;
  const p = poolPoint(root);
  weijuPool.el.style.transition = 'none';
  weijuPool.el.style.transform = `translate(${p.x - weijuPool.ox}px, ${p.y - weijuPool.oy}px)`;
}

export interface WeijuResolveOpts {
  /** 被要求方 */
  player: PlayerId;
  /** 被要求方骰的有效点数 */
  value: number;
  /** 被要求方被消耗骰子的旧位置（1 颗；置换＝2 颗源骰） */
  sourceRects: Rect[];
  values: number[];
}

/** 被要求方骰 → 中间右位（与发起方并排）→ 顿 → 两颗一起淡出。返回时长。 */
export function weijuResolve(root: HTMLElement, opts: WeijuResolveOpts): number {
  if (!weijuPool) return 0;
  const layer = ensureFxLayer();
  const el = weijuPool.el;
  const aox = weijuPool.ox;
  const aoy = weijuPool.oy;
  const initiatorValue = weijuPool.value;
  weijuPool = null;
  if (!layer || !canAnimate(root)) {
    el.remove();
    return 0;
  }
  const p = poolPoint(root);
  const xs = sideBySideXs(p.x, 2, DIE_W); // [左, 右]
  const moveDur = ms(MOTION.move);
  const holdDur = ms(MOTION.hold);
  const popDur = ms(MOTION.micro);
  const fadeDur = ms(MOTION.fade);
  const isSub = opts.sourceRects.length >= 2;

  // 发起方骰 → 左位
  el.style.transition = `transform ${moveDur}ms ${EASE.move}`;
  raf(() => {
    el.style.transform = `translate(${xs[0] - aox}px, ${p.y - aoy}px)`;
  });

  // 被要求方骰 → 右位
  const right: HTMLElement[] = [];
  if (!isSub) {
    const r = opts.sourceRects[0];
    let bx = p.x;
    let by = p.y;
    if (r) {
      bx = r.left + r.width / 2;
      by = r.top + r.height / 2;
    }
    const die = makeDieEl(opts.player, opts.value);
    die.style.left = `${bx - 13}px`;
    die.style.top = `${by - 13}px`;
    die.style.transition = `transform ${moveDur}ms ${EASE.move}`;
    layer.appendChild(die);
    right.push(die);
    raf(() => {
      die.style.transform = `translate(${xs[1] - bx}px, ${p.y - by}px)`;
    });
  } else {
    for (let i = 0; i < opts.sourceRects.length; i++) {
      const rc = opts.sourceRects[i];
      const cx = rc.left + rc.width / 2;
      const cy = rc.top + rc.height / 2;
      const g = makeDieEl(opts.player, opts.values[i] ?? 0);
      g.style.left = `${cx - 13}px`;
      g.style.top = `${cy - 13}px`;
      g.style.transition = `transform ${moveDur}ms ${EASE.move}`;
      layer.appendChild(g);
      right.push(g);
      raf(() => {
        g.style.transform = `translate(${xs[1] - cx}px, ${p.y - cy}px)`;
      });
    }
  }

  const tHold = moveDur + (isSub ? popDur : 0);
  window.setTimeout(() => {
    let rightEls = right;
    if (isSub) {
      for (const g of right) g.remove();
      const d5 = makeGhostEl(opts.player, opts.value || 5);
      d5.style.left = `${xs[1] - 13}px`;
      d5.style.top = `${p.y - 13}px`;
      d5.style.transform = 'scale(.5)';
      d5.style.transition = `transform ${popDur}ms ${EASE.pop}`;
      layer.appendChild(d5);
      rightEls = [d5];
      raf(() => {
        d5.style.transform = 'scale(1)';
      });
    }
    // 比大小飘字（并排展示，随骰子一起淡出）
    const t = document.createElement('div');
    t.className = 'fx-text fx-text--vs';
    t.textContent = `畏惧 · ${initiatorValue} 对 ${opts.value}`;
    t.style.left = `${p.x}px`;
    t.style.top = `${p.y - 26}px`;
    layer.appendChild(t);
    if (typeof t.animate === 'function') {
      t.animate(
        [
          { transform: 'translate(-50%, 0) scale(.7)', opacity: 0, offset: 0 },
          { transform: 'translate(-50%, 0) scale(1)', opacity: 1, offset: 0.25 },
          { transform: 'translate(-50%, -14px) scale(1)', opacity: 0, offset: 1 },
        ],
        { duration: holdDur + fadeDur, easing: 'ease-out', fill: 'forwards' },
      );
    } else {
      t.style.transform = 'translate(-50%, 0)';
    }
    window.setTimeout(() => t.remove(), holdDur + fadeDur + 80);

    window.setTimeout(() => {
      fadeEl(el, fadeDur);
      for (const r of rightEls) fadeEl(r, fadeDur);
    }, holdDur);
  }, tHold);

  return tHold + holdDur + fadeDur;
}

/** 需要在"切换视角后"补播的"获得"骰 id（跨一次重绘传递）。 */
let pendingAddIds: string[] | null = null;

/** "消耗/弃置"一组的完整时长（供"整组播完才下一组"计时）。 */
export function removalGroupMs(): number {
  return ms(MOTION.move) + ms(MOTION.hold) + ms(MOTION.fade);
}

/** 通用「获得骰」动画时长（中间并排冒出 → 飞入区域）；供界面估算"要推迟到什么时候"。 */
export function addsDuration(): number {
  return ms(MOTION.micro) + ms(MOTION.hold) + ms(MOTION.move) + ms(MOTION.settle);
}

export interface PayDie {
  id: string;
  rect: Rect;
  value: number;
  /** 该骰来自卡头存放骰（灰）→ 飞行动效保持灰色（不染玩家色） */
  held?: boolean;
}

export interface PayInfo {
  player: PlayerId;
  /** 本次支付**全部被消耗**的骰子（真实骰 + 置换源骰） */
  dice: PayDie[];
  /** 置换配对（每组 2 个 id → 合并成 1 颗灰「5」） */
  groups: string[][];
}

/**
 * 一次"支付"的**整体动画**（非攻击/非抵挡）：**全部被消耗的骰子并排飞向中间 → 停顿
 * → 每组置换收拢合并成灰「5」→ 全部有效骰（真实骰 + 灰 5）一起淡出**。
 * 多笔支付在中间横向错开。返回整组时长（供"代价先于效果"计时）。
 */
export function playPayments(root: HTMLElement, list: PayInfo[]): number {
  if (list.length === 0 || !canAnimate(root)) return 0;
  const layer = ensureFxLayer();
  if (!layer) return 0;
  const moveDur = ms(MOTION.move);
  const holdDur = ms(MOTION.hold);
  const popDur = ms(MOTION.micro);
  const fadeDur = ms(MOTION.fade);
  const pool = poolPoint(root);
  const tConverge = moveDur + holdDur; // 并排到中间 + 停顿
  const tMerge = tConverge + popDur; // 收拢合并
  const tFade = tMerge + popDur; // 开始淡出
  const end = tFade + fadeDur;

  list.forEach((pay, payIdx) => {
    const byId = new Map(pay.dice.map((d) => [d.id, d]));
    const groupOf = (id: string): string[] | null => pay.groups.find((g) => g.includes(id)) ?? null;
    // 队：置换组（2 位） / 真实骰（1 位）
    const units: { ids: string[]; group: boolean; xs: number[] }[] = [];
    const seen = new Set<string>();
    const raw: { ids: string[]; group: boolean }[] = [];
    for (const d of pay.dice) {
      if (seen.has(d.id)) continue;
      const g = groupOf(d.id);
      const ids = g ?? [d.id];
      raw.push({ ids, group: !!g });
      for (const id of ids) seen.add(id);
    }
    const total = pay.dice.length;
    const centerX =
      pool.x +
      (list.length > 1
        ? (payIdx - (list.length - 1) / 2) * (Math.max(total, 2) * (DIE_W + DIE_GAP) + 40)
        : 0);
    const slotXs = sideBySideXs(centerX, total, DIE_W);
    let slot = 0;
    for (const u of raw) {
      const xs: number[] = [];
      for (let i = 0; i < u.ids.length; i++) {
        xs.push(slotXs[slot] ?? centerX);
        slot += 1;
      }
      units.push({ ...u, xs });
    }

    const dieEls = new Map<string, HTMLElement>();
    // ① 全部源骰并排飞向中间
    for (const { ids, xs } of units) {
      ids.forEach((id, i) => {
        const d = byId.get(id);
        if (!d) return;
        const cx = d.rect.left + d.rect.width / 2;
        const cy = d.rect.top + d.rect.height / 2;
        const g = makeFlyingDie(flyingDieKind({ held: d.held }), pay.player, d.value);
        g.style.left = `${cx - 13}px`;
        g.style.top = `${cy - 13}px`;
        g.style.transition = `transform ${moveDur}ms ${EASE.move}`;
        layer.appendChild(g);
        dieEls.set(id, g);
        raf(() => {
          g.style.transform = `translate(${xs[i] - cx}px, ${pool.y - cy}px)`;
        });
      });
    }
    // ② 收拢：每组的 2 颗向中点靠拢
    window.setTimeout(() => {
      for (const { ids, group, xs } of units) {
        if (!group) continue;
        const midX = (xs[0] + xs[xs.length - 1]) / 2;
        for (const id of ids) {
          const g = dieEls.get(id);
          const d = byId.get(id);
          if (!g || !d) continue;
          const cx = d.rect.left + d.rect.width / 2;
          const cy = d.rect.top + d.rect.height / 2;
          g.style.transition = `transform ${popDur}ms ${EASE.move}`;
          g.style.transform = `translate(${midX - cx}px, ${pool.y - cy}px)`;
        }
      }
    }, tConverge);
    // ③ 合并：隐藏组内源骰、中点生灰「5」；真实骰保留
    window.setTimeout(() => {
      for (const { ids, group, xs } of units) {
        if (!group) continue;
        for (const id of ids) dieEls.get(id)?.remove();
        const midX = (xs[0] + xs[xs.length - 1]) / 2;
        const d5 = makeGhostEl(pay.player, 5);
        d5.style.left = `${midX - 13}px`;
        d5.style.top = `${pool.y - 13}px`;
        d5.style.transform = 'scale(.5)';
        d5.style.transition = `transform ${popDur}ms ${EASE.pop}`;
        layer.appendChild(d5);
        raf(() => {
          d5.style.transform = 'scale(1)';
        });
        dieEls.set(ids[0], d5);
      }
    }, tMerge);
    // ④ 全部有效骰（真实骰 + 灰 5）一起淡出
    window.setTimeout(() => {
      for (const { ids } of units) {
        const el = dieEls.get(ids[0]);
        if (el) fadeEl(el, fadeDur);
      }
    }, tFade);
  });
  return end;
}

/**
 * 主入口（`renderGame` 收尾、`applyZoom` 之后调用）。
 * @param flipped 本帧相对上一帧切换了视角（左右互搏换手）。
 * @param deferAddOwner 本帧要换视角时＝**新视角那一方**：**它的获得延后到切换后再播**；
 *   其余（旧视角那方，如"你这回合技能给的骰"）的获得**在切换前随阶段③播完**。`null`＝本帧不换视角 → 所有获得照旧随阶段③播。
 * @returns 本次动效最长时长（ms），供"两阶段：播完再切"计时。
 */
export function runBoardMotions(
  root: HTMLElement,
  prev: PrevDice,
  lifeDeltas: LifeDelta[],
  flipped = false,
  deferAddOwner: PlayerId | null = null,
  excludeIds: string[] = [],
  prevStored: StoredDice = new Map(),
  rerollIds: Set<string> = new Set(),
  diceFx: DiceMoveFx = { moveIds: [], fromCard: [], hanguangs: [] },
  /** 「获得」之前必须播完的额外时长（如支付整体 playPayments 的时长）→ 保证"代价先于获得" */
  beforeAddsMs = 0,
  /** L04 重开：本帧走"全部旧骰→中间合成一个→新骰冒出"的专用动画（覆盖通用 L→M→G） */
  resetMerge = false,
): number {
  if (!canAnimate(root)) return 0;
  const layer0 = ensureFxLayer();
  if (!layer0) return 0;
  const pool0 = poolPoint(root);

  const movedIds = new Set(diceFx.moveIds);
  const hanguangIds = new Set<string>();
  for (const h of diceFx.hanguangs) {
    hanguangIds.add(h.heldId);
    if (h.opponentId) hanguangIds.add(h.opponentId);
  }
  const exAll = new Set<string>([...excludeIds, ...movedIds, ...hanguangIds]);

  // 0) 上次"持有视角"时把"获得"延后了 → 现在（已切换）补播
  if (pendingAddIds) {
    const ids = pendingAddIds;
    pendingAddIds = null;
    return playAdds(root, ids, pool0);
  }

  const curIds = new Set<string>();
  root.querySelectorAll<HTMLElement>('.die[data-id]').forEach((el) => {
    const id = el.dataset.id;
    if (id) curIds.add(id);
  });
  let setChanged = curIds.size !== prev.size;
  if (!setChanged) {
    for (const id of curIds) {
      if (!prev.has(id)) {
        setChanged = true;
        break;
      }
    }
  }
  // 点数/所属区/玩家的变化（id 不变）：重掷、威压改点、全知落区、区域互换等
  let visualChanged = false;
  if (!setChanged) {
    root.querySelectorAll<HTMLElement>('.die[data-id]').forEach((el) => {
      if (visualChanged) return;
      const id = el.dataset.id;
      if (!id) return;
      const p = prev.get(id);
      if (!p) return;
      const val = Number(el.dataset.value);
      const owner: PlayerId | null = el.classList.contains('die-A')
        ? 'A'
        : el.classList.contains('die-B')
          ? 'B'
          : null;
      const kind = (el.closest('.area') as HTMLElement | null)?.dataset.kind ?? null;
      if ((Number.isFinite(p.value) && p.value !== val) || p.owner !== owner || p.kind !== kind) {
        visualChanged = true;
      }
    });
  }
  let storedChanged = false;
  {
    const cur = new Set<string>();
    root
      .querySelectorAll<HTMLElement>('.card-held--head .pay-die--held[data-id], .tactic-held-die[data-id]')
      .forEach((el) => {
        const id = el.dataset.id;
        if (id) cur.add(id);
      });
    if (cur.size !== prevStored.size) storedChanged = true;
    else for (const id of cur) if (!prevStored.has(id)) { storedChanged = true; break; }
  }
  if (
    !setChanged &&
    !visualChanged &&
    lifeDeltas.length === 0 &&
    !storedChanged &&
    rerollIds.size === 0 &&
    diceFx.moveIds.length === 0 &&
    diceFx.hanguangs.length === 0
  )
    return 0;

  const addedIds = [...curIds].filter((id) => !prev.has(id) && !exAll.has(id));
  const addDur = addedIds.length ? addsDuration() : 0;

  // L04 重开：整盘重置 → 专用"合成再分回"动画（不走通用 L→M→G）
  if (resetMerge) return playResetMerge(root, layer0, pool0, prev, prevStored, exAll, addedIds, addDur);

  // 阶段①：离开（旧坐标）。按「代价 → 效果」排序：
  //   ① 消耗/弃置（消失）→ ② 生命变化（如真伤 -N）→ ③ 改点/重掷（翻面）。
  // 只有"本帧真的会播消失动画"（未切视角 + 有被移除的骰）才给后两者垫延时；否则一切照旧
  // （普通攻击的支付骰在 excludeIds 里、重掷阶段无移除 → 顺序不变）。
  const removedCount = [...prev.keys()].filter((id) => !curIds.has(id) && !exAll.has(id)).length;
  const removalDur = !flipped && removedCount > 0 ? removalGroupMs() : 0;
  const lifeSpan = playLifeFloats(root, layer0, lifeDeltas, removalDur); // 生命排在"消失"之后
  let dur = Math.max(removalDur, lifeSpan);
  // 「翻面（重掷/改点）」接在"消失 + 生命"之后；**只有本帧真有移除（代价）时才延后**，
  // 无代价时保持原行为（翻面与生命同播），避免影响其它卡。
  const flipsDelay = removalDur > 0 ? Math.max(removalDur, lifeSpan) : 0;
  if (!flipped) dur = Math.max(dur, playRemovalsAndFlip(root, layer0, prev, curIds, pool0, [...exAll], rerollIds, flipsDelay));
  dur = Math.max(dur, beforeAddsMs);
  const leaveDur = dur;

  // 阶段②：搬家（区域移动 / 027 寒光）——排在「离开」之后
  const moveDur = Math.max(
    playMoves(root, diceFx.moveIds, new Set(diceFx.fromCard), prev, prevStored, pool0, leaveDur),
    playHanguang(layer0, root, diceFx.hanguangs, prev, prevStored, pool0, leaveDur),
  );
  dur = leaveDur + moveDur;

  // 阶段③：获得——排在「离开 + 搬家」之后。**按归属拆分**：
  //   · **新视角那一方**（`deferAddOwner`，如"下家的回合开始补充"）→ 延后到切换后播；
  //   · **其余**（旧视角那方，如"你这回合技能给的骰"）→ **切换前随阶段③播完**。
  if (addedIds.length) {
    const ownerOf = (id: string): PlayerId | null => {
      const el = root.querySelector<HTMLElement>(`.die[data-id="${id}"]`);
      if (!el) return null;
      return el.classList.contains('die-A') ? 'A' : el.classList.contains('die-B') ? 'B' : null;
    };
    const nowIds = deferAddOwner ? addedIds.filter((id) => ownerOf(id) !== deferAddOwner) : addedIds;
    const deferIds = deferAddOwner ? addedIds.filter((id) => ownerOf(id) === deferAddOwner) : [];
    if (nowIds.length) {
      const delay = dur;
      // 同步调用（延时交给 WAAPI `delay` + `fill:'backwards'`）→ 延时期间保持隐藏，不再"一起播"
      playAdds(root, nowIds, poolPoint(root), delay);
      dur = delay + addDur;
    }
    if (deferIds.length) {
      pendingAddIds = deferIds;
      // 切视角前先把"要延后的"新骰藏起来：否则阶段①（旧视角）播放期间会提前显示
      for (const id of deferIds) {
        const el = root.querySelector<HTMLElement>(`.die[data-id="${id}"]`);
        if (el) el.style.visibility = 'hidden';
      }
    }
  }

  // 存放骰：中间 ↔ 卡头/战术栏（与上并行；不参与 L→M→G 排序）
  dur = Math.max(dur, playStored(root, layer0, pool0, prevStored, exAll));
  return dur;
}

/** 阶段①：存活骰"让位"（FLIP）+ 消失骰"飞向中间淡出"。返回时长。 */
function playRemovalsAndFlip(
  root: HTMLElement,
  layer: HTMLElement,
  prev: PrevDice,
  curIds: Set<string>,
  pool: { x: number; y: number },
  excludeIds: string[],
  rerollIds: Set<string>,
  /** 「翻面（重掷/改点）」延后多少毫秒再播（排在"消失/生命"之后 → 代价先于效果）。 */
  flipsDelayMs = 0,
): number {
  const reduce = prefersReducedMotion();
  const dist = moveScale();
  const cx = pool.x;
  const cy = pool.y;
  const moveDur = ms(MOTION.move);
  const settleDur = ms(MOTION.settle);
  const holdDur = ms(MOTION.hold);
  const ex = new Set(excludeIds);
  let maxDur = 0;
  // 本帧要"翻面"的骰（重掷 / 改点）：先收集，随后**并排**在中间翻滚（避免多颗叠在同一点）
  const flipItems: { el: HTMLElement; oldVal: number; newVal: number; center: { x: number; y: number } }[] = [];

  root.querySelectorAll<HTMLElement>('.die[data-id]').forEach((el) => {
    const id = el.dataset.id;
    if (!id) return;
    const p = prev.get(id);
    if (!p || ex.has(id)) return; // 新增在阶段②处理；被攻击池/支付接管的跳过
    if (reduce) return; // 减弱动效：不做移动/翻滚
    const nr = el.getBoundingClientRect();
    const n = rectCenter({ left: nr.left, top: nr.top, width: nr.width, height: nr.height });
    const curOwner: PlayerId | null = el.classList.contains('die-A')
      ? 'A'
      : el.classList.contains('die-B')
        ? 'B'
        : null;
    const curKind = (el.closest('.area') as HTMLElement | null)?.dataset.kind ?? null;
    const newVal = Number(el.dataset.value);
    if (rerollIds.has(id)) {
      // 本次被重掷（**无论点数是否变化**）→ 移中间翻滚再飞回
      flipItems.push({ el, oldVal: Number.isFinite(p.value) ? p.value : newVal, newVal, center: n });
      return;
    }
    if (p.owner !== curOwner || p.kind !== curKind) {
      // 区域互换 / 移动：旧位 → 中间 → 停 → 分体飞新位（**值也变了就在中间翻面**）
      maxDur = Math.max(
        maxDur,
        playAreaMove(
          el,
          p.rect,
          n,
          pool,
          moveDur,
          holdDur,
          Number.isFinite(p.value) ? p.value : undefined,
          Number.isFinite(newVal) ? newVal : undefined,
        ),
      );
      return;
    }
    if (Number.isFinite(p.value) && p.value !== newVal) {
      // 骰面翻转（改点 / 重投）：旧值 → 中间翻滚 → 新值 → 飞回
      flipItems.push({ el, oldVal: p.value, newVal, center: n });
      return;
    }
    // 普通让位 FLIP
    const pc = rectCenter(p.rect);
    const dx = (pc.x - n.x) * dist;
    const dy = (pc.y - n.y) * dist;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    const d = moveDur + settleDur;
    maxDur = Math.max(maxDur, d);
    if (typeof el.animate === 'function') {
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, offset: 0 },
          { transform: `translate(${-dx * 0.05}px, ${-dy * 0.05}px)`, offset: 0.85 },
          { transform: 'translate(0, 0)', offset: 1 },
        ],
        { duration: d, easing: EASE.move },
      );
    } else {
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      raf(() => {
        el.style.transition = `transform ${d}ms ${EASE.move}`;
        el.style.transform = '';
      });
      window.setTimeout(() => {
        el.style.transition = '';
      }, d + 60);
    }
  });

  if (reduce) return maxDur;

  // 多颗翻面 → 到中间**并排**（复用"多颗消耗/获得"的 sideBySideXs）；单颗时退化为正中
  if (flipItems.length > 0) {
    const wmax = Math.max(...flipItems.map((it) => it.el.getBoundingClientRect().width || DIE_W));
    const xs = sideBySideXs(cx, flipItems.length, wmax);
    flipItems.forEach((it, i) => {
      maxDur = Math.max(
        maxDur,
        playValueFlip(it.el, it.oldVal, it.newVal, it.center, { x: xs[i], y: cy }, moveDur, holdDur, flipsDelayMs),
      );
    });
  }

  const ghostDur = ms(MOTION.move) + ms(MOTION.hold) + ms(MOTION.fade);
  const removed = [...prev.entries()].filter(([id]) => !curIds.has(id) && !ex.has(id));
  if (removed.length === 0) return maxDur;
  // 按原左右位置排序 → 到中间**并排**（不再叠成一颗）
  removed.sort((a, b) => a[1].rect.left - b[1].rect.left || a[1].rect.top - b[1].rect.top);
  const wmax = Math.max(...removed.map(([, p]) => p.rect.width || DIE_W));
  const xs = sideBySideXs(cx, removed.length, wmax);
  removed.forEach(([, p], i) => {
    maxDur = Math.max(maxDur, ghostDur);
    spawnGhost(layer, p, xs[i], cy, dist);
  });
  return maxDur;
}

/** 区域互换/移动：旧位 → 中间 → 停 → 分体飞新位（骰子元素当前在新位）。返回时长。
 *  `oldVal`/`newVal` 给出且不同 → 到中间**翻面**（＝"已有骰变点 + 换区"，如 005 影袭：去中间不消失、变值、回新区域）。 */
function playAreaMove(
  el: HTMLElement,
  fromRect: Rect,
  center: { x: number; y: number },
  pool: { x: number; y: number },
  moveDur: number,
  holdDur: number,
  oldVal?: number,
  newVal?: number,
  delayMs = 0,
): number {
  const dist = moveScale();
  const fc = rectCenter(fromRect);
  const total = moveDur + holdDur + moveDur;
  const flip = oldVal != null && newVal != null && oldVal !== newVal && !prefersReducedMotion();
  const d0 = Math.max(0, delayMs);
  const g = ghostifyDie(el); // 影子在 fx 层 → 压过快速操作栏 / 必杀横幅
  const t = g.el;
  let timer: number | null = null;
  const start = (): void => {
    if (flip) t.textContent = String(oldVal);
    t.style.transition = 'none';
    t.style.transform = `translate(${(fc.x - center.x) * dist}px, ${(fc.y - center.y) * dist}px)`;
    raf(() => {
      t.style.transition = `transform ${moveDur}ms ${EASE.move}`;
      t.style.transform = `translate(${(pool.x - center.x) * dist}px, ${(pool.y - center.y) * dist}px)`;
    });
    if (flip) {
      window.setTimeout(() => {
        timer = window.setInterval(() => {
          t.textContent = String(1 + Math.floor(Math.random() * 6));
        }, 60);
      }, moveDur);
    }
    window.setTimeout(() => {
      if (timer != null) window.clearInterval(timer);
      if (flip) t.textContent = String(newVal);
      t.style.transition = `transform ${moveDur}ms ${EASE.enter}`;
      t.style.transform = '';
    }, moveDur + holdDur);
    window.setTimeout(() => {
      if (timer != null) window.clearInterval(timer);
      if (flip) t.textContent = String(newVal);
      t.style.transition = '';
      t.style.transform = '';
    }, total + 60);
  };
  if (d0 > 0) window.setTimeout(start, d0);
  else start();
  window.setTimeout(() => g.reveal(), d0 + total + 90); // 收尾揭出真骰
  return d0 + total;
}

/** 骰面翻转（改点/重投）：旧值 → 中间翻滚 → 新值 → 飞回。返回时长。 */
function playValueFlip(
  el: HTMLElement,
  oldVal: number,
  newVal: number,
  center: { x: number; y: number },
  pool: { x: number; y: number },
  moveDur: number,
  holdDur: number,
  delayMs = 0,
): number {
  // `delayMs`：让"翻面（重掷/改点）"**排在它前面的动画之后**（如"消耗/真伤先播完"）；延时期间影子留原位显示旧值。
  const d0 = Math.max(0, delayMs);
  const dist = moveScale();
  const dx = (pool.x - center.x) * dist;
  const dy = (pool.y - center.y) * dist;
  const flipDur = moveDur + holdDur + moveDur;
  const g = ghostifyDie(el); // 影子在 fx 层 → 压过快速操作栏 / 必杀横幅
  const t = g.el;
  t.textContent = String(oldVal);
  let timer: number | null = null;
  window.setTimeout(() => {
    t.style.transition = `transform ${moveDur}ms ${EASE.move}`;
    raf(() => {
      t.style.transform = `translate(${dx}px, ${dy}px)`;
    });
  }, d0);
  window.setTimeout(() => {
    timer = window.setInterval(() => {
      t.textContent = String(1 + Math.floor(Math.random() * 6));
    }, 60);
  }, d0 + moveDur);
  window.setTimeout(() => {
    if (timer != null) window.clearInterval(timer);
    t.textContent = String(newVal);
    t.style.transition = `transform ${moveDur}ms ${EASE.enter}`;
    t.style.transform = '';
  }, d0 + moveDur + holdDur);
  window.setTimeout(() => {
    if (timer != null) window.clearInterval(timer);
    t.textContent = String(newVal);
    t.style.transition = '';
    t.style.transform = '';
  }, d0 + flipDur + 60);
  window.setTimeout(() => g.reveal(), d0 + flipDur + 90); // 收尾揭出真骰
  return d0 + flipDur;
}

/** 阶段②：新获得的骰从"中间"**并排**飞入。返回时长。 */
function playAdds(root: HTMLElement, ids: string[], pool: { x: number; y: number }, delayMs = 0, fromPool = false): number {
  const reduce = prefersReducedMotion();
  if (reduce) return 0;
  const dist = moveScale();
  const inDur = ms(MOTION.micro);
  const holdDur = ms(MOTION.hold);
  const flyDur = ms(MOTION.move);
  const settleDur = ms(MOTION.settle);
  const d = inDur + holdDur + flyDur + settleDur;
  const items = ids
    .map((id) => {
      const el = root.querySelector<HTMLElement>(`.die[data-id="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        el,
        n: rectCenter({ left: r.left, top: r.top, width: r.width, height: r.height }),
        w: r.width || 26,
      };
    })
    .filter((x): x is { el: HTMLElement; n: { x: number; y: number }; w: number } => x !== null)
    .sort((a, b) => a.n.x - b.n.x); // 按落点左右排序 → 从中间并排飞出、不穿插
  if (items.length === 0) return 0;
  const wmax = Math.max(...items.map((x) => x.w));
  const xs = sideBySideXs(pool.x, items.length, wmax);
  items.forEach((it, i) => {
    const g = ghostifyDie(it.el); // 影子在 fx 层 → 压过必杀横幅 / 快速操作栏；真骰先隐藏、收尾揭出
    const el = g.el;
    const sx = fromPool ? pool.x : xs[i]; // 起点在中间**并排**（fromPool＝从同一个点冒出）
    const dx = (sx - it.n.x) * dist;
    const dy = (pool.y - it.n.y) * dist;
    if (typeof el.animate === 'function') {
      // delay + fill:'backwards' → **延时期间就套用首帧**（透明 + 停在中间），
      // 从而"获得"不会在"离开/代价"动画播完前就提前显示在最终位置。
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(.7)`, opacity: 0, offset: 0 },
          { transform: `translate(${dx}px, ${dy}px) scale(1.05)`, opacity: 1, offset: inDur / d },
          { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 1, offset: (inDur + holdDur) / d },
          { transform: 'translate(0, 0) scale(1.08)', opacity: 1, offset: (inDur + holdDur + flyDur) / d },
          { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 1 },
        ],
        { duration: d, easing: EASE.enter, delay: delayMs, fill: 'backwards' },
      );
    } else {
      const start = (): void => {
        raf(() => {
          el.style.transition = `transform ${d}ms ${EASE.enter}, opacity ${ms(MOTION.micro)}ms linear`;
          el.style.transform = '';
          el.style.opacity = '1';
        });
      };
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px) scale(.7)`;
      el.style.opacity = '0';
      if (delayMs > 0) window.setTimeout(start, delayMs);
      else start();
      window.setTimeout(() => {
        el.style.transition = '';
        el.style.transform = '';
        el.style.opacity = '';
      }, delayMs + d + 60);
    }
    window.setTimeout(() => g.reveal(), delayMs + d + 90); // 收尾揭出真骰
  });
  return delayMs + d;
}

/** L04 重开：全部旧骰（区域 + 存放）→ **同一个中间点合成一个** → 消失；新骰从该点**冒出** → 分回各自区域。返回时长。 */
function playResetMerge(
  root: HTMLElement,
  layer: HTMLElement,
  pool: { x: number; y: number },
  prev: PrevDice,
  prevStored: StoredDice,
  exAll: Set<string>,
  addedIds: string[],
  addDur: number,
): number {
  if (prefersReducedMotion()) return 0;
  const dist = moveScale();
  const moveDur = ms(MOTION.move);
  const holdDur = ms(MOTION.hold);
  const fadeDur = ms(MOTION.fade);
  const ghostDur = moveDur + holdDur + fadeDur;

  // 出：全部旧骰（区域 + 存放）飞到**同一个点**（重叠 = 合成一个）→ 停顿 → 淡出
  const outItems: PrevDie[] = [];
  prev.forEach((p, id) => {
    if (!exAll.has(id)) outItems.push(p);
  });
  prevStored.forEach((p) => {
    outItems.push({ rect: p.rect, html: p.html, owner: null, kind: null, value: p.value });
  });
  for (const p of outItems) spawnGhost(layer, p, pool.x, pool.y, dist, 0);

  // 入：从**同一个点**冒出 → 分飞各自区域（延时到"出"播完）
  if (addedIds.length > 0) {
    window.setTimeout(() => {
      playAdds(root, addedIds, pool, 0, true);
    }, ghostDur);
  }
  return ghostDur + addDur;
}

/** 存放骰：新存放＝中间飞入卡头/战术栏凝住；移除＝从卡头飞中间淡出。返回时长。 */
function playStored(
  root: HTMLElement,
  layer: HTMLElement,
  pool: { x: number; y: number },
  prevStored: StoredDice,
  exclude: Set<string> = new Set(),
): number {
  const reduce = prefersReducedMotion();
  if (reduce) return 0;
  const dist = moveScale();
  const moveDur = ms(MOTION.move);
  const holdDur = ms(MOTION.hold);
  const fadeDur = ms(MOTION.fade);
  const d = moveDur + holdDur + fadeDur;
  const cur = snapshotStored(root);
  let maxDur = 0;

  // 新增：中间冒头 → 顿一下 → 飞入卡头（凝住）
  const inDur = ms(MOTION.micro);
  const storeHold = ms(MOTION.hold);
  const flyDur = ms(MOTION.move);
  const storeTotal = inDur + storeHold + flyDur;
  cur.forEach((c, id) => {
    if (prevStored.has(id) || exclude.has(id)) return;
    maxDur = Math.max(maxDur, storeTotal);
    const g = document.createElement('div');
    g.className = 'fx-ghost';
    g.style.left = `${pool.x - c.rect.width / 2}px`;
    g.style.top = `${pool.y - c.rect.height / 2}px`;
    g.style.width = `${c.rect.width}px`;
    g.style.height = `${c.rect.height}px`;
    g.innerHTML = c.html;
    layer.appendChild(g);
    const tx = (c.rect.left + c.rect.width / 2 - pool.x) * dist;
    const ty = (c.rect.top + c.rect.height / 2 - pool.y) * dist;
    if (typeof g.animate === 'function') {
      g.animate(
        [
          { transform: 'translate(0, 0) scale(.7)', opacity: 0, offset: 0 },
          { transform: 'translate(0, 0) scale(1.05)', opacity: 1, offset: inDur / storeTotal },
          { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: (inDur + storeHold) / storeTotal },
          { transform: `translate(${tx}px, ${ty}px) scale(1)`, opacity: 1, offset: 1 },
        ],
        { duration: storeTotal, easing: EASE.enter },
      );
    } else {
      g.style.opacity = '1';
      g.style.transition = `transform ${flyDur}ms ${EASE.enter}`;
      raf(() => {
        g.style.transform = `translate(${tx}px, ${ty}px)`;
      });
    }
    window.setTimeout(() => g.remove(), storeTotal + 80);
  });

  // 移除：卡头 → 中间（化开）
  prevStored.forEach((p, id) => {
    if (cur.has(id) || exclude.has(id)) return;
    maxDur = Math.max(maxDur, d);
    const g = document.createElement('div');
    g.className = 'fx-ghost';
    g.style.left = `${p.rect.left}px`;
    g.style.top = `${p.rect.top}px`;
    g.style.width = `${p.rect.width}px`;
    g.style.height = `${p.rect.height}px`;
    g.innerHTML = p.html;
    layer.appendChild(g);
    const pc = rectCenter(p.rect);
    raf(() => {
      g.style.transition = `transform ${moveDur}ms ${EASE.move}, opacity ${fadeDur}ms ${EASE.move}`;
      g.style.transform = `translate(${(pool.x - pc.x) * dist}px, ${(pool.y - pc.y) * dist}px) scale(.72)`;
      g.style.opacity = '0';
    });
    window.setTimeout(() => g.remove(), d + 80);
  });

  return maxDur;
}

export interface DiceMoveFx {
  moveIds: string[];
  fromCard: string[];
  hanguangs: { player: PlayerId; mode: 'move' | 'discard'; heldId: string; opponentId?: string }[];
}

/** 区域移动 / 027 寒光必杀 这组动画的时长（供"代价先于效果"——例如攻击要等它播完）。 */
export function moveFxDuration(fx: DiceMoveFx): number {
  if (fx.moveIds.length === 0 && fx.hanguangs.length === 0) return 0;
  const moveDur = ms(MOTION.move);
  const holdDur = ms(MOTION.hold);
  const fadeDur = ms(MOTION.fade);
  let d = 0;
  if (fx.moveIds.length > 0) d = Math.max(d, moveDur + holdDur + moveDur);
  for (const h of fx.hanguangs) {
    d = Math.max(d, h.mode === 'move' ? moveDur + holdDur + moveDur : moveDur + holdDur + fadeDur);
  }
  return d;
}

/** 区域移动/重排：每颗骰"旧位 → 中间重合 → 停 → 分体飞新位"（旧位可来自区域或卡头）。返回时长。 */
function playMoves(
  root: HTMLElement,
  moveIds: string[],
  fromCard: Set<string>,
  prev: PrevDice,
  prevStored: StoredDice,
  pool: { x: number; y: number },
  delayMs = 0,
): number {
  if (moveIds.length === 0 || prefersReducedMotion()) return 0;
  const moveDur = ms(MOTION.move);
  const holdDur = ms(MOTION.hold);
  let maxDur = 0;
  for (const id of moveIds) {
    const el = root.querySelector<HTMLElement>(`.die[data-id="${id}"]`);
    if (!el) continue;
    const src = fromCard.has(id) ? prevStored.get(id)?.rect : prev.get(id)?.rect;
    if (!src) continue;
    const r = el.getBoundingClientRect();
    const center = rectCenter({ left: r.left, top: r.top, width: r.width, height: r.height });
    const oldVal = prev.get(id)?.value;
    const nv = Number(el.dataset.value);
    maxDur = Math.max(
      maxDur,
      playAreaMove(el, src, center, pool, moveDur, holdDur, oldVal, Number.isFinite(nv) ? nv : undefined, delayMs),
    );
  }
  return maxDur;
}

/** 027 寒光·必杀：move＝卡头→中间→对应区；discard＝卡头那颗 + 对方同点那颗 → 中间一起消失。返回时长。 */
function playHanguang(
  layer: HTMLElement,
  root: HTMLElement,
  hanguangs: DiceMoveFx['hanguangs'],
  prev: PrevDice,
  prevStored: StoredDice,
  pool: { x: number; y: number },
  delayMs = 0,
): number {
  if (hanguangs.length === 0 || prefersReducedMotion()) return 0;
  const dist = moveScale();
  const moveDur = ms(MOTION.move);
  const holdDur = ms(MOTION.hold);
  const fadeDur = ms(MOTION.fade);
  const ghostDur = moveDur + holdDur + fadeDur;
  let maxDur = 0;
  for (const h of hanguangs) {
    if (h.mode === 'move') {
      const el = root.querySelector<HTMLElement>(`.die[data-id="${h.heldId}"]`);
      const stored = prevStored.get(h.heldId);
      if (el && stored) {
        const r = el.getBoundingClientRect();
        const center = rectCenter({ left: r.left, top: r.top, width: r.width, height: r.height });
        // 用**残影**走 卡头→中间→对应区（真骰在残影落地前隐藏）；
        // 残影在 .fx-layer，恒在"必杀"横幅（z-index:-1）之上 → 中间那一下看得见。
        const ghost = document.createElement('div');
        ghost.className = 'fx-ghost';
        ghost.style.left = `${center.x - r.width / 2}px`;
        ghost.style.top = `${center.y - r.height / 2}px`;
        ghost.style.width = `${r.width}px`;
        ghost.style.height = `${r.height}px`;
        ghost.innerHTML = stored.html;
        layer.appendChild(ghost);
        el.style.visibility = 'hidden';
        const d0 = Math.max(0, delayMs);
        const total = moveDur + holdDur + moveDur;
        window.setTimeout(() => {
          el.style.visibility = '';
        }, d0 + total - 40);
        window.setTimeout(() => ghost.remove(), d0 + total + 60);
        maxDur = Math.max(maxDur, playAreaMove(ghost, stored.rect, center, pool, moveDur, holdDur, undefined, undefined, delayMs));
      }
    } else {
      const items: PrevDie[] = [];
      const hs = prevStored.get(h.heldId);
      if (hs) items.push({ rect: hs.rect, html: hs.html, owner: null, kind: null, value: hs.value });
      if (h.opponentId) {
        const os = prev.get(h.opponentId);
        if (os) items.push(os);
      }
      if (items.length === 0) continue;
      const wmax = Math.max(...items.map((x) => x.rect.width || DIE_W));
      const xs = sideBySideXs(pool.x, items.length, wmax);
      items.forEach((it, i) => spawnGhost(layer, it, xs[i], pool.y, dist, delayMs));
      maxDur = Math.max(maxDur, Math.max(0, delayMs) + ghostDur);
    }
  }
  return maxDur;
}

/** A06 勾魂：攻击骰从中间飞向神器标题栏、落地现出灰色存放骰（参考裁雨流的"停在中间"观感）。返回时长。 */
export function playGouhun(
  root: HTMLElement,
  list: { player: PlayerId; artifactId: string; chipId: string; value: number }[],
): number {
  if (list.length === 0 || prefersReducedMotion()) return 0;
  const layer = ensureFxLayer();
  if (!layer) return 0;
  const pool = poolPoint(root);
  const inDur = ms(MOTION.micro);
  const holdDur = ms(MOTION.hold);
  const flyDur = ms(MOTION.move);
  const total = inDur + holdDur + flyDur;
  let maxDur = 0;
  for (const e of list) {
    const dest = root.querySelector<HTMLElement>(
      `.player[data-player="${e.player}"] .card[data-artifact="${e.artifactId}"] .card-head`,
    );
    const chip = root.querySelector<HTMLElement>(`.card-held--head .pay-die--held[data-id="${e.chipId}"]`);
    if (!dest) continue;
    const dr = dest.getBoundingClientRect();
    const g = document.createElement('div');
    g.className = 'fx-ghost';
    g.style.left = `${pool.x - 12}px`;
    g.style.top = `${pool.y - 12}px`;
    g.style.width = '24px';
    g.style.height = '24px';
    g.innerHTML = chip ? chip.outerHTML : `<span class="pay-die pay-die--held">${e.value}</span>`;
    layer.appendChild(g);
    if (chip) chip.style.visibility = 'hidden';
    const tx = dr.left + dr.width / 2 - pool.x;
    const ty = dr.top + dr.height / 2 - pool.y;
    if (typeof g.animate === 'function') {
      g.animate(
        [
          { transform: 'scale(.7)', opacity: 0, offset: 0 },
          { transform: 'scale(1.05)', opacity: 1, offset: inDur / total },
          { transform: 'scale(1)', opacity: 1, offset: (inDur + holdDur) / total },
          { transform: `translate(${tx}px, ${ty}px) scale(1)`, opacity: 1, offset: 1 },
        ],
        { duration: total, easing: EASE.enter },
      );
    } else {
      g.style.opacity = '1';
    }
    window.setTimeout(() => {
      if (chip) chip.style.visibility = '';
    }, total - 40);
    window.setTimeout(() => g.remove(), total + 80);
    maxDur = Math.max(maxDur, total);
  }
  return maxDur;
}

function spawnGhost(layer: HTMLElement, p: PrevDie, cx: number, cy: number, dist: number, delayMs = 0): number {
  const wrap = document.createElement('div');
  wrap.className = 'fx-ghost';
  wrap.style.left = `${p.rect.left}px`;
  wrap.style.top = `${p.rect.top}px`;
  wrap.style.width = `${p.rect.width}px`;
  wrap.style.height = `${p.rect.height}px`;
  wrap.innerHTML = p.html;
  layer.appendChild(wrap);

  const c = rectCenter(p.rect);
  const dx = (cx - c.x) * dist;
  const dy = (cy - c.y) * dist;
  const moveDur = ms(MOTION.move);
  const holdDur = ms(MOTION.hold);
  const fadeDur = ms(MOTION.fade);
  const total = moveDur + holdDur + fadeDur;
  const d0 = Math.max(0, delayMs);

  const begin = (): void => {
    raf(() => {
      wrap.style.transition = `transform ${moveDur}ms ${EASE.move}`;
      wrap.style.transform = `translate(${dx}px, ${dy}px)`;
      window.setTimeout(() => {
        wrap.style.transition = `transform ${fadeDur}ms ${EASE.enter}, opacity ${fadeDur}ms ${EASE.enter}`;
        wrap.style.transform = `translate(${dx}px, ${dy}px) scale(.72)`;
        wrap.style.opacity = '0';
      }, moveDur + holdDur);
    });
  };
  if (d0 > 0) window.setTimeout(begin, d0);
  else begin();
  window.setTimeout(() => wrap.remove(), d0 + total + 80);
  return d0 + total;
}

function shakePanel(panel: HTMLElement): void {
  if (typeof panel.animate !== 'function') return;
  panel.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-5px)' },
      { transform: 'translateX(5px)' },
      { transform: 'translateX(-3px)' },
      { transform: 'translateX(2px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: ms(260), easing: 'ease-in-out' },
  );
}

function pulseHeal(lifeline: HTMLElement): void {
  if (typeof lifeline.animate !== 'function') return;
  lifeline.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }],
    { duration: ms(320), easing: 'ease-out' },
  );
}

function healGlow(layer: HTMLElement, rect: Rect): void {
  const dur = ms(360);
  const g = document.createElement('div');
  g.className = 'fx-heal-glow';
  g.style.left = `${rect.left}px`;
  g.style.top = `${rect.top}px`;
  g.style.width = `${rect.width}px`;
  g.style.height = `${rect.height}px`;
  g.style.opacity = '0';
  layer.appendChild(g);
  if (typeof g.animate === 'function') {
    g.animate([{ opacity: 0 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }], {
      duration: dur,
      easing: 'ease-out',
    });
  } else {
    g.style.opacity = '0.9';
  }
  window.setTimeout(() => g.remove(), dur + 80);
}

function healSweep(layer: HTMLElement, rect: Rect): void {
  const dur = ms(380);
  const sweep = document.createElement('div');
  sweep.className = 'fx-heal-sweep';
  sweep.style.left = `${rect.left}px`;
  sweep.style.top = `${rect.top}px`;
  sweep.style.width = `${rect.width}px`;
  sweep.style.height = `${rect.height}px`;
  layer.appendChild(sweep);
  if (typeof sweep.animate === 'function') {
    sweep.animate(
      [
        { transform: 'translateX(-100%)', opacity: 0 },
        { opacity: 0.9, offset: 0.5 },
        { transform: 'translateX(100%)', opacity: 0 },
      ],
      { duration: dur, easing: 'ease-out' },
    );
  }
  window.setTimeout(() => sweep.remove(), dur + 80);
}

/** 回血：生命条内层**平滑变长**（从旧比例过渡到新比例，封顶不溢出）。delta=0（满血 +0）时不动。 */
function growHealBar(lifeline: HTMLElement, delta: number, max: number, delayMs = 0): void {
  if (delta <= 0) return;
  const fill = lifeline.querySelector<HTMLElement>('.lifeline-fill');
  if (!fill || max <= 0 || typeof fill.animate !== 'function') return;
  const newPct = parseFloat(fill.style.width || '0');
  if (!(newPct > 0)) return;
  const oldPct = Math.max(0, newPct - (delta / max) * 100);
  const ratio = Math.max(0, Math.min(1, oldPct / newPct));
  if (ratio >= 0.999) return;
  fill.style.transformOrigin = 'left center';
  // `fill:'backwards'` → 延时期间保持首帧（旧宽度），避免"血条先跳到新宽度、再回跳播放"
  fill.animate([{ transform: `scaleX(${ratio})` }, { transform: 'scaleX(1)' }], {
    duration: ms(360),
    easing: EASE.enter,
    delay: Math.max(0, delayMs),
    fill: 'backwards',
  });
}

/**
 * 受伤·血条收缩起点：把"当前(新)宽度%"与掉血量换算成动画起点的 `scaleX`（＝旧宽/新宽，≥1）。
 * 新宽为 0（掉到空）无意义 → 返回 1（不做）。纯函数，便于单测。
 */
export function hitShrinkScale(newPct: number, delta: number, max: number): number {
  if (delta >= 0 || max <= 0 || !(newPct > 0)) return 1;
  const lostPct = (Math.min(-delta, max) / max) * 100;
  const oldPct = Math.min(100, newPct + lostPct);
  const s = oldPct / newPct;
  return s > 1 ? s : 1;
}

/** 受伤：生命条内层从"旧(更长)"平滑**收缩**到新比例（与 `growHealBar` 对称；轨道 `overflow:hidden` 裁掉溢出）。 */
function shrinkLifeBar(lifeline: HTMLElement, delta: number, max: number, delayMs = 0): void {
  if (delta >= 0) return;
  const fill = lifeline.querySelector<HTMLElement>('.lifeline-fill');
  if (!fill || typeof fill.animate !== 'function') return;
  const newPct = parseFloat(fill.style.width || '0');
  if (!(newPct > 0)) return;
  const scale = hitShrinkScale(newPct, delta, max);
  if (scale <= 1.001) return;
  fill.style.transformOrigin = 'left center';
  // `fill:'backwards'` → 延时期间保持首帧（旧宽度），避免"血条先跳到新宽度、再回跳播放"
  fill.animate([{ transform: `scaleX(${scale})` }, { transform: 'scaleX(1)' }], {
    duration: ms(360),
    easing: EASE.enter,
    delay: Math.max(0, delayMs),
    fill: 'backwards',
  });
}

/**
 * 面板**彩光脉冲**（受伤红 / 回血绿通用）。与「操作者黄框」（`.player--acting`）**错时**：
 * - 首/尾帧＝黄框（操作中）或透明（不操作）；
 * - **中段帧＝只有红/绿彩光（不含黄）** → 彩光期间黄框**临时让位**、结束**平滑淡回**。
 * 三帧阴影层数恒定（同形状）→ 可在同一条 `box-shadow` 通道插值。非位移 → 减弱动效下也保留。`rgb`＝"R, G, B"。
 */
export function panelGlow(panel: HTMLElement, rgb: string): void {
  if (typeof panel.animate !== 'function') return;
  const TRANSPARENT = '0 0 0 0 rgba(0, 0, 0, 0), 0 0 16px 3px rgba(0, 0, 0, 0)';
  const YELLOW = '0 0 0 2px rgba(242, 203, 92, .55), 0 0 16px 3px rgba(242, 203, 92, .35)';
  const glow = (a: number): string =>
    `0 0 0 ${a > 0 ? 2 : 0}px rgba(${rgb}, ${a}), 0 0 16px 3px rgba(${rgb}, ${a * 0.6})`;
  const base = panel.classList.contains('player--acting') ? YELLOW : TRANSPARENT;
  panel.animate(
    [{ boxShadow: base }, { boxShadow: glow(0.5), offset: 0.35 }, { boxShadow: base }],
    { duration: ms(420), easing: 'ease-out' },
  );
}

/** 受伤：面板淡红光圈（色＝掉血字 `#c0392b`）。 */
function hitGlow(panel: HTMLElement): void {
  panelGlow(panel, '192, 57, 43');
}

/** 回血：面板淡绿光圈（色＝回血字 `#1d7a4d`）。 */
function healPanelGlow(panel: HTMLElement): void {
  panelGlow(panel, '29, 122, 77');
}

/** 生命变化飘字 + 反馈。delta>=0 走"回血"（含 +0），delta<0 走"受伤"。返回时长。 */
function playLifeFloats(root: HTMLElement, layer: HTMLElement, deltas: LifeDelta[], delayMs = 0): number {
  if (deltas.length === 0) return 0;
  const reduce = prefersReducedMotion();
  const d0 = Math.max(0, delayMs); // 生命变化排在"消耗/弃置"之后（代价先于效果）
  const popDur = ms(180);
  const holdDur = ms(300);
  const riseDur = ms(400);
  const total = reduce ? ms(500) : popDur + holdDur + riseDur;

  for (const d of deltas) {
    const isHeal = d.delta >= 0;
    const panel = root.querySelector<HTMLElement>(`.player[data-player="${d.player}"]`);
    const anchor =
      panel?.querySelector<HTMLElement>('.lifeline') ??
      root.querySelector<HTMLElement>(`.lifeline[data-player="${d.player}"]`);
    if (!anchor) continue;
    const r = anchor.getBoundingClientRect();

    if (panel) window.setTimeout(() => (isHeal ? healPanelGlow : hitGlow)(panel), d0); // 受伤红 / 回血绿 面板彩光（非位移 → 减弱动效也保留）
    if (!reduce) {
      if (!isHeal) {
        if (panel && !d.calm) window.setTimeout(() => shakePanel(panel), d0); // 「非伤害的下降」（033 抹零）不抖；其余照抖
        shrinkLifeBar(anchor, d.delta, d.max, d0); // 受伤：血条平滑收缩（与回血的"平滑变长"对称）
      } else {
        window.setTimeout(() => {
          pulseHeal(anchor);
          healGlow(layer, { left: r.left, top: r.top, width: r.width, height: r.height });
          healSweep(layer, { left: r.left, top: r.top, width: r.width, height: r.height });
        }, d0);
        growHealBar(anchor, d.delta, d.max, d0);
      }
    }

    const t = document.createElement('div');
    t.className = `fx-text fx-text--${isHeal ? 'heal' : 'dmg'}`;
    t.textContent = `${isHeal ? '+' : ''}${d.delta}`;
    t.style.left = `${r.left + r.width / 2}px`;
    t.style.top = `${r.top + 2}px`;
    layer.appendChild(t);

    if (!reduce && typeof t.animate === 'function') {
      // `fill:'both'` + `delay` → 延时期间保持首帧（不可见），不被"代价"动画提前盖出
      t.animate(
        [
          { transform: 'translate(-50%, 0) scale(.6)', opacity: 0, offset: 0 },
          { transform: 'translate(-50%, 0) scale(1.12)', opacity: 1, offset: 0.2 },
          { transform: 'translate(-50%, 0) scale(1)', opacity: 1, offset: 0.32 },
          { transform: 'translate(-50%, 0) scale(1)', opacity: 1, offset: 0.62 },
          { transform: 'translate(-50%, -30px) scale(1)', opacity: 0, offset: 1 },
        ],
        { duration: total, delay: d0, easing: 'ease-out', fill: 'both' },
      );
    } else {
      t.style.transform = 'translate(-50%, 0)';
      t.style.opacity = '0';
      window.setTimeout(() => {
        t.style.opacity = '1';
        raf(() => {
          t.style.transition = `transform ${total}ms linear, opacity ${total}ms linear`;
          t.style.transform = 'translate(-50%, -16px)';
          t.style.opacity = '0';
        });
      }, d0);
    }
    window.setTimeout(() => t.remove(), d0 + total + 80);
  }
  return d0 + total;
}

// ── P-D 状态类 · 阶段横幅 / 技能气泡 ─────────────────────────────────
/** 阶段横幅：从操作栏中间滑出 → 停一下 → 淡出。返回时长。 */
export function playBanner(root: HTMLElement, text: string, delayMs = 0, holdMs?: number): number {
  if (!canAnimate(root)) return 0;
  const layer = ensureFxLayer();
  if (!layer) return 0;
  const p = poolPoint(root);
  const inDur = ms(MOTION.micro);
  const holdDur = ms(holdMs ?? MOTION.bannerHold);
  const fadeDur = ms(MOTION.fade);
  const total = inDur + holdDur + fadeDur;
  const delay = Math.max(0, delayMs);
  const b = document.createElement('div');
  b.className = 'fx-banner';
  b.textContent = text;
  b.style.left = `${p.x}px`;
  b.style.top = `${p.y}px`;
  b.style.transform = 'translate(-50%,-50%)';
  layer.appendChild(b);
  if (typeof b.animate === 'function') {
    b.animate(
      prefersReducedMotion()
        ? [
            { opacity: 0, offset: 0 },
            { opacity: 1, offset: inDur / total },
            { opacity: 1, offset: (inDur + holdDur) / total },
            { opacity: 0, offset: 1 },
          ]
        : [
            { transform: 'translate(-50%,-50%) translateY(-10px) scale(.96)', opacity: 0, offset: 0 },
            { transform: 'translate(-50%,-50%) translateY(0) scale(1)', opacity: 1, offset: inDur / total },
            { transform: 'translate(-50%,-50%) translateY(0) scale(1)', opacity: 1, offset: (inDur + holdDur) / total },
            { transform: 'translate(-50%,-50%) translateY(0) scale(1)', opacity: 0, offset: 1 },
          ],
      { duration: total, delay, easing: EASE.enter, fill: 'both' },
    );
  } else {
    b.style.opacity = '1';
  }
  window.setTimeout(() => b.remove(), delay + total + 80);
  return delay + total;
}

/** 技能气泡：在目标元素上方冒出 → 停一下 → 淡出（技能名用玩家色）。返回时长。 */
/** 战斗气泡的"撕裂笔迹"滤镜（比首页更夸张：scale 30）。注入一次。 */
function ensureBubbleInkFilter(): void {
  if (typeof document === 'undefined' || !document.body) return;
  if (document.getElementById('dust-ink-bubble-svg')) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('id', 'dust-ink-bubble-svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  const filter = document.createElementNS(ns, 'filter');
  filter.setAttribute('id', 'dust-ink-bubble');
  filter.setAttribute('x', '-30%');
  filter.setAttribute('y', '-90%');
  filter.setAttribute('width', '160%');
  filter.setAttribute('height', '280%');
  const turb = document.createElementNS(ns, 'feTurbulence');
  turb.setAttribute('type', 'fractalNoise');
  turb.setAttribute('baseFrequency', '0.06 0.85');
  turb.setAttribute('numOctaves', '4');
  turb.setAttribute('seed', '9');
  turb.setAttribute('result', 'n');
  const disp = document.createElementNS(ns, 'feDisplacementMap');
  disp.setAttribute('in', 'SourceGraphic');
  disp.setAttribute('in2', 'n');
  disp.setAttribute('scale', '30');
  disp.setAttribute('xChannelSelector', 'R');
  disp.setAttribute('yChannelSelector', 'G');
  filter.appendChild(turb);
  filter.appendChild(disp);
  svg.appendChild(filter);
  document.body.appendChild(svg);
}

export type BubbleVariant = 'open' | 'use' | 'tactic';
export interface BubbleOpts {
  /** 指定宽（战术＝「战术名＋药丸」总宽）；不给则贴合文字（受 CSS max-width 约束）。 */
  width?: number;
  /** 指定居中点（战术＝「战术名＋药丸」的中点）；不给则用 target 的中心。 */
  center?: { x: number; y: number };
  /** 延后出场的毫秒数（同卡串行）；元素**立即创建**、只用 WAAPI `delay` 延后动画（不跨重绘持旧元素）。 */
  delayMs?: number;
}

/** 某类气泡的完整时长（供"同卡串行排队"估算占用）。 */
export function bubbleDuration(variant: BubbleVariant): number {
  const small = variant === 'tactic';
  return (
    ms(small ? MOTION.emerge * 0.8 : MOTION.emerge) +
    ms(small ? MOTION.bubbleHold * 0.82 : MOTION.bubbleHold) +
    ms(small ? MOTION.bubbleOut * 0.9 : MOTION.bubbleOut)
  );
}

/** 计数徽标"弹一下"（纯 `transform: scale`；减弱动效/jsdom 自动跳过）。 */
export function bumpEl(el: HTMLElement, scale = 1.32): void {
  if (prefersReducedMotion() || typeof el.animate !== 'function') return;
  el.animate(
    [{ transform: 'scale(1)' }, { transform: `scale(${scale})` }, { transform: 'scale(1)' }],
    { duration: ms(MOTION.bump), easing: EASE.enter },
  );
}

/** 充能进度条：把 `scaleX` 设为 ratio；给了 `from` 且变化则平滑过渡（减弱动效/jsdom 直接到位）。 */
export function setScaleX(el: HTMLElement, ratio: number, from?: number): void {
  const to = `scaleX(${ratio})`;
  el.style.transform = to;
  if (from != null && from !== ratio && !prefersReducedMotion() && typeof el.animate === 'function') {
    el.animate([{ transform: `scaleX(${from})` }, { transform: to }], {
      duration: ms(MOTION.move * 0.4),
      easing: EASE.enter,
    });
  }
}

/** 必杀横幅：从**快速操作栏正中心**弹出 `${prefix}${name}`（黑底白字、放大），从小变大浮现 → 停 → 原地淡出。
 *  `delayMs` 用于"跨卡顺序"（如先弹「没有怜悯」卡图气泡、再弹必杀横幅）。
 *  `prefix` 默认「必杀·」；**挑战模式**传 `''` 只显示技能名（复用同一套视觉，不另造）。 */
export function playUltimate(root: HTMLElement, name: string, delayMs = 0, prefix = '必杀·'): number {
  if (!canAnimate(root)) return 0;
  const layer = ensureFxLayer();
  if (!layer) return 0;
  ensureBubbleInkFilter();
  const p = poolPoint(root);
  const inDur = ms(MOTION.emerge);
  const holdDur = ms(MOTION.ultimateHold);
  const outDur = ms(MOTION.bubbleOut);
  const total = inDur + holdDur + outDur;
  const delay = Math.max(0, delayMs);
  const b = document.createElement('div');
  b.className = 'fx-ultimate';
  b.textContent = `${prefix}${name}`;
  b.style.left = `${p.x}px`;
  b.style.top = `${p.y}px`;
  b.style.transform = 'translate(-50%,-50%)';
  layer.appendChild(b);
  if (typeof b.animate === 'function') {
    b.animate(
      prefersReducedMotion()
        ? [
            { opacity: 0, offset: 0 },
            { opacity: 1, offset: inDur / total },
            { opacity: 1, offset: (inDur + holdDur) / total },
            { opacity: 0, offset: 1 },
          ]
        : [
            { transform: 'translate(-50%,-50%) scale(.5)', opacity: 0, offset: 0 },
            { transform: 'translate(-50%,-50%) scale(1.08)', opacity: 1, offset: inDur / total },
            { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: (inDur + 60) / total },
            { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: (inDur + holdDur) / total },
            { transform: 'translate(-50%,-50%) scale(1)', opacity: 0, offset: 1 },
          ],
      { duration: total, delay, easing: EASE.enter, fill: 'both' },
    );
  } else {
    b.style.opacity = '1';
  }
  window.setTimeout(() => b.remove(), delay + total + 80);
  return delay + total;
}

/** 战斗气泡：**从小变大浮现 → 停 → 原地淡出**（纯 `scale`＋`opacity`，无位移）。
 *  `open`＝白底黑字（单字：切换/激活/充能）；`use`＝黑底白字（技能名）；`tactic`＝黑底白字小号（战术名）。
 *  居中在 `target`（或 `opts.center`）上。返回时长。 */
export function playBubble(
  root: HTMLElement,
  target: HTMLElement | null,
  text: string,
  variant: BubbleVariant,
  opts: BubbleOpts = {},
): number {
  if (!canAnimate(root)) return 0;
  const r = target ? target.getBoundingClientRect() : null;
  if (!opts.center && (!r || (r.width === 0 && r.height === 0))) return 0;
  const layer = ensureFxLayer();
  if (!layer) return 0;
  ensureBubbleInkFilter();
  const small = variant === 'tactic';
  const inDur = ms(small ? MOTION.emerge * 0.8 : MOTION.emerge);
  const holdDur = ms(small ? MOTION.bubbleHold * 0.82 : MOTION.bubbleHold);
  const outDur = ms(small ? MOTION.bubbleOut * 0.9 : MOTION.bubbleOut);
  const total = inDur + holdDur + outDur;
  const delay = Math.max(0, opts.delayMs ?? 0);
  const cx = opts.center ? opts.center.x : r!.left + r!.width / 2;
  const cy = opts.center ? opts.center.y : r!.top + r!.height / 2;
  const b = document.createElement('div');
  b.className = `fx-bubble fx-bubble--${variant}`;
  b.textContent = text;
  b.style.left = `${cx}px`;
  b.style.top = `${cy}px`;
  b.style.transform = 'translate(-50%,-50%)';
  if (opts.width != null) b.style.width = `${opts.width}px`;
  layer.appendChild(b);
  if (typeof b.animate === 'function') {
    // reduced-motion：只淡入淡出，不做缩放。`fill:'both'` → 延迟期间保持首帧（不可见）
    b.animate(
      prefersReducedMotion()
        ? [
            { opacity: 0, offset: 0 },
            { opacity: 1, offset: inDur / total },
            { opacity: 1, offset: (inDur + holdDur) / total },
            { opacity: 0, offset: 1 },
          ]
        : [
            { transform: 'translate(-50%,-50%) scale(.55)', opacity: 0, offset: 0 },
            { transform: 'translate(-50%,-50%) scale(1.06)', opacity: 1, offset: inDur / total },
            { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: (inDur + 40) / total },
            { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: (inDur + holdDur) / total },
            { transform: 'translate(-50%,-50%) scale(1)', opacity: 0, offset: 1 },
          ],
      { duration: total, delay, easing: EASE.enter, fill: 'both' },
    );
  } else {
    b.style.opacity = '1';
  }
  window.setTimeout(() => b.remove(), delay + total + 80);
  return delay + total;
}

/* ===== 挑战模式 · 传奇回合的专属过场 ===== */

/**
 * 传奇回合开始：驱动骰从**快速操作栏中心**并排冒出 → 飞入「临时驱动骰区域」。返回时长。
 * 直接复用通用「获得骰」动画（`playAdds`＋`fromPool`）——骰子此刻**真的**在临时区里，所以是真骰动画。
 */
export function playLegendRoll(root: HTMLElement, ids: string[], delayMs = 0): number {
  if (!canAnimate(root)) return 0;
  return playAdds(root, ids, poolPoint(root), delayMs, true);
}

export interface LegendConsumeItem {
  /** 该驱动骰**上一帧**在「临时驱动骰区域」里的位置（结算后它已从状态消失 → 只能靠影子） */
  rect: Rect;
  value: number;
}

/** 区域内"能力骰真实落点"的排布常量（与 `.dice{gap:5}` / `.die{26px}` 一致）。 */
const AREA_ROW_DIE_W = 26;
const AREA_ROW_GAP = 5;

/**
 * 某骰区里"能力骰会排到哪"——和**真实骰同排**：从 `.dice` 行左起 26+5 并排；行中心＝**区域竖向中心**
 * （`.area{align-items:center}`）。
 * ⚠️ 容器为空时 `.dice` 高度＝0 → **绝不能拿它定 Y**（曾因此把落点算成"快速操作栏"→ 骰子飞进操作栏消失）。
 * 找不到区域矩形 → 返回 null（调用方**不得**退回 `pool`）。
 */
function areaDiceLanding(
  areaEl: HTMLElement | null,
  count: number,
): { xs: number[]; y: number } | null {
  if (!areaEl) return null;
  const r = areaEl.getBoundingClientRect();
  if (r.width <= 0 && r.height <= 0) return null;
  const rowEl = areaEl.querySelector<HTMLElement>('.dice');
  const rr = rowEl ? rowEl.getBoundingClientRect() : null;
  const rowLeft = rr && rr.width > 0 ? rr.left : r.left + 8; // 量不到行就用区域左 + padding(8)
  const xs = Array.from(
    { length: count },
    (_, i) => rowLeft + AREA_ROW_DIE_W / 2 + i * (AREA_ROW_DIE_W + AREA_ROW_GAP),
  );
  return { xs, y: r.top + r.height / 2 };
}

/**
 * 传奇本步**新产生**的骰：从快速操作栏中心冒出 → 飞入对应骰区**并排落位**（与真实骰同排）。返回时长。
 * 用于"引擎已把骰子移走、DOM 里找不到真骰"的情况（例：枭首触发攻击时，新骰被立刻移进攻击队列）；
 * 真骰还在区里时请交给通用「获得骰」动画（不要用本函数，否则重影）。
 */
export function playLegendSpawn(
  root: HTMLElement,
  items: { value: number; area: 'attack' | 'defense' | 'meditation' }[],
  delayMs = 0,
): number {
  if (!canAnimate(root) || items.length === 0) return 0;
  if (prefersReducedMotion() || moveScale() === 0) return 0;
  const layer = ensureFxLayer();
  if (!layer) return 0;
  const pool = poolPoint(root);
  const inDur = ms(MOTION.micro);
  const holdDur = ms(MOTION.hold);
  const flyDur = ms(MOTION.move);
  const settleDur = ms(MOTION.settle);
  const total = inDur + holdDur + flyDur + settleDur;
  const delay = Math.max(0, delayMs);
  const midXs = sideBySideXs(pool.x, items.length, AREA_ROW_DIE_W);
  // 按区域分组：落点＝该区域 `.dice` 行里**接着已有真骰**依次并排
  const slotOf = new Map<string, number>();
  items.forEach((it, i) => {
    const areaEl = root.querySelector<HTMLElement>(`.panel--challenge .area[data-kind="${it.area}"]`);
    if (!areaEl) return; // 目标区域量不到 → 本颗不做动画（绝不飞向快速操作栏）
    const existing = areaEl.querySelectorAll('.dice .die').length;
    const k = existing + (slotOf.get(it.area) ?? 0);
    slotOf.set(it.area, (slotOf.get(it.area) ?? 0) + 1);
    const landing = areaDiceLanding(areaEl, k + 1);
    if (!landing) return;
    const tcX = landing.xs[k];
    const tcY = landing.y;
    const el = makeFlyingDie('solid', 'B', it.value);
    el.style.left = `${pool.x}px`;
    el.style.top = `${pool.y}px`;
    el.style.position = 'absolute';
    layer.appendChild(el);
    if (typeof el.animate === 'function') {
      const sx = midXs[i] - pool.x;
      el.animate(
        [
          { transform: `translate(${sx}px, 0) scale(.7)`, opacity: 0, offset: 0 },
          { transform: `translate(${sx}px, 0) scale(1.05)`, opacity: 1, offset: inDur / total },
          { transform: `translate(${sx}px, 0) scale(1)`, opacity: 1, offset: (inDur + holdDur) / total },
          {
            transform: `translate(${tcX - pool.x}px, ${tcY - pool.y}px) scale(1.08)`,
            opacity: 1,
            offset: (inDur + holdDur + flyDur) / total,
          },
          { transform: `translate(${tcX - pool.x}px, ${tcY - pool.y}px) scale(1)`, opacity: 1, offset: 1 },
        ],
        { duration: total, delay, easing: EASE.enter, fill: 'both' },
      );
    }
    window.setTimeout(() => el.remove(), delay + total + 90);
  });
  return delay + total;
}

/**
 * 传奇发动技能：把「临时驱动骰区域」里满足条件的那几颗驱动骰演成
 * **临时区 → 中间（停一下）→ 驱动骰槽 → 消失**。返回时长。
 * 落点＝**槽区域里 `.dice` 行的并排位置**（和攻击/防御区里的骰子同一种排布）；
 * ⚠️ 落点必须用**区域**矩形算（空槽的 `.dice` 高度为 0，曾因此把骰子算到"快速操作栏"里消失）。
 */
export function playLegendConsume(
  root: HTMLElement,
  dice: LegendConsumeItem[],
  slotAreaEl: HTMLElement | null,
  delayMs = 0,
): number {
  if (!canAnimate(root) || dice.length === 0) return 0;
  if (prefersReducedMotion() || moveScale() === 0) return 0; // 减弱动效：整段跳过（骰子本就是"被消耗"）
  const layer = ensureFxLayer();
  if (!layer) return 0;
  const pool = poolPoint(root);
  const moveDur = ms(MOTION.move);
  const holdDur = ms(MOTION.hold);
  const fadeDur = ms(MOTION.fade);
  const total = moveDur + holdDur + moveDur + fadeDur;
  const delay = Math.max(0, delayMs);
  const sorted = [...dice].sort((a, b) => a.rect.left - b.rect.left); // 按上一帧左右排序 → 中间/落点都不穿插
  const midXs = sideBySideXs(pool.x, sorted.length, AREA_ROW_DIE_W);
  const landing = areaDiceLanding(slotAreaEl, sorted.length);
  sorted.forEach((dy, i) => {
    const g = makeFlyingDie('solid', 'B', dy.value);
    g.style.left = `${dy.rect.left}px`;
    g.style.top = `${dy.rect.top}px`;
    g.style.position = 'absolute';
    layer.appendChild(g);
    const c = rectCenter(dy.rect);
    const dx1 = midXs[i] - c.x;
    const dy1 = pool.y - c.y;
    // 第二跳：中间 → 槽区并排落点（量不到槽区时原地淡出，绝不飞向快速操作栏）
    const dx2 = landing ? landing.xs[i] - midXs[i] : 0;
    const dy2 = landing ? landing.y - pool.y : 0;
    if (typeof g.animate === 'function') {
      g.animate(
        [
          { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0 },
          { transform: `translate(${dx1}px, ${dy1}px) scale(1.04)`, opacity: 1, offset: moveDur / total },
          { transform: `translate(${dx1}px, ${dy1}px) scale(1)`, opacity: 1, offset: (moveDur + holdDur) / total },
          {
            transform: `translate(${dx1 + dx2}px, ${dy1 + dy2}px) scale(.92)`,
            opacity: 1,
            offset: (moveDur + holdDur + moveDur) / total,
          },
          {
            transform: `translate(${dx1 + dx2}px, ${dy1 + dy2}px) scale(.8)`,
            opacity: 0,
            offset: 1,
          },
        ],
        { duration: total, delay, easing: EASE.move, fill: 'both' },
      );
    }
    window.setTimeout(() => g.remove(), delay + total + 90);
  });
  return delay + total;
}
