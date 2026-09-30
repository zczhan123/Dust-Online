// L09「天殇的战鬼」李封 界面：面板三行技能、必杀行"三件全激活 + 尘落≥2"门槛、遍野残杀后左右两侧同时显示为可用
import { describe, it, expect } from 'vitest';
import { setupGame } from '../src/core/engine/setup';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import type { GameState } from '../src/core/model/types';

const makeUi = (): UiState => ({
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

const mount = (state: GameState): HTMLElement => {
  const root = document.createElement('div');
  const hooks: RenderHooks = {
    onAction: () => {},
    ui: makeUi(),
    propose: () => {},
    requestRender: () => renderGame(state, root, hooks),
    onRestart: () => {},
  };
  renderGame(state, root, hooks);
  return root;
};

const l09 = (): GameState =>
  setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L09', heroA: ['025', '026', '027'], heroB: ['004', '005', '006'] });

const skillKeys = (root: HTMLElement, legendId: string): (string | undefined)[] =>
  Array.from(root.querySelectorAll(`.card-legend[data-legend="${legendId}"] .skill-part`)).map(
    (p) => (p as HTMLElement).dataset.key,
  );

describe('L09 天殇的战鬼 李封 · 面板 UI', () => {
  it('面板三行技能 key 精确对应', () => {
    const g = l09();
    g.phase = 'main';
    g.activePlayer = 'A';
    expect(skillKeys(mount(g), 'L09')).toEqual([
      'lifeng.tunhuzhilang',
      'lifeng.aozhan',
      'lifeng.bianyecansha',
    ]);
  });

  it('「遍野残杀」行灰绿：需 三件全激活 + 尘落≥2', () => {
    const g = l09();
    g.phase = 'main';
    g.activePlayer = 'A';
    const rowOn = (): boolean =>
      !!mount(g)
        .querySelector('.card-legend[data-legend="L09"] .skill-part[data-key="lifeng.bianyecansha"]')
        ?.classList.contains('skill-part--on');

    g.dustfall = 2; // 尘落够，但三件未激活
    expect(rowOn()).toBe(false);
    g.players.A.artifacts.forEach((a) => {
      a.activeMarkerSide = 'left';
    });
    expect(rowOn()).toBe(true);
    g.dustfall = 1; // 尘落不足
    expect(rowOn()).toBe(false);
  });

  it('「遍野残杀」生效后：025 左右两侧技能行都显示为可用（左右两侧均视为激活）', () => {
    const g = l09();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.artifacts.forEach((a) => {
      a.activeMarkerSide = 'left';
      a.allSidesActiveThisTurn = true;
    });
    const root = mount(g);
    // 025：左「奇袭」+ 右「横贯」两行都应为可用（skill-part--on）
    const rows025 = Array.from(root.querySelectorAll('.player--self .card[data-artifact="025"] .skill-part'));
    expect(rows025.length).toBeGreaterThanOrEqual(2);
    expect(rows025.every((r) => r.classList.contains('skill-part--on'))).toBe(true);
  });
});
