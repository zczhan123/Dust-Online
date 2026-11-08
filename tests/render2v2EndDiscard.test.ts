// 2v2「待决策弃骰」三种面板必须与 1v1 同款：
// 入口按钮（`btn btn-skill`）→ `.selector` 面板 → `.pay-die` 骰片 → `btn btn-confirm`（不是 `.option-btn` 文字按钮）。
// 真实事故：2v2 手搓了一套 `.option-btn` 面板，按钮样式、双入口、确认态全跟 1v1 不一样。
import { describe, it, expect } from 'vitest';
import { createTwoVTwoGame } from '../src/core/engine/game';
import { render2v2Game } from '../src/ui/battle2v2View';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';
import type { Action } from '../src/core/model/types';

const setup = (): TwoVTwoSetup => ({
  seats: {
    A1: ['001', '002', '003'],
    A2: ['004', '005', '006'],
    B1: ['007', '008', '009'],
    B2: ['010', '011', '012'],
  },
  firstTeam: 'A',
  seed: 7,
});

type Case = {
  name: string;
  pending: unknown;
  act: string;
  label: string;
  /** 面板第一步是不是"选项步"（死亡亦逝有 ①/②） */
  firstStepIsOption: boolean;
  /** 该玩家区域里的骰子总数（决定"要弃几颗"→ 确认按钮初始禁用） */
  diceCount: number;
};

const CASES: Case[] = [
  {
    name: '结束阶段·超出意志上限',
    pending: { kind: 'endDiscard', player: 'A1' },
    act: 'endDiscardOpen',
    label: '结束阶段：弃置超出意志上限的能力骰',
    firstStepIsOption: false,
    // 10 颗 > 意志上限（8）→ 必须弃 2 颗，确认按钮初始禁用
    diceCount: 10,
  },
  {
    name: '035 千劫·万丈明光',
    pending: { kind: 'wanzhangDiscard', player: 'A1' },
    act: 'wanzhangOpen',
    label: '「万丈明光」：弃置能力骰',
    firstStepIsOption: false,
    diceCount: 4,
  },
  {
    name: '033 凋零·死亡亦逝',
    pending: { kind: 'tiaolingPick', player: 'A1' },
    act: 'tiaolingOpen',
    label: '「死亡亦逝」：弃置自己的能力骰',
    firstStepIsOption: true,
    diceCount: 4,
  },
];

/** 造出一批点数互不相同的骰（`tiaolingPick` 的"保留全相同"因此一开始不合法 → 确认禁用） */
const makeDice = (n: number, kind: 'attack' | 'defense' | 'meditation') =>
  Array.from({ length: n }, (_, i) => ({ id: `x-${kind}-${i}`, value: (i % 6) + 1, kind })) as never;

describe('2v2 待决策弃骰：三张卡同款面板（对齐 1v1）', () => {
  for (const c of CASES) {
    it(`${c.name}：入口按钮 + .selector 面板 + .pay-die 骰片 + btn-confirm`, () => {
      document.body.innerHTML = '<div id="app"></div>';
      const root = document.getElementById('app')!;
      const state = createTwoVTwoGame(setup());
      state.phase = 'main';
      state.activePlayer = 'A1';
      state.players.A1.areas.attack = makeDice(c.diceCount, 'attack');
      state.players.A1.areas.defense = [] as never;
      state.players.A1.areas.meditation = [] as never;
      state.pending = c.pending as never;
      const seen: Action[] = [];
      render2v2Game(root, state, { onAction: (a) => seen.push(a), onBack: () => {} });

      // ① 入口按钮：唯一来源，class/文案/data-act 都对齐 1v1
      const open = root.querySelector<HTMLButtonElement>(`[data-act="${c.act}"]`);
      expect(open).not.toBeNull();
      expect(open!.className).toBe('btn btn-skill');
      expect(open!.textContent).toBe(c.label);
      expect(seen).toEqual([]); // 点入口只开面板，不直接派发

      open!.click();
      expect(root.querySelector('.selector')).not.toBeNull();
      expect(root.querySelector('.selector .btn-cancel')).not.toBeNull();
      // ② 第二步（或第一步）就是骰片，不是文字按钮
      if (c.firstStepIsOption) {
        expect(root.querySelectorAll('.selector .option-btn').length).toBe(2);
        root.querySelector<HTMLButtonElement>('.selector .option-btn')!.click();
      } else {
        expect(root.querySelector('.selector .option-btn')).toBeNull();
      }
      expect(root.querySelectorAll('.selector .pay-dice .pay-die').length).toBe(c.diceCount);
      // ③ 确认按钮＝1v1 的 `.btn-confirm` + 文案「确认」
      const confirm = root.querySelector<HTMLButtonElement>('.selector .btn-confirm');
      expect(confirm).not.toBeNull();
      expect(confirm!.textContent).toBe('确认');
      expect(confirm!.disabled).toBe(true);
    });
  }

  it('通用动作循环必须跳过这三种动作（否则会多出重复的纯文字按钮）', () => {
    const raw = import.meta.glob('../src/ui/battle2v2View.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const src = Object.values(raw)[0] ?? '';
    expect(src).toContain("a.t === 'endDiscardResolve'");
    expect(src).toContain("a.t === 'wanzhangDiscard'");
    expect(src).toContain("a.t === 'tiaolingResolve'");
  });
});
