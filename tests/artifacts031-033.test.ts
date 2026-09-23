import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll } from '../src/core/engine/game';
import { SKILL_HANDLERS } from '../src/core/engine/skills';
import { SeededRng } from '../src/core/rng/rng';
import type { GameState, PlayerId } from '../src/core/model/types';

/** A 持 031/032/033（受缚邪灵 艾娃），B 持 001/002/003（雨中剑圣 空） */
const aiwaGame = (heroA: [string, string, string] = ['031', '032', '033']): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA, heroB: ['001', '002', '003'] });
  skipInitialReroll(g);
  return g;
};
const art = (g: GameState, who: PlayerId, id: string) => g.players[who].artifacts.find((a) => a.id === id)!;
const arm = (g: GameState, who: PlayerId, id: string, side: 'left' | 'right'): void => {
  const a = art(g, who, id);
  a.activeMarkerSide = side;
  a.armedSide = side;
  a.armedTurn = g.turnIndex;
};
const toMain = (g: GameState): void => {
  let guard = 0;
  while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
};
const clear = (g: GameState, who: PlayerId): void => {
  g.players[who].areas.attack = [];
  g.players[who].areas.defense = [];
  g.players[who].areas.meditation = [];
};
const count = (g: GameState, who: PlayerId): number =>
  g.players[who].areas.attack.length + g.players[who].areas.defense.length + g.players[who].areas.meditation.length;
const runSkill = (g: GameState, who: PlayerId, id: string, key: string, params: Record<string, unknown> = {}): void => {
  SKILL_HANDLERS[key].run({
    g,
    player: who,
    artifact: art(g, who, id),
    rng: new SeededRng(1),
    params,
    endMainPhase: () => {},
    reportConsumed: () => {},
  });
};

describe('031 恶兆（血祭 / 清算）', () => {
  it('血祭：每次攻击后计数 +1；造成伤害后按【新计数】受等量真实伤害（FAQ 31.1.2）', () => {
    const g = aiwaGame();
    toMain(g);
    arm(g, 'A', '031', 'left');
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.attack = [{ id: 'a1', value: 1, kind: 'attack' }];
    const lifeA = g.players.A.life;
    const lifeB = g.players.B.life;
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    applyAction(g, { t: 'block' }); // 不抵挡 → 造成伤害
    expect(art(g, 'A', '031').count).toBe(1);
    expect(g.players.B.life).toBe(lifeB - 1); // 攻击 1 点
    expect(g.players.A.life).toBe(lifeA - 1); // 血祭：按新计数 1 受 1 真实伤害
  });

  it('血祭：被抵挡（0 伤）仍 +1 计数，但不受真实伤害（FAQ 31.1.1）；计数上限 7', () => {
    const g = aiwaGame();
    toMain(g);
    arm(g, 'A', '031', 'left');
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.attack = [{ id: 'a1', value: 4, kind: 'attack' }];
    g.players.B.areas.defense = [{ id: 'bd', value: 1, kind: 'defense' }];
    const lifeA = g.players.A.life;
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['bd'] }] });
    expect(art(g, 'A', '031').count).toBe(1);
    expect(g.players.A.life).toBe(lifeA); // 0 伤 → 不受真伤
    // 上限 7
    let guard = 0;
    while (art(g, 'A', '031').count < 7 && guard++ < 10) {
      g.players.A.areas.attack = [{ id: `x${guard}`, value: 1, kind: 'attack' }];
      applyAction(g, { t: 'attack', costSlots: [{ dieIds: [`x${guard}`] }] });
      applyAction(g, { t: 'block' }); // 造成伤害，但计数封顶 7
    }
    expect(art(g, 'A', '031').count).toBe(7);
  });

  it('清算（激活）：弃置对方 X 颗（X=计数），无缺口则无真伤，随后计数 −1', () => {
    const g = aiwaGame();
    toMain(g);
    const a = art(g, 'A', '031');
    a.activeMarkerSide = 'right';
    a.armedSide = 'right';
    a.armedTurn = g.turnIndex;
    a.count = 3;
    clear(g, 'B');
    g.players.B.areas.attack = [1, 2, 3].map((v) => ({ id: `b${v}`, value: v, kind: 'attack' as const }));
    const lifeB = g.players.B.life;
    g.pending = { kind: 'activationResolve', player: 'A', artifactId: '031', side: 'right' };
    applyAction(g, { t: 'skill', artifactId: '031', side: 'right', params: { dieIds: ['b1', 'b2', 'b3'] } });
    expect(count(g, 'B')).toBe(0);
    expect(g.players.B.life).toBe(lifeB);
    expect(a.count).toBe(2);
  });

  it('清算：对方不足 X → 每差 1 颗造成 3 点真实伤害', () => {
    const g = aiwaGame();
    toMain(g);
    const a = art(g, 'A', '031');
    a.activeMarkerSide = 'right';
    a.armedSide = 'right';
    a.armedTurn = g.turnIndex;
    a.count = 3;
    clear(g, 'B');
    g.players.B.areas.attack = [{ id: 'b1', value: 1, kind: 'attack' }];
    const lifeB = g.players.B.life;
    g.pending = { kind: 'activationResolve', player: 'A', artifactId: '031', side: 'right' };
    applyAction(g, { t: 'skill', artifactId: '031', side: 'right', params: { dieIds: ['b1'] } });
    expect(g.players.B.life).toBe(lifeB - (3 - 1) * 3); // 差 2 颗 → 6 真伤
    expect(a.count).toBe(2);
  });
});

