/**
 * 排查用"黑匣子"（默认关闭，零开销）。
 *
 * 开启：网址后加 `?diag=1`（例如 `https://域名/?diag=1`）→ 设置面板多出「诊断日志」。
 * 用途：只记录**挑战模式**的动作/状态快照、"骰子被藏起来"、以及**数据里有、画面上没有**的骰子
 *       （`DOM-MISSING`）——专门用来抓"隐形骰子"这类渲染问题。
 * 取日志：设置面板「诊断日志」→「复制全部」（http 下浏览器禁用剪贴板 → 自动弹出全选文本框，Ctrl+C）。
 */
import type { GameState, PlayerState } from '../core/model/types';

const MAX = 800;
const ring: string[] = [];
let enabled = typeof location !== 'undefined' && /[?&]diag=1\b/.test(location.search);

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
}
export function diagCount(): number {
  return ring.length;
}

export function diag(tag: string, data?: unknown): void {
  if (!enabled) return;
  let body = '';
  if (data !== undefined) {
    try {
      body = ' ' + JSON.stringify(data);
    } catch {
      body = ' [unserializable]';
    }
  }
  const t = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  ring.push(`${t} ${tag}${body}`);
  if (ring.length > MAX) ring.shift();
}

export function diagDump(): string {
  return ring.join('\n');
}

/** 纯函数：**数据里有、画面上没有**的骰子 id（重复 id 只报一次）。 */
export function missingDiceInDom(dataIds: string[], domIds: string[]): string[] {
  const dom = new Set(domIds);
  return [...new Set(dataIds)].filter((id) => !dom.has(id));
}

/** 整局状态快照（**全模式**；挑战专属字段有才带、没有为 null）。骰子写成 `id:点数`。 */
export function gameSnapshot(g: GameState, gone: string[] = []): Record<string, unknown> {
  const areas = (p: PlayerState) => ({
    attack: p.areas.attack.map((d) => `${d.id}:${d.value}`),
    defense: p.areas.defense.map((d) => `${d.id}:${d.value}`),
    meditation: p.areas.meditation.map((d) => `${d.id}:${d.value}`),
  });
  const c = g.challenge;
  const pa = g.pendingAttack;
  return {
    mode: g.mode,
    phase: g.phase,
    active: g.activePlayer,
    A: areas(g.players.A),
    B: areas(g.players.B),
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
  };
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
