import { describe, it, expect } from 'vitest';
import { createTwoVTwoGame } from '../src/core/engine/game';
import { render2v2Game } from '../src/ui/battle2v2View';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';

const setup = (): TwoVTwoSetup => ({
  seats: {
    A1: ['001', '002', '003'],
    A2: ['004', '005', '006'],
    B1: ['007', '008', '009'],
    B2: ['010', '011', '012'],
  },
  firstTeam: 'A',
  seed: 7,
});

function mainState() {
  const state = createTwoVTwoGame(setup());
  state.phase = 'main';
  state.activePlayer = 'A1';
  return state;
}

function armed003() {
  const state = mainState();
  const art = state.players.A1.artifacts.find((a) => a.id === '003')!;
  art.chargeLayer = 4;
  art.activeMarkerSide = 'left';
  art.armedSide = 'left';
  art.armedTurn = state.turnIndex;
  return state;
}

describe('2v2 已知问题回归', () => {
  it('技能按钮使用 1v1 的 btn-skill 样式', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = armed003();
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    const button = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).find(
      (b) => b.textContent?.includes('斩神切'),
    )!;
    expect(button.classList.contains('btn')).toBe(true);
    expect(button.classList.contains('btn-skill')).toBe(true);
  });

  it('003 必杀目标只列出两名敌人', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = armed003();
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    const button = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).find(
      (b) => b.textContent?.includes('斩神切'),
    )!;
    button.click();
    const targets = Array.from(root.querySelectorAll<HTMLElement>('.selector .b2v2-target'));
    expect(targets.map((b) => b.dataset.choice)).toEqual(['B1', 'B2']);
    expect(root.querySelector('.selector-body')).toBeNull();
  });

  it('003 充能满：充能行 disabled，必杀行仍 on', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = armed003();
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    const card = root.querySelector<HTMLElement>('.player[data-player="A1"] .card[data-artifact="003"]')!;
    const parts = Array.from(card.querySelectorAll<HTMLElement>('.skill-part'));
    expect(parts.some((p) => p.classList.contains('skill-part--disabled'))).toBe(true);
    expect(parts.some((p) => p.classList.contains('skill-part--on'))).toBe(true);
    expect(parts.every((p) => p.classList.contains('skill-part--off'))).toBe(false);
  });

  it('回合内重掷选择不能超过速度上限', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'reroll';
    state.activePlayer = 'A1';
    const art002 = state.players.A1.artifacts.find((a) => a.id === '002')!;
    art002.activeMarkerSide = 'left';
    state.players.A1.areas = {
      attack: [1, 2].map((value, i) => ({ id: `a${i}`, value, kind: 'attack' })),
      defense: [3, 4].map((value, i) => ({ id: `d${i}`, value, kind: 'defense' })),
      meditation: [5, 6].map((value, i) => ({ id: `m${i}`, value, kind: 'meditation' })),
    } as never;
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    const dice = Array.from(root.querySelectorAll<HTMLElement>('.player[data-player="A1"] .die'));
    expect(dice).toHaveLength(6);
    dice.forEach((d) => d.click());
    expect(root.querySelectorAll('.player[data-player="A1"] .die.selected')).toHaveLength(5);
    expect(root.querySelector('.actionlist .btn-reroll')?.textContent).toContain('重掷选中(5)');
  });

  it('初始重掷不限数量', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = createTwoVTwoGame(setup());
    state.phase = 'initialReroll';
    state.activePlayer = 'A1';
    state.players.A1.areas = {
      attack: [1, 2].map((value, i) => ({ id: `ia${i}`, value, kind: 'attack' })),
      defense: [3, 4].map((value, i) => ({ id: `id${i}`, value, kind: 'defense' })),
      meditation: [5, 6].map((value, i) => ({ id: `im${i}`, value, kind: 'meditation' })),
    } as never;
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    const dice = Array.from(root.querySelectorAll<HTMLElement>('.player[data-player="A1"] .die'));
    expect(dice).toHaveLength(6);
    dice.forEach((d) => d.click());
    expect(root.querySelectorAll('.player[data-player="A1"] .die.selected')).toHaveLength(6);
    expect(root.querySelector('.actionlist .btn-reroll')?.textContent).toContain('重掷选中(6)');
  });

  it('技能按钮排在攻击骰之前', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = mainState();
    const art = state.players.A1.artifacts.find((a) => a.id === '001')!;
    art.activeMarkerSide = 'left';
    art.armedSide = 'left';
    art.armedTurn = state.turnIndex;
    state.players.A1.areas.attack = [{ id: 'order-atk', value: 3, kind: 'attack' }] as never;
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    const skill = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).find(
      (b) => b.textContent?.startsWith('启动技能：'),
    )!;
    const attack = root.querySelector<HTMLElement>('.actionlist-chips .pay-die[data-act="attack"]')!;
    expect(skill).toBeTruthy();
    expect(attack).toBeTruthy();
    expect((skill.compareDocumentPosition(attack) & 4) !== 0).toBe(true);
  });

  it('胜利弹框复用 1v1 居中结构', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = mainState();
    state.phase = 'gameOver';
    state.winner = 'A';
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    expect(root.querySelector('.gameover-overlay .gameover-modal')).not.toBeNull();
    expect(root.querySelector('.gameover-winner')?.textContent).toContain('A 队胜利');
  });
});
