// 2v2「生命变化抖动」门禁。
// 真实事故（用户 2026-11-07 报）：2v2 触发 010「杀意」造成 3 点真实伤害时**没有伤害抖动**。
// 原因：抖动要先找到"该抖哪块面板"——1v1 按 `.player[data-player="A"]` 精确找；
//       2v2 的面板是座位（A1/A2），`A` 找不到 → panels 为空 → 跳过抖动。
//       攻击帧走 2v2 专用分支（传了队伍映射）所以会抖；**非攻击的生命变化**走通用分支，
//       `runBoardMotions` 没有映射 → 不抖。
import { describe, it, expect } from 'vitest';
import { setupGame } from '../src/core/engine/setup';
import { applyAction, createTwoVTwoGame } from '../src/core/engine/game';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import { render2v2Game } from '../src/ui/battle2v2View';
import { lifeFloatPanelsFor } from '../src/ui/motion';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';
import type { GameState } from '../src/core/model/types';

const RAW = import.meta.glob('../src/ui/{battle2v2View,render,motion}.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const srcOf = (name: string): string =>
  Object.entries(RAW).find(([k]) => k.endsWith(`/${name}.ts`))?.[1] ?? '';

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
    A1: { attack: [3, 4], defense: [], meditation: [] },
    B1: { attack: [], defense: [], meditation: [] },
    B2: { attack: [], defense: [], meditation: [] },
  },
});

const mount2v2 = (g: GameState): HTMLElement => {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  render2v2Game(root, g, { onAction: () => {}, onBack: () => {} });
  return root;
};

const makeUi = (): UiState => ({
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

const mount1v1 = (g: GameState): HTMLElement => {
  const root = document.createElement('div');
  const hooks: RenderHooks = {
    onAction: () => {},
    ui: makeUi(),
    propose: () => {},
    requestRender: () => {},
    onRestart: () => {},
  };
  renderGame(g, root, hooks);
  return root;
};

const teamPanels = (root: HTMLElement) => (team: string): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(`.player[data-player^="${team}"]`));

describe('2v2 生命变化 → 伤害抖动（010 杀意真伤等非攻击生命下降）', () => {
  it('2v2：A 队生命变化能定位到 A1 + A2 两块面板（抖动的成败点）', () => {
    const root = mount2v2(createTwoVTwoGame(setup()));
    const a = lifeFloatPanelsFor(root, 'A', teamPanels(root));
    const b = lifeFloatPanelsFor(root, 'B', teamPanels(root));
    // 顺序＝DOM 视觉顺序（镜像摆放会颠倒），断言精确集合
    expect(a.map((p) => p.dataset.player).sort()).toEqual(['A1', 'A2']);
    expect(b.map((p) => p.dataset.player).sort()).toEqual(['B1', 'B2']);
  });

  it('2v2：不传队伍映射时精确匹配 `.player[data-player="A"]` → 空（这就是原来的 bug）', () => {
    const root = mount2v2(createTwoVTwoGame(setup()));
    expect(lifeFloatPanelsFor(root, 'A')).toEqual([]);
    expect(lifeFloatPanelsFor(root, 'B')).toEqual([]);
  });

  it('1v1：缺省仍按 `.player[data-player="A"]` 定位唯一面板（行为不变）', () => {
    const root = mount1v1(setupGame({ seed: 1, firstPlayer: 'A' }));
    expect(lifeFloatPanelsFor(root, 'A').map((p) => p.dataset.player)).toEqual(['A']);
    expect(lifeFloatPanelsFor(root, 'B').map((p) => p.dataset.player)).toEqual(['B']);
  });

  it('2v2：队伍生命条带 `data-player=队名`（浮字/血条动画的锚点）', () => {
    const root = mount2v2(createTwoVTwoGame(setup()));
    const line = root.querySelector<HTMLElement>('.lifeline[data-player="A"]');
    expect(line).not.toBeNull();
    expect(line!.textContent).toContain('生命');
  });

  it('010 杀意：引擎真的造成 3 点真伤（非攻击帧的生命变化源头）', () => {
    const g = createTwoVTwoGame(setup());
    g.phase = 'main';
    g.activePlayer = 'A1';
    const art = g.players.A1.artifacts.find((a) => a.id === '010')!;
    art.activeMarkerSide = 'right';
    g.pending = { kind: 'shenhongKill', player: 'A1' } as never;
    const before = g.teams!.B.life;
    applyAction(g, { t: 'shenhongKill', accept: true, target: 'B1' } as never);
    expect(g.teams!.B.life).toBe(before - 3);
    expect(g.pendingAttack).toBeFalsy(); // 非攻击 → 走通用生命动画分支
  });

  it('接线：2v2 两处生命动画都走同一个队伍映射；motion 把映射转发给 playLifeFloats', () => {
    const view = srcOf('battle2v2View').replace(/\r\n/g, '\n');
    const motion = srcOf('motion').replace(/\r\n/g, '\n');
    // 唯一来源：映射函数只定义一次，攻击帧 + 通用帧各用一次
    expect(view.match(/function teamPanelsOf2v2\(/g)).toHaveLength(1);
    expect(view.match(/teamPanelsOf2v2\(root\)/g)).toHaveLength(2);
    // 通用帧必须把映射交给 runBoardMotions（否则非攻击生命变化不抖）
    expect(view).toMatch(/new Set\(\),\s*true,\s*teamPanelsOf2v2\(root\),\s*\);/);
    // motion：runBoardMotions → playLifeFloats 必须转发
    expect(motion).toContain('playLifeFloats(root, layer0, lifeDeltas, removalDur, lifePanelsOf)');
  });
});
