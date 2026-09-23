import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll, beginTurn } from '../src/core/engine/game';
import { totalDice, effectiveWill } from '../src/core/engine/derive';
import { virtualAttack } from '../src/core/engine/combat';
import { applyTurnStartEffects } from '../src/core/engine/skills';

describe('真实之剑置换（战报留痕）', () => {
  it('置换攻击：战报记录一条「真实之剑」置换', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['010', '002', '003'] });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' }); // 尘起 -> 主要
    g.players.A.artifacts.find((a) => a.id === '010')!.activeMarkerSide = 'left';
    g.players.A.areas.defense = [{ id: 'd1', value: 4, kind: 'defense' }];
    g.players.A.areas.meditation = [{ id: 'm1', value: 6, kind: 'meditation' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['d1', 'm1'] }] });
    const texts = g.log.map((l) => l.text).join('\n');
    expect(texts).toContain('使用「真实之剑」置换');
    expect(texts).toContain('视为 1 颗攻击骰（点数按 5）');
  });

  it('置换技能代价（淬炼）：战报同样留痕', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['010', '004', '002'] });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' }); // 尘起 -> 主要
    const gs = g.players.A.artifacts.find((a) => a.id === '010')!;
    gs.activeMarkerSide = 'left';
    const bx = g.players.A.artifacts.find((a) => a.id === '004')!;
    bx.activeMarkerSide = 'left';
    g.players.A.areas.defense = [{ id: 'd1', value: 4, kind: 'defense' }];
    g.players.A.areas.meditation = [{ id: 'm1', value: 6, kind: 'meditation' }];
    applyAction(g, {
      t: 'skill',
      artifactId: '004',
      side: 'left',
      params: { costSlots: [{ dieIds: ['d1', 'm1'] }] },
    });
    expect(g.log.map((l) => l.text).join('\n')).toContain('使用「真实之剑」置换');
  });
});

describe('basic activate skills', () => {
  it('淬炼 consumes an attack die and increments 不祥 count (cap 3)', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '002', '003'] });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' }); // -> main
    const buxiang = g.players.A.artifacts.find((a) => a.id === '004')!;
    buxiang.activeMarkerSide = 'left';
    g.players.A.areas.attack.push({ id: 'x', value: 3, kind: 'attack' });
    applyAction(g, { t: 'skill', artifactId: '004', side: 'left', params: { costSlots: [{ dieIds: ['x'] }] } });
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
    applyAction(g, { t: 'skill', artifactId: '002', side: 'right', params: { costSlots: medIds.map((id) => ({ dieIds: [id] })) } });
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
    applyAction(g, { t: 'skill', artifactId: '005', side: 'right', params: { costSlots: [{ dieIds: ['p1'] }, { dieIds: ['p2'] }] } });
    expect(g.players.B.areas.defense.length).toBe(defBefore + 2);
    expect(g.players.B.areas.meditation.length).toBe(medBefore + 1);
  });

  it('rejects activating a skill that is not active', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' });
    g.players.A.areas.attack.push({ id: 'x', value: 3, kind: 'attack' });
    expect(() => applyAction(g, { t: 'skill', artifactId: '004', side: 'left', params: { costSlots: [{ dieIds: ['x'] }] } })).toThrow();
  });

  it('rejects using the same activate skill twice in one turn', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '002', '003'] });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' });
    const buxiang = g.players.A.artifacts.find((a) => a.id === '004')!;
    buxiang.activeMarkerSide = 'left';
    g.players.A.areas.attack.push({ id: 'x1', value: 3, kind: 'attack' }, { id: 'x2', value: 4, kind: 'attack' });
    applyAction(g, { t: 'skill', artifactId: '004', side: 'left', params: { costSlots: [{ dieIds: ['x1'] }] } });
    expect(() => applyAction(g, { t: 'skill', artifactId: '004', side: 'left', params: { costSlots: [{ dieIds: ['x2'] }] } })).toThrow();
  });
});

import { getLegalActions } from '../src/core/engine/game';

