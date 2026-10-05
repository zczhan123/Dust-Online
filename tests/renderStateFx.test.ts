import { describe, it, expect } from 'vitest';
import { applyAction, createGame, skipInitialReroll } from '../src/core/engine/game';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import { DEFAULT_PREFS, clonePrefs } from '../src/ui/prefs';
import type { GameState } from '../src/core/model/types';

function mount(state: GameState) {
  const root = document.createElement('div');
  const ui: UiState = {
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
  };
  const hooks: RenderHooks = {
    ui,
    onAction: () => {},
    propose: () => {},
    requestRender: () => renderGame(state, root, hooks),
    onRestart: () => {},
  };
  return { root, hooks };
}

describe('P-D 状态类（尘起"开"气泡 / 技能"用"气泡 / 阶段横幅）渲染不抛错', () => {
  it('尘起帧（rise 事件 + 换阶段）：renderGame 不抛错', () => {
    const g: GameState = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['001', '002', '003'],
      heroB: ['004', '005', '006'],
    });
    skipInitialReroll(g);
    const { root, hooks } = mount(g);
    renderGame(g, root, hooks); // 建基线（lastPhaseSnap）
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    g.players.A.areas.meditation = [{ id: 'md', value: 3, kind: 'meditation' }];
    applyAction(g, { t: 'dustRise', artifactId: '001', side: 'left', costSlots: [{ dieIds: ['md'] }] });
    expect(() => renderGame(g, root, hooks)).not.toThrow();
  });

  it('技能发动帧（skillFired）：renderGame 不抛错', () => {
    const g: GameState = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['022', '023', '024'],
      heroB: ['004', '005', '006'],
    });
    skipInitialReroll(g);
    let guard = 0;
    while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
    const a = g.players.A.artifacts.find((x) => x.id === '023')!;
    a.activeMarkerSide = 'left';
    a.armedSide = 'left';
    a.armedTurn = g.turnIndex;
    g.players.A.areas.meditation = [{ id: 'my', value: 5, kind: 'meditation' }];
    g.players.B.areas.attack = [{ id: 'theirs', value: 2, kind: 'attack' }];
    const { root, hooks } = mount(g);
    renderGame(g, root, hooks);
    applyAction(g, { t: 'skill', artifactId: '023', side: 'left', params: { dieId: 'my' } });
    expect(() => renderGame(g, root, hooks)).not.toThrow();
  });

  it('L08 没有怜悯 + 024 必杀帧（同帧"卡图气泡 + 必杀横幅"跨卡顺序）：renderGame 不抛错', () => {
    const g: GameState = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['022', '023', '024'],
      heroB: ['004', '005', '006'],
      legendA: 'L08',
    });
    skipInitialReroll(g);
    let guard = 0;
    while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
    const a024 = g.players.A.artifacts.find((x) => x.id === '024')!;
    a024.chargeLayer = a024.chargeReq ?? 0;
    a024.activeMarkerSide = 'left';
    g.dustfall = 4;
    const { root, hooks } = mount(g);
    renderGame(g, root, hooks);
    applyAction(g, { t: 'skill', artifactId: '024', side: 'only', params: { groups: [[], [], [], [], [], []], direction: 'cw' } });
    expect(() => renderGame(g, root, hooks)).not.toThrow();
  });
});

describe('4b · 计数跳动 + 充能进度条', () => {
  it('充能进度条：.sub-charge-fill 的 scaleX = y/x（随充能变化）', () => {
    const g: GameState = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    skipInitialReroll(g);
    const { root, hooks } = mount(g);
    renderGame(g, root, hooks); // 基线（充能 0）
    const a003 = g.players.A.artifacts.find((a) => a.id === '003')!; // chargeReq 4
    a003.chargeLayer = 2;
    renderGame(g, root, hooks);
    const fill = root.querySelector<HTMLElement>('.card[data-artifact="003"] .sub-charge-fill');
    expect(fill).not.toBeNull();
    expect(fill!.style.transform).toBe('scaleX(0.5)');
  });

  it('计数变化 → 徽标带 data-bump（跳动标记）', () => {
    const g: GameState = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '005', '006'], heroB: ['001', '002', '003'] });
    skipInitialReroll(g);
    const { root, hooks } = mount(g);
    renderGame(g, root, hooks); // 基线（计数 0）
    g.players.A.artifacts.find((a) => a.id === '004')!.count = 2; // 004 countCap 3
    renderGame(g, root, hooks);
    const badge = root.querySelector<HTMLElement>('.card[data-artifact="004"] .badge-count');
    expect(badge).not.toBeNull();
    expect(badge!.dataset.bump).toBe('1');
  });

  it('尘落变化 → .hint-dust 带 data-bump、数字文本更新', () => {
    const g: GameState = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    skipInitialReroll(g);
    const { root, hooks } = mount(g);
    renderGame(g, root, hooks); // 基线（尘落 0）
    g.dustfall = 3;
    renderGame(g, root, hooks);
    const dust = root.querySelector<HTMLElement>('.hint-dust');
    expect(dust).not.toBeNull();
    expect(dust!.dataset.bump).toBe('1');
    expect(dust!.querySelector('.hint-dust-num')!.textContent).toBe('3');
  });
});