describe('032 梦魇（低语 / 恶意）', () => {
  it('恶意（启动）：消耗 1 攻击骰 → 获得 2 随机冥想骰', () => {
    const g = aiwaGame();
    toMain(g);
    const a = art(g, 'A', '032');
    a.activeMarkerSide = 'right';
    a.armedSide = 'right';
    a.armedTurn = g.turnIndex;
    clear(g, 'A');
    g.players.A.areas.attack = [{ id: 'atk', value: 3, kind: 'attack' }];
    applyAction(g, { t: 'skill', artifactId: '032', side: 'right', params: { costSlots: [{ dieIds: ['atk'] }] } });
    expect(g.players.A.areas.attack.length).toBe(0);
    expect(g.players.A.areas.meditation.length).toBe(2);
  });

  it('恶意（持续）：攻击伤害 +floor(冥想骰数/2)', () => {
    const g = aiwaGame();
    toMain(g);
    arm(g, 'A', '032', 'right');
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.attack = [{ id: 'a1', value: 1, kind: 'attack' }];
    g.players.A.areas.meditation = [1, 2, 3, 4].map((v) => ({ id: `m${v}`, value: v, kind: 'meditation' as const }));
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g.pendingAttack?.bonusValue).toBe(2); // floor(4/2)
    expect(g.pendingAttack?.value).toBe(3);
  });

  it('恶意（持续，FAQ 32.2.1）：按【支付后】的冥想骰数计算（真实之剑用 2 颗 → +1）', () => {
    const g = aiwaGame(['010', '032', '033']);
    toMain(g);
    arm(g, 'A', '010', 'left'); // 真实之剑
    arm(g, 'A', '032', 'right'); // 恶意（启动+持续）
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.meditation = [1, 2, 3, 4].map((v) => ({ id: `m${v}`, value: v, kind: 'meditation' as const }));
    // 用 2 颗冥想骰置换出 1 个攻击骰位 → 支付后冥想骰剩 2 → +1
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['m1', 'm2'] }] });
    expect(g.pendingAttack?.bonusValue).toBe(1);
  });

  it('低语：主要阶段结束时宣称类型 → 获得 1 随机骰并移入该区；不符分布则尘落 +1', () => {
    const g = aiwaGame();
    const a = art(g, 'A', '032');
    a.activeMarkerSide = 'left';
    a.armedSide = 'left';
    a.armedTurn = g.turnIndex;
    g.phase = 'main';
    g.activePlayer = 'A';
    clear(g, 'A');
    const before = g.dustfall;
    applyAction(g, { t: 'advance' }); // 主要阶段结束 → 低语待决策
    expect(g.pending?.kind).toBe('kuyu');
    const medBefore = g.players.A.areas.meditation.length;
    applyAction(g, { t: 'kuyuResolve', area: 'meditation' });
    const med = g.players.A.areas.meditation;
    expect(med.length).toBe(medBefore + 1);
    const die = med[med.length - 1];
    const distMismatch = die.value === 1 || die.value === 6 || die.value === 2 || die.value === 5; // 冥=3/4
    expect(g.dustfall).toBe(before + (distMismatch ? 1 : 0));
    expect(g.activePlayer).toBe('B'); // 回合已结束
  });
});

describe('033 凋零（死亡亦逝）', () => {
  it('充能：抹零——对方下降至个位 0、自己尽可能回复至个位 0（非伤害）', () => {
    const g = aiwaGame();
    g.players.A.life = 32;
    g.players.A.lifeMax = 40;
    g.players.B.life = 45;
    runSkill(g, 'A', '033', 'diaoling.charge');
    expect(g.players.A.life).toBe(40);
    expect(g.players.B.life).toBe(40);
    // 个位本就是 0 → 不变
    runSkill(g, 'A', '033', 'diaoling.charge');
    expect(g.players.B.life).toBe(40);
  });

  it('充能：生命上限个位≠0 时回至上限（FAQ 33.1.3）', () => {
    const g = aiwaGame();
    g.players.A.life = 32;
    g.players.A.lifeMax = 33;
    runSkill(g, 'A', '033', 'diaoling.charge');
    expect(g.players.A.life).toBe(33);
  });

  it('持续：回合结束时本人择②全不同并弃自己的骰；非法弃法抛错', () => {
    const g = aiwaGame();
    const a = art(g, 'A', '033');
    a.activeMarkerSide = 'left';
    g.phase = 'main';
    g.activePlayer = 'A';
    clear(g, 'A');
    g.players.A.areas.attack = [3, 3, 5, 6].map((v, i) => ({ id: `d${i}`, value: v, kind: 'attack' as const }));
    const ids = g.players.A.areas.attack.map((d) => d.id);
    applyAction(g, { t: 'advance' });
    expect(g.pending?.kind).toBe('tiaolingPick');
    // 非法：选①全相同但不弃 → 剩余 {3,3,5,6} 不全同 → 抛错且不改状态
    expect(() => applyAction(g, { t: 'tiaolingResolve', pick: 'same', dieIds: [] })).toThrow();
    expect(g.pending?.kind).toBe('tiaolingPick');
    // 合法：选②全不同，弃掉一个 3
    const dup = ids[1];
    applyAction(g, { t: 'tiaolingResolve', pick: 'diff', dieIds: [dup] });
    const vals = g.players.A.areas.attack.map((d) => d.value).sort();
    expect(vals).toEqual([3, 5, 6]);
    expect(g.activePlayer).toBe('B');
  });

  it('持续：区域为空 → 无需选择（自动通过）', () => {
    const g = aiwaGame();
    const a = art(g, 'A', '033');
    a.activeMarkerSide = 'left';
    g.phase = 'main';
    g.activePlayer = 'A';
    clear(g, 'A');
    applyAction(g, { t: 'advance' });
    expect(g.pending).toBeNull();
    expect(g.activePlayer).toBe('B');
  });
});