describe('charge effects', () => {
  it('明镜 charge grants a free extra dust rise (not counting the 1/round limit)', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    g.players.A.areas.meditation.push({ id: 'm0', value: 2, kind: 'meditation' });
    applyAction(g, { t: 'dustRise', artifactId: '003', costSlots: [{ dieIds: ['m0'] }] });
    expect(g.players.A.artifacts.find((a) => a.id === '003')!.chargeLayer).toBe(1);
    expect(g.freeDustRise).toBe(1);
    expect(getLegalActions(g).some((a) => a.t === 'dustRise')).toBe(true);
    // 用掉这次额外尘起（再次充能 → 又获得 1 次额外）
    g.players.A.areas.meditation.push({ id: 'm1', value: 3, kind: 'meditation' });
    applyAction(g, { t: 'dustRise', artifactId: '003', costSlots: [{ dieIds: ['m1'] }] });
    expect(g.players.A.artifacts.find((a) => a.id === '003')!.chargeLayer).toBe(2);
    expect(g.freeDustRise).toBe(1);
  });

  it('完杀 charge grants an attack die equal to the charge layer', () => {
    const g = createGame({ seed: 1, firstPlayer: 'B' }); // B 持 006
    skipInitialReroll(g);
    g.players.B.areas.meditation.push({ id: 'm0', value: 2, kind: 'meditation' });
    const before = g.players.B.areas.attack.length;
    applyAction(g, { t: 'dustRise', artifactId: '006', costSlots: [{ dieIds: ['m0'] }] });
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
    applyAction(g, { t: 'skill', artifactId: '001', side: 'left', params: { costSlots: medIds.map((id) => ({ dieIds: [id] })), opponentDefenseDieIds: oppDef } });
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
    applyAction(g, { t: 'skill', artifactId: '001', side: 'left', params: { costSlots: medIds.map((id) => ({ dieIds: [id] })), opponentDefenseDieIds: oppDef } });
    g.players.A.areas.attack.push({ id: 'a1', value: 5, kind: 'attack' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g.pendingAttack!.unblockable).toBe(true);
    const def = g.players.B.areas.defense[0];
    const lifeBefore = g.players.B.life;
    applyAction(g, { t: 'block', costSlots: [{ dieIds: [def?.id ?? ''] }] });
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
    applyAction(g, { t: 'skill', artifactId: '001', side: 'left', params: { costSlots: [{ dieIds: ['m2'] }, { dieIds: ['m3'] }], opponentDefenseDieIds: ['bd1'] } });
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
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['atk1'] }] });
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
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['d1'] }] });
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
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['d1'] }] });
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
    applyAction(g, { t: 'skill', artifactId: '006', side: 'only', params: { costSlots: [{ dieIds: ['k1'] }] } });
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
    applyAction(g, { t: 'skill', artifactId: '006', side: 'only', params: { costSlots: [{ dieIds: ['k1'] }] } });
    expect(g.players.A.areas.defense.length).toBe(0);
    expect(g.players.B.areas.attack.length).toBe(0);
  });

  it('零时枭首: a converted (2-dice) slot yields X=5 (requires 真实之剑)', () => {
    const g = createGame({ seed: 1, firstPlayer: 'B', heroB: ['010', '005', '006'] }); // B: 010 深红 + 006 完杀
    g.activePlayer = 'B';
    g.phase = 'main';
    g.players.B.artifacts.find((a) => a.id === '006')!.activeMarkerSide = 'left';
    g.players.B.artifacts.find((a) => a.id === '010')!.activeMarkerSide = 'left'; // 真实之剑
    g.players.B.areas.attack = [
      { id: 'k1', value: 3, kind: 'attack' },
      { id: 'k2', value: 1, kind: 'attack' },
    ];
    g.players.A.areas.defense = Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, value: 1, kind: 'defense' as const }));
    applyAction(g, { t: 'skill', artifactId: '006', side: 'only', params: { costSlots: [{ dieIds: ['k1', 'k2'] }] } });
    // 2 real dice consumed as one converted slot → X = 5
    expect(g.players.B.areas.attack).toHaveLength(5); // gained X=5
    expect(g.players.A.areas.defense).toHaveLength(1); // 5 discarded
  });

  it('零时枭首: a converted slot without 真实之剑 is rejected', () => {
    const g = createGame({ seed: 1, firstPlayer: 'B' }); // B has 006 only (no 010)
    g.activePlayer = 'B';
    g.phase = 'main';
    g.players.B.artifacts.find((a) => a.id === '006')!.activeMarkerSide = 'left';
    g.players.B.areas.attack = [
      { id: 'k1', value: 3, kind: 'attack' },
      { id: 'k2', value: 1, kind: 'attack' },
    ];
    expect(() =>
      applyAction(g, { t: 'skill', artifactId: '006', side: 'only', params: { costSlots: [{ dieIds: ['k1', 'k2'] }] } }),
    ).toThrow();
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
        costSlots: [{ dieIds: ['sa'] }, { dieIds: ['sd'] }, { dieIds: ['sm'] }],
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
        costSlots: [{ dieIds: ['sa'] }, { dieIds: ['sd'] }, { dieIds: ['sm'] }],
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
        costSlots: [{ dieIds: ['c1'] }, { dieIds: ['c2'] }, { dieIds: ['c3'] }, { dieIds: ['c4'] }],
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
        params: { kind: 'attack', costSlots: [{ dieIds: ['c1'] }, { dieIds: ['c2'] }, { dieIds: ['c3'] }] },
      }),
    ).toThrow();
    const g2 = base();
    expect(() =>
      applyAction(g2, {
        t: 'skill',
        artifactId: '007',
        side: 'right',
        params: { kind: 'attack', costSlots: [{ dieIds: ['c1'] }, { dieIds: ['c2'] }, { dieIds: ['c3'] }, { dieIds: ['o1'] }] },
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
      params: { costSlots: [{ dieIds: ['m1'] }, { dieIds: ['m2'] }], defenseDieIds: ['d1', 'd2'] },
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
      params: { costSlots: [{ dieIds: ['m1'] }, { dieIds: ['m2'] }], defenseDieIds: [] },
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
      params: { costSlots: [{ dieIds: ['m1'] }, { dieIds: ['m2'] }], defenseDieIds: ['d1'] },
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
        params: { costSlots: [{ dieIds: ['m1'] }], defenseDieIds: [] },
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
    applyAction(g, { t: 'dustRise', artifactId: '009', costSlots: [{ dieIds: ['m0'] }] });
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
    applyAction(g, { t: 'dustRise', artifactId: '009', costSlots: [{ dieIds: ['m0'] }] });
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
    applyAction(g, { t: 'dustRise', artifactId: '009', costSlots: [{ dieIds: ['m0'] }] });
    applyAction(g, { t: 'guwangCharge' });
    expect(g.players.B.areas.attack).toEqual([{ id: 'oa1', value: 5, kind: 'attack' }]);
    expect(g.pending).toBeNull();
  });

  it('充能: does not set a pending when the opponent has no attack dice', () => {
    const g = setup009();
    g.players.B.areas.attack = [];
    g.players.A.areas.meditation.push({ id: 'm0', value: 2, kind: 'meditation' });
    applyAction(g, { t: 'dustRise', artifactId: '009', costSlots: [{ dieIds: ['m0'] }] });
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

describe('010 深红', () => {
  const setup010 = () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['010', '002', '003'] });
    skipInitialReroll(g);
    g.players.A.artifacts.find((a) => a.id === '010')!.activeMarkerSide = 'right';
    return g;
  };

  // 现有 6 颗；意志 8、速度 4 → 补充 room = 2，仅补 2 颗（≤3）
  const sixDice = () => ({
    attack: [
      { id: 'a1', value: 2, kind: 'attack' as const },
      { id: 'a2', value: 3, kind: 'attack' as const },
      { id: 'a3', value: 4, kind: 'attack' as const },
    ],
    defense: [
      { id: 'd1', value: 1, kind: 'defense' as const },
      { id: 'd2', value: 6, kind: 'defense' as const },
    ],
    meditation: [{ id: 'm1', value: 5, kind: 'meditation' as const }],
  });

  it('杀意 FAQ 10.2.1: refill ≤3 sets a pending; accepting deals 3 true damage and heals 2 (clamped at max)', () => {
    const g = setup010();
    g.players.A.areas = sixDice();
    g.players.A.life = g.players.A.lifeMax - 1;
    g.firstRound.A = false;
    const bBefore = g.players.B.life;
    beginTurn(g);
    expect(g.pending).toEqual({ kind: 'shenhongKill', player: 'A' });
    const legal = getLegalActions(g);
    expect(legal).toContainEqual({ t: 'shenhongKill', accept: true });
    expect(legal).toContainEqual({ t: 'shenhongKill', accept: false });
    const refillLog = g.log.map((l) => l.text).find((t) => t.includes('补充'));
    expect(refillLog).toContain('补充 2 颗');

    applyAction(g, { t: 'shenhongKill', accept: true });
    expect(g.pending).toBeNull();
    expect(g.players.B.life).toBe(bBefore - 3);
    expect(g.players.A.life).toBe(g.players.A.lifeMax);
  });

  it('杀意: declining clears the pending without damage or healing', () => {
    const g = setup010();
    g.players.A.areas = sixDice();
    g.firstRound.A = false;
    const aBefore = g.players.A.life;
    const bBefore = g.players.B.life;
    beginTurn(g);
    expect(g.pending!.kind).toBe('shenhongKill');
    applyAction(g, { t: 'shenhongKill', accept: false });
    expect(g.pending).toBeNull();
    expect(g.players.A.life).toBe(aBefore);
    expect(g.players.B.life).toBe(bBefore);
  });

  it('杀意: refill >3 does not set a pending', () => {
    const g = setup010();
    g.players.A.areas = {
      attack: [{ id: 'a1', value: 2, kind: 'attack' as const }],
      defense: [{ id: 'd1', value: 1, kind: 'defense' as const }],
      meditation: [],
    };
    g.firstRound.A = false;
    beginTurn(g);
    // 意志 8 − 现有 2 = 6，速度 4 → 补 4 颗（>3）
    expect(g.pending).toBeNull();
    const refillLog = g.log.map((l) => l.text).find((t) => t.includes('补充'));
    expect(refillLog).toContain('补充 4 颗');
  });

  it('杀意: first turn (refill skipped) does not set a pending', () => {
    const g = setup010();
    beginTurn(g); // firstRound.A 仍为 true → 跳过补充
    expect(g.pending).toBeNull();
    expect(g.phase).toBe('dustRise');
  });

  it('杀意: requires the right side to be active', () => {
    const g = setup010();
    g.players.A.artifacts.find((a) => a.id === '010')!.activeMarkerSide = 'left';
    g.players.A.areas = sixDice();
    g.firstRound.A = false;
    beginTurn(g);
    expect(g.pending).toBeNull();
  });
});

