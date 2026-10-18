import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createChallengeGame, createGame } from '../src/core/engine/game';
import { fxReset, fxPush } from '../src/core/engine/fx';
import { renderGame, legendGoneList, type RenderHooks, type UiState } from '../src/ui/render';
import { DEFAULT_PREFS, clonePrefs } from '../src/ui/prefs';
import type { GameState, PendingAttack } from '../src/core/model/types';

/**
 * 回归（2026-10-18 真实事故）：挑战模式下骰子"飞出去攻击"会被隐藏；
 * 若这颗骰子随后被**搬回区域**（Z01「裁雨流」前 3 次命中 → 移入防御区），
 * 必须**解除隐藏**，否则区里有 4 颗、画面只显示 2 颗。
 */
const mount = (g: GameState, root: HTMLElement): void => {
  const ui: UiState = {
    rerollSelected: new Set(),
    selection: null,
    pendingConfirm: null,
    convertPick: null,
    fengmangPick: null,
    hanguangPick: null,
    quanzhi: null,
    dustFlow: null,
    prefs: clonePrefs(DEFAULT_PREFS),
    settingsOpen: false,
    logOpen: false,
    logPop: false,
    detail: null,
    error: null,
  };
  const hooks: RenderHooks = {
    ui,
    onAction: () => {},
    propose: () => {},
    requestRender: () => {},
    onRestart: () => {},
  };
  renderGame(g, root, hooks);
};

describe('挑战 · 飞出去的骰子被搬回区域 → 解除隐藏', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="app"></div>';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('攻击开始 → 藏；收到 move（搬进防御区）→ 重新显示', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z01', challenger: ['001', '002', '003'] });
    g.players.B.areas.attack = [{ id: 'bx', value: 5, kind: 'attack' }];
    g.players.B.areas.defense = [];
    fxReset();
    g.pendingAttack = {
      attacker: 'B',
      value: 5,
      baseValue: 5,
      unblockable: false,
      physical: false,
      sourceDieId: 'bx',
      dieStyle: 'solid',
    } as PendingAttack;

    const root = document.getElementById('app')!;
    mount(g, root);
    vi.advanceTimersByTime(50); // 开飞定时器 → 藏
    expect(root.querySelector('.area[data-kind="attack"] .die[data-id="bx"]')).toBeNull();

    // 结算：骰子被搬进防御区（裁雨流）
    g.pendingAttack = null;
    g.players.B.areas.attack = [];
    g.players.B.areas.defense = [{ id: 'bx', value: 5, kind: 'defense' }];
    fxPush({ kind: 'move', player: 'B', dieIds: ['bx'] });
    mount(g, root);
    expect(root.querySelector('.area[data-kind="defense"] .die[data-id="bx"]')).toBeTruthy();
  });

  it('迟到的隐藏定时器：攻击已结算（pendingAttack 清空）→ 不得隐藏骰子', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z01', challenger: ['001', '002', '003'] });
    g.players.B.areas.attack = [{ id: 'bx', value: 5, kind: 'attack' }];
    fxReset();
    g.pendingAttack = {
      attacker: 'B',
      value: 5,
      baseValue: 5,
      unblockable: false,
      physical: false,
      sourceDieId: 'bx',
      dieStyle: 'solid',
    } as PendingAttack;
    const root = document.getElementById('app')!;
    mount(g, root);
    // 结算先发生（攻击打完），定时器还没到点
    g.pendingAttack = null;
    vi.advanceTimersByTime(200);
    expect(root.querySelector('.area[data-kind="attack"] .die[data-id="bx"]')).toBeTruthy();
    expect(legendGoneList()).not.toContain('bx');
  });

  it('标准模式：攻击全程不进隐藏名单（挑战专属机制）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    g.players.A.areas.attack = [{ id: 'sx', value: 4, kind: 'attack' }];
    fxReset();
    g.pendingAttack = {
      attacker: 'A',
      value: 4,
      baseValue: 4,
      unblockable: false,
      physical: true,
      sourceDieId: 'sx',
    } as PendingAttack;
    const root = document.getElementById('app')!;
    mount(g, root);
    vi.advanceTimersByTime(200);
    expect(legendGoneList()).toEqual([]);
    expect(root.querySelector('.area[data-kind="attack"] .die[data-id="sx"]')).toBeTruthy();
  });
});
