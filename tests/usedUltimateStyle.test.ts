import { describe, it, expect, afterEach } from 'vitest';
import { createGame, skipInitialReroll } from '../src/core/engine/game';
import { skillUseKey } from '../src/core/engine/skill-state';
import { makeLegend } from '../src/core/content/legends';
import { renderGame, setLocalViewPlayer, type RenderHooks, type UiState } from '../src/ui/render';
import { DEFAULT_PREFS, clonePrefs } from '../src/ui/prefs';
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
  prefs: clonePrefs(DEFAULT_PREFS),
  settingsOpen: false,
  logOpen: false,
  logPop: false,
  detail: null,
  error: null,
});

const mount = (state: GameState, ui = makeUi()): HTMLElement => {
  const root = document.createElement('div');
  const hooks: RenderHooks = {
    ui,
    onAction: () => {},
    propose: () => {},
    requestRender: () => {},
    onRestart: () => {},
  };
  renderGame(state, root, hooks);
  return root;
};

const baseGame = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
  skipInitialReroll(g);
  return g;
};

afterEach(() => setLocalViewPlayer(null));

describe('「已用必杀」删除线统一（神器卡 / 传奇面板 / 卡图浮窗 同款 .skill-part--used）', () => {
  it('神器卡：已用必杀行加 .skill-part--used 且名字带删除线', () => {
    const g = baseGame();
    g.ultimatesUsed.push(skillUseKey('A', 'mingjing.ultimate'));
    const root = mount(g);
    const used = root.querySelector<HTMLElement>('.player[data-player="A"] .skill-part--used');
    expect(used).not.toBeNull();
    expect(used!.querySelector('.skill-name')?.textContent ?? '').toContain('斩神切');
  });

  it('传奇面板：已用必杀行加 .skill-part--used（此前缺）', () => {
    const g = baseGame();
    g.players.A.legend = makeLegend('L02');
    g.ultimatesUsed.push(skillUseKey('A', 'ying.zangdihua'));
    const root = mount(g);
    const used = root.querySelector<HTMLElement>('.player[data-player="A"] .skill-part--used');
    expect(used).not.toBeNull();
    expect(used!.querySelector('.skill-name')?.textContent ?? '').toContain('潸然的葬敌花');
  });

  it('卡图浮窗·神器：已用必杀行加 .skill-part--used（此前缺）', () => {
    const g = baseGame();
    g.ultimatesUsed.push(skillUseKey('A', 'mingjing.ultimate'));
    const ui = makeUi();
    ui.detail = { artifactId: '003', player: 'A', rect: { left: 0, top: 0, width: 10, height: 10 } };
    const root = mount(g, ui);
    expect(root.querySelector('.detail-popover .skill-part--used')).not.toBeNull();
  });

  it('卡图浮窗·传奇：已用必杀行加 .skill-part--used（此前缺）', () => {
    const g = baseGame();
    g.players.A.legend = makeLegend('L02');
    g.ultimatesUsed.push(skillUseKey('A', 'ying.zangdihua'));
    const ui = makeUi();
    ui.detail = { artifactId: 'L02', player: 'A', rect: { left: 0, top: 0, width: 10, height: 10 } };
    const root = mount(g, ui);
    expect(root.querySelector('.detail-popover .skill-part--used')).not.toBeNull();
  });
});