describe('011 顿悟', () => {
  const setup011 = () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['011', '002', '003'] });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' }); // -> main
    return g;
  };

  it('灵能屏障·启动: consumes N defense dice and gains 2N random meditation dice', () => {
    const g = setup011();
    g.players.A.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'left';
    g.players.A.areas = {
      attack: [],
      defense: [
        { id: 'd1', value: 1, kind: 'defense' },
        { id: 'd2', value: 6, kind: 'defense' },
        { id: 'd3', value: 1, kind: 'defense' },
      ],
      meditation: [],
    };
    applyAction(g, { t: 'skill', artifactId: '011', side: 'left', params: { costSlots: [{ dieIds: ['d1'] }, { dieIds: ['d2'] }] } });
    expect(g.players.A.areas.defense.map((d) => d.id)).toEqual(['d3']);
    expect(g.players.A.areas.meditation).toHaveLength(4);
    for (const d of g.players.A.areas.meditation) {
      expect(d.kind).toBe('meditation');
      expect(d.value).toBeGreaterThanOrEqual(1);
      expect(d.value).toBeLessThanOrEqual(6);
    }
  });

  it('灵能屏障·启动: consuming 3 defense dice gains 6 meditation dice', () => {
    const g = setup011();
    g.players.A.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'left';
    g.players.A.areas = {
      attack: [],
      defense: [
        { id: 'd1', value: 1, kind: 'defense' },
        { id: 'd2', value: 6, kind: 'defense' },
        { id: 'd3', value: 1, kind: 'defense' },
      ],
      meditation: [],
    };
    const medBefore = g.players.A.areas.meditation.length;
    applyAction(g, { t: 'skill', artifactId: '011', side: 'left', params: { costSlots: [{ dieIds: ['d1'] }, { dieIds: ['d2'] }, { dieIds: ['d3'] }] } });
    expect(g.players.A.areas.defense).toHaveLength(0);
    expect(g.players.A.areas.meditation).toHaveLength(medBefore + 6);
  });

  it('灵能屏障·启动: rejects fewer than 1, more than 3, and foreign dice', () => {
    const zero = setup011();
    zero.players.A.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'left';
    zero.players.A.areas.defense = [{ id: 'd1', value: 1, kind: 'defense' }];
    expect(() =>
      applyAction(zero, { t: 'skill', artifactId: '011', side: 'left', params: { costSlots: [] } }),
    ).toThrow();

    const many = setup011();
    many.players.A.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'left';
    many.players.A.areas.defense = ['d1', 'd2', 'd3', 'd4'].map((id) => ({ id, value: 1, kind: 'defense' as const }));
    expect(() =>
      applyAction(many, {
        t: 'skill',
        artifactId: '011',
        side: 'left',
        params: { costSlots: [{ dieIds: ['d1'] }, { dieIds: ['d2'] }, { dieIds: ['d3'] }, { dieIds: ['d4'] }] },
      }),
    ).toThrow();

    const foreign = setup011();
    foreign.players.A.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'left';
    foreign.players.A.areas.defense = [{ id: 'd1', value: 1, kind: 'defense' }];
    expect(() =>
      applyAction(foreign, { t: 'skill', artifactId: '011', side: 'left', params: { costSlots: [{ dieIds: ['nope'] }] } }),
    ).toThrow();
  });

  it('灵能脉冲·启动: consumes N attack dice and gains 2N random meditation dice', () => {
    const g = setup011();
    g.players.A.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'right';
    g.players.A.areas = {
      attack: [
        { id: 'a1', value: 2, kind: 'attack' },
        { id: 'a2', value: 4, kind: 'attack' },
        { id: 'a3', value: 2, kind: 'attack' },
      ],
      defense: [],
      meditation: [],
    };
    applyAction(g, { t: 'skill', artifactId: '011', side: 'right', params: { costSlots: [{ dieIds: ['a1'] }] } });
    expect(g.players.A.areas.attack.map((d) => d.id)).toEqual(['a2', 'a3']);
    expect(g.players.A.areas.meditation).toHaveLength(2);
    for (const d of g.players.A.areas.meditation) {
      expect(d.kind).toBe('meditation');
      expect(d.value).toBeGreaterThanOrEqual(1);
      expect(d.value).toBeLessThanOrEqual(6);
    }
  });

  it('灵能脉冲·启动: consumes 3 attack dice and gains 6 meditation dice', () => {
    const g = setup011();
    g.players.A.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'right';
    g.players.A.areas = {
      attack: [
        { id: 'a1', value: 2, kind: 'attack' },
        { id: 'a2', value: 4, kind: 'attack' },
        { id: 'a3', value: 2, kind: 'attack' },
      ],
      defense: [],
      meditation: [{ id: 'm0', value: 3, kind: 'meditation' }],
    };
    const medBefore = g.players.A.areas.meditation.length;
    applyAction(g, { t: 'skill', artifactId: '011', side: 'right', params: { costSlots: [{ dieIds: ['a1'] }, { dieIds: ['a2'] }, { dieIds: ['a3'] }] } });
    expect(g.players.A.areas.attack).toHaveLength(0);
    expect(g.players.A.areas.meditation).toHaveLength(medBefore + 6);
  });

  it('灵能脉冲·启动: rejects fewer than 1, more than 3, and foreign dice', () => {
    const zero = setup011();
    zero.players.A.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'right';
    zero.players.A.areas.attack = [{ id: 'a1', value: 2, kind: 'attack' }];
    expect(() =>
      applyAction(zero, { t: 'skill', artifactId: '011', side: 'right', params: { costSlots: [] } }),
    ).toThrow();

    const many = setup011();
    many.players.A.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'right';
    many.players.A.areas.attack = ['a1', 'a2', 'a3', 'a4'].map((id) => ({ id, value: 2, kind: 'attack' as const }));
    expect(() =>
      applyAction(many, {
        t: 'skill',
        artifactId: '011',
        side: 'right',
        params: { costSlots: [{ dieIds: ['a1'] }, { dieIds: ['a2'] }, { dieIds: ['a3'] }, { dieIds: ['a4'] }] },
      }),
    ).toThrow();

    const foreign = setup011();
    foreign.players.A.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'right';
    foreign.players.A.areas.attack = [{ id: 'a1', value: 2, kind: 'attack' }];
    expect(() =>
      applyAction(foreign, { t: 'skill', artifactId: '011', side: 'right', params: { costSlots: [{ dieIds: ['nope'] }] } }),
    ).toThrow();
  });

  it('candidates: offers barrier with up to 3 defense dice and pulse with up to 3 attack dice', () => {
    const g = setup011();
    const art = g.players.A.artifacts.find((a) => a.id === '011')!;
    art.activeMarkerSide = 'left';
    g.players.A.areas = {
      attack: [
        { id: 'a1', value: 2, kind: 'attack' },
        { id: 'a2', value: 4, kind: 'attack' },
        { id: 'a3', value: 2, kind: 'attack' },
        { id: 'a4', value: 4, kind: 'attack' },
      ],
      defense: [
        { id: 'd1', value: 1, kind: 'defense' },
        { id: 'd2', value: 6, kind: 'defense' },
      ],
      meditation: [],
    };
    const legal = getLegalActions(g);
    expect(legal).toContainEqual({
      t: 'skill',
      artifactId: '011',
      side: 'left',
      params: { costSlots: [{ dieIds: ['d1'] }, { dieIds: ['d2'] }] },
    });
    art.activeMarkerSide = 'right';
    const legal2 = getLegalActions(g);
    expect(legal2).toContainEqual({
      t: 'skill',
      artifactId: '011',
      side: 'right',
      params: { costSlots: [{ dieIds: ['a1'] }, { dieIds: ['a2'] }, { dieIds: ['a3'] }] },
    });
  });
});

