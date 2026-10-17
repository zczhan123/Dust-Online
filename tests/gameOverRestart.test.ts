import { describe, it, expect, vi } from 'vitest';
import { createGame, createChallengeGame } from '../src/core/engine/game';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import { DEFAULT_PREFS, clonePrefs } from '../src/ui/prefs';
import type { GameState } from '../src/core/model/types';

function baseUi(): UiState {
  return {
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
}

/** 造一局"已结束"的对局（弹窗由 `phase==='gameOver'` 触发）。 */
function mountOver(
  g: GameState,
  opts: { onRestartSame?: () => void; online?: RenderHooks['online'] } = {},
): { root: HTMLElement; onRestartSame: ReturnType<typeof vi.fn> } {
  g.phase = 'gameOver';
  g.winner = 'A';
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const ui = baseUi();
  const onRestartSame = vi.fn(opts.onRestartSame);
  const hooks: RenderHooks = {
    ui,
    onAction: vi.fn(),
    propose: () => {},
    requestRender: () => {},
    onRestart: vi.fn(),
    onRestartSame,
    online: opts.online,
  };
  renderGame(g, root, hooks);
  return { root, onRestartSame };
}

const std = (): GameState =>
  createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });

describe('胜者弹窗 · 「相同配置快速重开」（仅左右互搏）', () => {
  it('标准（左右互搏）：有该按钮；点击 → 触发钩子', () => {
    const { root, onRestartSame } = mountOver(std());
    const b = root.querySelector('.gameover-restart-same') as HTMLElement;
    expect(b).not.toBeNull();
    expect(b.textContent).toBe('相同配置快速重开');
    b.click();
    expect(onRestartSame).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.gameover-restart')).not.toBeNull(); // 原「重新开始游戏」仍在
  });

  it('挑战（左右互搏）：同样有该按钮，且在「重新开始游戏」之后', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });
    const { root } = mountOver(g);
    const labels = Array.from(root.querySelectorAll('.gameover-foot .btn')).map((n) => n.textContent);
    expect(labels).toEqual(['重新开始游戏', '相同配置快速重开']);
  });

  it('联机：**没有**该按钮（避免两个真人各点各的），但仍保留「回大厅」', () => {
    const { root } = mountOver(std(), {
      online: {
        myPlayer: 'A',
        names: { A: '甲', B: '乙' },
        onLeaveLobby: () => {},
        peerOnline: true,
      },
    });
    expect(root.querySelector('.gameover-restart-same')).toBeNull();
    expect(root.querySelector('.gameover-lobby')).not.toBeNull();
  });

  it('宿主未提供钩子：不显示该按钮（不报错）', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const g = std();
    g.phase = 'gameOver';
    g.winner = 'A';
    const hooks: RenderHooks = {
      ui: baseUi(),
      onAction: vi.fn(),
      propose: () => {},
      requestRender: () => {},
      onRestart: vi.fn(),
    };
    renderGame(g, root, hooks);
    expect(root.querySelector('.gameover-restart-same')).toBeNull();
    expect(root.querySelector('.gameover-restart')).not.toBeNull();
  });
});
