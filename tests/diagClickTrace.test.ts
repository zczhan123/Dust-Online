// 2v2「点了没反应」取证链路（2026-11-07）。
//
// 背景：用户报 010 杀意 / 011 灵能脉冲 点目标（旧版是「发动」按钮）有时完全没反应，
//       而 `bug.txt` 里那 174 秒**一条 action 都没有** → 证明点击根本没走到派发。
//       但当时日志里没有任何"点击"记录，无法判断是：
//         ① 点击没进浏览器（按钮被换掉 / 被透明层盖住）
//         ② 进了但被守卫忽略
//         ③ 处理器抛异常
//         ④ 提出了待确认但确认条没画 / 看不见
//
// 所以本文件锁住这些**旁路观察**：
//   - 默认关闭时零日志（不改变任何行为）；
//   - 一条点击只记一条（整页重建后**不会重复绑定**）；
//   - `ui-click` 带"坐标下最顶层元素"，被覆盖时会显示成 topOk=false；
//   - `ui-step` 记「引擎允许的动作类型 vs 画面上的按钮」——卡死时一眼分类型；
//   - 导出时的 `ui-now` 现场快照（设置里点「复制全部」即可，不需要再复现）；
//   - `game-start` / `action` 是**钉住**条目，不会被 800 条上限挤掉（否则没法用 seed 重放）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTwoVTwoGame } from '../src/core/engine/game';
import { render2v2Game } from '../src/ui/battle2v2View';
import {
  diag,
  diagClear,
  diagCount,
  diagDump,
  diagPin,
  diagPinnedCount,
  setDiagEnabled,
  setDumpProbe,
} from '../src/ui/diag';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';
import type { GameState } from '../src/core/model/types';

const setup = (): TwoVTwoSetup => ({
  seats: {
    A1: ['010', '011', '012'],
    A2: ['001', '002', '003'],
    B1: ['004', '005', '006'],
    B2: ['007', '008', '009'],
  },
  firstTeam: 'A',
  seed: 7,
  dice: {
    A1: { attack: [3, 4], defense: [2], meditation: [] },
    B1: { attack: [], defense: [], meditation: [] },
    B2: { attack: [], defense: [], meditation: [] },
  },
});

/** 起一局并摆好 010「杀意」的纯选对象型待决策（与 render2v2PendingShape 同一口径）。 */
const withShenhong = (): GameState => {
  const g = createTwoVTwoGame(setup());
  g.phase = 'main';
  g.activePlayer = 'A1';
  g.pending = { kind: 'shenhongKill', player: 'A1' } as never;
  return g;
};

const mount = (g: GameState, seen: unknown[] = []) => {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  render2v2Game(root, g, { onAction: (a) => seen.push(a as never), onBack: () => {} });
  return root;
};

const lines = (tag: string): string[] =>
  diagDump()
    .split('\n')
    .filter((l) => l.includes(` ${tag} `) || l.includes(` ${tag}\n`));

beforeEach(() => {
  setDiagEnabled(true);
  diagClear();
  setDumpProbe(null);
});
afterEach(() => {
  setDiagEnabled(false);
  setDumpProbe(null);
  diagClear();
});

describe('诊断：默认关闭时零开销、不改变行为', () => {
  it('diag=0 → 点击不产生任何日志，但动作照常派发', () => {
    setDiagEnabled(false);
    const g = withShenhong();
    const seen: unknown[] = [];
    const root = mount(g, seen);
    const target = root.querySelector<HTMLElement>('.option-row--decide [data-choice="B1"]')!;
    target.click();
    const confirm = root.querySelector<HTMLElement>('.confirm-row [data-act="confirm"]')!;
    confirm.click();
    expect(seen).toHaveLength(1);
    expect(diagCount()).toBe(0);
  });
});

describe('诊断：点击链路', () => {
  it('点目标 → 记 ui-click（含 data-choice）+ ui-propose，且确认条进 DOM', () => {
    const g = withShenhong();
    const root = mount(g);
    const target = root.querySelector<HTMLElement>('.option-row--decide [data-choice="B1"]')!;
    target.click();

    const clicks = lines('ui-click');
    expect(clicks).toHaveLength(1); // 一次点击只记一条（监听器没重复绑定）
    expect(clicks[0]).toContain('"choice":"B1"');
    expect(clicks[0]).toContain('"act":"shenhongKill"');
    // jsdom 没有 elementFromPoint → top 为 null，但字段必须在
    expect(clicks[0]).toContain('"top":');

    const proposes = lines('ui-propose');
    expect(proposes).toHaveLength(1);
    expect(proposes[0]).toContain('"t":"shenhongKill"');
    expect(proposes[0]).toContain('"target":"B1"');

    // 确认条状态也进了快照（含宽高字段）
    const steps = lines('ui-step');
    expect(steps.some((l) => l.includes('"confirmInDom":true'))).toBe(true);
    expect(steps.some((l) => l.includes('"confirmRect"'))).toBe(true);
  });

  it('整页重建**不会**重复绑定监听（重建后点一次仍只有一条 ui-click）', () => {
    const g = withShenhong();
    const root = mount(g);
    render2v2Game(root, g, { onAction: () => {}, onBack: () => {} }); // 模拟换队帧整页重建
    diagClear();
    root.querySelector<HTMLElement>('.option-row--decide [data-choice="B2"]')!.click();
    expect(lines('ui-click')).toHaveLength(1);
  });

  it('重建会记 ui-rebuild（带重建前屏幕上有没有确认条）', () => {
    const g = withShenhong();
    const root = mount(g);
    root.querySelector<HTMLElement>('.option-row--decide [data-choice="B1"]')!.click();
    render2v2Game(root, g, { onAction: () => {}, onBack: () => {} });
    const rebuilds = lines('ui-rebuild');
    expect(rebuilds.length).toBeGreaterThanOrEqual(2);
    // 第二次重建时，屏幕上还有上一帧画出来的确认条 → 证明确认条确实会被整页重建带走
    expect(rebuilds[rebuilds.length - 1]).toContain('"hadConfirmRow":true');
  });

  it('ui-step 同时记「引擎允许的动作」与「画面上的按钮」——卡死时用来分清类型', () => {
    const g = withShenhong();
    mount(g);
    const step = lines('ui-step').pop()!;
    expect(step).toContain('"legalTypes":["shenhongKill"]');
    expect(step).toContain('不发动「杀意」');
  });

  it('导出探针：diagDump 末尾追加 ui-now（卡死时点「复制全部」即可取证）', () => {
    const g = withShenhong();
    const root = mount(g);
    root.querySelector<HTMLElement>('.option-row--decide [data-choice="B1"]')!.click();
    const dump = diagDump();
    const last = dump.split('\n').pop()!;
    expect(last).toContain(' ui-now ');
    expect(last).toContain('"confirmInDom":true');
    expect(last).toContain('"pending":{"kind":"shenhongKill"');
    expect(last).toContain('"legalTypes":["shenhongKill"]');
  });
});

describe('诊断：钉住条目（可本地重放）', () => {
  it('game-start / action 不会被 800 条点击日志挤掉', () => {
    diagPin('game-start', { mode: '2v2', seed: 123 });
    expect(diagPinnedCount()).toBe(1);
    for (let i = 0; i < 900; i++) diag('ui-click', { i });
    expect(diagCount()).toBe(800); // 上限照旧
    expect(diagDump()).toContain('game-start {"mode":"2v2","seed":123}');
    expect(diagDump()).toContain('{"i":899}');
    expect(diagDump()).not.toContain('{"i":99}'); // 旧的非钉住条目被淘汰
  });
});
