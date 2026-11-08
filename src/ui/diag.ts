/**
 * 排查用"黑匣子"（默认关闭，零开销）。
 *
 * 开启：网址后加 `?diag=1`（例如 `https://域名/?diag=1`）→ 设置面板多出「诊断日志」。
 * 用途：只记录**挑战模式**的动作/状态快照、"骰子被藏起来"、以及**数据里有、画面上没有**的骰子
 *       （`DOM-MISSING`）——专门用来抓"隐形骰子"这类渲染问题。
 *       （2026-11-07 扩充）另记 2v2 的**点击链路**：`ui-rebuild` / `ui-down` / `ui-click` /
 *       `ui-step` / `ui-propose` / `ui-dispatch` / `ui-guard` / `ui-throw`，
 *       以及导出那一刻的 `ui-now` 现场快照——专门抓"点了没反应"这类**界面把点击吞掉**的问题。
 *       `game-start` 与每条 `action` 会被**钉住**（不随 800 条上限淘汰）→ 用 seed + 动作序列可本地重放。
 * 取日志：设置面板「诊断日志」→「复制全部」（http 下浏览器禁用剪贴板 → 自动弹出全选文本框，Ctrl+C）。
 */
import type { GameState, PlayerState } from '../core/model/types';

const MAX = 800;
/** 「钉住」条目（开局种子 + 每一条动作）不受 800 条上限淘汰，另设一个硬上限防失控。 */
const MAX_PINNED = 4000;
type Entry = { line: string; pinned: boolean };
const ring: Entry[] = [];
let pinnedCount = 0;
let enabled = typeof location !== 'undefined' && /[?&]diag=1\b/.test(location.search);
/**
 * 「导出那一刻」的现场快照（由界面注册，缺省 null）。
 * 用途：卡死时玩家只要点「诊断日志 → 复制全部」，就能得到**当下**的 UI 步骤 + 引擎合法动作，
 * 不需要再复现一次点击。
 */
let dumpProbe: (() => unknown) | null = null;

/** 测试用：强制开关（jsdom 里改 location.search 不方便）。 */
export function setDiagEnabled(on: boolean): void {
  enabled = on;
  if (!on) ring.length = 0;
}
export function isDiagEnabled(): boolean {
  return enabled;
}
export function diagClear(): void {
  ring.length = 0;
  pinnedCount = 0;
}
export function diagCount(): number {
  return ring.length;
}
/** 钉住条数（测试/排查用：证明开局种子与动作没被淘汰）。 */
export function diagPinnedCount(): number {
  return pinnedCount;
}

/** 注册「导出时现场快照」探针；传 null 取消（非 2v2 界面必须取消，避免读到过期闭包）。 */
export function setDumpProbe(fn: (() => unknown) | null): void {
  dumpProbe = fn;
}

const stamp = (): string => new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm

function pushLine(tag: string, data: unknown, pinned: boolean): void {
  let body = '';
  if (data !== undefined) {
    try {
      body = ' ' + JSON.stringify(data);
    } catch {
      body = ' [unserializable]';
    }
  }
  pushLineRaw(`${stamp()} ${tag}${body}`, pinned);
}

function pushLineRaw(line: string, pinned: boolean): void {
  ring.push({ line, pinned });
  if (pinned) pinnedCount++;
  // 超上限 → 从**最旧的未钉住**条目开始淘汰（保住开局种子 → 可用 seed + 动作序列本地重放）。
  while (ring.length > MAX) {
    const i = ring.findIndex((e) => !e.pinned);
    if (i >= 0) {
      ring.splice(i, 1);
      continue;
    }
    if (pinnedCount <= MAX_PINNED) break; // 全是钉住条目且未超硬上限：允许暂时超过 MAX
    ring.shift();
    pinnedCount--;
  }
}

export function diag(tag: string, data?: unknown): void {
  if (!enabled) return;
  pushLine(tag, data, false);
}

/**
 * 钉住条目：不受 800 条上限淘汰。
 * 只给「事后必须还在」的记录用——开局种子、每一条派发出去的动作（少了就没法重放）。
 */
export function diagPin(tag: string, data?: unknown): void {
  if (!enabled) return;
  pushLine(tag, data, true);
}

