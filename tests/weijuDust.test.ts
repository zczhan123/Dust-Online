import { describe, it, expect, vi } from 'vitest';
import { applyAction, createGame, getLegalActions, skipInitialReroll } from '../src/core/engine/game';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import { DEFAULT_PREFS, clonePrefs } from '../src/ui/prefs';
import type { GameState } from '../src/core/model/types';

/** A 持 022/023/024（含 023「畏惧」）→ 推进到 A 的**尘起阶段**（首回合＝尘起、无重掷）。 */
function atDustRise(): GameState {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['022', '023', '024'], heroB: ['004', '005', '006'] });
  skipInitialReroll(g);
  let guard = 0;
  while (g.phase !== 'dustRise' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
  return g;
}

/** 023 在尘起候选里出现的"侧"（畏惧＝left / 共振＝right）。 */
function weijuSides(g: GameState): string[] {
  return getLegalActions(g)
    .filter((a) => a.t === 'dustRise' && a.artifactId === '023' && a.side != null)
    .map((a) => (a as { side: string }).side);
}

/** 023 的「使用」动作出现的"侧"。 */
function skillSides(g: GameState): string[] {
  return getLegalActions(g)
    .filter((a) => a.t === 'skill' && a.artifactId === '023')
    .map((a) => (a as { side: string }).side);
}

/** 把 023 装填到「畏惧」（left）侧，并进入主要阶段（用于测"使用"）。 */
function armWeiju(g: GameState): void {
  const a = g.players.A.artifacts.find((x) => x.id === '023')!;
  a.activeMarkerSide = 'left';
  a.armedSide = 'left';
  a.armedTurn = g.turnIndex;
  g.phase = 'main';
}

const clearB = (g: GameState): void => {
  g.players.B.areas.attack = [];
  g.players.B.areas.defense = [];
  g.players.B.areas.meditation = [];
};

describe('023 畏惧 · 对手无骰：**可激活、不可使用**（全模式）', () => {
  it('尘起：对手无骰时「畏惧 / 共振」两侧都能切（激活不受限）', () => {
    const g = atDustRise();
    expect(g.phase).toBe('dustRise');
    g.players.A.areas.meditation = [{ id: 'aM', value: 3, kind: 'meditation' }];
    clearB(g);
    expect(weijuSides(g)).toEqual(expect.arrayContaining(['left', 'right']));
  });

  it('使用：对手无骰 → **没有「畏惧」的使用动作**（共振照旧）', () => {
    const g = atDustRise();
    g.players.A.areas.meditation = [{ id: 'aM', value: 3, kind: 'meditation' }];
    clearB(g);
    armWeiju(g);
    // 023 此时装在「畏惧」（left）侧 → 只有左侧技能处于激活态；对手无骰 → 连左侧的使用动作也不给
    expect(skillSides(g)).toEqual([]);
  });

  it('使用：对手有骰 → 「畏惧」的使用动作出现', () => {
    const g = atDustRise();
    g.players.A.areas.meditation = [{ id: 'aM', value: 3, kind: 'meditation' }];
    clearB(g);
    g.players.B.areas.attack = [{ id: 'bA', value: 2, kind: 'attack' }];
    armWeiju(g);
    expect(skillSides(g)).toContain('left');
  });

  it('界面：尘起"选侧"步骤在对手无骰时**两个按钮都渲染**', () => {
    const g = atDustRise();
    g.players.A.areas.meditation = [{ id: 'aM', value: 3, kind: 'meditation' }];
    clearB(g);

    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const ui: UiState = {
      rerollSelected: new Set(),
      selection: null,
      pendingConfirm: null,
      convertPick: null,
      fengmangPick: null,
      hanguangPick: null,
      quanzhi: null,
      dustFlow: { artifactId: '023', kind: 'activate', step: 'side' },
      prefs: clonePrefs(DEFAULT_PREFS),
      settingsOpen: false,
      logOpen: false,
      logPop: false,
      detail: null,
      error: null,
    };
    const hooks: RenderHooks = {
      ui,
      onAction: vi.fn(),
      propose: () => {},
      requestRender: () => renderGame(g, root, hooks),
      onRestart: () => {},
    };
    renderGame(g, root, hooks);
    const labels = Array.from(root.querySelectorAll('.dustflow-side .dustflow-side-btn')).map((b) => b.textContent);
    expect(labels).toHaveLength(2);
    expect(labels.join('')).toContain('畏惧');
    expect(labels.join('')).toContain('共振');
  });
});
