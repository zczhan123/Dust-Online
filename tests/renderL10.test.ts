// L10「破晓之剑」玛特 界面：面板三行技能、涤罪大剑术选骰面板（种类不同的实时校验）、汝等罪人两按钮
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

const l10 = (): GameState =>
  setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L10', heroA: ['028', '029', '030'], heroB: ['004', '005', '006'] });

describe('L10 破晓之剑 玛特 · 面板 UI', () => {
  it('面板三行技能 key 精确对应', () => {
    const g = l10();
    g.phase = 'main';
    g.activePlayer = 'A';
    const keys = Array.from(
      mount(g).root.querySelectorAll('.card-legend[data-legend="L10"] .skill-part'),
    ).map((p) => (p as HTMLElement).dataset.key);
    expect(keys).toEqual(['mate.dizuidaijianshu', 'mate.nudengzuiren', 'mate.chilaidezhengyi']);
  });

  it('涤罪大剑术待决策：两个按钮；选骰面板对"种类相同"禁用确认，种类不同才可派发', () => {
    const g = l10();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.pending = { kind: 'dizuidaijianshu', player: 'A' };
    g.players.B.areas.attack = [die('b1', 1, 'attack'), die('b1b', 2, 'attack')];
    g.players.B.areas.defense = [die('b2', 2, 'defense')];
    const { root, acts } = mount(g);

    const labels = Array.from(root.querySelectorAll('.actionlist button')).map((b) => b.textContent ?? '');
    expect(labels).toContain('不发动「涤罪大剑术」');
    expect(labels).toContain('弃置对方 2 颗能力骰（种类不相同）');

    root.querySelector<HTMLButtonElement>('.actionlist [data-act="dizuidaijianshuOpen"]')!.click();
    const confirm = (): HTMLButtonElement =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('.selector .btn')).find((b) =>
        (b.textContent ?? '').includes('确认'),
      )!;
    // 选两颗**同种类**（攻击）→ 确认禁用 + 提示
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="b1"]')!.click();
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="b1b"]')!.click();
    expect(confirm().disabled).toBe(true);
    expect(root.querySelector('.selector')!.textContent).toContain('种类必须不相同');

    // 换成"攻击 + 防御" → 可确认
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="b1b"]')!.click(); // 取消 b1b
    root.querySelector<HTMLElement>('.selector .pay-die[data-id="b2"]')!.click();
    expect(confirm().disabled).toBe(false);
    confirm().click();
    expect(acts).toEqual([{ t: 'dizuidaijianshu', dieIds: ['b1', 'b2'] }]);
  });

  it('汝等罪人待决策：两按钮——发动按名义量、不发动按实际可回复量（受上限封顶）', () => {
    const g = l10();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.life = g.players.A.lifeMax - 1; // 名义量 3，但实际只能回复 1
    g.pending = { kind: 'nudengzuiren', player: 'A', amount: 3 };
    const { root, acts } = mount(g);
    const labels = Array.from(root.querySelectorAll('.actionlist button')).map((b) => b.textContent ?? '');
    expect(labels).toContain('不发动「汝等罪人」（正常回复 1 点生命）');
    expect(labels).toContain('发动「汝等罪人」（改为对对方造成 3 点真实伤害）');

    const yes = Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).find((b) =>
      (b.textContent ?? '').includes('改为对对方造成'),
    )!;
    yes.click();
    expect(acts).toEqual([{ t: 'nudengzuiren', accept: true }]);
  });
});
