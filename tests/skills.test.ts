import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll, beginTurn } from '../src/core/engine/game';
import { totalDice, effectiveWill } from '../src/core/engine/derive';
import { virtualAttack } from '../src/core/engine/combat';
import { applyTurnStartEffects } from '../src/core/engine/skills';

describe('basic activate skills', () => {
  it('淬炼 consumes an attack die and increments 不祥 count (cap 3)', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '002', '003'] });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' }); // -> main
    const buxiang = g.players.A.artifacts.find((a) => a.id === '004')!;
    buxiang.activeMarkerSide = 'left';
    g.players.A.areas.attack.push({ id: 'x', value: 3, kind: 'attack' });
    applyAction(g, { t: 'skill', artifactId: '004', side: 'left', params: { attackDieId: 'x' } });
    expect(buxiang.count).toBe(1);
    expect(g.players.A.areas.attack.some((d) => d.id === 'x')).toBe(false);
  });

  it('龙腾万丈 consumes 3 meditation dice, gains 4, moves 2 to attack and adds +1 damage', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' });
    const youlong = g.players.A.artifacts.find((a) => a.id === '002')!;
    youlong.activeMarkerSide = 'right';
    while (g.players.A.areas.meditation.length < 3) {
      g.players.A.areas.meditation.push({ id: `m${g.players.A.areas.meditation.length}`, value: 2, kind: 'meditation' });
    }
    const medIds = g.players.A.areas.meditation.slice(0, 3).map((d) => d.id);
    const before = totalDice(g.players.A);
    const atkBefore = g.players.A.areas.attack.length;
    applyAction(g, { t: 'skill', artifactId: '002', side: 'right', params: { meditationDieIds: medIds } });
    expect(totalDice(g.players.A)).toBe(before - 3 + 4);
    expect(g.players.A.areas.attack.length).toBe(atkBefore + 2);
    expect(g.players.A.buffs.some((b) => b.attr === 'attackDamage' && b.add === 1)).toBe(true);
  });

  it('潜行 consumes 2 attack dice and gains 2 defense + 1 meditation', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    g.activePlayer = 'B';
    g.phase = 'main';
    const a = g.players.B.artifacts.find((x) => x.id === '005')!;
    a.activeMarkerSide = 'right';
    g.players.B.areas.attack.push({ id: 'p1', value: 3, kind: 'attack' }, { id: 'p2', value: 4, kind: 'attack' });
    const defBefore = g.players.B.areas.defense.length;
    const medBefore = g.players.B.areas.meditation.length;
    applyAction(g, { t: 'skill', artifactId: '005', side: 'right', params: { attackDieIds: ['p1', 'p2'] } });
    expect(g.players.B.areas.defense.length).toBe(defBefore + 2);
    expect(g.players.B.areas.meditation.length).toBe(medBefore + 1);
  });

  it('rejects activating a skill that is not active', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' });
    g.players.A.areas.attack.push({ id: 'x', value: 3, kind: 'attack' });
    expect(() => applyAction(g, { t: 'skill', artifactId: '004', side: 'left', params: { attackDieId: 'x' } })).toThrow();
  });

  it('rejects using the same activate skill twice in one turn', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '002', '003'] });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' });
    const buxiang = g.players.A.artifacts.find((a) => a.id === '004')!;
    buxiang.activeMarkerSide = 'left';
    g.players.A.areas.attack.push({ id: 'x1', value: 3, kind: 'attack' }, { id: 'x2', value: 4, kind: 'attack' });
    applyAction(g, { t: 'skill', artifactId: '004', side: 'left', params: { attackDieId: 'x1' } });
    expect(() => applyAction(g, { t: 'skill', artifactId: '004', side: 'left', params: { attackDieId: 'x2' } })).toThrow();
  });
});

import { getLegalActions } from '../src/core/engine/game';

