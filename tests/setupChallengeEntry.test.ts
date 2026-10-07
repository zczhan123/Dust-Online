import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderChallengeSetup, type SetupOptions } from '../src/ui/setupScreen';

type El = HTMLElement;
const q = <T extends El = El>(root: El, sel: string): T | null => root.querySelector<T>(sel);
const qa = <T extends El = El>(root: El, sel: string): T[] => Array.from(root.querySelectorAll<T>(sel));
const click = (n: El | null | undefined): void => {
  if (!n) throw new Error('missing element');
  n.click();
};

describe('挑战模式 · 选择界面入口', () => {
  let root: HTMLDivElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  it('选满挑战者 3 件 + 选「昔日传奇」→「开始挑战」带 challengeCardId / firstPlayer=B', () => {
    const onStart = vi.fn();
    renderChallengeSetup(root, onStart);

    // 起始：未选满 → 按钮禁用
    expect(q<HTMLButtonElement>(root, '[data-act="challengeStart"]')!.disabled).toBe(true);

    // 选满挑战者 3 件（每次点"当前第一张可选"；已选列会变成"已被选取"）
    for (let i = 0; i < 3; i++) {
      click(qa(root, '.pick-col.A.cand .pick-slot.clickable')[0]);
    }

    // 选昔日传奇 = 名单第 2 位（CHALLENGES[1] = Z02 永暗之刃）
    click(qa(root, '.pick-ab.L')[1]);

    const start = q<HTMLButtonElement>(root, '[data-act="challengeStart"]')!;
    expect(start.disabled).toBe(false);
    click(start);

    expect(onStart).toHaveBeenCalledTimes(1);
    const o = onStart.mock.calls[0][0] as SetupOptions;
    expect(o.challengeCardId).toBe('Z02');
    expect(o.firstPlayer).toBe('B');
    expect(o.heroA).toHaveLength(3);
    expect(o.heroB).toEqual(['004', '005', '006']);
  });
});
