import { describe, it, expect } from 'vitest';
import {
  createGame,
  createChallengeGame,
  skipInitialReroll,
  getLegalActions as legal,
} from '../src/core/engine/game';
import { logLine } from '../src/core/engine/log';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import { toMain } from './helpers';
import type { Action, GameState } from '../src/core/model/types';

/** 挂载并记录"派发 / 提出确认"两类回调（③ 用）。 */
const mount = (
  state: GameState,
): { root: HTMLElement; ui: UiState; dispatched: Action[]; proposed: { action: Action; label: string }[] } => {
  const root = document.createElement('div');
  const ui: UiState = {
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
  };
  const dispatched: Action[] = [];
  const proposed: { action: Action; label: string }[] = [];
  const hooks: RenderHooks = {
    onAction: (a) => dispatched.push(a),
    ui,
    propose: (action, label) => {
      proposed.push({ action, label });
      ui.pendingConfirm = { action, label };
      renderGame(state, root, hooks);
    },
    requestRender: () => renderGame(state, root, hooks),
    onRestart: () => {},
  };
  renderGame(state, root, hooks);
  return { root, ui, dispatched, proposed };
};

const stdGame = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
  skipInitialReroll(g);
  toMain(g);
  return g;
};

describe('① 战报上色（界面层；引擎 text 不变）', () => {
  it('身份词上色：玩家A 蓝；挑战模式传奇卡名「黑枪」红', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z08', challenger: ['001', '002', '003'] });
    g.log.length = 0;
    logLine(g, '玩家A 的回合开始');
    logLine(g, '「黑枪」：回合开始');
    const { root } = mount(g);
    const lines = Array.from(root.querySelectorAll('.log-line'));
    // 最新在上：line0 = 「黑枪」…，line1 = 玩家A…
    expect(lines[0].querySelector('.log-actor.player-B')?.textContent).toBe('「黑枪」');
    expect(lines[1].querySelector('.log-actor.player-A')?.textContent).toBe('玩家A');
  });

  it('「…」技能名按"最近前身份词"上色：挑战者的「填弹」染蓝（与传奇同名也不串）', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z08', challenger: ['001', '002', '003'] });
    g.log.length = 0;
    logLine(g, '玩家A 发动「填弹」：…');
    logLine(g, '「黑枪」：填弹 — 点数最高的驱动骰 5 移入攻击骰区');
    const { root } = mount(g);
    // 最新在上 → [0] = 「黑枪」行，[1] = 玩家A 行
    const [lB, lA] = Array.from(root.querySelectorAll('.log-line'));
    // 挑战者的「填弹」（玩家A 发动）→ 蓝
    expect(lA.querySelector('.log-skill.player-A')?.textContent).toBe('「填弹」');
    expect(lA.querySelector('.log-skill.player-B')).toBeNull();
    // 传奇行（「黑枪」：填弹 …）→ 「黑枪」红 + 裸技能名"填弹"红
    expect(lB.querySelector('.log-actor.player-B')?.textContent).toBe('「黑枪」');
    expect(lB.querySelector('.log-skill.player-B')?.textContent).toBe('填弹');
  });

  it('行业务文本不变（textContent 仍等于"前缀 + 原文"）', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z08', challenger: ['001', '002', '003'] });
    g.log.length = 0;
    g.turnIndex = 3;
    g.phase = 'main';
    logLine(g, '玩家A 的回合开始');
    const { root } = mount(g);
    expect(root.querySelector('.log-line')!.textContent).toBe('T3·主要：玩家A 的回合开始');
  });
});

describe('③「不抵挡」无骰可挡时一键直发', () => {
  const blockState = (withDie: boolean): GameState => {
    const g = stdGame();
    g.players.A.areas = {
      attack: [],
      defense: withDie ? [{ id: 'd1', value: 5, kind: 'defense' }] : [],
      meditation: [],
    };
    g.pendingAttack = { attacker: 'B', value: 5, baseValue: 5, unblockable: false, physical: true };
    return g;
  };

  it('无骰可挡：只有「不抵挡」→ 点一下直接派发（不弹确认条）', () => {
    const g = blockState(false);
    expect(legal(g).filter((a) => a.t === 'block')).toHaveLength(1); // 仅"不抵挡"
    const { root, dispatched, proposed } = mount(g);
    const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).find(
      (b) => b.textContent === '不抵挡',
    );
    expect(btn).toBeTruthy();
    btn!.click();
    expect(proposed).toHaveLength(0); // 没弹确认
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].t).toBe('block');
  });

  it('有骰可挡：点「不抵挡」仍走确认条', () => {
    const g = blockState(true);
    expect(legal(g).filter((a) => a.t === 'block').length).toBeGreaterThan(1); // 有"用骰抵挡"选项
    const { root, dispatched, proposed } = mount(g);
    const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).find(
      (b) => b.textContent === '不抵挡',
    );
    expect(btn).toBeTruthy();
    btn!.click();
    expect(dispatched).toHaveLength(0); // 未直发
    expect(proposed).toHaveLength(1); // 弹确认条
  });
});

describe('④ 胜利弹窗 / 胜者提示 · 玩家色', () => {
  it('标准局：胜者 B → `.player-B` 上色', () => {
    const g = stdGame();
    g.phase = 'gameOver';
    g.winner = 'B';
    const { root } = mount(g);
    const span = root.querySelector('.gameover-winner .player-B');
    expect(span?.textContent).toBe('玩家B 获胜！');
    expect(root.querySelector('.gameover-winner .player-A')).toBeNull();
  });

  it('挑战局：胜者＝传奇 → 显示"昔日传奇"且染红（界面口径）', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z08', challenger: ['001', '002', '003'] });
    g.phase = 'gameOver';
    g.winner = 'B';
    const { root } = mount(g);
    const span = root.querySelector('.gameover-winner .player-B');
    expect(span?.textContent).toBe('昔日传奇 获胜！');
  });

  it('游戏结束提示栏：显示名 + 上色（不再写内部 id A/B）', () => {
    const g = stdGame();
    g.phase = 'gameOver';
    g.winner = 'A';
    const { root } = mount(g);
    const hint = root.querySelector('.hint-phase .hint-skill.player-A');
    expect(hint?.textContent).toBe('玩家A');
    expect(root.querySelector('.hint-phase')!.textContent).not.toContain('胜者：A');
  });
});
