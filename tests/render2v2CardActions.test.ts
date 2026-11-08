import { describe, it, expect } from 'vitest';
import { ARTIFACTS } from '../src/core/content/artifacts';
import { createTwoVTwoGame, getLegalActions } from '../src/core/engine/game';
import { render2v2Game } from '../src/ui/battle2v2View';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';

function setupWith(id: string): TwoVTwoSetup {
  return { seats: { A1: [id, '002', '003'], A2: ['004', '005', '006'], B1: ['007', '008', '009'], B2: ['010', '011', '012'] }, firstTeam: 'A', seed: 5 };
}

function prime(id: string) {
  const state = createTwoVTwoGame(setupWith(id));
  state.phase = 'main';
  state.activePlayer = 'A1';
  const art = state.players.A1.artifacts.find((a) => a.id === id)!;
  for (const s of art.skills) {
    if (!['activate', 'ultimate'].includes(s.kind)) continue;
    const side = s.side === 'only' ? 'left' : s.side;
    art.activeMarkerSide = side;
    art.armedSide = side;
    art.armedTurn = state.turnIndex;
  }
  art.count = 3;
  for (const kind of ['attack', 'defense', 'meditation'] as const) {
    state.players.A1.areas[kind] = Array.from({ length: 8 }, (_, i) => ({ id: `${id}-${kind}-${i}`, value: (i % 6) + 1, kind })) as never;
    state.players.B1.areas[kind] = Array.from({ length: 4 }, (_, i) => ({ id: `b1-${kind}-${i}`, value: (i % 6) + 1, kind })) as never;
    state.players.B2.areas[kind] = Array.from({ length: 4 }, (_, i) => ({ id: `b2-${kind}-${i}`, value: (i % 6) + 1, kind })) as never;
  }
  return state;
}

describe('2v2 全卡技能动作', () => {
  it('有合法技能动作的卡都能从界面点进下一步', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const failures: string[] = [];
    for (const id of Object.keys(ARTIFACTS)) {
      const state = prime(id);
      const legal = getLegalActions(state).filter((a) => a.t === 'skill' && a.artifactId === id);
      if (!legal.length) continue;
      const sent: string[] = [];
      render2v2Game(root, state, { onAction: (a) => sent.push(a.t), onBack: () => {} });
      const skill = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).find((b) => b.textContent?.includes('启动技能：') || b.textContent?.includes('发动必杀：') || b.textContent?.includes('结算「'));
      if (!skill) { failures.push(`${id}: no button`); continue; }
      skill.click();
      if (!root.querySelector('.selector, .option-row, .target-row, .confirm-row') && sent.length === 0) failures.push(`${id}: no path`);
    }
    expect(failures).toEqual([]);
  });
});
