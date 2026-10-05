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

function fadeEl(el: HTMLElement, dur: number): void {
  if (typeof el.animate === 'function') {
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: 'ease-in', fill: 'forwards' });
  } else {
    el.style.opacity = '0';
  }
  window.setTimeout(() => el.remove(), dur + 80);
}

/** 攻击**连接线**（攻击方攻击骰区中心 → 被攻击方生命条中心）；不是骰子的运动路径。 */
function drawLinkLine(layer: HTMLElement, atk: HTMLElement | null, def: HTMLElement | null): void {
  if (!atk || !def) return;
  const start = atk.querySelector<HTMLElement>('.area[data-kind="attack"]') ?? atk;
  const end = def.querySelector<HTMLElement>('.lifeline') ?? def;
  const s = start.getBoundingClientRect();
  const e = end.getBoundingClientRect();
  const x1 = s.left + s.width / 2;
  const y1 = s.top + s.height / 2;
  const x2 = e.left + e.width / 2;
  const y2 = e.top + e.height / 2;
  const len = Math.max(1, Math.hypot(x2 - x1, y2 - y1));
  const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const drawDur = ms(160);
  const holdDur = ms(200);
  const fadeDur = ms(180);
  const total = drawDur + holdDur + fadeDur;
  const line = document.createElement('div');
  line.className = 'fx-line';
  line.style.left = `${x1}px`;
  line.style.top = `${y1}px`;
  line.style.width = `${len}px`;
  line.style.transformOrigin = '0 50%';
  line.style.transform = `rotate(${ang}deg) scaleX(0)`;
  layer.appendChild(line);
  if (typeof line.animate === 'function') {
    line.animate(
      [
        { transform: `rotate(${ang}deg) scaleX(0)`, opacity: 0, offset: 0 },
        { transform: `rotate(${ang}deg) scaleX(1)`, opacity: 1, offset: drawDur / total },
        { transform: `rotate(${ang}deg) scaleX(1)`, opacity: 1, offset: (drawDur + holdDur) / total },
        { transform: `rotate(${ang}deg) scaleX(1)`, opacity: 0, offset: 1 },
      ],
      { duration: total, easing: 'ease-out' },
    );
  }
  window.setTimeout(() => line.remove(), total + 80);
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
 * @param holdAdds 本帧"获得"要延后到切换后再播（＝有换手且有获得）。
 * @returns 本次动效最长时长（ms），供"两阶段：播完再切"计时。
 */
export function runBoardMotions(
  root: HTMLElement,
  prev: PrevDice,
  lifeDeltas: LifeDelta[],
  flipped = false,
  holdAdds = false,
  excludeIds: string[] = [],
  prevStored: StoredDice = new Map(),
  rerollIds: Set<string> = new Set(),
  diceFx: DiceMoveFx = { moveIds: [], fromCard: [], hanguangs: [] },
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
  const addDur = addedIds.length
    ? ms(MOTION.micro) + ms(MOTION.hold) + ms(MOTION.move) + ms(MOTION.settle)
    : 0;

  // 阶段①：生命反馈 + 消耗/弃置/让位/改点/换区（旧坐标）
  let dur = playLifeFloats(root, layer0, lifeDeltas);
  if (!flipped) dur = Math.max(dur, playRemovalsAndFlip(root, layer0, prev, curIds, pool0, [...exAll], rerollIds));

  // 阶段②：获得（串行在阶段①之后；若要切视角则延后到切换后）
  if (addedIds.length) {
    if (holdAdds) {
      pendingAddIds = addedIds;
    } else {
      const delay = dur;
      window.setTimeout(() => {
        playAdds(root, addedIds, poolPoint(root));
      }, delay);
      dur = delay + addDur;
    }
  }

  // 存放骰：中间 ↔ 卡头/战术栏
  dur = Math.max(dur, playStored(root, layer0, pool0, prevStored, exAll));
  // 区域移动/重排（029 全知等）：整体"聚中间 → 分体飞新位"
  dur = Math.max(dur, playMoves(root, diceFx.moveIds, new Set(diceFx.fromCard), prev, prevStored, pool0));
  // 027 寒光·必杀：移入对应区 / 与对方同点骰一起消失
  dur = Math.max(dur, playHanguang(layer0, root, diceFx.hanguangs, prev, prevStored, pool0));
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
      maxDur = Math.max(
        maxDur,
        playValueFlip(el, Number.isFinite(p.value) ? p.value : newVal, newVal, n, pool, moveDur, holdDur),
      );
      return;
    }
    if (p.owner !== curOwner || p.kind !== curKind) {
      // 区域互换 / 移动：旧位 → 中间 → 停 → 分体飞新位
      maxDur = Math.max(maxDur, playAreaMove(el, p.rect, n, pool, moveDur, holdDur));
      return;
    }
    if (Number.isFinite(p.value) && p.value !== newVal) {
      // 骰面翻转（改点 / 重投）：旧值 → 中间翻滚 → 新值 → 飞回
      maxDur = Math.max(maxDur, playValueFlip(el, p.value, newVal, n, pool, moveDur, holdDur));
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

/** 区域互换/移动：旧位 → 中间 → 停 → 分体飞新位（骰子元素当前在新位）。返回时长。 */
function playAreaMove(
  el: HTMLElement,
  fromRect: Rect,
  center: { x: number; y: number },
  pool: { x: number; y: number },
  moveDur: number,
  holdDur: number,
): number {
  const dist = moveScale();
  const fc = rectCenter(fromRect);
  const total = moveDur + holdDur + moveDur;
  el.style.transition = 'none';
  el.style.transform = `translate(${(fc.x - center.x) * dist}px, ${(fc.y - center.y) * dist}px)`;
  raf(() => {
    el.style.transition = `transform ${moveDur}ms ${EASE.move}`;
    el.style.transform = `translate(${(pool.x - center.x) * dist}px, ${(pool.y - center.y) * dist}px)`;
  });
  window.setTimeout(() => {
    el.style.transition = `transform ${moveDur}ms ${EASE.enter}`;
    el.style.transform = '';
  }, moveDur + holdDur);
  window.setTimeout(() => {
    el.style.transition = '';
    el.style.transform = '';
  }, total + 60);
  return total;
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
): number {
  const dist = moveScale();
  const dx = (pool.x - center.x) * dist;
  const dy = (pool.y - center.y) * dist;
  const total = moveDur + holdDur + moveDur;
  el.textContent = String(oldVal);
  el.style.transition = `transform ${moveDur}ms ${EASE.move}`;
  raf(() => {
    el.style.transform = `translate(${dx}px, ${dy}px)`;
  });
  let timer: number | null = null;
  window.setTimeout(() => {
    timer = window.setInterval(() => {
      el.textContent = String(1 + Math.floor(Math.random() * 6));
    }, 60);
  }, moveDur);
  window.setTimeout(() => {
    if (timer != null) window.clearInterval(timer);
    el.textContent = String(newVal);
    el.style.transition = `transform ${moveDur}ms ${EASE.enter}`;
    el.style.transform = '';
  }, moveDur + holdDur);
  window.setTimeout(() => {
    if (timer != null) window.clearInterval(timer);
    el.textContent = String(newVal);
    el.style.transition = '';
    el.style.transform = '';
  }, total + 60);
  return total;
}

/** 阶段②：新获得的骰从"中间"**并排**飞入。返回时长。 */
function playAdds(root: HTMLElement, ids: string[], pool: { x: number; y: number }): number {
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
    const el = it.el;
    const sx = xs[i]; // 起点在中间**并排**
    const dx = (sx - it.n.x) * dist;
    const dy = (pool.y - it.n.y) * dist;
    if (typeof el.animate === 'function') {
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(.7)`, opacity: 0, offset: 0 },
          { transform: `translate(${dx}px, ${dy}px) scale(1.05)`, opacity: 1, offset: inDur / d },
          { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 1, offset: (inDur + holdDur) / d },
          { transform: 'translate(0, 0) scale(1.08)', opacity: 1, offset: (inDur + holdDur + flyDur) / d },
          { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 1 },
        ],
        { duration: d, easing: EASE.enter },
      );
    } else {
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px) scale(.7)`;
      el.style.opacity = '0';
      raf(() => {
        el.style.transition = `transform ${d}ms ${EASE.enter}, opacity ${ms(MOTION.micro)}ms linear`;
        el.style.transform = '';
        el.style.opacity = '1';
      });
      window.setTimeout(() => {
        el.style.transition = '';
        el.style.transform = '';
        el.style.opacity = '';
      }, d + 60);
    }
  });
  return d;
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
    maxDur = Math.max(maxDur, playAreaMove(el, src, center, pool, moveDur, holdDur));
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
      const src = prevStored.get(h.heldId)?.rect;
      if (el && src) {
        const r = el.getBoundingClientRect();
        const center = rectCenter({ left: r.left, top: r.top, width: r.width, height: r.height });
        maxDur = Math.max(maxDur, playAreaMove(el, src, center, pool, moveDur, holdDur));
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
      items.forEach((it, i) => spawnGhost(layer, it, xs[i], pool.y, dist));
      maxDur = Math.max(maxDur, ghostDur);
    }
  }
  return maxDur;
}