describe('011 灵能屏障·触发', () => {
  const setupDefender = () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroB: ['011', '002', '003'] });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' }); // A -> main
    return g;
  };

  it('当防御方 011 激活且有冥想骰时，攻击后挂起 dunwuHalve（攻击仍待结算）', () => {
    const g = setupDefender();
    g.players.B.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'left';
    g.players.B.areas.meditation = [{ id: 'm1', value: 3, kind: 'meditation' }];
    g.players.A.areas.attack = [{ id: 'atk', value: 5, kind: 'attack' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['atk'] }] });
    expect(g.pending).toEqual({ kind: 'dunwuHalve', player: 'B' });
    expect(g.pendingAttack).not.toBeNull();
    expect(g.pendingAttack!.value).toBe(5);
    const legal = getLegalActions(g);
    expect(legal).toContainEqual({ t: 'dunwuHalve', accept: false });
    expect(legal).toContainEqual({ t: 'dunwuHalve', accept: true, meditationDieId: 'm1' });
  });

  it('接受：消耗冥想骰并将伤害向下取整减半', () => {
    const g = setupDefender();
    g.players.B.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'left';
    g.players.B.areas.meditation = [{ id: 'm1', value: 3, kind: 'meditation' }];
    g.players.A.areas.attack = [{ id: 'atk', value: 5, kind: 'attack' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['atk'] }] });
    applyAction(g, { t: 'dunwuHalve', accept: true, meditationDieId: 'm1' });
    expect(g.pending).toBeNull();
    expect(g.pendingAttack!.value).toBe(2); // floor(5/2)
    expect(g.players.B.areas.meditation).toHaveLength(0);
  });

  it('1 点伤害减半为 0', () => {
    const g = setupDefender();
    g.players.B.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'left';
    g.players.B.areas.meditation = [{ id: 'm1', value: 3, kind: 'meditation' }];
    g.players.A.areas.attack = [{ id: 'atk', value: 1, kind: 'attack' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['atk'] }] });
    applyAction(g, { t: 'dunwuHalve', accept: true, meditationDieId: 'm1' });
    expect(g.pendingAttack!.value).toBe(0); // floor(1/2)
  });

  it('放弃：伤害不变且不消耗冥想骰', () => {
    const g = setupDefender();
    g.players.B.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'left';
    g.players.B.areas.meditation = [{ id: 'm1', value: 3, kind: 'meditation' }];
    g.players.A.areas.attack = [{ id: 'atk', value: 5, kind: 'attack' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['atk'] }] });
    applyAction(g, { t: 'dunwuHalve', accept: false });
    expect(g.pending).toBeNull();
    expect(g.pendingAttack!.value).toBe(5);
    expect(g.players.B.areas.meditation).toHaveLength(1);
  });

  it('010 置换 × 011：用 2 颗任意骰代替 1 颗冥想骰，同样减半并消耗 2 颗', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['010', '011', '012'] });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' }); // A -> main
    g.players.B.artifacts.find((a) => a.id === '010')!.activeMarkerSide = 'left'; // 真实之剑·持续
    g.players.B.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'left'; // 灵能屏障·触发
    g.players.B.areas.meditation = [];
    g.players.B.areas.attack = [{ id: 'b1', value: 2, kind: 'attack' }];
    g.players.B.areas.defense = [{ id: 'b2', value: 4, kind: 'defense' }];
    g.players.A.areas.attack = [{ id: 'atk', value: 5, kind: 'attack' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['atk'] }] });
    expect(g.pending?.kind).toBe('dunwuHalve');
    applyAction(g, { t: 'dunwuHalve', accept: true, costSlots: [{ dieIds: ['b1', 'b2'] }] });
    expect(g.pendingAttack!.value).toBe(2); // floor(5/2)
    expect(g.players.B.areas.attack).toHaveLength(0);
    expect(g.players.B.areas.defense).toHaveLength(0);
  });

  it('防御方无冥想骰时不挂起', () => {
    const g = setupDefender();
    g.players.B.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'left';
    g.players.B.areas.meditation = [];
    g.players.A.areas.attack = [{ id: 'atk', value: 5, kind: 'attack' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['atk'] }] });
    expect(g.pending).toBeNull();
    expect(g.pendingAttack!.value).toBe(5);
  });

  it('技能未激活时不挂起', () => {
    const g = setupDefender();
    const art = g.players.B.artifacts.find((a) => a.id === '011')!;
    art.activeMarkerSide = 'right'; // 仅激活脉冲侧
    g.players.B.areas.meditation = [{ id: 'm1', value: 3, kind: 'meditation' }];
    g.players.A.areas.attack = [{ id: 'atk', value: 5, kind: 'attack' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['atk'] }] });
    expect(g.pending).toBeNull();
    expect(g.pendingAttack!.value).toBe(5);
  });
});

