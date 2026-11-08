import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render2v2DraftSetup, renderSetup } from '../src/ui/setupScreen';
import type { TwoVTwoSetup } from '../src/ui/twoVTwoSetup';

const mount = (): {
  root: HTMLElement;
  back: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
} => {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const back = vi.fn();
  const start = vi.fn();
  render2v2DraftSetup(root, back, start);
  return { root, back, start };
};

const clickFirstLegal = (root: HTMLElement): void => {
  const slot = root.querySelector<HTMLElement>('.pick-cards--4 .pick-slot.legal');
  expect(slot).not.toBeNull();
  slot!.click();
};

const finishDraft = (root: HTMLElement): void => {
  for (let i = 0; i < 12; i += 1) {
    const slot = root.querySelector<HTMLElement>('.pick-cards--4 .pick-slot.legal');
    if (!slot) break;
    slot.click();
  }
  expect(root.querySelector('.assign-stage')).not.toBeNull();
};

beforeEach(() => {
  document.documentElement.classList.remove('mode-2v2');
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('2v2 轮选界面', () => {
  it('先手准备页：A 队先手从 A1 开始，B 队先手从 B1 开始', () => {
    const a = mount();
    expect(a.root.textContent).toContain('团队作战 · 准备');
    expect(a.root.textContent).toContain('选择先手队伍');
    expect(a.root.textContent).toContain('A 队');
    expect(a.root.textContent).toContain('B 队');
    expect(a.root.textContent).toContain('使用异相神器');
    a.root.querySelector<HTMLElement>('.pick-prep-chips .pick-tbtn:nth-child(1)')!.click();
    expect(a.root.textContent).toContain('团队作战 · 轮选');
    expect(a.root.querySelector('.pick-step-who')?.textContent).toContain('玩家A1');
    expect((a.root.querySelector('.pick-step-who') as HTMLElement).style.color).toBe('rgb(37, 99, 235)');
    a.root.querySelector<HTMLElement>('.pick-back')!.click();
    expect(a.back).toHaveBeenCalledTimes(1);

    document.body.innerHTML = '<div id="app"></div>';
    const b = document.getElementById('app')!;
    const backB = vi.fn();
    render2v2DraftSetup(b, backB, vi.fn());
    b.querySelectorAll<HTMLElement>('.pick-prep-chips .pick-tbtn')[1].click();
    expect(b.querySelector('.pick-step-who')?.textContent).toContain('玩家B1');
  });

  it('轮选 12 件后进入分配；每队 6 件、每列最多 2 件', () => {
    const { root, start } = mount();
    root.querySelector<HTMLElement>('.pick-prep-chips .pick-tbtn')!.click();
    finishDraft(root);

    expect(root.textContent).toContain('团队作战 · 分配');
    expect(root.textContent).not.toContain('使用异相神器');
    expect(root.querySelector('.assign-colhead')?.textContent).toContain('玩家A1');
    expect(root.querySelector('.assign-colhead')?.textContent).toContain('A1');
    expect(root.querySelector('.assign-colhead')?.textContent).toContain('玩家A2');
    // 分配阶段每队 3 行 × 2 张 = 6 件。
    expect(root.querySelectorAll('.assign-stage .assign-slot')).toHaveLength(6);
    root.querySelector<HTMLButtonElement>('.assign-stage .assign-lock')!.click();
    expect(root.querySelector('.assign-colhead')?.textContent).toContain('玩家B1');
    expect(root.querySelector('.assign-colhead')?.textContent).toContain('玩家B2');
    expect(root.querySelectorAll('.assign-stage .assign-slot')).toHaveLength(6);
    root.querySelector<HTMLButtonElement>('.assign-stage .assign-lock')!.click();
    expect(root.querySelector('.reveal-stage')).not.toBeNull();
    expect(root.querySelectorAll('.reveal-team')).toHaveLength(4);
    expect(root.querySelectorAll('.reveal-stage [data-card-id]')).toHaveLength(12);
    expect(start).not.toHaveBeenCalled();
  });

  it('分配、亮出、实时生命和开始游戏交接完整', () => {
    const { root, start } = mount();
    root.querySelector<HTMLElement>('.pick-prep-chips .pick-tbtn')!.click();
    finishDraft(root);

    // A 封存 -> B 分配 -> B 封存 -> 亮出
    root.querySelector<HTMLButtonElement>('.assign-stage .assign-lock')!.click();
    expect(root.querySelector('.assign-stage')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('.assign-stage .assign-lock')!.click();
    expect(root.querySelector('.reveal-stage')).not.toBeNull();
    expect(root.textContent).toContain('双方同时亮出');
    expect(root.textContent).toMatch(/A 队生命 \d+.*B 队生命 \d+/);

    // 四个阶段的所有揭示卡都必须能触发右键详情所需的 data-card-id。
    expect(root.querySelector('.reveal-stage [data-card-id]')).not.toBeNull();

    root.querySelector<HTMLButtonElement>('[data-act="start2v2"]')!.click();
    expect(start).toHaveBeenCalledTimes(1);
    const setup = start.mock.calls[0][0] as TwoVTwoSetup;
    expect(setup.firstTeam).toBe('A');
    for (const seat of ['A1', 'A2', 'B1', 'B2'] as const) {
      expect(setup.seats[seat]).toHaveLength(3);
      expect(setup.seats[seat].every(Boolean)).toBe(true);
    }
  });

  it('网格、已选、分配、亮出都有技能详情数据锚点', () => {
    const { root } = mount();
    root.querySelector<HTMLElement>('.pick-prep-chips .pick-tbtn')!.click();
    expect(root.querySelector('.pick-cards--4 [data-card-id]')).not.toBeNull();
    clickFirstLegal(root);
    expect(root.querySelector('.pick-col.confirm [data-card-id]')).not.toBeNull();
    finishDraft(root);
    expect(root.querySelector('.assign-stage [data-card-id]')).not.toBeNull();
  });

  it('左右互搏 → 团队作战 → 开始游戏把四座位配置交给真实对局', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    let started: { twoVTwo?: unknown } | null = null;
    renderSetup(root, (opts) => {
      started = opts as { twoVTwo?: unknown };
    });
    root.querySelector<HTMLElement>('.menu-item[data-act="jubai"]')!.click();
    root.querySelector<HTMLElement>('.menu-item[data-act="team2v2"]')!.click();
    expect(root.querySelector('.pick-prep-title')?.textContent).toBe('选择先手队伍');

    root.querySelector<HTMLElement>('.pick-prep-chips .pick-tbtn')!.click();
    finishDraft(root);
    root.querySelector<HTMLButtonElement>('.assign-stage .assign-lock')!.click();
    root.querySelector<HTMLButtonElement>('.assign-stage .assign-lock')!.click();
    root.querySelector<HTMLButtonElement>('[data-act="start2v2"]')!.click();
    const setup = started!.twoVTwo as { seats: Record<string, string[]> };
    expect(Object.keys(setup.seats)).toEqual(['A1', 'A2', 'B1', 'B2']);
    expect(Object.values(setup.seats).flat()).toHaveLength(12);
  });

  it('切到异相后，已选、分配、亮出仍保留徽章', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const { root } = mount();
    // 准备页先打开异相，再进入轮选。
    root.querySelector<HTMLElement>('.pick-sw')!.click();
    root.querySelector<HTMLElement>('.pick-prep-chips .pick-tbtn')!.click();
    const sw = root.querySelector<HTMLElement>('.pick-cards--4 .pick-alt-switch')!;
    sw.click();
    const altBadge = root.querySelector<HTMLElement>('.pick-cards--4 .pick-alt-badge')!;
    const slot = altBadge.closest('.pick-slot') as HTMLElement;
    const altId = slot.dataset.cardId!;
    expect(altBadge).not.toBeNull();
    slot.click();
    expect(root.querySelector(`.pick-col.confirm [data-card-id="${altId}"] .pick-alt-badge`)).not.toBeNull();

    finishDraft(root);
    expect(root.querySelector('.assign-stage .pick-alt-badge')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('.assign-stage .assign-lock')!.click();
    root.querySelector<HTMLButtonElement>('.assign-stage .assign-lock')!.click();
    expect(root.querySelector('.reveal-stage .pick-alt-badge')).not.toBeNull();
  });
});
