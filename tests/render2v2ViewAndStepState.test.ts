// 2v2 对齐 1v1：**视角归属**与「进行中的操作」跨重建存活（2026-11-07）。
//
// 用户反馈：
//   ① 009 高塔铁幕·触发 / 011 灵能屏障 待决策时"没有视觉转换"；
//   ② 点了目标后确认条会"一闪就没了"（"点了没反应"的根因候选）。
//
// 口径（1v1 唯一真源）：
//   - `viewOwnerOf = actorOf` → **待决策人 → 防守方 → 回合玩家**；2v2 要映射到"队"。
//   - 1v1 的 `ui` 存在 `main.ts` 上（跨整页重建）；2v2 的步骤状态同样必须持久，
//     否则任何一次重建（换视角）都会清掉确认条 / 向导 / 投票。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTwoVTwoGame } from '../src/core/engine/game';
import { render2v2Game } from '../src/ui/battle2v2View';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';
import type { GameState } from '../src/core/model/types';
import { setDiagEnabled } from '../src/ui/diag';

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

const mount = (g: GameState, seen: unknown[] = []) => {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  render2v2Game(root, g, { onAction: (a) => seen.push(a as never), onBack: () => {} });
  return root;
};

/** 屏幕上的座位顺序：先上排（两人），后下排（两人）。 */
const seatOrder = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll<HTMLElement>('.main > .side-row .player[data-player]')).map(
    (p) => p.dataset.player ?? '',
  );

beforeEach(() => setDiagEnabled(false));
afterEach(() => setDiagEnabled(false));

describe('2v2 视角归属 = 决策人那一队（与 1v1 的 actorOf 同口径）', () => {
  it('无待决策：回合玩家(A1)在下方 → 上排 B、下排 A', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    expect(seatOrder(mount(g))).toEqual(['B1', 'B2', 'A2', 'A1']);
  });

  it('011 灵能屏障（dunwuHalve）由**防守方 B1** 决策 → 视角切到 B 队（B 在下方）', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.pending = { kind: 'dunwuHalve', player: 'B1' } as never;
    expect(seatOrder(mount(g))).toEqual(['A2', 'A1', 'B1', 'B2']);
  });

  it('009 高塔铁幕（guwangCancel）由**挨真伤的座位 B2** 决策 → 视角切到 B 队', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.pending = { kind: 'guwangCancel', player: 'B2', amount: 3 } as never;
    expect(seatOrder(mount(g))).toEqual(['A2', 'A1', 'B1', 'B2']);
  });

  it('待决策属于**当前行动队自己** → 不翻转（A 仍在下方）', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.pending = { kind: 'shenhongKill', player: 'A1' } as never;
    expect(seatOrder(mount(g))).toEqual(['B1', 'B2', 'A2', 'A1']);
  });

  it('待抵挡（pendingAttack.defender）→ 视角切到防守方（与 1v1 一致）', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.pendingAttack = {
      attacker: 'A1',
      defender: 'B2',
      value: 3,
      baseValue: 3,
      physical: true,
      unblockable: false,
    } as never;
    expect(seatOrder(mount(g))).toEqual(['A2', 'A1', 'B1', 'B2']);
  });
});

describe('2v2「进行中的操作」必须跨整页重建存活（与 1v1 的 ui 同构）', () => {
  it('确认条：点目标 → 整页重建 → 确认条仍在 → 点「确定」能派发', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    g.pending = { kind: 'shenhongKill', player: 'A1' } as never;
    const seen: unknown[] = [];
    const root = mount(g, seen);

    root.querySelector<HTMLElement>('.option-row--decide [data-choice="B1"]')!.click();
    expect(root.querySelector('.confirm-row')).not.toBeNull();

    // 模拟"换视角那一帧"的整页重建（同一 state、同一 root）
    render2v2Game(root, g, { onAction: (a) => seen.push(a as never), onBack: () => {} });

    const ok = root.querySelector<HTMLElement>('.confirm-row [data-act="confirm"]');
    expect(ok).not.toBeNull();
    ok!.click();
    expect(seen).toHaveLength(1);
    expect((seen[0] as { t: string }).t).toBe('shenhongKill');
    // 派发后必须清空：重建不会再"复活"旧确认条
    render2v2Game(root, g, { onAction: (a) => seen.push(a as never), onBack: () => {} });
    expect(root.querySelector('.confirm-row')).toBeNull();
  });

  it('选目标：点攻击骰 → 目标行出现 → 整页重建后**目标行仍在**（不会退回"未选骰"）', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    const root = mount(g);
    const chip = root.querySelector<HTMLElement>('[data-act="attack"]');
    expect(chip).not.toBeNull();
    chip!.click();
    const targets = () =>
      Array.from(root.querySelectorAll<HTMLElement>('.option-row .b2v2-target')).map(
        (b) => b.dataset.choice,
      );
    expect(targets()).toEqual(['B1', 'B2']);

    render2v2Game(root, g, { onAction: () => {}, onBack: () => {} });
    expect(targets()).toEqual(['B1', 'B2']);
  });
});
