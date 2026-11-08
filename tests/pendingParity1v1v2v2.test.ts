// 1v1 / 2v2 待决策界面的 **parity 门禁**（2026-11-08 用户要求，防复发）。
//
// 背景：2v2 曾自己手写了一套待决策文案与面板（`「高塔铁幕」：消耗 1 个防御骰取消真实伤害` / `不取消`），
// 与 1v1 的 `发动「高塔铁幕」取消（消耗 防N）` / `不发动「高塔铁幕」` 不一致；按钮顺序也不同。
// 用户要求：**这种"按钮样式/文字/顺序/换行"的差异以后不许再出现** → 用这条测试锁死。
//
// 口径：
//   - 同一局面分别用 1v1（`renderGame`）与 2v2（`render2v2Game`）渲染；
//   - 断言 `.actionlist` 里的按钮/骰片 **文字 + class + 顺序 + 数量** 完全一致；
//   - 断言提示栏 `.hint-phase` 文本完全一致；
//   - 唯一允许的差异：座位名归一化（`玩家A1` → `玩家A`、`die-A2` → `die-A`）。
//   - 2v2 的「纯选对象型待决策」是**刻意的 2v2 形状**（`目标 [B1][B2][不发动]`，见 AGENTS 第 18 条）→ 不在本门禁内。
import { describe, it, expect } from 'vitest';
import { createGame, createTwoVTwoGame, skipInitialReroll } from '../src/core/engine/game';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import { render2v2Game } from '../src/ui/battle2v2View';
import type { Action, GameState } from '../src/core/model/types';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';
import { toMain } from './helpers';

const freshUi = (): UiState => ({
  rerollSelected: new Set(),
  selection: null,
  pendingConfirm: null,
  convertPick: null,
  fengmangPick: null,
  hanguangPick: null,
  quanzhi: null,
  dustFlow: null,
  prefs: {
    showSkillText: false,
    cardArt: 'thumb',
    density: 'compact',
    mirrorEnemy: false,
    preset: 'desktop',
    logCollapsed: false,
    zoomMode: 'off',
    zoomPercent: 90,
  },
  settingsOpen: false,
  logOpen: false,
  logPop: false,
  detail: null,
  error: null,
});

const hooksFor = (): RenderHooks => {
  const ui = freshUi();
  return {
    onAction: (_a: Action) => {},
    ui,
    propose: (action, label) => {
      ui.pendingConfirm = { action, label };
    },
    requestRender: () => {},
    onRestart: () => {},
  };
};

/** 座位名 / class 归一化：2v2 的 A1/A2/B1/B2 → A/B（其余字符必须逐字相同） */
const norm = (s: string): string =>
  s
    .replace(/玩家([AB])[12]/g, '玩家$1')
    .replace(/\b(die|player|bg|option-btn|hint-skill)-([AB])[12]\b/g, '$1-$2');

const snapshot = (root: HTMLElement) => {
  const items = Array.from(
    root.querySelectorAll<HTMLElement>('.actionlist button, .actionlist .pay-die'),
  ).map((el) => ({
    text: norm((el.textContent ?? '').replace(/\s+/g, ' ').trim()),
    cls: norm(el.className),
  }));
  const hint = norm((root.querySelector('.hint-phase')?.textContent ?? '').replace(/\s+/g, ' ').trim());
  return { items, hint };
};

const mount1v1 = (g: GameState): HTMLElement => {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  renderGame(g, root, hooksFor());
  return root;
};

const mount2v2 = (g: GameState): HTMLElement => {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  render2v2Game(root, g, { onAction: (_a) => {}, onBack: () => {} });
  return root;
};

type Seats3 = [string, string, string];

const game1v1 = (heroA: Seats3, heroB: Seats3): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: [...heroA], heroB: [...heroB] });
  skipInitialReroll(g);
  toMain(g);
  return g;
};

const setup2v2 = (a1: Seats3, b1: Seats3): TwoVTwoSetup => ({
  seats: {
    A1: a1,
    A2: ['002', '003', '005'],
    B1: b1,
    B2: ['007', '008', '006'],
  },
  firstTeam: 'A',
  seed: 7,
  dice: {
    A1: { attack: [3], defense: [2], meditation: [5] },
    B1: { attack: [], defense: [2], meditation: [5] },
    B2: { attack: [], defense: [], meditation: [] },
  },
});

