import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupGame } from '../src/core/engine/setup';
import { createGame, applyAction, skipInitialReroll, beginTurn } from '../src/core/engine/game';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import { dealTrueDamage } from '../src/core/engine/combat';
import type { Action, GameState } from '../src/core/model/types';

const freshUi = (): UiState => ({ rerollSelected: new Set(), selection: null, pendingConfirm: null });

const hooksFor = (onAction: (a: Action) => void = () => {}): RenderHooks => {
  const ui = freshUi();
  return {
    onAction,
    ui,
    propose: (action, label) => { ui.pendingConfirm = { action, label }; },
    requestRender: () => {},
    onRestart: () => {},
  };
};

/** 带重绘的挂载：propose 会写入 pendingConfirm 并重绘，模拟 main.ts */
const mount = (state: GameState, root: HTMLElement, onAction: (a: Action) => void = vi.fn()) => {
  const ui = freshUi();
  const hooks: RenderHooks = {
    onAction,
    ui,
    propose: (action, label) => { ui.pendingConfirm = { action, label }; renderGame(state, root, hooks); },
    requestRender: () => renderGame(state, root, hooks),
    onRestart: () => {},
  };
  renderGame(state, root, hooks);
  return { ui, hooks, onAction };
};

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

  it('shows the dustfall counter in the center band and the log in the left sidebar', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    const band = root.querySelector('.centerband');
    expect(band).not.toBeNull();
    expect(band!.querySelector('.dustfall')?.textContent).toContain('尘落');
    expect(root.querySelector('.sidebar .log')).not.toBeNull();
  });

  it('renders weapon type in the artifact card title', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    expect(root.textContent ?? '').toContain('雨切（武士刀）');
  });

  it('colors the life span by player id', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    const life = root.querySelector('.player--self .player-life');
    expect(life).not.toBeNull();
    expect(life!.classList.contains('life-A')).toBe(true);
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

  it('marks a fully charged column-3 artifact and does not offer charging', () => {
    const state = setupGame({ seed: 1, firstPlayer: 'A' });
    state.players.A.artifacts.find((a) => a.id === '003')!.chargeLayer = 4; // 明镜 满充能
    renderGame(state, root, hooksFor());
    expect(root.textContent ?? '').toContain('充能 4/4（已满）');
    const card = root.querySelector('.player--self .card[data-artifact="003"]')!;
    const badge = card.querySelector('.badge-charge');
    expect(badge).not.toBeNull();
    expect(badge!.classList.contains('badge-charge--full')).toBe(true);
    expect(card.querySelectorAll('.clickable').length).toBe(0);
  });

  it('does not offer 淬炼 once 不祥 count reaches 3', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    const buxiang = state.players.A.artifacts.find((a) => a.id === '004')!;
    buxiang.activeMarkerSide = 'left';
    buxiang.count = 3;
    renderGame(state, root, hooksFor());
    const text = root.textContent ?? '';
    expect(text).not.toContain('启动技能：淬炼');
    const box = root.querySelector<HTMLElement>('.player--self .card[data-artifact="004"] .skill--on');
    expect(box).not.toBeNull();
    expect(box!.classList.contains('skill--full')).toBe(true);
    expect(box!.textContent).toContain('已满');
    expect(box!.classList.contains('clickable')).toBe(false);
  });
});

