// L08「黑枪」希瓦 界面：面板三行技能（含两个"持续"的 key 精确对应）、024 必杀行在尘落≥4 可用、「只为赏金而来」抉择面板
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

const mount = (state: GameState): { root: HTMLElement; acts: Action[]; ui: UiState } => {
  const root = document.createElement('div');
  const acts: Action[] = [];
  const ui = makeUi();
  const hooks: RenderHooks = {
    onAction: (a) => {
      acts.push(a);
      renderGame(state, root, hooks);
    },
    ui,
    propose: (a, label) => {
      acts.push(a);
      renderGame(state, root, hooks);
      void label;
    },
    requestRender: () => renderGame(state, root, hooks),
    onRestart: () => {},
  };
  renderGame(state, root, hooks);
  return { root, acts, ui };
};

const die = (id: string, value: number, kind: DiceKind): Die => ({ id, value, kind });

const skillKeys = (root: HTMLElement, legendId: string): (string | undefined)[] =>
  Array.from(root.querySelectorAll(`.card-legend[data-legend="${legendId}"] .skill-part`)).map(
    (p) => (p as HTMLElement).dataset.key,
  );

const l08 = (): GameState =>
  setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L08', heroA: ['022', '023', '024'], heroB: ['004', '005', '006'] });

describe('L08 黑枪 希瓦 · 面板与抉择 UI', () => {
  it('面板三行技能 key 精确对应（两个"持续"也不串行）；L06 同类场景一并锁住', () => {
    const g = l08();
    g.phase = 'main';
    g.activePlayer = 'A';
    expect(skillKeys(mount(g).root, 'L08')).toEqual([
      'xiva.shexiezhilei',
      'xiva.zhiweishangjin',
      'xiva.meiyoulianmin',
    ]);

    // L06 也有两个「持续」（圆舞 / 死即新生）→ 修复前第二行会错误显示圆舞的 key
    const g6 = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L06', heroA: ['016', '017', '018'], heroB: ['004', '005', '006'] });
    g6.phase = 'main';
    g6.activePlayer = 'A';
    expect(skillKeys(mount(g6).root, 'L06')).toEqual([
      'xiu.yuanwu',
      'xiu.wuguanglingyu',
      'xiu.sijixinsheng',
    ]);
  });

  it('「没有怜悯」：尘落 <4 行灰；≥4 行亮，且 024 必杀行在**未充能**时也显示为可用', () => {
    const g = l08();
    g.phase = 'main';
    g.activePlayer = 'A';
    const rowOn = (root: HTMLElement, key: string): boolean =>
      !!root.querySelector(`.card-legend[data-legend="L08"] .skill-part[data-key="${key}"]`)?.classList.contains(
        'skill-part--on',
      );
    const ultRowOn = (root: HTMLElement): boolean =>
      !!root.querySelector('.player--self .card[data-artifact="024"] .skill-part--on');

    g.dustfall = 3;
    let root = mount(g).root;
    expect(rowOn(root, 'xiva.meiyoulianmin')).toBe(false);
    expect(ultRowOn(root)).toBe(false);

    g.dustfall = 4;
    root = mount(g).root;
    expect(rowOn(root, 'xiva.meiyoulianmin')).toBe(true);
    expect(ultRowOn(root)).toBe(true); // 未充能也能用（没有怜悯）
  });

  it('「只为赏金而来」待决策：操作列表出现「不发动」与「启动「畏惧」」；点后者选骰并派发 skill', () => {
    const g = l08();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.pending = { kind: 'shangjin', player: 'A' };
    const p = g.players.A;
    p.artifacts.find((a) => a.id === '023')!.activeMarkerSide = 'left'; // 畏惧（启动·左）
    p.areas.meditation = [die('m1', 3, 'meditation')];
    const { root, acts } = mount(g);

    const labels = Array.from(root.querySelectorAll('.actionlist button')).map((b) => b.textContent ?? '');
    expect(labels).toContain('不发动「只为赏金而来」');
    expect(labels).toContain('启动「畏惧」');

    root.querySelector<HTMLButtonElement>('.actionlist [data-act="shangjinOpen"]')!.click();
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="m1"]')!.click();
    const ok = Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find(
      (b) => (b.textContent ?? '').includes('确认'),
    )!;
    ok.click();
    const last = acts[acts.length - 1] as Extract<Action, { t: 'skill' }>;
    expect(last.t).toBe('skill');
    expect(last.artifactId).toBe('023');
    expect((last.params as { dieId?: string }).dieId).toBe('m1');
  });
});