describe('charge effects', () => {
  it('明镜 charge grants a free extra dust rise (not counting the 1/round limit)', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    g.players.A.areas.meditation.push({ id: 'm0', value: 2, kind: 'meditation' });
    applyAction(g, { t: 'dustRise', artifactId: '003', meditationDieId: 'm0' });
    expect(g.players.A.artifacts.find((a) => a.id === '003')!.chargeLayer).toBe(1);
    expect(g.freeDustRise).toBe(1);
    expect(getLegalActions(g).some((a) => a.t === 'dustRise')).toBe(true);
    // 用掉这次额外尘起（再次充能 → 又获得 1 次额外）
    g.players.A.areas.meditation.push({ id: 'm1', value: 3, kind: 'meditation' });
    applyAction(g, { t: 'dustRise', artifactId: '003', meditationDieId: 'm1' });
    expect(g.players.A.artifacts.find((a) => a.id === '003')!.chargeLayer).toBe(2);
    expect(g.freeDustRise).toBe(1);
  });

  it('完杀 charge grants an attack die equal to the charge layer', () => {
    const g = createGame({ seed: 1, firstPlayer: 'B' }); // B 持 006
    skipInitialReroll(g);
    g.players.B.areas.meditation.push({ id: 'm0', value: 2, kind: 'meditation' });
    const before = g.players.B.areas.attack.length;
    applyAction(g, { t: 'dustRise', artifactId: '006', meditationDieId: 'm0' });
    const wansha = g.players.B.artifacts.find((a) => a.id === '006')!;
    expect(wansha.chargeLayer).toBe(1);
    expect(g.players.B.areas.attack.length).toBe(before + 1);
    expect(g.players.B.areas.attack[g.players.B.areas.attack.length - 1]!.value).toBe(1);
  });

  it('charging a col3 artifact via dust seal also triggers its charge effect', () => {
    const g = createGame({ seed: 1, firstPlayer: 'B' });
    skipInitialReroll(g);
    g.players.B.hasDustSeal = true;
    const before = g.players.B.areas.attack.length;
    applyAction(g, { t: 'dustRise', artifactId: '006', useSeal: true });
    expect(g.players.B.artifacts.find((a) => a.id === '006')!.chargeLayer).toBe(1);
    expect(g.players.B.areas.attack.length).toBe(before + 1);
  });
});

describe('中央突破', () => {
  it('consumes 3 meditation dice and discards the chosen opponent defense dice, granting unblockable', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' }); // -> main
    g.players.A.artifacts.find((a) => a.id === '001')!.activeMarkerSide = 'left';
    while (g.players.A.areas.meditation.length < 3) {
      g.players.A.areas.meditation.push({ id: `m${g.players.A.areas.meditation.length}`, value: 2, kind: 'meditation' });
    }
    while (g.players.B.areas.defense.length < 3) {
      g.players.B.areas.defense.push({ id: `d${g.players.B.areas.defense.length}`, value: 3, kind: 'defense' });
    }
    const oppDef = g.players.B.areas.defense.slice(0, 3).map((d) => d.id);
    const bDefBefore = g.players.B.areas.defense.length;
    const medIds = g.players.A.areas.meditation.slice(0, 3).map((d) => d.id);
    applyAction(g, { t: 'skill', artifactId: '001', side: 'left', params: { meditationDieIds: medIds, opponentDefenseDieIds: oppDef } });
    expect(g.unblockableThisTurn).toBe(true);
    expect(g.players.B.areas.defense.length).toBe(bDefBefore - 3);
  });

  it('an unblockable attack deals damage even if a defense die is offered', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' });
    g.players.A.artifacts.find((a) => a.id === '001')!.activeMarkerSide = 'left';
    while (g.players.A.areas.meditation.length < 3) {
      g.players.A.areas.meditation.push({ id: `m${g.players.A.areas.meditation.length}`, value: 2, kind: 'meditation' });
    }
    while (g.players.B.areas.defense.length < 3) {
      g.players.B.areas.defense.push({ id: `d${g.players.B.areas.defense.length}`, value: 3, kind: 'defense' });
    }
    const oppDef = g.players.B.areas.defense.slice(0, 3).map((d) => d.id);
    const medIds = g.players.A.areas.meditation.slice(0, 3).map((d) => d.id);
    applyAction(g, { t: 'skill', artifactId: '001', side: 'left', params: { meditationDieIds: medIds, opponentDefenseDieIds: oppDef } });
    g.players.A.areas.attack.push({ id: 'a1', value: 5, kind: 'attack' });
    applyAction(g, { t: 'attack', dieId: 'a1' });
    expect(g.pendingAttack!.unblockable).toBe(true);
    const def = g.players.B.areas.defense[0];
    const lifeBefore = g.players.B.life;
    applyAction(g, { t: 'block', dieId: def?.id });
    expect(g.players.B.life).toBe(lifeBefore - 5);
  });

  it('中央突破 consumes the SPECIFIC meditation dice chosen', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' });
    g.players.A.artifacts.find((a) => a.id === '001')!.activeMarkerSide = 'left';
    g.players.A.areas.meditation = [
      { id: 'm1', value: 2, kind: 'meditation' },
      { id: 'm2', value: 5, kind: 'meditation' },
      { id: 'm3', value: 5, kind: 'meditation' },
      { id: 'm4', value: 2, kind: 'meditation' },
    ];
    g.players.B.areas.defense = [{ id: 'bd1', value: 1, kind: 'defense' }];
    applyAction(g, { t: 'skill', artifactId: '001', side: 'left', params: { meditationDieIds: ['m2', 'm3'], opponentDefenseDieIds: ['bd1'] } });
    // m2, m3 consumed; m1, m4 remain
    expect(g.players.A.areas.meditation.map((d) => d.id).sort()).toEqual(['m1', 'm4']);
    expect(g.players.B.areas.defense.length).toBe(0);
    expect(g.unblockableThisTurn).toBe(false); // only 2 consumed
  });

  it('virtualAttack is not physical', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    virtualAttack(g, 'A', 4);
    expect(g.pendingAttack).toMatchObject({ value: 4, physical: false });
  });
});

