// L12「渡世行僧」弥云 界面：面板三行技能、闻我名者断恶行两入口（不发动 + 对方攻击骰内联骰片）
import { describe, it, expect } from 'vitest';
import { setupGame } from '../src/core/engine/setup';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import type { Action, DiceKind, Die, GameState } from '../src/core/model/types';

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

const mount = (state: GameState): { root: HTMLElement; acts: Action[] } => {
  const root = document.createElement('div');
  const acts: Action[] = [];
  const hooks: RenderHooks = {
    onAction: (a) => {
      acts.push(a);
      renderGame(state, root, hooks);
    },
    ui: makeUi(),
    propose: (a) => {
      acts.push(a);
      renderGame(state, root, hooks);
    },
    requestRender: () => renderGame(state, root, hooks),
    onRestart: () => {},
  };
  renderGame(state, root, hooks);
  return { root, acts };
};

const die = (id: string, value: number, kind: DiceKind): Die => ({ id, value, kind });

const l12 = (): GameState =>
  setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L12', heroA: ['034', '035', '036'], heroB: ['004', '005', '006'] });

describe('L12 渡世行僧 弥云 · 面板 UI', () => {
  it('面板三行技能 key 精确对应', () => {
    const g = l12();
    g.phase = 'main';
    g.activePlayer = 'A';
    const keys = Array.from(
      mount(g).root.querySelectorAll('.card-legend[data-legend="L12"] .skill-part'),
    ).map((p) => (p as HTMLElement).dataset.key);
    expect(keys).toEqual(['miyun.putixin', 'miyun.duanexing', 'miyun.lidichengfo']);
  });

  it('闻我名者断恶行待决策：不发动按钮 + 对方攻击骰内联骰片（点击即派发弃置）', () => {
    const g = l12();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.pending = { kind: 'duanexing', player: 'A' };
    g.players.B.areas.attack = [die('ba1', 3, 'attack'), die('ba2', 5, 'attack')];
    const { root, acts } = mount(g);

    const labels = Array.from(root.querySelectorAll('.actionlist button')).map((b) => b.textContent ?? '');
    expect(labels).toContain('不发动「闻我名者断恶行」');

    const chips = Array.from(root.querySelectorAll<HTMLElement>('.actionlist-chips [data-act="duanexing"]')).map(
      (c) => c.dataset.id,
    );
    expect(chips).toEqual(['ba1', 'ba2']);
    expect(root.querySelector('.actionlist-chips')!.textContent).toContain('发动「闻我名者断恶行」（弃置对方 ');

    root.querySelector<HTMLButtonElement>('.actionlist-chips [data-id="ba2"]')!.click();
    expect(acts).toEqual([{ t: 'duanexing', accept: true, dieId: 'ba2' }]);
  });
});
