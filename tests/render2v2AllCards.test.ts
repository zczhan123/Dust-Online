import { describe, it, expect } from 'vitest';
import { ARTIFACTS } from '../src/core/content/artifacts';
import { ARTIFACT_TEXT } from '../src/core/content/artifactText';
import { createTwoVTwoGame } from '../src/core/engine/game';
import { render2v2Game } from '../src/ui/battle2v2View';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';

function setupWith(id: string): TwoVTwoSetup {
  return {
    seats: {
      A1: [id, '002', '003'],
      A2: ['004', '005', '006'],
      B1: ['007', '008', '009'],
      B2: ['010', '011', '012'],
    },
    firstTeam: 'A',
    seed: 3,
  };
}

describe('2v2 全部神器卡面与详情', () => {
  it('全部神器都能渲染并打开技能详情', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const ids = Object.keys(ARTIFACTS);
    expect(ids.length).toBe(45);
    for (const id of ids) {
      const state = createTwoVTwoGame(setupWith(id));
      render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
      const card = root.querySelector<HTMLElement>(`[data-artifact="${id}"]`);
      expect(card, id).not.toBeNull();
      card!.click();
      const title = root.querySelector('.detail-popover .detail-title')?.textContent ?? '';
      expect(title, id).toContain(ARTIFACTS[id].name);
      expect(root.querySelectorAll('.detail-popover .skills .skill-part').length, id).toBe(
        ARTIFACT_TEXT[id]?.skills.length ?? 0,
      );
      root.querySelector<HTMLButtonElement>('.detail-close')!.click();
      expect(root.querySelector('.detail-overlay'), id).toBeNull();
    }
  });
});