export function diagDump(): string {
  const out = ring.map((e) => e.line);
  if (enabled && dumpProbe) {
    try {
      const data = dumpProbe();
      if (data !== undefined) out.push(`${stamp()} ui-now ${JSON.stringify(data)}`);
    } catch (e) {
      out.push(`${stamp()} ui-now-error ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out.join('\n');
}

/** 纯函数：**数据里有、画面上没有**的骰子 id（重复 id 只报一次）。 */
export function missingDiceInDom(dataIds: string[], domIds: string[]): string[] {
  const dom = new Set(domIds);
  return [...new Set(dataIds)].filter((id) => !dom.has(id));
}

const areasOf = (p: PlayerState) => ({
  attack: p.areas.attack.map((d) => `${d.id}:${d.value}`),
  defense: p.areas.defense.map((d) => `${d.id}:${d.value}`),
  meditation: p.areas.meditation.map((d) => `${d.id}:${d.value}`),
});

const logTailOf = (g: GameState) =>
  g.log.slice(-12).map((entry) => ({
    turn: entry.turn,
    phase: entry.phase,
    text: entry.text,
  }));

/** 2v2 状态快照：四座位 + 团队生命；不能套用 1v1 的 A/B。 */
export function twoVTwoSnapshot(g: GameState, gone: string[] = []): Record<string, unknown> {
  const seats: Record<string, unknown> = {};
  for (const id of g.roster ?? Object.keys(g.players)) {
    const p = g.players[id];
    if (!p) continue;
    seats[id] = {
      areas: areasOf(p),
      life: p.life,
      artifacts: p.artifacts.map((a) => ({
        id: a.id,
        count: a.count,
        chargeLayer: a.chargeLayer ?? 0,
        chargeReq: a.chargeReq ?? 0,
        activeMarkerSide: a.activeMarkerSide ?? null,
        armedSide: a.armedSide ?? null,
        armedTurn: a.armedTurn ?? null,
        heldDice: a.heldDice?.map((d) => `${d.id}:${d.value}`) ?? [],
      })),
    };
  }
  const teams =
    g.teams == null
      ? null
      : Object.fromEntries(
          Object.entries(g.teams).map(([id, team]) => [
            id,
            { life: team.life, lifeMax: team.lifeMax, members: team.members },
          ]),
        );
  const pa = g.pendingAttack;
  return {
    mode: '2v2',
    phase: g.phase,
    active: g.activePlayer,
    stance: g.stance ?? null,
    teams,
    seats,
    pending: g.pending?.kind ?? null,
    pendingPlayer: g.pending?.player ?? null,
    pendingQueue: g.pendingQueue?.length ?? 0,
    pa: pa
      ? {
          attacker: pa.attacker,
          defender: pa.defender ?? null,
          value: pa.value,
          sourceDieId: pa.sourceDieId ?? null,
        }
      : null,
    attackQueue: g.attackQueue ? (g.attackQueue.values?.length ?? 0) : null,
    virtualQueue: g.virtualQueue?.map((q) => `${q.dieId ?? '-'}:${q.value}`) ?? null,
    gone,
    logTail: logTailOf(g),
  };
}

/** 整局状态快照（全模式；2v2 自动走四座位结构）。 */
export function gameSnapshot(g: GameState, gone: string[] = []): Record<string, unknown> {
  if (g.rules?.id === '2v2' || !g.players.A || !g.players.B) {
    return twoVTwoSnapshot(g, gone);
  }
  const c = g.challenge;
  const pa = g.pendingAttack;
  return {
    mode: g.mode,
    phase: g.phase,
    active: g.activePlayer,
    A: areasOf(g.players.A),
    B: areasOf(g.players.B),
    driven: c?.driven?.map((d) => `${d.id}:${d.value}`) ?? null,
    card: c?.cardId ?? null,
    legendTurn: c?.turn ?? null,
    pending: g.pending?.kind ?? null,
    pendingPlayer: g.pending?.player ?? null,
    pendingQueue: g.pendingQueue?.length ?? 0,
    pa: pa ? { attacker: pa.attacker, value: pa.value, sourceDieId: pa.sourceDieId ?? null } : null,
    attackQueue: g.attackQueue ? (g.attackQueue.values?.length ?? 0) : null,
    virtualQueue: g.virtualQueue?.map((q) => `${q.dieId ?? '-'}:${q.value}`) ?? null,
    gone,
    logTail: logTailOf(g),
  };
}

/** 诊断入口：按当前规则选正确的快照结构，绝不让调用方碰 `players.A/B`。 */
export function snapshotForState(g: GameState, gone: string[] = []): Record<string, unknown> {
  return gameSnapshot(g, gone);
}

/** 纯函数：数据值 vs 画面值（`data-value`）不一致的骰子（"显示的是过时骰子"的证据）。 */
export function staleDice(
  dataVals: Record<string, number>,
  domVals: Record<string, string>,
): { id: string; data: number; dom: string }[] {
  const out: { id: string; data: number; dom: string }[] = [];
  for (const [id, dv] of Object.entries(dataVals)) {
    const dom = domVals[id];
    if (dom == null) continue;
    if (dom !== String(dv)) out.push({ id, data: dv, dom });
  }
  return out;
}