const game2v2 = (a1: Seats3, b1: Seats3): GameState => {
  const g = createTwoVTwoGame(setup2v2(a1, b1));
  g.phase = 'main';
  g.activePlayer = 'A1';
  return g;
};

describe('待决策界面 parity（1v1 ≡ 2v2，只允许座位名归一化）', () => {
  it('009 高塔铁幕：骰片行 + 不发动 的文案/class/顺序一致；提示栏一致（含来源句）', () => {
    const g1 = game1v1(['004', '002', '003'], ['009', '002', '003']);
    g1.players.B.areas.defense = [{ id: 'b-d', value: 6, kind: 'defense' }];
    g1.pending = {
      kind: 'guwangCancel',
      player: 'B',
      amount: 5,
      source: 'A',
      sourceCard: { player: 'A', artifactId: '004', side: 'right', skillKey: 'buxiang.fengmang.trigger' },
    } as never;

    const g2 = game2v2(['004', '010', '011'], ['009', '001', '003']);
    g2.players.B1.areas.defense = [{ id: 'b-d', value: 6, kind: 'defense' }];
    g2.pending = {
      kind: 'guwangCancel',
      player: 'B1',
      amount: 5,
      source: 'A1',
      sourceCard: { player: 'A1', artifactId: '004', side: 'right', skillKey: 'buxiang.fengmang.trigger' },
    } as never;

    const v1 = snapshot(mount1v1(g1));
    const v2 = snapshot(mount2v2(g2));
    expect(v2.items).toEqual(v1.items);
    expect(v2.hint).toEqual(v1.hint);
    // 具体文案（防止两边一起写错）：1v1 是唯一来源
    expect(v1.items[0]?.text).toBe('防6');
    expect(v1.items.some((x) => x.text === '不发动「高塔铁幕」')).toBe(true);
    expect(v1.hint).toContain('玩家A 发动「锋芒」，对你造成 5 点真实伤害；高塔铁幕：可消耗 1 个防御骰取消。');
  });

  it('011 灵能屏障：骰片行 + 不发动 的文案/class/顺序一致；提示栏一致（含"这一刀"）', () => {
    const g1 = game1v1(['001', '002', '003'], ['011', '002', '003']);
    g1.players.B.areas.meditation = [{ id: 'b-m', value: 5, kind: 'meditation' }];
    g1.pending = { kind: 'dunwuHalve', player: 'B' } as never;

    const g2 = game2v2(['001', '010', '012'], ['011', '001', '003']);
    g2.players.B1.areas.meditation = [{ id: 'b-m', value: 5, kind: 'meditation' }];
    g2.pending = { kind: 'dunwuHalve', player: 'B1' } as never;

    const v1 = snapshot(mount1v1(g1));
    const v2 = snapshot(mount2v2(g2));
    expect(v2.items).toEqual(v1.items);
    expect(v2.hint).toEqual(v1.hint);
    expect(v1.items[0]?.text).toBe('冥5');
    expect(v1.items.some((x) => x.text === '不发动「灵能屏障」')).toBe(true);
  });

  it('锋芒：按钮**顺序**一致（发动在前、不发动在后），且不泄漏组合按钮', () => {
    const g1 = game1v1(['004', '002', '003'], ['001', '002', '003']);
    g1.players.A.areas.attack = [{ id: 'a-atk', value: 3, kind: 'attack' }];
    g1.players.A.areas.meditation = [{ id: 'a-med', value: 4, kind: 'meditation' }];
    g1.pending = { kind: 'fengmang', player: 'A', defenderId: 'B', value: 3 } as never;

    const g2 = game2v2(['004', '010', '011'], ['001', '002', '003']);
    g2.players.A1.areas.attack = [{ id: 'a-atk', value: 3, kind: 'attack' }];
    g2.players.A1.areas.meditation = [{ id: 'a-med', value: 4, kind: 'meditation' }];
    g2.pending = { kind: 'fengmang', player: 'A1', defenderId: 'B1', value: 3 } as never;

    const v1 = snapshot(mount1v1(g1));
    const v2 = snapshot(mount2v2(g2));
    expect(v2.items).toEqual(v1.items);
    expect(v1.items.map((x) => x.text)).toEqual(['发动「锋芒」', '不发动']);
  });
});