describe('renderGame (interaction)', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
  });

  it('renders a two-line hint: turn line and phase guidance', () => {
    renderGame(createGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    const hint = root.querySelector('.hint');
    expect(hint).not.toBeNull();
    expect(hint!.textContent ?? '').toContain('轮到 玩家A 操作');
    expect((hint!.textContent ?? '').length).toBeGreaterThan(0);
  });

  it('renders an operation list with buttons in the main phase', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    renderGame(state, root, hooksFor());
    expect(root.querySelectorAll('.actionlist .btn').length).toBeGreaterThan(0);
  });

  it('puts the operation list and dustfall inside the center band', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    renderGame(state, root, hooksFor());
    const band = root.querySelector('.centerband')!;
    expect(band.querySelector('.centerband-left .actionlist')).not.toBeNull();
    expect(band.querySelector('.centerband-right .dustfall')).not.toBeNull();
  });

  it('clicking a legal attack die proposes a confirm, and 确认 dispatches it', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    const die = state.players.A.areas.attack[0];
    const { ui, onAction } = mount(state, root);

    const dieEl = root.querySelector<HTMLElement>(
      `.player--self .die[data-id="${die.id}"]`,
    );
    expect(dieEl).not.toBeNull();
    expect(dieEl!.classList.contains('clickable')).toBe(true);
    dieEl!.click();
    expect(onAction).not.toHaveBeenCalled();
    expect(ui.pendingConfirm).not.toBeNull();
    expect(ui.pendingConfirm!.action).toEqual({ t: 'attack', dieId: die.id });

    const confirmBtn = root.querySelector<HTMLButtonElement>('.confirm-row .btn-confirm');
    expect(confirmBtn).not.toBeNull();
    confirmBtn!.click();
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

    const { ui, onAction } = mount(state, root);

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

    const { ui } = mount(state, root);

    const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist .btn')).find((b) =>
      (b.textContent ?? '').includes('淬炼'),
    );
    expect(btn).toBeTruthy();
    btn!.click();
    expect(ui.selection).not.toBeNull();
    expect(root.querySelector('.selector')).not.toBeNull();
  });

  it('completes the chooser, proposes the skill, and dispatches only after 确认', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    const buxiang = state.players.A.artifacts.find((a) => a.id === '004')!;
    buxiang.activeMarkerSide = 'left';
    state.players.A.areas.attack.push({ id: 'atk-test', value: 3, kind: 'attack' });

    const { ui, onAction } = mount(state, root);

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

    expect(onAction).not.toHaveBeenCalled();
    expect(ui.pendingConfirm).not.toBeNull();
    expect(ui.pendingConfirm!.action).toEqual({
      t: 'skill',
      artifactId: '004',
      side: 'left',
      params: { attackDieId: 'atk-test' },
    });

    const confirmBtn = root.querySelector<HTMLButtonElement>('.confirm-row .btn-confirm');
    expect(confirmBtn).not.toBeNull();
    confirmBtn!.click();
    expect(onAction).toHaveBeenCalledWith({
      t: 'skill',
      artifactId: '004',
      side: 'left',
      params: { attackDieId: 'atk-test' },
    });
  });

  it('cancels a pending confirm without dispatching', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // 尘起 -> 主要
    const die = state.players.A.areas.attack[0];
    const { ui, onAction } = mount(state, root);

    root.querySelector<HTMLElement>(`.player--self .die[data-id="${die.id}"]`)!.click();
    expect(ui.pendingConfirm).not.toBeNull();

    const cancelBtn = root.querySelector<HTMLButtonElement>('.confirm-row .btn-cancel');
    expect(cancelBtn).not.toBeNull();
    cancelBtn!.click();
    expect(ui.pendingConfirm).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
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

  it('colors dice by owner class (die-A / die-B)', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    renderGame(state, root, hooksFor());
    const dice = root.querySelectorAll('.die');
    expect(dice.length).toBe(15);
    for (const d of Array.from(dice)) {
      expect(d.classList.contains('die-A') !== d.classList.contains('die-B')).toBe(true);
    }
    expect(root.querySelectorAll('.player--self .die.die-A').length).toBe(7); // A will 7
    expect(root.querySelectorAll('.player--enemy .die.die-B').length).toBe(8); // B will 8
  });

  it('clicking a dust-rise button opens the meditation-die chooser (no auto-pick)', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(state);
    state.players.A.areas.meditation.push({ id: 'mm', value: 2, kind: 'meditation' });
    const { ui, onAction } = mount(state, root);
    const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('.btn')).find(
      (b) => b.dataset.act === 'dustRise',
    );
    expect(btn).toBeTruthy();
    btn!.click();
    expect(onAction).not.toHaveBeenCalled();
    expect(ui.selection).not.toBeNull();
    expect(ui.selection!.key).toBe('@dustRise');
    expect(root.querySelector('.selector')).not.toBeNull();
  });

  it('shows the defender as the acting player while an attack is pending (colored)', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // -> main
    state.players.A.areas.attack.push({ id: 'atk', value: 5, kind: 'attack' });
    applyAction(state, { t: 'attack', dieId: 'atk' });
    renderGame(state, root, hooksFor());
    const turn = root.querySelector('.hint-turn')!;
    expect(turn.textContent).toContain('玩家B'); // 轮到防御方
    expect(turn.querySelector('.player-B')).not.toBeNull(); // 玩家名按颜色类标出
    expect(root.querySelector('.hint .hint-phase')).not.toBeNull(); // 提示在同一行
  });

  it('renders the card art image for each artifact', () => {
    renderGame(setupGame({ seed: 1, firstPlayer: 'A' }), root, hooksFor());
    const imgs = root.querySelectorAll<HTMLImageElement>('img.card-art-img');
    expect(imgs.length).toBe(6);
    const srcs = Array.from(imgs).map((i) => i.getAttribute('src'));
    expect(srcs).toContain('/cards/001.jpg');
    expect(srcs).toContain('/cards/006.jpg');
  });

  it('opens the 007 chooser with an option step and completes 震荡斩击 with explicit params', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['007', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // -> main
    state.players.A.artifacts.find((a) => a.id === '007')!.activeMarkerSide = 'right';
    state.players.A.areas.attack = [
      { id: 'c1', value: 2, kind: 'attack' },
      { id: 'c2', value: 3, kind: 'attack' },
      { id: 'c3', value: 4, kind: 'attack' },
      { id: 'c4', value: 5, kind: 'attack' },
    ];
    state.players.B.areas.attack = [
      { id: 'o1', value: 1, kind: 'attack' },
      { id: 'o2', value: 1, kind: 'attack' },
    ];

    const { ui, onAction } = mount(state, root);

    const box = root.querySelector<HTMLElement>(
      '.player--self .card[data-artifact="007"] .skill[data-side="right"].clickable',
    );
    expect(box).not.toBeNull();
    box!.click();
    expect(onAction).not.toHaveBeenCalled();
    expect(ui.selection).not.toBeNull();
    expect(ui.selection!.key).toBe('zhuzai.smash');
    expect(root.querySelector('.selector')).not.toBeNull();

    // step 1: option
    const optBtn = root.querySelector<HTMLButtonElement>('.option-btn[data-option="attack"]');
    expect(optBtn).not.toBeNull();
    optBtn!.click();
    const ok1 = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => b.textContent === '确认',
    )!;
    expect(ok1.disabled).toBe(false);
    ok1.click();

    // step 2: pick 4 own attack dice
    for (const id of ['c1', 'c2', 'c3', 'c4']) {
      const d = root.querySelector<HTMLElement>(`.player--self .die[data-id="${id}"]`)!;
      expect(d).not.toBeNull();
      d.click();
    }
    const ok2 = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => b.textContent === '确认',
    )!;
    expect(ok2.disabled).toBe(false);
    ok2.click();

    // step 3: pick opponent attack dice (0-4); choose one
    const od = root.querySelector<HTMLElement>('.player--enemy .die[data-id="o1"]')!;
    expect(od).not.toBeNull();
    od.click();
    const ok3 = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => b.textContent === '确认',
    )!;
    ok3.click();

    expect(onAction).not.toHaveBeenCalled();
    expect(ui.pendingConfirm).not.toBeNull();
    expect(ui.pendingConfirm!.action).toEqual({
      t: 'skill',
      artifactId: '007',
      side: 'right',
      params: {
        kind: 'attack',
        consumedIds: ['c1', 'c2', 'c3', 'c4'],
        opponentDiscardIds: ['o1'],
      },
    });
  });

  it('opens the 008 王家之拳 chooser and proposes explicit meditation/defense params', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '008', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // -> main
    state.players.A.artifacts.find((a) => a.id === '008')!.activeMarkerSide = 'right';
    state.players.A.areas = {
      attack: [],
      defense: [
        { id: 'd1', value: 1, kind: 'defense' },
        { id: 'd2', value: 6, kind: 'defense' },
      ],
      meditation: [
        { id: 'm1', value: 3, kind: 'meditation' },
        { id: 'm2', value: 4, kind: 'meditation' },
      ],
    };

    const { ui, onAction } = mount(state, root);

    const box = root.querySelector<HTMLElement>(
      '.player--self .card[data-artifact="008"] .skill[data-side="right"].clickable',
    );
    expect(box).not.toBeNull();
    box!.click();
    expect(onAction).not.toHaveBeenCalled();
    expect(ui.selection).not.toBeNull();
    expect(ui.selection!.key).toBe('tiebi.fist');
    expect(root.querySelector('.selector')).not.toBeNull();

    // step 1: pick exactly 2 meditation dice
    for (const id of ['m1', 'm2']) {
      root.querySelector<HTMLElement>(`.player--self .die[data-id="${id}"]`)!.click();
    }
    let ok = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => b.textContent === '确认',
    )!;
    expect(ok.disabled).toBe(false);
    ok.click();

    // step 2: pick the 2 defense dice to discard
    for (const id of ['d1', 'd2']) {
      root.querySelector<HTMLElement>(`.player--self .die[data-id="${id}"]`)!.click();
    }
    ok = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => b.textContent === '确认',
    )!;
    expect(ok.disabled).toBe(false);
    ok.click();

    expect(onAction).not.toHaveBeenCalled();
    expect(ui.pendingConfirm).not.toBeNull();
    expect(ui.pendingConfirm!.action).toEqual({
      t: 'skill',
      artifactId: '008',
      side: 'right',
      params: { meditationDieIds: ['m1', 'm2'], defenseDieIds: ['d1', 'd2'] },
    });
  });

  it('renders the 009 高塔铁幕 charge prompt with one button per opponent attack die', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '009'] });
    skipInitialReroll(state);
    state.players.A.areas.meditation.push({ id: 'mm', value: 2, kind: 'meditation' });
    state.players.B.areas.attack = [
      { id: 'oa1', value: 5, kind: 'attack' },
      { id: 'oa2', value: 3, kind: 'attack' },
    ];
    applyAction(state, { t: 'dustRise', artifactId: '009', meditationDieId: 'mm' });
    expect(state.pending!.kind).toBe('guwangCharge');

    renderGame(state, root, hooksFor());
    expect(root.querySelector('.hint-phase')?.textContent).toContain('高塔铁幕');
    const btns = root.querySelectorAll<HTMLButtonElement>('.actionlist .btn[data-act="guwangCharge"]');
    expect(btns.length).toBe(3); // 2 颗对方攻击骰 + 不变更
    const labels = Array.from(btns).map((b) => b.textContent);
    expect(labels).toContain('不变更');
    expect(labels).toContain('改为1（5点）');
    expect(labels).toContain('改为1（3点）');
    expect(state.pending!.kind).toBe('guwangCharge'); // 渲染不应改变状态
  });

  it('renders the 009 高塔铁幕 trigger prompt with cancel / take-damage buttons', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '009'] });
    skipInitialReroll(state);
    const gw = state.players.A.artifacts.find((a) => a.id === '009')!;
    gw.activeMarkerSide = 'left';
    state.players.A.areas.defense = [{ id: 'gd1', value: 4, kind: 'defense' }];
    dealTrueDamage(state, 'A', 6);
    expect(state.pending!.kind).toBe('guwangCancel');

    renderGame(state, root, hooksFor());
    expect(root.querySelector('.hint-phase')?.textContent).toContain('高塔铁幕');
    const btns = root.querySelectorAll<HTMLButtonElement>('.actionlist .btn[data-act="guwangCancel"]');
    expect(btns.length).toBe(2); // 承受伤害 + 取消
    const labels = Array.from(btns).map((b) => b.textContent);
    expect(labels).toContain('承受伤害');
    expect(labels).toContain('取消（消耗 防御4）');
    expect(state.pending!.kind).toBe('guwangCancel'); // 渲染不应改变状态
  });

  it('renders the 010 深红 杀意 prompt with accept / decline buttons', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['010', '002', '003'] });
    skipInitialReroll(state);
    state.players.A.artifacts.find((a) => a.id === '010')!.activeMarkerSide = 'right';
    state.players.A.areas = {
      attack: [
        { id: 'a1', value: 2, kind: 'attack' },
        { id: 'a2', value: 3, kind: 'attack' },
        { id: 'a3', value: 4, kind: 'attack' },
      ],
      defense: [
        { id: 'd1', value: 1, kind: 'defense' },
        { id: 'd2', value: 6, kind: 'defense' },
      ],
      meditation: [{ id: 'm1', value: 5, kind: 'meditation' }],
    };
    state.firstRound.A = false;
    beginTurn(state);
    expect(state.pending!.kind).toBe('shenhongKill');

    renderGame(state, root, hooksFor());
    expect(root.querySelector('.hint-phase')?.textContent).toContain('杀意');
    const btns = root.querySelectorAll<HTMLButtonElement>('.actionlist .btn[data-act="shenhongKill"]');
    expect(btns.length).toBe(2);
    const labels = Array.from(btns).map((b) => b.textContent);
    expect(labels).toContain('发动杀意（3 真伤 + 回2）');
    expect(labels).toContain('不发动');
    expect(state.pending!.kind).toBe('shenhongKill'); // 渲染不应改变状态
  });

  it('opens the 011 灵能屏障 chooser and proposes explicit defense dice params', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['011', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // -> main
    state.players.A.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'left';
    state.players.A.areas = {
      attack: [],
      defense: [
        { id: 'd1', value: 1, kind: 'defense' },
        { id: 'd2', value: 6, kind: 'defense' },
        { id: 'd3', value: 1, kind: 'defense' },
      ],
      meditation: [],
    };

    const { ui, onAction } = mount(state, root);

    const box = root.querySelector<HTMLElement>(
      '.player--self .card[data-artifact="011"] .skill[data-side="left"].clickable',
    );
    expect(box).not.toBeNull();
    box!.click();
    expect(onAction).not.toHaveBeenCalled();
    expect(ui.selection).not.toBeNull();
    expect(ui.selection!.key).toBe('dunwu.barrier.activate');
    expect(root.querySelector('.selector')).not.toBeNull();

    for (const id of ['d1', 'd2']) {
      root.querySelector<HTMLElement>(`.player--self .die[data-id="${id}"]`)!.click();
    }
    const ok = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => b.textContent === '确认',
    )!;
    expect(ok.disabled).toBe(false);
    ok.click();

    expect(onAction).not.toHaveBeenCalled();
    expect(ui.pendingConfirm).not.toBeNull();
    expect(ui.pendingConfirm!.action).toEqual({
      t: 'skill',
      artifactId: '011',
      side: 'left',
      params: { defenseDieIds: ['d1', 'd2'] },
    });
  });

  it('opens the 011 灵能脉冲 chooser and proposes explicit attack dice params', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['011', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // -> main
    state.players.A.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'right';
    state.players.A.areas = {
      attack: [
        { id: 'a1', value: 2, kind: 'attack' },
        { id: 'a2', value: 4, kind: 'attack' },
        { id: 'a3', value: 2, kind: 'attack' },
      ],
      defense: [],
      meditation: [],
    };

    const { ui, onAction } = mount(state, root);

    const box = root.querySelector<HTMLElement>(
      '.player--self .card[data-artifact="011"] .skill[data-side="right"].clickable',
    );
    expect(box).not.toBeNull();
    box!.click();
    expect(onAction).not.toHaveBeenCalled();
    expect(ui.selection).not.toBeNull();
    expect(ui.selection!.key).toBe('dunwu.pulse.activate');
    expect(root.querySelector('.selector')).not.toBeNull();

    for (const id of ['a1', 'a2', 'a3']) {
      root.querySelector<HTMLElement>(`.player--self .die[data-id="${id}"]`)!.click();
    }
    const ok = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => b.textContent === '确认',
    )!;
    expect(ok.disabled).toBe(false);
    ok.click();

    expect(onAction).not.toHaveBeenCalled();
    expect(ui.pendingConfirm).not.toBeNull();
    expect(ui.pendingConfirm!.action).toEqual({
      t: 'skill',
      artifactId: '011',
      side: 'right',
      params: { attackDieIds: ['a1', 'a2', 'a3'] },
    });
  });

  it('renders the 011 灵能屏障 触发 prompt with halve / decline buttons', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroB: ['011', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // A -> main
    state.players.B.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'left';
    state.players.B.areas.meditation = [{ id: 'bm1', value: 3, kind: 'meditation' }];
    state.players.A.areas.attack = [{ id: 'atk', value: 5, kind: 'attack' }];
    applyAction(state, { t: 'attack', dieId: 'atk' });
    expect(state.pending!.kind).toBe('dunwuHalve');

    renderGame(state, root, hooksFor());
    expect(root.querySelector('.hint-phase')?.textContent).toContain('灵能屏障');
    const btns = root.querySelectorAll<HTMLButtonElement>('.actionlist .btn[data-act="dunwuHalve"]');
    expect(btns.length).toBe(2); // 不减半 + 消耗冥想骰
    const labels = Array.from(btns).map((b) => b.textContent);
    expect(labels).toContain('不减半');
    expect(labels).toContain('伤害减半（消耗 冥想3）');
    expect(state.pending!.kind).toBe('dunwuHalve'); // 渲染不应改变状态
  });

  it('opens the 012 梦醒时分 chooser and proposes explicit destination + meditation dice params', () => {
    const state = createGame({ seed: 1, firstPlayer: 'A', heroA: ['012', '002', '003'] });
    skipInitialReroll(state);
    applyAction(state, { t: 'advance' }); // -> main
    state.players.A.artifacts.find((a) => a.id === '012')!.activeMarkerSide = 'left';
    state.players.A.areas = {
      attack: [],
      defense: [],
      meditation: [
        { id: 'm1', value: 2, kind: 'meditation' },
        { id: 'm2', value: 5, kind: 'meditation' },
        { id: 'm3', value: 3, kind: 'meditation' },
        { id: 'm4', value: 6, kind: 'meditation' },
      ],
    };

    const { ui, onAction } = mount(state, root);

    const box = root.querySelector<HTMLElement>(
      '.player--self .card[data-artifact="012"] .skill[data-side="only"].clickable',
    );
    expect(box).not.toBeNull();
    box!.click();
    expect(onAction).not.toHaveBeenCalled();
    expect(ui.selection).not.toBeNull();
    expect(ui.selection!.key).toBe('monv.ultimate');
    expect(root.querySelector('.selector')).not.toBeNull();

    const defenseOption = root.querySelector<HTMLElement>('.selector .option-btn[data-option="defense"]');
    expect(defenseOption).not.toBeNull();
    defenseOption!.click();
    const okOption = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => b.textContent === '确认',
    )!;
    expect(okOption.disabled).toBe(false);
    okOption.click();

    for (const id of ['m1', 'm2']) {
      root.querySelector<HTMLElement>(`.player--self .die[data-id="${id}"]`)!.click();
    }
    const ok = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => b.textContent === '确认',
    )!;
    expect(ok.disabled).toBe(false);
    ok.click();

    expect(onAction).not.toHaveBeenCalled();
    expect(ui.pendingConfirm).not.toBeNull();
    expect(ui.pendingConfirm!.action).toEqual({
      t: 'skill',
      artifactId: '012',
      side: 'only',
      params: { to: 'defense', meditationDieIds: ['m1', 'm2'] },
    });
  });
});
