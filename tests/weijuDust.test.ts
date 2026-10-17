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

describe('023 畏惧 · 「对手没有能力骰 → 不可发动」＝不生成入口（全模式）', () => {
  it('引擎：对手无能力骰 → 尘起候选里没有「畏惧」侧；有骰则有（「共振」恒在）', () => {
    const g = atDustRise();
    expect(g.phase).toBe('dustRise');
    g.players.A.areas.meditation = [{ id: 'aM', value: 3, kind: 'meditation' }]; // 保证有冥想骰可支付
    // 对手有 1 颗能力骰 → 畏惧可出现
    g.players.B.areas.attack = [{ id: 'bA', value: 2, kind: 'attack' }];
    expect(weijuSides(g)).toContain('left');
    expect(weijuSides(g)).toContain('right');
    // 对手一颗能力骰都没有 → 畏惧不再出现，共振照旧
    g.players.B.areas.attack = [];
    g.players.B.areas.defense = [];
    g.players.B.areas.meditation = [];
    const sides = weijuSides(g);
    expect(sides).not.toContain('left');
    expect(sides).toContain('right');
  });

  it('界面：尘起"选侧"步骤在对手无骰时只渲染「共振」按钮', () => {
    const g = atDustRise();
    g.players.A.areas.meditation = [{ id: 'aM', value: 3, kind: 'meditation' }];
    g.players.B.areas.attack = [];
    g.players.B.areas.defense = [];
    g.players.B.areas.meditation = [];

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
    expect(labels).toEqual(['共振']);
  });
});