describe('影袭', () => {
  it('lowers a die by X, moves it by its new value, and makes a virtual X attack', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    g.activePlayer = 'B';
    g.phase = 'main';
    g.players.B.artifacts.find((a) => a.id === '005')!.activeMarkerSide = 'left';
    g.players.B.areas.attack.push({ id: 'v1', value: 6, kind: 'attack' });
    applyAction(g, { t: 'skill', artifactId: '005', side: 'left', params: { dieId: 'v1', x: 4 } });
    // 6-4=2 → 攻击区（影掠 攻击 1/2/6）
    expect(g.players.B.areas.attack.some((d) => d.id === 'v1' && d.value === 2)).toBe(true);
    expect(g.pendingAttack).toMatchObject({ value: 4, physical: false, attacker: 'B' });
  });

  it('moves the die to another area when the new value belongs there', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    g.activePlayer = 'B';
    g.phase = 'main';
    g.players.B.artifacts.find((a) => a.id === '005')!.activeMarkerSide = 'left';
    g.players.B.areas.attack.push({ id: 'v2', value: 6, kind: 'attack' });
    applyAction(g, { t: 'skill', artifactId: '005', side: 'left', params: { dieId: 'v2', x: 2 } });
    // 6-2=4 → 冥想区（影掠 冥想 4/5）
    expect(g.players.B.areas.meditation.some((d) => d.id === 'v2' && d.value === 4)).toBe(true);
  });

  it('rejects X that would reduce the die below 1 (no 3-3=1 weirdness)', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    g.activePlayer = 'B';
    g.phase = 'main';
    g.players.B.artifacts.find((a) => a.id === '005')!.activeMarkerSide = 'left';
    g.players.B.areas.attack.push({ id: 'v3', value: 3, kind: 'attack' });
    // x=3 would give 3-3=0 → invalid (max x is 2)
    expect(() =>
      applyAction(g, { t: 'skill', artifactId: '005', side: 'left', params: { dieId: 'v3', x: 3 } }),
    ).toThrow();
    // x=2 is allowed → die becomes exactly 1, attack = 2
    applyAction(g, { t: 'skill', artifactId: '005', side: 'left', params: { dieId: 'v3', x: 2 } });
    expect(g.pendingAttack).toMatchObject({ value: 2, physical: false });
    expect(g.players.B.areas.attack.some((d) => d.id === 'v3' && d.value === 1)).toBe(true);
  });
});

