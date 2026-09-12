import { describe, it, expect, beforeEach } from 'vitest';
import { setupGame } from '../src/core/engine/setup';
import { renderGame } from '../src/ui/render';

describe('renderGame (read-only snapshot)', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
  });

  it('renders all six artifact names', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root);
    const text = root.textContent ?? '';
    for (const name of ['雨切', '游龙', '明镜', '不祥', '影掠', '完杀']) {
      expect(text).toContain(name);
    }
  });

  it('stacks enemy above self', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root);
    const panels = root.querySelectorAll('.player');
    expect(panels.length).toBe(2);
    expect(panels[0].classList.contains('player--enemy')).toBe(true);
    expect(panels[1].classList.contains('player--self')).toBe(true);
  });

  it('mirrors the enemy area order (attack <-> meditation)', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root);
    const enemyAreas = root.querySelectorAll<HTMLElement>('.player--enemy .area');
    const selfAreas = root.querySelectorAll<HTMLElement>('.player--self .area');
    expect(enemyAreas[0].dataset.kind).toBe('meditation');
    expect(enemyAreas[2].dataset.kind).toBe('attack');
    expect(selfAreas[0].dataset.kind).toBe('attack');
    expect(selfAreas[2].dataset.kind).toBe('meditation');
  });

  it('puts self dice areas above the life header', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root);
    const self = root.querySelector('.player--self')!;
    expect(self.firstElementChild!.classList.contains('areas')).toBe(true);
    const header = self.querySelector('.player-header')!;
    // header 必须排在 areas 之后
    const order = Array.from(self.children);
    expect(order.indexOf(self.querySelector('.areas')!)).toBeLessThan(order.indexOf(header));
  });

  it('renders dice in three areas per player', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root);
    expect(root.querySelectorAll('.area').length).toBe(6);
    expect(root.querySelectorAll('.die').length).toBe(15); // A will 7 + B will 8
  });

  it('shows skill text so skills can be read/switched', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root);
    const text = root.textContent ?? '';
    for (const s of [
      '中央突破', '裁雨流', '龙游万象', '龙腾万丈', '斩神切',
      '淬炼', '锋芒', '影袭', '潜行', '零时枭首',
    ]) {
      expect(text).toContain(s);
    }
    expect(root.querySelectorAll('.card').length).toBe(6);
  });

  it('shows dust seal on the second player', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root);
    // 后手 B 显示在敌人位（自己=A）
    expect(root.querySelectorAll('.player--enemy .badge-seal').length).toBe(1);
    expect(root.querySelectorAll('.player--self .badge-seal').length).toBe(0);
    expect(root.querySelector('.badge-seal')?.textContent).toContain('尘印');
  });

  it('marks the activated skill side differently from the inactive one', () => {
    const state = setupGame({ seed: 1, firstPlayer: 'A' });
    const yuqie = state.players.A.artifacts.find((a) => a.id === '001')!;
    yuqie.activeMarkerSide = 'left';
    renderGame(state, root);
    const card = root.querySelector('.player--self .card[data-artifact="001"]')!;
    expect(card.querySelectorAll('.skill--on').length).toBe(1);
    expect(card.querySelectorAll('.skill--off').length).toBe(1);
  });

  it('shows a dustfall counter and a roll/supply zone in the center', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root);
    expect(root.querySelector('.dustfall')?.textContent).toContain('尘落');
    expect(root.querySelector('.rollzone')).not.toBeNull();
  });

  it('shows count and charge badges when present', () => {
    const state = setupGame({ seed: 1, firstPlayer: 'A' });
    state.players.B.artifacts.find((a) => a.id === '004')!.count = 2; // 不祥
    state.players.A.artifacts.find((a) => a.id === '003')!.chargeLayer = 2; // 明镜
    renderGame(state, root);
    const text = root.textContent ?? '';
    expect(text).toContain('计数 2');
    expect(text).toContain('充能 2/4');
  });
});
