import { describe, it, expect, vi } from 'vitest';
import { createGame, getLegalActions, skipInitialReroll } from '../src/core/engine/game';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import { DEFAULT_PREFS, clonePrefs } from '../src/ui/prefs';
import type { Action, GameState } from '../src/core/model/types';

/** 造一局：A 处于尘起阶段，且至少有一颗冥想骰（保证尘起支付可选）。 */
function setup() {
  const root = document.createElement('div');
  const state: GameState = createGame({ seed: 1, firstPlayer: 'A' });
  skipInitialReroll(state);
  state.players.A.areas.meditation.push({ id: 'test-md', value: 3, kind: 'meditation' });

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
  const onAction = vi.fn<(a: Action) => void>();
  const hooks: RenderHooks = {
    ui,
    onAction,
    propose: () => {},
    requestRender: () => renderGame(state, root, hooks),
    onRestart: () => {},
  };
  return { root, state, ui, hooks, onAction };
}

const diceVariantArtifact = (state: GameState): string => {
  const dust = getLegalActions(state).find(
    (a) => a.t === 'dustRise' && !a.useSeal && (a.costSlots?.length ?? 0) > 0,
  );
  if (!dust || dust.t !== 'dustRise') throw new Error('no dice dust variant');
  return dust.artifactId;
};

describe('尘起支付 · 骰区与骰片双入口（付款步开放、选侧步不开放）', () => {
  it('付款步：点骰区的冥想骰 → 直接触发尘起支付', () => {
    const { root, state, ui, hooks, onAction } = setup();
    const artifactId = diceVariantArtifact(state);
    ui.dustFlow = { artifactId, kind: 'switch', step: 'pay' };
    renderGame(state, root, hooks);

    const die = root.querySelector<HTMLElement>('.player--self .die[data-id="test-md"]')!;
    expect(die).not.toBeNull();
    expect(die.classList.contains('clickable')).toBe(true);

    die.click();
    expect(onAction).toHaveBeenCalledTimes(1);
    const a = onAction.mock.calls[0][0];
    expect(a.t).toBe('dustRise');
    if (a.t === 'dustRise') expect(a.costSlots?.[0].dieIds).toEqual(['test-md']);
  });

  it('选侧步：骰区不可点（仍只能用操作栏）', () => {
    const { root, state, ui, hooks } = setup();
    ui.dustFlow = { artifactId: state.players.A.artifacts[0].id, kind: 'activate', step: 'side' };
    renderGame(state, root, hooks);
    expect(root.querySelectorAll('.player--self .die.clickable').length).toBe(0);
  });

  it('付款步·真实之剑置换：点骰区两颗骰子 → 打包为一次尘起支付', () => {
    const { root, state, ui, hooks, onAction } = setup();
    const artifactId = diceVariantArtifact(state);
    ui.dustFlow = { artifactId, kind: 'switch', step: 'pay', convertPick: [] };
    renderGame(state, root, hooks);

    const first = Array.from(root.querySelectorAll<HTMLElement>('.player--self .die.clickable'));
    expect(first.length).toBeGreaterThanOrEqual(2);
    first[0].click();
    expect(onAction).toHaveBeenCalledTimes(0); // 只选第一颗 → 不派发

    const second = Array.from(root.querySelectorAll<HTMLElement>('.player--self .die.clickable'));
    second[1].click();
    expect(onAction).toHaveBeenCalledTimes(1);
    const a = onAction.mock.calls[0][0];
    expect(a.t).toBe('dustRise');
    if (a.t === 'dustRise') expect(a.costSlots?.[0].dieIds).toHaveLength(2);
  });
});
