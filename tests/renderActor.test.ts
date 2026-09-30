// AGENTS「非当前玩家的选择器」硬规则门禁：UI 只能用 actorOf(state) 解析"行动者"，禁止用 activePlayer 取行动者的卡面/骰。
// 真实事故（2026-09-27）：L05「复仇之灵」在对方回合强制尘起 → dustFlowView 用 activePlayer 找神器 → 找不到 → 面板只剩「取消」。
import { describe, it, expect } from 'vitest';
import { setupGame } from '../src/core/engine/setup';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import type { Action, GameState } from '../src/core/model/types';

/** `src/ui/render.ts` 源码原文（Vite `?raw`，避免依赖 node 类型） */
const RAW = import.meta.glob('../src/ui/render.ts', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;
const RENDER_SRC = Object.values(RAW)[0] ?? '';

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

/** 渲染并捕获 UI 派发的动作（不真正执行引擎，只用于断言语义） */
const mount = (state: GameState): { root: HTMLElement; acts: Action[] } => {
  const root = document.createElement('div');
  const acts: Action[] = [];
  const hooks: RenderHooks = {
    onAction: (a) => {
      acts.push(a);
      renderGame(state, root, hooks);
    },
    ui: makeUi(),
    propose: () => {},
    requestRender: () => renderGame(state, root, hooks),
    onRestart: () => {},
  };
  renderGame(state, root, hooks);
  return { root, acts };
};

describe('UI「谁在做操作」门禁（源码扫描）', () => {
  it('render.ts 内 0 处「用当前回合玩家的卡面解析行动者」（players[…activePlayer].artifacts）', () => {
    expect(RENDER_SRC.length).toBeGreaterThan(0); // 确认读到了源码
    const hits = RENDER_SRC.match(/players\[[^\]]*activePlayer\]\.artifacts/g) ?? [];
    expect(hits).toEqual([]);
  });

  it('dustFlowView 的付款方/卡面按 actorOf 取（防"只剩取消"复现）', () => {
    expect(RENDER_SRC).toContain('const payer = ctx.state.players[actorOf(ctx.state)];');
  });
});

describe('L05「复仇之灵」· 非当前回合玩家的强制尘起（回归：面板只剩「取消」）', () => {
  it('点「激活「惩戒」（免费）」→ 出现两个侧按钮（净化 / 数罪并罚）→ 选侧派发免支付尘起', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L05', heroA: ['013', '014', '015'] });
    g.activePlayer = 'B'; // 当前回合是 B
    g.pending = { kind: 'fuchouRise', player: 'A' }; // 但被迫尘起的是 A（被攻击方）
    const { root, acts } = mount(g);

    const entries = Array.from(root.querySelectorAll('[data-fuchou="1"]')) as HTMLButtonElement[];
    // 强制尘起：三件神器都可选（由玩家任选一件）
    expect(entries.map((b) => b.dataset.artifact)).toEqual(['013', '014', '015']);
    const entry = entries.find((b) => b.dataset.artifact === '014')!;
    expect(entry.textContent).toContain('免费');
    expect(entry.textContent).toContain('惩戒');

    // 打开选侧步骤（修复前：找不到 A 的 014 → 面板只有「取消」）
    entry.click();
    const sideBtns = Array.from(root.querySelectorAll('.dustflow-side-btn')) as HTMLButtonElement[];
    expect(sideBtns.map((b) => b.textContent)).toEqual(['净化', '数罪并罚']);

    // 选左侧 → 免支付 + 强制尘起标记
    sideBtns[0].click();
    expect(acts).toEqual([{ t: 'dustRise', artifactId: '014', side: 'left', free: true, fuchou: true }]);
  });
});