describe('裁雨流 / 锋芒触发', () => {
  it('裁雨流 offers to move the physical attack die after damage; accepting places it', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' }); // -> main
    g.players.A.artifacts.find((a) => a.id === '001')!.activeMarkerSide = 'right';
    g.players.A.areas.attack.push({ id: 'atk1', value: 5, kind: 'attack' });
    applyAction(g, { t: 'attack', dieId: 'atk1' });
    applyAction(g, { t: 'block' }); // B does not block
    expect(g.pending).toMatchObject({ kind: 'caiyuliu', player: 'A', dieId: 'atk1', value: 5 });
    applyAction(g, { t: 'caiyuliu', to: 'defense' });
    expect(g.players.A.areas.defense.some((d) => d.id === 'atk1' && d.value === 5)).toBe(true);
    expect(g.caiyuliuUsed).toBe(1);
  });

  it('裁雨流 does not trigger for a virtual (skill) attack', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '005', '003'] });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' });
    g.players.A.artifacts.find((a) => a.id === '001')!.activeMarkerSide = 'right';
    g.players.A.artifacts.find((a) => a.id === '005')!.activeMarkerSide = 'left';
    g.players.A.areas.attack.push({ id: 'v1', value: 6, kind: 'attack' });
    applyAction(g, { t: 'skill', artifactId: '005', side: 'left', params: { dieId: 'v1', x: 2 } });
    expect(g.pendingAttack).toMatchObject({ physical: false });
    applyAction(g, { t: 'block' }); // virtual attack deals damage
    expect(g.pending).toBeNull();
  });

  it('锋芒·触发: after a block, the attacker may pay to cancel and deal +2 true damage', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '002', '003'] });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' });
    g.players.A.artifacts.find((a) => a.id === '004')!.activeMarkerSide = 'right';
    g.players.A.areas.attack.push({ id: 'a1', value: 5, kind: 'attack' });
    g.players.A.areas.attack.push({ id: 'a2', value: 3, kind: 'attack' });
    g.players.A.areas.meditation.push({ id: 'mm', value: 2, kind: 'meditation' });
    g.players.B.areas.defense.push({ id: 'd1', value: 3, kind: 'defense' });
    applyAction(g, { t: 'attack', dieId: 'a1' });
    applyAction(g, { t: 'block', dieId: 'd1' });
    expect(g.pending).toMatchObject({ kind: 'fengmang', player: 'A', defenderId: 'B', value: 5 });
    const lifeBefore = g.players.B.life;
    applyAction(g, { t: 'fengmang', accept: true, attackDieId: 'a2', meditationDieId: 'mm' });
    expect(g.players.B.life).toBe(lifeBefore - 5 - 2);
  });

  it('锋芒·触发: declining changes nothing', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '002', '003'] });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' });
    g.players.A.artifacts.find((a) => a.id === '004')!.activeMarkerSide = 'right';
    g.players.A.areas.attack.push({ id: 'a1', value: 5, kind: 'attack' });
    g.players.B.areas.defense.push({ id: 'd1', value: 3, kind: 'defense' });
    applyAction(g, { t: 'attack', dieId: 'a1' });
    applyAction(g, { t: 'block', dieId: 'd1' });
    const lifeBefore = g.players.B.life;
    applyAction(g, { t: 'fengmang', accept: false });
    expect(g.players.B.life).toBe(lifeBefore);
    expect(g.pending).toBeNull();
  });
});