describe('011 灵能脉冲·触发', () => {
  const setupPulse = () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '011', '003'] });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' }); // -> main
    // 001 中央突破（左，消耗自身冥想骰）；011 灵能脉冲·触发（右侧激活）
    g.players.A.artifacts.find((a) => a.id === '001')!.activeMarkerSide = 'left';
    g.players.A.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'right';
    g.players.B.areas.defense = [
      { id: 'bd1', value: 1, kind: 'defense' },
      { id: 'bd2', value: 1, kind: 'defense' },
    ];
    g.players.A.areas = {
      attack: [],
      defense: [],
      meditation: [
        { id: 'm1', value: 2, kind: 'meditation' },
        { id: 'm2', value: 3, kind: 'meditation' },
      ],
    };
    return g;
  };

  const useBreakthrough2 = (g: ReturnType<typeof setupPulse>) =>
    applyAction(g, {
      t: 'skill',
      artifactId: '001',
      side: 'left',
      params: { costSlots: [{ dieIds: ['m1'] }, { dieIds: ['m2'] }], opponentDefenseDieIds: ['bd1', 'bd2'] },
    });

  it('通过技能消耗 2 颗能力骰后挂起 dunwuPulse（数量=消耗骰数）', () => {
    const g = setupPulse();
    expect(g.skillConsumedThisAction).toBe(0);
    useBreakthrough2(g);
    expect(g.skillConsumedThisAction).toBe(2);
    expect(g.pending).toEqual({ kind: 'dunwuPulse', player: 'A', amount: 2 });
    const legal = getLegalActions(g);
    expect(legal).toContainEqual({ t: 'dunwuPulse', accept: true });
    expect(legal).toContainEqual({ t: 'dunwuPulse', accept: false });
  });

  it('接受：造成等同消耗数量的真实伤害并标记本回合已触发', () => {
    const g = setupPulse();
    useBreakthrough2(g);
    const lifeBefore = g.players.B.life;
    applyAction(g, { t: 'dunwuPulse', accept: true });
    expect(g.players.B.life).toBe(lifeBefore - 2);
    expect(g.pending).toBeNull();
    expect(g.dunwuPulseUsedThisTurn).toBe(true);
    expect(g.log.some((e) => e.text.includes('灵能脉冲'))).toBe(true);
  });

  it('同一回合第二次消耗不再挂起', () => {
    const g = setupPulse();
    useBreakthrough2(g);
    applyAction(g, { t: 'dunwuPulse', accept: true });
    g.players.A.areas.attack = [
      { id: 'a1', value: 2, kind: 'attack' },
      { id: 'a2', value: 3, kind: 'attack' },
    ];
    applyAction(g, { t: 'skill', artifactId: '011', side: 'right', params: { costSlots: [{ dieIds: ['a1'] }, { dieIds: ['a2'] }] } });
    expect(g.skillConsumedThisAction).toBe(2);
    expect(g.pending).toBeNull();
  });

  it('放弃后可本回合再次触发（used 保持 false）', () => {
    const g = setupPulse();
    useBreakthrough2(g);
    applyAction(g, { t: 'dunwuPulse', accept: false });
    expect(g.pending).toBeNull();
    expect(g.dunwuPulseUsedThisTurn).toBe(false);
    g.players.A.areas.attack = [{ id: 'a1', value: 2, kind: 'attack' }];
    applyAction(g, { t: 'skill', artifactId: '011', side: 'right', params: { costSlots: [{ dieIds: ['a1'] }] } });
    expect(g.pending).toEqual({ kind: 'dunwuPulse', player: 'A', amount: 1 });
  });

  it('弃置（非消耗）能力骰的技能不触发脉冲（明镜·必杀）', () => {
    const g = setupPulse();
    g.players.A.artifacts.find((a) => a.id === '003')!.activeMarkerSide = 'left';
    g.players.A.areas = {
      attack: [{ id: 'a1', value: 4, kind: 'attack' }],
      defense: [{ id: 'd1', value: 2, kind: 'defense' }],
      meditation: [{ id: 'm1', value: 5, kind: 'meditation' }],
    };
    applyAction(g, { t: 'skill', artifactId: '003', side: 'only' });
    expect(g.pending).toBeNull();
  });

  it('技能消耗后若产生其他待决策（孤王取消），不挂起脉冲', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['007', '011', '003'], heroB: ['004', '002', '009'] });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' });
    g.players.A.artifacts.find((a) => a.id === '007')!.activeMarkerSide = 'left';
    g.players.A.artifacts.find((a) => a.id === '011')!.activeMarkerSide = 'right';
    g.players.B.artifacts.find((a) => a.id === '009')!.activeMarkerSide = 'left';
    g.players.A.areas = {
      attack: [{ id: 'a1', value: 6, kind: 'attack' }],
      defense: [{ id: 'd1', value: 6, kind: 'defense' }],
      meditation: [{ id: 'm1', value: 6, kind: 'meditation' }],
    };
    g.players.B.areas = {
      attack: [{ id: 'ba1', value: 1, kind: 'attack' }],
      defense: [
        { id: 'bd1', value: 1, kind: 'defense' },
        { id: 'bd2', value: 1, kind: 'defense' },
      ],
      meditation: [{ id: 'bm1', value: 1, kind: 'meditation' }],
    };
    applyAction(g, {
      t: 'skill',
      artifactId: '007',
      side: 'left',
      params: {
        costSlots: [{ dieIds: ['a1'] }, { dieIds: ['d1'] }, { dieIds: ['m1'] }],
        discard: { attack: 'ba1', defense: 'bd1', meditation: 'bm1' },
      },
    });
    expect(g.pending).toEqual({ kind: 'guwangCancel', player: 'B', amount: 9 });
  });
});

