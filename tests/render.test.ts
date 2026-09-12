import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupGame } from '../src/core/engine/setup';
import { createGame, applyAction, skipInitialReroll } from '../src/core/engine/game';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import type { Action } from '../src/core/model/types';

const freshUi = (): UiState => ({ rerollSelected: new Set(), selection: null });

const hooksFor = (onAction: (a: Action) => void = () => {}): RenderHooks => ({
  onAction,
  ui: freshUi(),
  requestRender: () => {},
  onRestart: () => {},
});

describe('renderGame (read-only snapshot)', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
  });

  it('renders all six artifact names', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    const text = root.textContent ?? '';
    for (const name of ['雨切', '游龙', '明镜', '不祥', '影掠', '完杀']) {
      expect(text).toContain(name);
    }
  });

  it('stacks enemy above self', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    const panels = root.querySelectorAll('.player');
    expect(panels.length).toBe(2);
    expect(panels[0].classList.contains('player--enemy')).toBe(true);
    expect(panels[1].classList.contains('player--self')).toBe(true);
  });

  it('mirrors the enemy area order (attack <-> meditation)', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    const enemyAreas = root.querySelectorAll<HTMLElement>('.player--enemy .area');
    const selfAreas = root.querySelectorAll<HTMLElement>('.player--self .area');
    expect(enemyAreas[0].dataset.kind).toBe('meditation');
    expect(enemyAreas[2].dataset.kind).toBe('attack');
    expect(selfAreas[0].dataset.kind).toBe('attack');
    expect(selfAreas[2].dataset.kind).toBe('meditation');
  });

  it('puts self dice areas above the life header', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    const self = root.querySelector('.player--self')!;
    expect(self.firstElementChild!.classList.contains('areas')).toBe(true);
    const header = self.querySelector('.player-header')!;
    // header 必须排在 areas 之后
    const order = Array.from(self.children);
    expect(order.indexOf(self.querySelector('.areas')!)).toBeLessThan(order.indexOf(header));
  });

  it('renders dice in three areas per player', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    expect(root.querySelectorAll('.area').length).toBe(6);
    expect(root.querySelectorAll('.die').length).toBe(15); // A will 7 + B will 8
  });

  it('shows skill text so skills can be read/switched', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
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
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    // 后手 B 显示在敌人位（自己=A）
    expect(root.querySelectorAll('.player--enemy .badge-seal').length).toBe(1);
    expect(root.querySelectorAll('.player--self .badge-seal').length).toBe(0);
    expect(root.querySelector('.badge-seal')?.textContent).toContain('尘印');
  });

  it('marks the activated skill side differently from the inactive one', () => {
    const state = setupGame({ seed: 1, firstPlayer: 'A' });
    const yuqie = state.players.A.artifacts.find((a) => a.id === '001')!;
    yuqie.activeMarkerSide = 'left';
    renderGame(state, root, hooksFor());
    const card = root.querySelector('.player--self .card[data-artifact="001"]')!;
    expect(card.querySelectorAll('.skill--on').length).toBe(1);
    expect(card.querySelectorAll('.skill--off').length).toBe(1);
  });

  it('shows a dustfall counter and a roll/supply zone in the center', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    expect(root.querySelector('.dustfall')?.textContent).toContain('尘落');
    expect(root.querySelector('.rollzone')).not.toBeNull();
  });

  it('shows count and charge badges when present', () => {
    const state = setupGame({ seed: 1, firstPlayer: 'A' });
    state.players.B.artifacts.find((a) => a.id === '004')!.count = 2; // 不祥
    state.players.A.artifacts.find((a) => a.id === '003')!.chargeLayer = 2; // 明镜
    renderGame(state, root, hooksFor());
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
    renderGame(createGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    expect(root.querySelector('.status')?.textContent).toContain('阶段');
  });

  it('renders a non-empty phase hint', () => {
    renderGame(createGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    expect((root.querySelector('.hint')?.textContent ?? '').length).toBeGreaterThan(0);
  });

  it('renders an operation list with buttons in the main phase', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    renderGame(state, root, hooksFor());
    expect(root.querySelectorAll('.actionlist .btn').length).toBeGreaterThan(0);
  });

  it('clicking a legal attack die dispatches an attack action', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    const die = state.players.A.areas.attack[0];
    const onAction = vi.fn();
    renderGame(state, root, hooksFor(onAction));

    const dieEl = root.querySelector<HTMLElement>(
      `.player--self .die[data-id="${die.id}"]`,
    );
    expect(dieEl).not.toBeNull();
    expect(dieEl!.classList.contains('clickable')).toBe(true);
    dieEl!.click();
    expect(onAction).toHaveBeenCalledWith({ t: 'attack', dieId: die.id });
  });

  it('clicking a parameterized skill card opens the dice chooser (no default dispatch)', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    const yuqie = state.players.A.artifacts.find((a) => a.id === '001')!;
    yuqie.activeMarkerSide = 'left';
    state.players.A.areas.meditation.push(
      { id: 'test-m1', value: 2, kind: 'meditation' },
    );

    const ui = freshUi();
    const onAction = vi.fn();
    const hooks: RenderHooks = { onAction, ui, requestRender: () => renderGame(state, root, hooks), onRestart: () => {} };
    renderGame(state, root, hooks);

    const box = root.querySelector<HTMLElement>(
      '.player--self .card[data-artifact="001"] .skill.clickable',
    );
    expect(box).not.toBeNull();
    box!.click();
    expect(onAction).not.toHaveBeenCalled();
    expect(ui.selection).not.toBeNull();
    expect(root.querySelector('.selector')).not.toBeNull();
  });

  it('enters the skill chooser from the operation list', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    const buxiang = state.players.A.artifacts.find((a) => a.id === '004')!;
    buxiang.activeMarkerSide = 'left';
    state.players.A.areas.attack.push({ id: 'atk-test', value: 3, kind: 'attack' });

    const ui = freshUi();
    const onAction = vi.fn();
    const hooks: RenderHooks = { onAction, ui, requestRender: () => renderGame(state, root, hooks), onRestart: () => {} };
    renderGame(state, root, hooks);

    const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).find((b) =>
      (b.textContent ?? '').includes('淬炼'),
    );
    expect(btn).toBeTruthy();
    btn!.click();
    expect(ui.selection).not.toBeNull();
    expect(root.querySelector('.selector')).not.toBeNull();
  });

  it('completes the chooser and dispatches explicit dice params', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    const buxiang = state.players.A.artifacts.find((a) => a.id === '004')!;
    buxiang.activeMarkerSide = 'left';
    state.players.A.areas.attack.push({ id: 'atk-test', value: 3, kind: 'attack' });

    const ui = freshUi();
    const onAction = vi.fn();
    const hooks: RenderHooks = { onAction, ui, requestRender: () => renderGame(state, root, hooks), onRestart: () => {} };
    renderGame(state, root, hooks);

    const openBtn = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).find((b) =>
      (b.textContent ?? '').includes('淬炼'),
    )!;
    openBtn.click();

    const die = root.querySelector<HTMLElement>('.player--self .die[data-id="atk-test"]');
    expect(die).not.toBeNull();
    die!.click();

    const okBtn = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => b.textContent === '确认',
    );
    expect(okBtn).toBeTruthy();
    expect(okBtn!.disabled).toBe(false);
    okBtn!.click();

    expect(onAction).toHaveBeenCalledWith({
      t: 'skill',
      artifactId: '004',
      side: 'left',
      params: { attackDieId: 'atk-test' },
    });
  });

  it('shows the log newest-first', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    state.log.length = 0;
    state.log.push(
      { turn: 0, phase: 'main', text: '第一条' },
      { turn: 0, phase: 'main', text: '第二条' },
      { turn: 0, phase: 'main', text: '第三条' },
    );
    renderGame(state, root, hooksFor());
    const lines = root.querySelectorAll('.log .log-line');
    expect(lines.length).toBe(3);
    expect(lines[0].textContent).toContain('第三条');
    expect(lines[2].textContent).toContain('第一条');
  });

  it('marks a used ultimate with a 已使用 badge and disables it', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    state.ultimatesUsed.push('mingjing.ultimate');
    state.players.A.artifacts.find((a) => a.id === '003')!.activeMarkerSide = 'left';
    renderGame(state, root, hooksFor());
    const used = root.querySelectorAll<HTMLElement>('.player--self .skill--used');
    expect(used.length).toBe(1);
    expect(used[0].textContent).toContain('已使用');
    expect(used[0].classList.contains('clickable')).toBe(false);
  });

  it('shows a game-over modal with the winner and a working restart button', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    state.phase = 'gameOver';
    state.winner = 'B';
    const onRestart = vi.fn();
    renderGame(state, root, { ...hooksFor(), onRestart });
    const modal = root.querySelector('.gameover-modal');
    expect(modal).not.toBeNull();
    expect(modal!.textContent).toContain('玩家B');
    expect(modal!.textContent).toContain('获胜');
    const btn = root.querySelector<HTMLButtonElement>('.gameover-restart');
    expect(btn).not.toBeNull();
    btn!.click();
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});
