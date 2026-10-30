import { describe, it, expect } from 'vitest';
import { createChallengeGame } from '../src/core/engine/game';
import { SKILL_HANDLERS } from '../src/core/engine/skills';
import { SeededRng } from '../src/core/rng/rng';
import { renderGame, setLocalViewPlayer, type RenderHooks, type UiState } from '../src/ui/render';
import type { Die, DiceKind, GameState } from '../src/core/model/types';

const die = (id: string, value: number, kind: DiceKind = 'attack'): Die => ({ id, value, kind });

/** Z12 不动菩提：挑战者 A 持 005（影袭），锁定点数为 3 */
const makeZ12 = (): GameState => {
  const g = createChallengeGame({
    seed: 1,
    cardId: 'Z12',
    challenger: ['004', '005', '006'],
    settleMode: 'manual',
  });
  g.activePlayer = 'A';
  g.phase = 'main';
  g.challenge!.lockValue = 3;
  g.players.A.areas.attack = [die('d3', 3, 'attack')];
  g.players.A.areas.defense = [];
  g.players.A.areas.meditation = [];
  return g;
};

const freshUi = (): UiState => ({
  rerollSelected: new Set(),
  selection: null,
  pendingConfirm: null,
  convertPick: null,
  fengmangPick: null,
  hanguangPick: null,
  quanzhi: null,
  dustFlow: null,
  prefs: {
    showSkillText: false,
    cardArt: 'thumb',
    density: 'compact',
    mirrorEnemy: false,
    preset: 'desktop',
    logCollapsed: false,
    zoomMode: 'off',
    zoomPercent: 90,
  },
  settingsOpen: false,
  logOpen: false,
  logPop: false,
  detail: null,
  error: null,
});

const hooksFor = (ui: UiState): RenderHooks => ({
  onAction: () => {},
  ui,
  propose: () => {},
  requestRender: () => {},
  onRestart: () => {},
});

describe('Z12 不动菩提 · 非使用/消耗/弃置的选骰步骤', () => {
  it('005 影袭对"被锁点数"的骰仍可降点（引擎不锁改点）', () => {
    const g = makeZ12();
    const a005 = g.players.A.artifacts.find((a) => a.id === '005')!;
    SKILL_HANDLERS['yingle.yingxi'].run({
      g,
      player: 'A',
      artifact: a005,
      rng: new SeededRng(1),
      params: { dieId: 'd3', x: 1 },
      endMainPhase: () => {},
      reportConsumed: () => {},
    });
    const after = [...g.players.A.areas.attack, ...g.players.A.areas.defense, ...g.players.A.areas.meditation].find(
      (d) => d.id === 'd3',
    );
    expect(after).toMatchObject({ value: 2 });
  });

  it('005 影袭的选骰步骤忽略封锁；弃置步骤仍受封锁（UI）', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    setLocalViewPlayer('A');

    // ① 005 影袭：被锁的 3 点骰应可点
    const g = makeZ12();
    const ui = freshUi();
    ui.selection = {
      key: 'yingle.yingxi',
      artifactId: '005',
      side: 'left',
      stepIndex: 0,
      chosenDice: [],
      options: [],
      currentSel: new Set(),
      numbers: [],
      slots: [],
      slotModes: [],
    };
    renderGame(g, root, hooksFor(ui));
    const d3 = root.querySelector<HTMLElement>('.player--self .die[data-id="d3"]')!;
    expect(d3).not.toBeNull();
    expect(d3.classList.contains('clickable')).toBe(true);
    d3.click();
    expect(ui.selection!.currentSel.has('d3')).toBe(true);

    // ② 陷阵的"弃置"步骤：同一颗被锁的 3 点骰不可点
    const g2 = makeZ12();
    g2.pending = { kind: 'xianzhenPick', player: 'A', owner: 'A' };
    const ui2 = freshUi();
    ui2.selection = {
      key: '@xianzhenPick',
      artifactId: '',
      side: 'only',
      stepIndex: 0,
      chosenDice: [],
      options: [],
      currentSel: new Set(),
      numbers: [],
      slots: [],
      slotModes: [],
    };
    document.body.innerHTML = '';
    const root2 = document.createElement('div');
    document.body.appendChild(root2);
    renderGame(g2, root2, hooksFor(ui2));
    const d3b = root2.querySelector<HTMLElement>('.player--self .die[data-id="d3"]')!;
    expect(d3b).not.toBeNull();
    expect(d3b.classList.contains('clickable')).toBe(false);
  });
});