describe('012 魔女', () => {
  const setup012 = () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['012', '002', '003'] });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' }); // -> main
    return g;
  };

  it('必杀 梦醒时分: moves chosen meditation dice to defense preserving their values', () => {
    const g = setup012();
    g.players.A.artifacts.find((a) => a.id === '012')!.activeMarkerSide = 'left';
    g.players.A.areas = {
      attack: [{ id: 'a1', value: 4, kind: 'attack' }],
      defense: [],
      meditation: [
        { id: 'm1', value: 2, kind: 'meditation' },
        { id: 'm2', value: 5, kind: 'meditation' },
        { id: 'm3', value: 3, kind: 'meditation' },
        { id: 'm4', value: 6, kind: 'meditation' },
      ],
    };
    applyAction(g, {
      t: 'skill',
      artifactId: '012',
      side: 'only',
      params: { to: 'defense', meditationDieIds: ['m1', 'm2'] },
    });
    expect(g.players.A.areas.meditation.map((d) => d.id)).toEqual(['m3', 'm4']);
    expect(g.players.A.areas.defense).toEqual([
      { id: 'm1', value: 2, kind: 'defense' },
      { id: 'm2', value: 5, kind: 'defense' },
    ]);
    expect(g.players.A.areas.attack).toEqual([{ id: 'a1', value: 4, kind: 'attack' }]);
    expect(g.ultimatesUsed).toContain('monv.ultimate');
  });

  it('必杀 梦醒时分: can move meditation dice to the attack area', () => {
    const g = setup012();
    g.players.A.artifacts.find((a) => a.id === '012')!.activeMarkerSide = 'left';
    g.players.A.areas = {
      attack: [],
      defense: [],
      meditation: [
        { id: 'm1', value: 2, kind: 'meditation' },
        { id: 'm2', value: 5, kind: 'meditation' },
        { id: 'm3', value: 3, kind: 'meditation' },
      ],
    };
    applyAction(g, {
      t: 'skill',
      artifactId: '012',
      side: 'only',
      params: { to: 'attack', meditationDieIds: ['m1', 'm2', 'm3'] },
    });
    expect(g.players.A.areas.meditation).toHaveLength(0);
    expect(g.players.A.areas.attack).toEqual([
      { id: 'm1', value: 2, kind: 'attack' },
      { id: 'm2', value: 5, kind: 'attack' },
      { id: 'm3', value: 3, kind: 'attack' },
    ]);
  });

  it('必杀 梦醒时分: rejects invalid destination, 0 or >3 dice, duplicates, and foreign dice', () => {
    const badDest = setup012();
    badDest.players.A.artifacts.find((a) => a.id === '012')!.activeMarkerSide = 'left';
    badDest.players.A.areas = { attack: [], defense: [], meditation: [{ id: 'm1', value: 2, kind: 'meditation' }] };
    expect(() =>
      applyAction(badDest, {
        t: 'skill',
        artifactId: '012',
        side: 'only',
        params: { to: 'meditation', meditationDieIds: ['m1'] },
      }),
    ).toThrow();

    const zero = setup012();
    zero.players.A.artifacts.find((a) => a.id === '012')!.activeMarkerSide = 'left';
    zero.players.A.areas = { attack: [], defense: [], meditation: [{ id: 'm1', value: 2, kind: 'meditation' }] };
    expect(() =>
      applyAction(zero, {
        t: 'skill',
        artifactId: '012',
        side: 'only',
        params: { to: 'defense', meditationDieIds: [] },
      }),
    ).toThrow();

    const many = setup012();
    many.players.A.artifacts.find((a) => a.id === '012')!.activeMarkerSide = 'left';
    many.players.A.areas = {
      attack: [],
      defense: [],
      meditation: ['m1', 'm2', 'm3', 'm4'].map((id) => ({ id, value: 2, kind: 'meditation' as const })),
    };
    expect(() =>
      applyAction(many, {
        t: 'skill',
        artifactId: '012',
        side: 'only',
        params: { to: 'defense', meditationDieIds: ['m1', 'm2', 'm3', 'm4'] },
      }),
    ).toThrow();

    const dup = setup012();
    dup.players.A.artifacts.find((a) => a.id === '012')!.activeMarkerSide = 'left';
    dup.players.A.areas = {
      attack: [],
      defense: [],
      meditation: ['m1', 'm2'].map((id) => ({ id, value: 2, kind: 'meditation' as const })),
    };
    expect(() =>
      applyAction(dup, {
        t: 'skill',
        artifactId: '012',
        side: 'only',
        params: { to: 'defense', meditationDieIds: ['m1', 'm1'] },
      }),
    ).toThrow();

    const foreign = setup012();
    foreign.players.A.artifacts.find((a) => a.id === '012')!.activeMarkerSide = 'left';
    foreign.players.A.areas = { attack: [], defense: [], meditation: [{ id: 'm1', value: 2, kind: 'meditation' }] };
    expect(() =>
      applyAction(foreign, {
        t: 'skill',
        artifactId: '012',
        side: 'only',
        params: { to: 'defense', meditationDieIds: ['nope'] },
      }),
    ).toThrow();
  });

  it('必杀 梦醒时分: can only be used once per game', () => {
    const g = setup012();
    g.players.A.artifacts.find((a) => a.id === '012')!.activeMarkerSide = 'left';
    g.players.A.areas = {
      attack: [],
      defense: [],
      meditation: [
        { id: 'm1', value: 2, kind: 'meditation' },
        { id: 'm2', value: 4, kind: 'meditation' },
      ],
    };
    applyAction(g, {
      t: 'skill',
      artifactId: '012',
      side: 'only',
      params: { to: 'defense', meditationDieIds: ['m1'] },
    });
    expect(g.ultimatesUsed).toContain('monv.ultimate');
    g.skillsUsedThisTurn = [];
    expect(() =>
      applyAction(g, {
        t: 'skill',
        artifactId: '012',
        side: 'only',
        params: { to: 'defense', meditationDieIds: ['m2'] },
      }),
    ).toThrow();
  });

  it('candidates: offers the ultimate with up to 3 meditation dice when active', () => {
    const g = setup012();
    g.players.A.artifacts.find((a) => a.id === '012')!.activeMarkerSide = 'left';
    g.players.A.areas = {
      attack: [],
      defense: [],
      meditation: [
        { id: 'm1', value: 2, kind: 'meditation' },
        { id: 'm2', value: 4, kind: 'meditation' },
        { id: 'm3', value: 3, kind: 'meditation' },
        { id: 'm4', value: 6, kind: 'meditation' },
      ],
    };
    const legal = getLegalActions(g);
    expect(legal).toContainEqual({
      t: 'skill',
      artifactId: '012',
      side: 'only',
      params: { to: 'attack', meditationDieIds: ['m1', 'm2', 'm3'] },
    });
  });
});

