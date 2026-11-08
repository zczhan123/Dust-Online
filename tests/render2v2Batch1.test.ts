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
  for (const seat of ['B1', 'B2'] as const) {
    state.players[seat].areas.defense = Array.from({ length: 3 }, (_, i) => ({
      id: `${seat}-def-${i}`,
      value: i + 1,
      kind: 'defense',
    })) as never;
  }
  return state;
}

function arm(state: ReturnType<typeof mainState>, id: string, side: 'left' | 'right') {
  const art = state.players.A1.artifacts.find((a) => a.id === id)!;
  art.activeMarkerSide = side;
  art.armedSide = side;
  art.armedTurn = state.turnIndex;
  state.players.A1.areas.meditation = [
    { id: `${id}-m1`, value: 1, kind: 'meditation' },
    { id: `${id}-m2`, value: 2, kind: 'meditation' },
    { id: `${id}-m3`, value: 3, kind: 'meditation' },
  ] as never;
  return art;
}

describe('2v2 第一批 001–003 · UI 对照', () => {
  it('001 中央突破：启动技能文案、2v2 选目标、骰区按钮玩家色', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = mainState();
    arm(state, '001', 'left');
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    const button = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).find(
      (b) => b.textContent === '启动技能：中央突破',
    );
    expect(button).toBeTruthy();
    button!.click();
    expect(root.querySelector('.selector')).not.toBeNull();
    expect(root.querySelector('.selector-title')?.textContent).toContain('选择目标');
    const targets = Array.from(root.querySelectorAll<HTMLElement>('.selector .b2v2-target'));
    expect(targets.map((b) => b.dataset.choice)).toEqual(['B1', 'B2']);
    expect(targets.every((b) => b.classList.contains('player-B1') || b.classList.contains('player-B2'))).toBe(true);
  });

  it('002 龙腾万丈：启动技能文案，进入冥想骰骰片选择', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = mainState();
    arm(state, '002', 'right');
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    const button = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).find(
      (b) => b.textContent === '启动技能：龙腾万丈',
    );
    expect(button).toBeTruthy();
    button!.click();
    expect(root.querySelector('.selector')).not.toBeNull();
    expect(root.querySelector('.selector .pay-dice .pay-die')).not.toBeNull();
  });

  it('003 明镜：卡头显示生命和充能，不错误显示终极技能入口', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const state = mainState();
    render2v2Game(root, state, { onAction: () => {}, onBack: () => {} });
    const card = root.querySelector<HTMLElement>('.player[data-player="A1"] .card[data-artifact="003"]')!;
    expect(card.querySelector('.card-sub')?.textContent).toContain('生命 50');
    expect(card.querySelector('.card-sub')?.textContent).toContain('充能 0/4');
    const labels = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).map(
      (b) => b.textContent ?? '',
    );
    expect(labels.some((t) => t.includes('斩神切') && t.includes('必杀'))).toBe(false);
  });
});
