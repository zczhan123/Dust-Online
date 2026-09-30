// L07「荒野行者 尼萨」界面：面板三行技能、020「兽魂」计数上限（L07 在场变 3）、始祖兽魂抉择、不屈咆哮选骰
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

/** 渲染并捕获 UI 派发的动作 */
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

const l07 = (): GameState =>
  setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L07', heroA: ['019', '020', '021'], heroB: ['004', '005', '006'] });

const die = (id: string, value: number, kind: DiceKind): Die => ({ id, value, kind });

const btnByText = (root: HTMLElement, sel: string, text: string): HTMLButtonElement =>
  Array.from(root.querySelectorAll<HTMLButtonElement>(sel)).find((b) => (b.textContent ?? '').includes(text))!;

describe('L07 荒野行者 尼萨 · 面板与抉择 UI', () => {
  it('面板三行技能（无尽追猎 / 始祖兽魂 / 不屈咆哮）；尘落 <2 时必杀行不绿、≥2 且「决意」计数 ≥1 才绿', () => {
    const g = l07();
    g.phase = 'main';
    g.activePlayer = 'A';
    const rowOn = (root: HTMLElement, key: string): boolean =>
      !!root
        .querySelector(`.card-legend[data-legend="L07"] .skill-part[data-key="${key}"]`)
        ?.classList.contains('skill-part--on');

    g.dustfall = 1;
    const root = mount(g).root;
    expect(
      Array.from(root.querySelectorAll('.card-legend[data-legend="L07"] .skill-part')).map(
        (p) => (p as HTMLElement).dataset.key,
      ),
    ).toEqual(['nisa.wujinzhulie', 'nisa.shizushouhun', 'nisa.buqupaoxiao']);
    expect(rowOn(root, 'nisa.buqupaoxiao')).toBe(false); // 尘落 1 < 2

    g.dustfall = 2; // 但仍需「决意」计数 ≥1
    expect(rowOn(mount(g).root, 'nisa.buqupaoxiao')).toBe(false);
    const jy = g.players.A.artifacts.find((a) => a.id === '021')!;
    jy.activeMarkerSide = 'left';
    jy.count = 1;
    expect(rowOn(mount(g).root, 'nisa.buqupaoxiao')).toBe(true);
  });

  it('「兽魂」计数上限显示 = max(卡面上限, 当前计数)：L07 在场但未加价 → 2/2（不是 2/3）；加价到 3 → 3/3；被减到 1 → 1/2；无 L07 → 2/2', () => {
    const badgeText = (g: GameState): string | undefined =>
      mount(g).root.querySelector('.player--self .card[data-artifact="020"] .badge-count')?.textContent ?? undefined;

    // L07 在场、计数 2（未加价 / 加价后被切换重设）→ 2/2（**本次回归**：修复前是 2/3）
    const g = l07();
    const s = g.players.A.artifacts.find((a) => a.id === '020')!;
    s.activeMarkerSide = 'left';
    s.count = 2;
    expect(badgeText(g)).toBe('计数 2/2');

    // 加价到 3 → 3/3
    s.count = 3;
    expect(badgeText(g)).toBe('计数 3/3');

    // 被「取消伤害 −1」到 1 → 1/2
    s.count = 1;
    expect(badgeText(g)).toBe('计数 1/2');

    // 对照：无 L07 → 2/2（上限不会变）
    const g2 = setupGame({ seed: 1, firstPlayer: 'A', heroA: ['019', '020', '021'], heroB: ['004', '005', '006'] });
    const s2 = g2.players.A.artifacts.find((a) => a.id === '020')!;
    s2.activeMarkerSide = 'left';
    s2.count = 2;
    expect(badgeText(g2)).toBe('计数 2/2');
  });

  it('始祖兽魂待决策：操作列表出现「不发动」与「额外消耗 1 个冥想骰（计数改为 3）」；点后者选骰并派发', () => {
    const g = l07();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.pending = { kind: 'shizushouhun', player: 'A', artifactId: '020' };
    g.players.A.areas.meditation = [die('m1', 3, 'meditation')];
    const { root, acts } = mount(g);

    const labels = Array.from(root.querySelectorAll('.actionlist button')).map((b) => b.textContent ?? '');
    expect(labels).toContain('不发动「始祖兽魂」');
    expect(labels).toContain('额外消耗 1 个冥想骰（计数改为 3）');

    root.querySelector<HTMLButtonElement>('.actionlist [data-act="shizushouhunOpen"]')!.click();
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="m1"]')!.click();
    btnByText(root, '.selector .btn', '确认').click();
    expect(acts).toEqual([{ t: 'shizushouhun', accept: true, costSlots: [{ dieIds: ['m1'] }] }]);
  });

  it('不屈咆哮：操作列表出现必杀按钮；点开选骰面板（跨类型选 N 颗）并派发 dieIds', () => {
    const g = l07();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.dustfall = 2;
    const jy = g.players.A.artifacts.find((a) => a.id === '021')!;
    jy.activeMarkerSide = 'left';
    jy.count = 2;
    g.players.B.areas.attack = [die('b1', 1, 'attack'), die('b2', 2, 'attack')];
    const { root, acts } = mount(g);

    const ult = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).find((b) =>
      (b.textContent ?? '').includes('不屈咆哮'),
    )!;
    expect(ult).toBeTruthy();
    ult.click();

    // 选骰面板：跨类型、恰好 2 颗
    expect(root.querySelector('.selector')).not.toBeNull();
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="b1"]')!.click();
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="b2"]')!.click();
    btnByText(root, '.selector .btn', '确认').click();
    const last = acts[acts.length - 1] as Extract<Action, { t: 'skill' }>;
    expect(last.t).toBe('skill');
    expect(last.artifactId).toBe('L07');
    expect((last.params as { dieIds?: string[] }).dieIds).toEqual(['b1', 'b2']);
  });
});
