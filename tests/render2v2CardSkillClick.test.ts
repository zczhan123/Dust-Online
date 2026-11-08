// 2v2 卡面「技能行」点击发动（对齐 1v1）：
// 1v1 的技能行在"可发动"时会加 `.clickable` + `data-act="skill"` + 「点击启动技能」提示，点了直接开选择器。
// 2v2 之前完全不可点，只能从快速操作栏发动 → 这里锁住"对齐"。
// 额外锁 2v2 专有的三条：只点亮当前行动座位（四席都渲染、同名神器不能串）、持续/触发不可点、待决策时不点。
import { describe, it, expect } from 'vitest';
import { createTwoVTwoGame } from '../src/core/engine/game';
import { render2v2Game } from '../src/ui/battle2v2View';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';

/** A2 也拿 002（同名神器）：用来验证"只点亮行动座位的卡"。 */
const setup = (): TwoVTwoSetup => ({
  seats: {
    A1: ['001', '002', '003'],
    A2: ['002', '005', '006'],
    B1: ['007', '008', '009'],
    B2: ['010', '011', '012'],
  },
  firstTeam: 'A',
  seed: 7,
});

const mount = (state: ReturnType<typeof createTwoVTwoGame>) => {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const seen: unknown[] = [];
  render2v2Game(root, state, { onAction: (a) => seen.push(a), onBack: () => {} });
  return { root, seen };
};

/** 让 A1 的 002 右侧「龙腾万丈」处于可发动（已激活 + 够冥想骰）。 */
const arm002 = (state: ReturnType<typeof createTwoVTwoGame>) => {
  state.phase = 'main';
  state.activePlayer = 'A1';
  const art = state.players.A1.artifacts.find((a) => a.id === '002')!;
  art.activeMarkerSide = 'right';
  art.armedSide = 'right';
  art.armedTurn = state.turnIndex;
  state.players.A1.areas.meditation = [
    { id: 'md-1', value: 1, kind: 'meditation' },
    { id: 'md-2', value: 2, kind: 'meditation' },
    { id: 'md-3', value: 3, kind: 'meditation' },
  ] as never;
};

describe('2v2 卡面技能行点击发动（对齐 1v1）', () => {
  it('可发动的技能行带 clickable / data-act / 提示，点了直接开选择器', () => {
    const state = createTwoVTwoGame(setup());
    arm002(state);
    const { root, seen } = mount(state);

    const rows = root.querySelectorAll<HTMLElement>('.skill-part.clickable');
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.dataset.act).toBe('skill');
    expect(row.title).toBe('点击启动技能');
    // 就是 A1 的 002 右侧「龙腾万丈」
    expect(row.closest('.player')?.getAttribute('data-player')).toBe('A1');
    expect(row.closest('.card')?.getAttribute('data-artifact')).toBe('002');
    expect(row.textContent).toContain('龙腾万丈');

    row.click();
    expect(root.querySelector('.selector')).not.toBeNull();
    expect(seen).toHaveLength(0); // 有选择步骤：先开面板，不直接派发
  });

  it('持续/触发行不可点（只有"启动/激活/必杀"能点）', () => {
    const state = createTwoVTwoGame(setup());
    arm002(state);
    const { root } = mount(state);
    const card = root.querySelector<HTMLElement>('.player[data-player="A1"] .card[data-artifact="002"]')!;
    const rows = Array.from(card.querySelectorAll<HTMLElement>('.skill-part'));
    const clickable = rows.filter((r) => r.classList.contains('clickable'));
    const plain = rows.filter((r) => !r.classList.contains('clickable'));
    expect(clickable.map((r) => r.textContent?.trim())).toEqual([expect.stringContaining('龙腾万丈')]);
    // 「万象」是持续 → 永远不可点
    expect(plain.some((r) => r.textContent?.includes('万象'))).toBe(true);
    expect(plain.every((r) => r.dataset.act !== 'skill')).toBe(true);
  });

  it('同名神器：只点亮当前行动座位那张卡（A2 的 002 不可点）', () => {
    const state = createTwoVTwoGame(setup());
    arm002(state);
    const { root } = mount(state);
    expect(
      root.querySelectorAll('.player[data-player="A2"] .skill-part.clickable').length,
    ).toBe(0);
    expect(
      root.querySelectorAll('.player[data-player="B1"] .skill-part.clickable').length,
    ).toBe(0);
  });

  it('待决策优先：有待决策时卡面技能行一个都不点（不能越过引擎）', () => {
    const state = createTwoVTwoGame(setup());
    arm002(state);
    state.pending = { kind: 'tiaolingPick', player: 'A1' } as never;
    const { root } = mount(state);
    expect(root.querySelectorAll('.skill-part.clickable').length).toBe(0);
  });

  it('派发只有一处：卡面技能行与操作列表按钮共用 fireSkillAction（禁止第二套）', () => {
    const raw = import.meta.glob('../src/ui/battle2v2View.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const src = Object.values(raw)[0] ?? '';
    expect(src).toContain('const fireSkillAction');
    // 卡面行 + 操作列表按钮，两处都只调它
    expect(src).toContain('return () => fireSkillAction(a);');
    expect(src).toContain("b.addEventListener('click', () => fireSkillAction(a));");
    // "有选择步骤就开选择器"的判断只能出现一次（否则两套逻辑会漂）
    expect((src.match(/if \(startWizard\(a\)\) return;/g) ?? []).length).toBe(1);
    // 可点样式必须与 1v1 同款（clickable + data-act + 提示）
    expect(src).toContain("part.classList.add('clickable');");
    expect(src).toContain("part.dataset.act = 'skill';");
    expect(src).toContain("part.title = '点击启动技能';");
  });
});