describe('必杀', () => {
  it('斩神切: discards all own dice + matching opponent dice, deals true damage, gains 3 defense dice', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' }); // A has 003 明镜
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' }); // -> main
    g.players.A.artifacts.find((a) => a.id === '003')!.activeMarkerSide = 'left';
    g.players.A.areas = {
      attack: [{ id: 'a1', value: 3, kind: 'attack' }, { id: 'a2', value: 4, kind: 'attack' }],
      defense: [{ id: 'd1', value: 1, kind: 'defense' }, { id: 'd2', value: 6, kind: 'defense' }],
      meditation: [{ id: 'm1', value: 2, kind: 'meditation' }, { id: 'm2', value: 5, kind: 'meditation' }],
    };
    g.players.B.areas.attack = [];
    g.players.B.areas.defense = [
      { id: 'bd1', value: 3, kind: 'defense' },
      { id: 'bd2', value: 3, kind: 'defense' },
      { id: 'bd3', value: 3, kind: 'defense' },
    ];
    g.players.B.areas.meditation = [{ id: 'bm1', value: 4, kind: 'meditation' }];
    const lifeBefore = g.players.B.life;
    applyAction(g, { t: 'skill', artifactId: '003', side: 'only' });
    // 己方弃 6；对方弃 1 冥想 + 2 防御 = 3；X = 9
    expect(g.players.B.life).toBe(lifeBefore - 9);
    expect(g.players.A.areas.defense.length).toBe(3); // 获得 3 防御骰
    expect(g.players.A.areas.attack.length).toBe(0);
    expect(g.ultimatesUsed).toContain('mingjing.ultimate');
    expect(() => applyAction(g, { t: 'skill', artifactId: '003', side: 'only' })).toThrow();
  });

  it('零时枭首: discards X defense dice; if any remain, gains X attack dice', () => {
    const g = createGame({ seed: 1, firstPlayer: 'B' }); // B has 006 完杀
    g.activePlayer = 'B';
    g.phase = 'main';
    g.players.B.artifacts.find((a) => a.id === '006')!.activeMarkerSide = 'left';
    g.players.B.areas.attack = [{ id: 'k1', value: 3, kind: 'attack' }];
    g.players.A.areas.defense = [
      { id: 'x1', value: 1, kind: 'defense' },
      { id: 'x2', value: 2, kind: 'defense' },
      { id: 'x3', value: 3, kind: 'defense' },
      { id: 'x4', value: 4, kind: 'defense' },
      { id: 'x5', value: 5, kind: 'defense' },
    ];
    applyAction(g, { t: 'skill', artifactId: '006', side: 'only', params: { attackDieId: 'k1' } });
    expect(g.players.A.areas.defense.length).toBe(2); // 3 discarded
    expect(g.players.B.areas.attack.length).toBe(3); // gained 3
    expect(g.ultimatesUsed).toContain('wansha.ultimate');
  });

  it('零时枭首: gains nothing when opponent has no defense dice left', () => {
    const g = createGame({ seed: 1, firstPlayer: 'B' });
    g.activePlayer = 'B';
    g.phase = 'main';
    g.players.B.artifacts.find((a) => a.id === '006')!.activeMarkerSide = 'left';
    g.players.B.areas.attack = [{ id: 'k1', value: 3, kind: 'attack' }];
    g.players.A.areas.defense = [{ id: 'x1', value: 1, kind: 'defense' }];
    applyAction(g, { t: 'skill', artifactId: '006', side: 'only', params: { attackDieId: 'k1' } });
    expect(g.players.A.areas.defense.length).toBe(0);
    expect(g.players.B.areas.attack.length).toBe(0);
  });
});

