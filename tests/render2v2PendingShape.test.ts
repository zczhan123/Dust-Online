// 2v2「纯选对象型待决策」的**通用形状**门禁（2026-11-07）。
//
// 规则：引擎只给「接受 / 放弃」、且"接受"除了**打谁**之外没有任何其它参数要选 → 合成一行
//       `目标 [玩家B1] [玩家B2] [不发动「X」]`，点目标即提出动作。
// 判定在**形状**层（不按卡号），所以现在的 010 杀意 / 011 灵能脉冲 / A02 哀悼（无防御骰版）
// 必须是同一个形状；而"纯是/否、没有对象"（雷暴·重掷 / 慈悲）和"还要选骰"（009 高塔铁幕）**不得**被合并。
import { describe, it, expect } from 'vitest';
import { createTwoVTwoGame } from '../src/core/engine/game';
import { render2v2Game } from '../src/ui/battle2v2View';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';
import type { GameState } from '../src/core/model/types';

const setup = (): TwoVTwoSetup => ({
  seats: {
    A1: ['010', '011', '012'],
    A2: ['001', '002', '003'],
    B1: ['004', '005', '006'],
    B2: ['007', '008', '009'],
  },
  firstTeam: 'A',
  seed: 7,
  dice: {
    A1: { attack: [3, 4], defense: [2], meditation: [] },
    B1: { attack: [], defense: [], meditation: [] },
    B2: { attack: [], defense: [], meditation: [] },
  },
});

const mount = (g: GameState) => {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const seen: Array<Record<string, unknown>> = [];
  render2v2Game(root, g, { onAction: (a) => seen.push(a as never), onBack: () => {} });
  return { root, seen };
};

const texts = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLButtonElement>('.actionlist button')).map((b) => b.textContent ?? '');

/** 起一局并把 pending 摆好（phase/active 与引擎枚举前提一致）。 */
const withPending = (pending: unknown): GameState => {
  const g = createTwoVTwoGame(setup());
  g.phase = 'main';
  g.activePlayer = 'A1';
  g.pending = pending as never;
  return g;
};

describe('2v2 纯选对象型待决策（通用形状）', () => {
  it('010 杀意 与 011 灵能脉冲 必须是**同一个形状**（只有技能名不同）', () => {
    const shape = (kind: 'shenhongKill' | 'dunwuPulse', skill: string) => {
      const g = withPending(
        kind === 'shenhongKill'
          ? { kind, player: 'A1' }
          : { kind, player: 'A1', amount: 3 },
      );
      const { root } = mount(g);
      const row = root.querySelector<HTMLElement>('.actionlist .option-row--decide')!;
      expect(row).not.toBeNull();
      return {
        buttons: texts(root).map((t) => t.replace(`「${skill}」`, '「X」')),
        label: row.querySelector('.selector-hint')?.textContent,
        choices: Array.from(row.querySelectorAll<HTMLElement>('[data-choice]')).map(
          (b) => b.dataset.choice,
        ),
      };
    };
    expect(shape('shenhongKill', '杀意')).toEqual(shape('dunwuPulse', '灵能脉冲'));
    expect(shape('shenhongKill', '杀意')).toEqual({
      buttons: ['玩家B1', '玩家B2', '不发动「X」'],
      label: '目标',
      choices: ['B1', 'B2', 'decline'],
    });
  });

  it('A02 哀悼（对方无防御骰）：形状相同 → 证明是"按形状"而不是按卡号', () => {
    const g = withPending({ kind: 'aidao', player: 'A1' });
    const { root, seen } = mount(g);
    const row = root.querySelector<HTMLElement>('.actionlist .option-row--decide')!;
    expect(row).not.toBeNull();
    expect(texts(root)).toEqual(['玩家B1', '玩家B2', '不发动「哀悼」']);

    // 选第二个敌人也能正确派发（不再只能打第一个）
    row.querySelector<HTMLElement>('[data-choice="B2"]')!.click();
    root.querySelector<HTMLButtonElement>('.confirm-row .btn-skill')!.click();
    expect(seen[0]).toMatchObject({ t: 'aidao', accept: true, target: 'B2' });
  });

  it('A02 哀悼（对方有防御骰）：要选骰 → **不合并**，且文案写明弃置防御骰', () => {
    const g = withPending({ kind: 'aidao', player: 'A1' });
    g.players.B1.areas.defense = [{ id: 'df-b1', value: 3, kind: 'defense' }] as never;
    const { root } = mount(g);
    expect(root.querySelector('.option-row--decide')).toBeNull();
    expect(texts(root)).toEqual(['不发动「哀悼」', '发动「哀悼」（弃置对方 1 个防御骰）']);
  });

  it('雷暴·重掷（纯是/否、没有对象）：保留「发动」入口，不得合并', () => {
    const g = withPending({ kind: 'leibaoReroll', player: 'A1' });
    const { root } = mount(g);
    expect(root.querySelector('.option-row--decide')).toBeNull();
    expect(texts(root)).toEqual(['发动「雷暴」进行额外重掷', '不发动「雷暴」']);
  });

  it('慈悲（纯是/否、没有对象）：保留「发动」入口，不得合并', () => {
    const g = withPending({ kind: 'ciBei', player: 'A1', amount: 4 });
    const { root } = mount(g);
    expect(root.querySelector('.option-row--decide')).toBeNull();
    expect(texts(root)).toEqual([
      '发动「慈悲」（取消 4 点伤害，改为回复 4 点生命）',
      '不发动「慈悲」',
    ]);
  });

  it('009 高塔铁幕·取消（要选骰）：不得合并（骰片 + 「不发动「高塔铁幕」」）', () => {
    const g = withPending({ kind: 'guwangCancel', player: 'A1', amount: 3 });
    g.players.A1.areas.defense = [{ id: 'df-a1', value: 2, kind: 'defense' }] as never;
    const { root } = mount(g);
    expect(root.querySelector('.option-row--decide')).toBeNull();
    expect(root.querySelector('.actionlist .pay-die[data-act="guwangCancel"]')).not.toBeNull();
    expect(texts(root)).toContain('不发动「高塔铁幕」');
  });
});