function spawnGhost(layer: HTMLElement, p: PrevDie, cx: number, cy: number, dist: number): number {
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

  raf(() => {
    wrap.style.transition = `transform ${moveDur}ms ${EASE.move}`;
    wrap.style.transform = `translate(${dx}px, ${dy}px)`;
    window.setTimeout(() => {
      wrap.style.transition = `transform ${fadeDur}ms ${EASE.enter}, opacity ${fadeDur}ms ${EASE.enter}`;
      wrap.style.transform = `translate(${dx}px, ${dy}px) scale(.72)`;
      wrap.style.opacity = '0';
    }, moveDur + holdDur);
  });
  window.setTimeout(() => wrap.remove(), total + 80);
  return total;
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
function growHealBar(lifeline: HTMLElement, delta: number, max: number): void {
  if (delta <= 0) return;
  const fill = lifeline.querySelector<HTMLElement>('.lifeline-fill');
  if (!fill || max <= 0 || typeof fill.animate !== 'function') return;
  const newPct = parseFloat(fill.style.width || '0');
  if (!(newPct > 0)) return;
  const oldPct = Math.max(0, newPct - (delta / max) * 100);
  const ratio = Math.max(0, Math.min(1, oldPct / newPct));
  if (ratio >= 0.999) return;
  fill.style.transformOrigin = 'left center';
  fill.animate([{ transform: `scaleX(${ratio})` }, { transform: 'scaleX(1)' }], {
    duration: ms(360),
    easing: EASE.enter,
  });
}

/** 生命变化飘字 + 反馈。delta>=0 走"回血"（含 +0），delta<0 走"受伤"。返回时长。 */
function playLifeFloats(root: HTMLElement, layer: HTMLElement, deltas: LifeDelta[]): number {
  if (deltas.length === 0) return 0;
  const reduce = prefersReducedMotion();
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

    if (!reduce) {
      if (!isHeal) {
        if (panel) shakePanel(panel);
      } else {
        pulseHeal(anchor);
        healGlow(layer, { left: r.left, top: r.top, width: r.width, height: r.height });
        healSweep(layer, { left: r.left, top: r.top, width: r.width, height: r.height });
        growHealBar(anchor, d.delta, d.max);
      }
    }

    const t = document.createElement('div');
    t.className = `fx-text fx-text--${isHeal ? 'heal' : 'dmg'}`;
    t.textContent = `${isHeal ? '+' : ''}${d.delta}`;
    t.style.left = `${r.left + r.width / 2}px`;
    t.style.top = `${r.top + 2}px`;
    layer.appendChild(t);

    if (!reduce && typeof t.animate === 'function') {
      t.animate(
        [
          { transform: 'translate(-50%, 0) scale(.6)', opacity: 0, offset: 0 },
          { transform: 'translate(-50%, 0) scale(1.12)', opacity: 1, offset: 0.2 },
          { transform: 'translate(-50%, 0) scale(1)', opacity: 1, offset: 0.32 },
          { transform: 'translate(-50%, 0) scale(1)', opacity: 1, offset: 0.62 },
          { transform: 'translate(-50%, -30px) scale(1)', opacity: 0, offset: 1 },
        ],
        { duration: total, easing: 'ease-out', fill: 'forwards' },
      );
    } else {
      t.style.transform = 'translate(-50%, 0)';
      t.style.opacity = '1';
      raf(() => {
        t.style.transition = `transform ${total}ms linear, opacity ${total}ms linear`;
        t.style.transform = 'translate(-50%, -16px)';
        t.style.opacity = '0';
      });
    }
    window.setTimeout(() => t.remove(), total + 80);
  }
  return total;
}

// ── P-D 状态类 · 阶段横幅 / 技能气泡 ─────────────────────────────────
/** 阶段横幅：从操作栏中间滑出 → 停一下 → 淡出。返回时长。 */
export function playBanner(root: HTMLElement, text: string): number {
  if (!canAnimate(root)) return 0;
  const layer = ensureFxLayer();
  if (!layer) return 0;
  const p = poolPoint(root);
  const inDur = ms(MOTION.micro);
  const holdDur = ms(MOTION.emphasis);
  const fadeDur = ms(MOTION.fade);
  const total = inDur + holdDur + fadeDur;
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
      { duration: total, easing: EASE.enter, fill: 'forwards' },
    );
  } else {
    b.style.opacity = '1';
  }
  window.setTimeout(() => b.remove(), total + 80);
  return total;
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

/** 必杀横幅：从**快速操作栏正中心**弹出 `必杀·XXXX`（黑底白字、放大），从小变大浮现 → 停 → 原地淡出。
 *  `delayMs` 用于"跨卡顺序"（如先弹「没有怜悯」卡图气泡、再弹必杀横幅）。 */
export function playUltimate(root: HTMLElement, name: string, delayMs = 0): number {
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
  b.textContent = `必杀·${name}`;
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