describe('007 主宰', () => {
  const setup007 = (side: 'left' | 'right') => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['007', '002', '003'] });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' }); // -> main
    g.players.A.artifacts.find((a) => a.id === '007')!.activeMarkerSide = side;
    return g;
  };

  it('战争横扫: consumes one of each, discards the chosen opponent dice, deals floor(sum/2) true damage', () => {
    const g = setup007('left');
    g.players.A.areas.attack = [{ id: 'sa', value: 5, kind: 'attack' }];
    g.players.A.areas.defense = [{ id: 'sd', value: 3, kind: 'defense' }];
    g.players.A.areas.meditation = [{ id: 'sm', value: 4, kind: 'meditation' }];
    g.players.B.areas.attack = [{ id: 'oa', value: 2, kind: 'attack' }];
    g.players.B.areas.defense = [{ id: 'od', value: 2, kind: 'defense' }];
    g.players.B.areas.meditation = [{ id: 'om', value: 2, kind: 'meditation' }];
    const lifeBefore = g.players.B.life;
    applyAction(g, {
      t: 'skill',
      artifactId: '007',
      side: 'left',
      params: {
        consumed: { attack: 'sa', defense: 'sd', meditation: 'sm' },
        discard: { attack: 'oa', defense: 'od', meditation: 'om' },
      },
    });
    // sum = 5+3+4 = 12 -> 6 true damage
    expect(g.players.B.life).toBe(lifeBefore - 6);
    expect(g.players.A.areas.attack).toHaveLength(0);
    expect(g.players.A.areas.defense).toHaveLength(0);
    expect(g.players.A.areas.meditation).toHaveLength(0);
    expect(g.players.B.areas.attack).toHaveLength(0);
    expect(g.players.B.areas.defense).toHaveLength(0);
    expect(g.players.B.areas.meditation).toHaveLength(0);
  });

  it('战争横扫 FAQ 7.1.1: still activates when the opponent is missing a die type', () => {
    const g = setup007('left');
    g.players.A.areas.attack = [{ id: 'sa', value: 3, kind: 'attack' }];
    g.players.A.areas.defense = [{ id: 'sd', value: 3, kind: 'defense' }];
    g.players.A.areas.meditation = [{ id: 'sm', value: 4, kind: 'meditation' }];
    g.players.B.areas.attack = [];
    g.players.B.areas.defense = [{ id: 'od', value: 2, kind: 'defense' }];
    g.players.B.areas.meditation = [];
    const lifeBefore = g.players.B.life;
    applyAction(g, {
      t: 'skill',
      artifactId: '007',
      side: 'left',
      params: {
        consumed: { attack: 'sa', defense: 'sd', meditation: 'sm' },
        discard: { defense: 'od' },
      },
    });
    // sum = 3+3+4 = 10 -> 5 true damage; opponent has no attack/meditation dice to discard
    expect(g.players.B.life).toBe(lifeBefore - 5);
    expect(g.players.B.areas.defense).toHaveLength(0);
    expect(g.players.A.areas.attack).toHaveLength(0);
    expect(g.players.A.areas.defense).toHaveLength(0);
    expect(g.players.A.areas.meditation).toHaveLength(0);
  });

  it('震荡斩击: consumes 4 same-type dice, discards up to 4 opponent same-type, deals floor(sum/2)', () => {
    const g = setup007('right');
    g.players.A.areas.attack = [
      { id: 'c1', value: 2, kind: 'attack' },
      { id: 'c2', value: 3, kind: 'attack' },
      { id: 'c3', value: 4, kind: 'attack' },
      { id: 'c4', value: 5, kind: 'attack' },
      { id: 'c5', value: 6, kind: 'attack' },
    ];
    g.players.B.areas.attack = [
      { id: 'o1', value: 1, kind: 'attack' },
      { id: 'o2', value: 1, kind: 'attack' },
      { id: 'o3', value: 1, kind: 'attack' },
      { id: 'o4', value: 1, kind: 'attack' },
      { id: 'o5', value: 1, kind: 'attack' },
    ];
    const lifeBefore = g.players.B.life;
    applyAction(g, {
      t: 'skill',
      artifactId: '007',
      side: 'right',
      params: {
        kind: 'attack',
        consumedIds: ['c1', 'c2', 'c3', 'c4'],
        opponentDiscardIds: ['o1', 'o2', 'o3'],
      },
    });
    // sum = 2+3+4+5 = 14 -> 7 true damage; c5 remains; o4/o5 remain
    expect(g.players.B.life).toBe(lifeBefore - 7);
    expect(g.players.A.areas.attack.map((d) => d.id)).toEqual(['c5']);
    expect(g.players.B.areas.attack.map((d) => d.id)).toEqual(['o4', 'o5']);
  });

  it('震荡斩击: rejects fewer than 4 dice and dice not owned by the player', () => {
    const base = () => {
      const g = setup007('right');
      g.players.A.areas.attack = [
        { id: 'c1', value: 2, kind: 'attack' },
        { id: 'c2', value: 3, kind: 'attack' },
        { id: 'c3', value: 4, kind: 'attack' },
        { id: 'c4', value: 5, kind: 'attack' },
      ];
      g.players.B.areas.attack = [{ id: 'o1', value: 1, kind: 'attack' }];
      return g;
    };
    const g1 = base();
    expect(() =>
      applyAction(g1, {
        t: 'skill',
        artifactId: '007',
        side: 'right',
        params: { kind: 'attack', consumedIds: ['c1', 'c2', 'c3'] },
      }),
    ).toThrow();
    const g2 = base();
    expect(() =>
      applyAction(g2, {
        t: 'skill',
        artifactId: '007',
        side: 'right',
        params: { kind: 'attack', consumedIds: ['c1', 'c2', 'c3', 'o1'] },
      }),
    ).toThrow();
  });
});

