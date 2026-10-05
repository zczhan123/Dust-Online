import { describe, it, expect } from 'vitest';
import { applyAction, createGame, skipInitialReroll } from '../src/core/engine/game';
import { pumpAttackQueue } from '../src/core/engine/combat';
import { fxTake } from '../src/core/engine/fx';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import { DEFAULT_PREFS, clonePrefs } from '../src/ui/prefs';
import type { GameState } from '../src/core/model/types';

/** 造一局：A 处于主阶段，且 attackQueue 里排着 2、3 两段（模拟 013 电刑的多段攻击）。 */
function multiAttackState(): GameState {
  const g = createGame({ seed: 1, firstPlayer: 'A' });
  skipInitialReroll(g);
  g.players.B.areas.defense.push({ id: 'bdef', value: 4, kind: 'defense' });
  g.attackQueue = { player: 'A', values: [2, 3] };
  pumpAttackQueue(g); // → 第 1 段（2 点）
  return g;
}

function mount(state: GameState) {
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
    requestRender: () => renderGame(state, root, hooks),
    onRestart: () => {},
  };
  return { root, hooks };
}

describe('多段攻击（虚拟骰）· 中间段"被抵挡"收尾不被吞', () => {
  it('根因：抵挡第 1 段的**同一个动作**里就 pump 出第 2 段（block 事件 + 新 pendingAttack 同帧）', () => {
    const g = multiAttackState();
    expect(g.pendingAttack?.value).toBe(2);
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['bdef'] }] });
    // 同一帧里：既有"本次抵挡"事件，又已起下一段（旧 UI 只认 !pa 的"解决"→ 会漏播并排消失）
    expect(fxTake().some((e) => e.kind === 'block' && e.player === 'B')).toBe(true);
    expect(g.pendingAttack?.value).toBe(3);
  });

  it('渲染"解决+新段"同帧（prevPA=上一段、pa=下一段）不抛错', () => {
    const g = multiAttackState();
    const { root, hooks } = mount(g);
    renderGame(g, root, hooks); // 让 lastAttack 记住第 1 段
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['bdef'] }] }); // 解决第 1 段 + 起第 2 段
    expect(() => renderGame(g, root, hooks)).not.toThrow();
  });
});