describe('010 真实之剑 置换骰位', () => {
  it('攻击置换：已激活 010 左（真实之剑）时，2 颗骰置换为 5 点有效攻击（含加成）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['010', '002', '003'] });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' }); // -> main
    g.players.A.artifacts.find((a) => a.id === '010')!.activeMarkerSide = 'left';
    g.players.A.areas.attack = [
      { id: 'ca1', value: 2, kind: 'attack' },
      { id: 'ca2', value: 3, kind: 'attack' },
    ];
    g.players.A.buffs.push({ attr: 'attackDamage', add: 1, duration: 'thisTurn' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['ca1', 'ca2'] }] });
    expect(g.pendingAttack).toMatchObject({
      attacker: 'A',
      value: 6, // 置换有效值 5 + 加成 1
      physical: true,
      sourceValue: 5,
      sourceDieId: 'ca1',
    });
    expect(g.players.A.areas.attack).toHaveLength(0);
  });

  it('攻击置换：未激活 010（真实之剑）时抛错', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '002', '003'] });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' }); // -> main
    g.players.A.areas.attack = [
      { id: 'ca1', value: 2, kind: 'attack' },
      { id: 'ca2', value: 3, kind: 'attack' },
    ];
    expect(() => applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['ca1', 'ca2'] }] })).toThrow();
  });

  it('抵挡置换：防御方已激活 010 时，2 颗骰置换抵挡并无伤消耗', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroB: ['010', '002', '003'] });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' }); // A -> main
    g.players.A.areas.attack = [{ id: 'atk', value: 5, kind: 'attack' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['atk'] }] });
    g.players.B.artifacts.find((a) => a.id === '010')!.activeMarkerSide = 'left';
    g.players.B.areas.defense = [
      { id: 'bd1', value: 1, kind: 'defense' },
      { id: 'bd2', value: 2, kind: 'defense' },
    ];
    const before = g.players.B.life;
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['bd1', 'bd2'] }] });
    expect(g.players.B.life).toBe(before);
    expect(g.players.B.areas.defense).toHaveLength(0);
    expect(g.pendingAttack).toBeNull();
  });

  it('抵挡置换：未激活 010 时抛错且不消耗骰子', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroB: ['004', '002', '003'] });
    skipInitialReroll(g);
    applyAction(g, { t: 'advance' }); // A -> main
    g.players.A.areas.attack = [{ id: 'atk', value: 5, kind: 'attack' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['atk'] }] });
    g.players.B.areas.defense = [
      { id: 'bd1', value: 1, kind: 'defense' },
      { id: 'bd2', value: 2, kind: 'defense' },
    ];
    expect(() => applyAction(g, { t: 'block', costSlots: [{ dieIds: ['bd1', 'bd2'] }] })).toThrow();
    expect(g.players.B.areas.defense).toHaveLength(2);
    expect(g.pendingAttack).not.toBeNull();
  });
});