describe('008 铁壁', () => {
  const setup008 = () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '008', '003'] });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' }); // -> main
    g.players.A.artifacts.find((a) => a.id === '008')!.activeMarkerSide = 'right';
    return g;
  };

  it('战车: at turn start, grants 1 attack die of value 5 when holding >=1 defense die', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '008', '003'] });
    g.players.A.artifacts.find((a) => a.id === '008')!.activeMarkerSide = 'left';
    g.players.A.areas = { attack: [], defense: [{ id: 'd1', value: 1, kind: 'defense' }], meditation: [] };
    applyTurnStartEffects(g, 'A');
    expect(g.players.A.areas.attack).toHaveLength(1);
    expect(g.players.A.areas.attack[0]).toMatchObject({ value: 5, kind: 'attack' });
  });

  it('战车: does nothing when the player has no defense die', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '008', '003'] });
    g.players.A.artifacts.find((a) => a.id === '008')!.activeMarkerSide = 'left';
    g.players.A.areas = { attack: [], defense: [], meditation: [] };
    applyTurnStartEffects(g, 'A');
    expect(g.players.A.areas.attack).toHaveLength(0);
  });

  it('战车 FAQ 8.1.1: the gained die counts toward the will cap and reduces the refill', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '008', '003'] });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' }); // -> main
    g.players.A.artifacts.find((a) => a.id === '008')!.activeMarkerSide = 'left';
    // 008 持续使意志 7+1=8；现有 6 颗（含 1 个以上防御骰）
    g.players.A.areas = {
      attack: [
        { id: 'a1', value: 2, kind: 'attack' },
        { id: 'a2', value: 2, kind: 'attack' },
        { id: 'a3', value: 2, kind: 'attack' },
      ],
      defense: [
        { id: 'd1', value: 1, kind: 'defense' },
        { id: 'd2', value: 1, kind: 'defense' },
      ],
      meditation: [{ id: 'm1', value: 3, kind: 'meditation' }],
    };
    g.firstRound.A = false;
    beginTurn(g);
    // 6 + 战车 1 = 7 → 补充 room = 8-7 = 1（若无战车则会补 2）
    expect(totalDice(g.players.A)).toBe(8);
    const refillLog = g.log.map((l) => l.text).find((t) => t.includes('补充'));
    expect(refillLog).toContain('补充 1 颗');
  });

  it('王家之拳: consumes 2 meditation, discards 2 defense, gains 4 defense and +1 thisTurn attack damage', () => {
    const g = setup008();
    g.players.A.areas = {
      attack: [],
      defense: [
        { id: 'd1', value: 1, kind: 'defense' },
        { id: 'd2', value: 6, kind: 'defense' },
      ],
      meditation: [
        { id: 'm1', value: 3, kind: 'meditation' },
        { id: 'm2', value: 4, kind: 'meditation' },
      ],
    };
    applyAction(g, {
      t: 'skill',
      artifactId: '008',
      side: 'right',
      params: { meditationDieIds: ['m1', 'm2'], defenseDieIds: ['d1', 'd2'] },
    });
    expect(g.players.A.areas.meditation).toHaveLength(0);
    expect(g.players.A.areas.defense).toHaveLength(4); // 弃 2 → 获得 4
    expect(
      g.players.A.buffs.some((b) => b.attr === 'attackDamage' && b.add === 1 && b.duration === 'thisTurn'),
    ).toBe(true);
  });

  it('王家之拳 FAQ 8.2.1: with <2 defense it still activates, takes (2-discarded)*2 true damage, gains 4 defense', () => {
    const g = setup008();
    g.players.A.areas = {
      attack: [],
      defense: [],
      meditation: [
        { id: 'm1', value: 3, kind: 'meditation' },
        { id: 'm2', value: 4, kind: 'meditation' },
      ],
    };
    const lifeBefore = g.players.A.life;
    applyAction(g, {
      t: 'skill',
      artifactId: '008',
      side: 'right',
      params: { meditationDieIds: ['m1', 'm2'], defenseDieIds: [] },
    });
    expect(g.players.A.life).toBe(lifeBefore - 4); // 少弃 2 → 4 点真实伤害
    expect(g.players.A.areas.defense).toHaveLength(4);
    expect(g.players.A.buffs.some((b) => b.attr === 'attackDamage' && b.add === 1)).toBe(true);
  });

  it('王家之拳: with exactly 1 defense, discards it and takes 2 true damage', () => {
    const g = setup008();
    g.players.A.areas = {
      attack: [],
      defense: [{ id: 'd1', value: 1, kind: 'defense' }],
      meditation: [
        { id: 'm1', value: 3, kind: 'meditation' },
        { id: 'm2', value: 4, kind: 'meditation' },
      ],
    };
    const lifeBefore = g.players.A.life;
    applyAction(g, {
      t: 'skill',
      artifactId: '008',
      side: 'right',
      params: { meditationDieIds: ['m1', 'm2'], defenseDieIds: ['d1'] },
    });
    expect(g.players.A.life).toBe(lifeBefore - 2); // 少弃 1 → 2 点真实伤害
    expect(g.players.A.areas.defense).toHaveLength(4); // 弃 1 → 获得 4
  });

  it('王家之拳: rejects activation without exactly 2 meditation dice', () => {
    const g = setup008();
    g.players.A.areas = {
      attack: [],
      defense: [],
      meditation: [{ id: 'm1', value: 3, kind: 'meditation' }],
    };
    expect(() =>
      applyAction(g, {
        t: 'skill',
        artifactId: '008',
        side: 'right',
        params: { meditationDieIds: ['m1'], defenseDieIds: [] },
      }),
    ).toThrow();
  });
});

