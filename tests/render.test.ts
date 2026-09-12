import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupGame } from '../src/core/engine/setup';
import { createGame, applyAction, getLegalActions } from '../src/core/engine/game';
import { renderGame } from '../src/ui/render';

const noop = { onAction: () => {} };

describe('renderGame (read-only snapshot)', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
  });

  it('renders all six artifact names', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, noop);
    const text = root.textContent ?? '';
    for (const name of ['雨切', '游龙', '明镜', '不祥', '影掠', '完杀']) {
      expect(text).toContain(name);
    }
  });

  it('stacks enemy above self', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, noop);
    const panels = root.querySelectorAll('.player');
    expect(panels.length).toBe(2);
    expect(panels[0].classList.contains('player--enemy')).toBe(true);
    expect(panels[1].classList.contains('player--self')).toBe(true);
  });

  it('mirrors the enemy area order (attack <-> meditation)', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, noop);
    const enemyAreas = root.querySelectorAll<HTMLElement>('.player--enemy .area');
    const selfAreas = root.querySelectorAll<HTMLElement>('.player--self .area');
    expect(enemyAreas[0].dataset.kind).toBe('meditation');
    expect(enemyAreas[2].dataset.kind).toBe('attack');
    expect(selfAreas[0].dataset.kind).toBe('attack');
    expect(selfAreas[2].dataset.kind).toBe('meditation');
  });

  it('puts self dice areas above the life header', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, noop);
    const self = root.querySelector('.player--self')!;
    expect(self.firstElementChild!.classList.contains('areas')).toBe(true);
    const header = self.querySelector('.player-header')!;
    // header 必须排在 areas 之后
    const order = Array.from(self.children);
    expect(order.indexOf(self.querySelector('.areas')!)).toBeLessThan(order.indexOf(header));
  });

  it('renders dice in three areas per player', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, noop);
    expect(root.querySelectorAll('.area').length).toBe(6);
    expect(root.querySelectorAll('.die').length).toBe(15); // A will 7 + B will 8
  });

  it('shows skill text so skills can be read/switched', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, noop);
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
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, noop);
    // 后手 B 显示在敌人位（自己=A）
    expect(root.querySelectorAll('.player--enemy .badge-seal').length).toBe(1);
    expect(root.querySelectorAll('.player--self .badge-seal').length).toBe(0);
    expect(root.querySelector('.badge-seal')?.textContent).toContain('尘印');
  });

  it('marks the activated skill side differently from the inactive one', () => {
    const state = setupGame({ seed: 1, firstPlayer: 'A' });
    const yuqie = state.players.A.artifacts.find((a) => a.id === '001')!;
    yuqie.activeMarkerSide = 'left';
    renderGame(state, root, noop);
    const card = root.querySelector('.player--self .card[data-artifact="001"]')!;
    expect(card.querySelectorAll('.skill--on').length).toBe(1);
    expect(card.querySelectorAll('.skill--off').length).toBe(1);
  });

  it('shows a dustfall counter and a roll/supply zone in the center', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, noop);
    expect(root.querySelector('.dustfall')?.textContent).toContain('尘落');
    expect(root.querySelector('.rollzone')).not.toBeNull();
  });

  it('shows count and charge badges when present', () => {
    const state = setupGame({ seed: 1, firstPlayer: 'A' });
    state.players.B.artifacts.find((a) => a.id === '004')!.count = 2; // 不祥
    state.players.A.artifacts.find((a) => a.id === '003')!.chargeLayer = 2; // 明镜
    renderGame(state, root, noop);
    const text = root.textContent ?? '';
    expect(text).toContain('计数 2');
    expect(text).toContain('充能 2/4');
  });
});

describe('renderGame (interaction)', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
  });

  it('shows status text including the phase', () => {
    renderGame(createGame({ seed: 1, firstPlayer: 'A' }), root, noop);
    expect(root.querySelector('.status')?.textContent).toContain('阶段');
  });

  it('clicking a legal attack die dispatches an attack action', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    const die = state.players.A.areas.attack[0];
    const onAction = vi.fn();
    renderGame(state, root, { onAction });

    const dieEl = root.querySelector<HTMLElement>(
      `.player--self .die[data-id="${die.id}"]`,
    );
    expect(dieEl).not.toBeNull();
    expect(dieEl!.classList.contains('clickable')).toBe(true);
    dieEl!.click();
    expect(onAction).toHaveBeenCalledWith({ t: 'attack', dieId: die.id });
  });

  it('clicking a clickable skill dispatches a skill action', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    const yuqie = state.players.A.artifacts.find((a) => a.id === '001')!;
    yuqie.activeMarkerSide = 'left';
    state.players.A.areas.meditation.push(
      { id: 'test-m1', value: 2, kind: 'meditation' },
      { id: 'test-m2', value: 5, kind: 'meditation' },
      { id: 'test-m3', value: 2, kind: 'meditation' },
    );
    const skillAction = getLegalActions(state).find(
      (a) => a.t === 'skill' && a.artifactId === '001' && a.side === 'left',
    );
    expect(skillAction).toBeTruthy();

    const onAction = vi.fn();
    renderGame(state, root, { onAction });
    const box = root.querySelector<HTMLElement>(
      '.player--self .card[data-artifact="001"] .skill.clickable',
    );
    expect(box).not.toBeNull();
    box!.click();
    expect(onAction).toHaveBeenCalledWith(skillAction);
  });
});
