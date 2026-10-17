import { describe, it, expect } from 'vitest';
import { createGame, createChallengeGame, applyAction, skipInitialReroll } from '../src/core/engine/game';
import type { PendingAttack } from '../src/core/model/types';

/**
 * 回归（2026-10-16 真实事故："隐形骰子"）：
 * 挑战模式下传奇用**区域真骰**发起攻击 → 骰子留在攻击/防御区等结算（界面会先把它藏起来）。
 * 一旦攻击被 **020 兽魂** 或 **034 不动菩提** 取消/延后，解决待决策时**也必须移除源骰**，
 * 否则它永远留在区里、又永远被隐藏 → 隐形。
 */
const paOf = (sourceDieId: string, value = 5): PendingAttack => ({
  attacker: 'B',
  value,
  baseValue: value,
  unblockable: false,
  physical: false,
  sourceDieId,
  sourceValue: value,
  dieStyle: 'solid',
});

describe('挑战模式：取消/延后攻击时必须移除传奇源骰', () => {
  it('020 兽魂「不取消」→ 源骰从传奇攻击区移除', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z09', challenger: ['020', '001', '002'] });
    skipInitialReroll(g);
    g.players.B.areas.attack = [{ id: 'bx', value: 5, kind: 'attack' }];
    g.pending = { kind: 'shouhunCancel', player: 'A', owner: 'A', attack: paOf('bx'), minCount: 1 };
    const lifeBefore = g.players.A.life;
    applyAction(g, { t: 'shouhunCancel', cancel: false });
    expect(g.players.B.areas.attack.map((d) => d.id)).toEqual([]);
    expect(g.players.A.life).toBe(lifeBefore - 5);
  });

  it('020 兽魂「取消」→ 源骰同样移除、且不掉血', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z09', challenger: ['020', '001', '002'] });
    skipInitialReroll(g);
    g.players.B.areas.attack = [{ id: 'bx', value: 5, kind: 'attack' }];
    g.pending = { kind: 'shouhunCancel', player: 'A', owner: 'A', attack: paOf('bx'), minCount: 1 };
    const lifeBefore = g.players.A.life;
    applyAction(g, { t: 'shouhunCancel', cancel: true });
    expect(g.players.B.areas.attack.map((d) => d.id)).toEqual([]);
    expect(g.players.A.life).toBe(lifeBefore);
  });

  it('034 不动菩提取消攻击 → 源骰从传奇攻击区移除', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z09', challenger: ['034', '001', '002'] });
    skipInitialReroll(g);
    const jg = g.players.A.artifacts.find((a) => a.id === '034')!;
    jg.heldDice = [{ id: 'hd', value: 5 }];
    g.players.B.areas.attack = [{ id: 'bx', value: 5, kind: 'attack' }];
    g.pending = {
      kind: 'putiPick',
      player: 'A',
      owner: 'B',
      value: 5,
      mode: 'attack',
      attack: paOf('bx'),
    };
    applyAction(g, { t: 'putiResolve', accept: true });
    expect(g.players.B.areas.attack.map((d) => d.id)).toEqual([]);
  });

  it('标准模式：020 兽魂「不取消」→ 防守方战术 T14「复活」正常触发（修漏调钩子）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    skipInitialReroll(g);
    g.players.B.tactic = 'T14';
    const pa: PendingAttack = { attacker: 'A', value: 5, baseValue: 5, unblockable: false, physical: true };
    g.pending = { kind: 'shouhunCancel', player: 'B', owner: 'B', attack: pa, minCount: 1 };
    const aBefore = g.players.A.life;
    applyAction(g, { t: 'shouhunCancel', cancel: false });
    // T14：首次受到来自对方的伤害 → 对来源造成等量真实伤害
        expect(g.players.A.life).toBe(aBefore - 5);
  });
});