describe('009 孤王', () => {
  const setup009 = () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '009'] });
    skipInitialReroll(g);
    return g;
  };

  it('充能: charging 009 sets a guwangCharge pending with skip + one action per opponent attack die', () => {
    const g = setup009();
    g.players.B.areas.attack = [
      { id: 'oa1', value: 5, kind: 'attack' },
      { id: 'oa2', value: 3, kind: 'attack' },
    ];
    g.players.A.areas.meditation.push({ id: 'm0', value: 2, kind: 'meditation' });
    applyAction(g, { t: 'dustRise', artifactId: '009', meditationDieId: 'm0' });
    expect(g.pending).toEqual({ kind: 'guwangCharge', player: 'A' });
    const legal = getLegalActions(g);
    expect(legal).toContainEqual({ t: 'guwangCharge' });
    expect(legal).toContainEqual({ t: 'guwangCharge', dieId: 'oa1' });
    expect(legal).toContainEqual({ t: 'guwangCharge', dieId: 'oa2' });
  });

  it('充能: resolving with an opponent attack die id sets it to 1 and preserves its area', () => {
    const g = setup009();
    g.players.B.areas.attack = [
      { id: 'oa1', value: 5, kind: 'attack' },
      { id: 'oa2', value: 3, kind: 'attack' },
    ];
    g.players.A.areas.meditation.push({ id: 'm0', value: 2, kind: 'meditation' });
    applyAction(g, { t: 'dustRise', artifactId: '009', meditationDieId: 'm0' });
    applyAction(g, { t: 'guwangCharge', dieId: 'oa1' });
    expect(g.players.B.areas.attack).toEqual([
      { id: 'oa1', value: 1, kind: 'attack' },
      { id: 'oa2', value: 3, kind: 'attack' },
    ]);
    expect(g.players.B.areas.defense.some((d) => d.id === 'oa1')).toBe(false);
    expect(g.pending).toBeNull();
  });

  it('充能: resolving without a die id leaves all dice unchanged', () => {
    const g = setup009();
    g.players.B.areas.attack = [{ id: 'oa1', value: 5, kind: 'attack' }];
    g.players.A.areas.meditation.push({ id: 'm0', value: 2, kind: 'meditation' });
    applyAction(g, { t: 'dustRise', artifactId: '009', meditationDieId: 'm0' });
    applyAction(g, { t: 'guwangCharge' });
    expect(g.players.B.areas.attack).toEqual([{ id: 'oa1', value: 5, kind: 'attack' }]);
    expect(g.pending).toBeNull();
  });

  it('充能: does not set a pending when the opponent has no attack dice', () => {
    const g = setup009();
    g.players.B.areas.attack = [];
    g.players.A.areas.meditation.push({ id: 'm0', value: 2, kind: 'meditation' });
    applyAction(g, { t: 'dustRise', artifactId: '009', meditationDieId: 'm0' });
    expect(g.pending).toBeNull();
  });

  it('必杀: discards all dice, gains random defense dice up to will, then ends the main phase', () => {
    const g = setup009();
    applyAction(g, { t: 'advance' }); // 尘起 -> 主要
    g.players.A.artifacts.find((x) => x.id === '009')!.activeMarkerSide = 'left'; // 充能完成后激活
    g.players.A.areas = {
      attack: [{ id: 'ga', value: 4, kind: 'attack' }],
      defense: [{ id: 'gd', value: 6, kind: 'defense' }],
      meditation: [{ id: 'gm', value: 2, kind: 'meditation' }],
    };
    const cap = effectiveWill(g.players.A);
    applyAction(g, { t: 'skill', artifactId: '009', side: 'only' });
    expect(g.players.A.areas.attack).toHaveLength(0);
    expect(g.players.A.areas.meditation).toHaveLength(0);
    expect(totalDice(g.players.A)).toBe(cap);
    expect(g.players.A.areas.defense).toHaveLength(cap);
    for (const d of g.players.A.areas.defense) {
      expect(d.value).toBeGreaterThanOrEqual(1);
      expect(d.value).toBeLessThanOrEqual(6);
    }
    expect(g.ultimatesUsed).toContain('guwang.ultimate');
    expect(g.phase).not.toBe('main');
    expect(g.activePlayer).toBe('B');
  });
});
