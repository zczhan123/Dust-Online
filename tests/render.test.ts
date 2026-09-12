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

  it('renders both players life', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root);
    expect(root.querySelectorAll('.player').length).toBe(2);
    expect(root.textContent).toContain('50');
  });

  it('renders dice in three areas per player', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root);
    expect(root.querySelectorAll('.area').length).toBe(6); // 2 players × 3 areas
    const dice = root.querySelectorAll('.die');
    expect(dice.length).toBe(15); // A will 7 + B will 8
  });

  it('shows speed/will for column-1 artifacts', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root);
    expect(root.textContent).toContain('速度');
    expect(root.textContent).toContain('意志');
  });
});
