import { describe, it, expect } from 'vitest';
import { applyAction, createGame, getLegalActions, skipInitialReroll } from '../src/core/engine/game';
import { hasActiveSkill, skillActive } from '../src/core/engine/skill-state';
import { makeLegend } from '../src/core/content/legends';
import type { Artifact, GameState, SkillDef } from '../src/core/model/types';

const guwangArt = (id: string, chargeReq: number): Artifact => {
  const chargeKey = id === '009' ? 'guwang.charge' : 'guwang.alt.charge';
  const skills: SkillDef[] = [
    { side: 'only', kind: 'charge', key: chargeKey },
    { side: 'only', kind: 'ultimate', key: 'guwang.ultimate' },
  ];
  if (id === '009') skills.splice(1, 0, { side: 'only', kind: 'trigger', key: 'guwang.trigger' }); // 009 额外有「触发」
  return {
    id,
    name: '孤王',
    column: 3,
    chargeReq,
    chargeLayer: 0,
    activeMarkerSide: null,
    armedSide: null,
    armedTurn: -1,
    heldDice: [],
    count: 0,
    skills,
  } as unknown as Artifact;
};

/** A 攻击 B 一次（B 持 009/A01 + L03「统御战场」，充能预置到"差一次就满"）→ 受击即完成充能。 */
const hitOnce = (id: string, chargeReq: number, preLayer: number): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A' });
  skipInitialReroll(g);
  g.activePlayer = 'A';
  g.phase = 'main';
  const art = guwangArt(id, chargeReq);
  art.chargeLayer = preLayer;
  g.players.B.artifacts = [art];
  g.players.B.legend = makeLegend('L03');
  g.players.A.areas.attack = [{ id: 'atk0', value: 3, kind: 'attack' }];
  g.players.A.areas.defense = [];
  g.players.A.areas.meditation = [];
  applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['atk0'] }] });
  applyAction(g, { t: 'block' }); // B 不抵挡 → 命中造成伤害
  // 009 的「充能效果」会弹"选择对方 1 个攻击骰"待决策 → 选「不变更」推进
  if (g.pending?.kind === 'guwangCharge') applyAction(g, { t: 'guwangCharge' });
  return g;
};

describe('L03「统御战场」充能顶满 → 必须完成激活（修 bug：此前绕开充能唯一入口、漏设 activeMarkerSide）', () => {
  it('009（guwang.charge，需 3）：补满 → 已激活 + 触发可用 + 必杀就绪', () => {
    const g = hitOnce('009', 3, 2);
    expect(g.players.B.artifacts[0].chargeLayer).toBe(3);
    expect(g.players.B.artifacts[0].activeMarkerSide).toBe('left'); // ← 关键：激活标记
    expect(hasActiveSkill(g.players.B, 'guwang.trigger')).toBe(true);
    g.activePlayer = 'B'; // 必杀属 B → 换到 B 的回合看合法动作
    expect(getLegalActions(g).some((a) => a.t === 'skill' && a.artifactId === '009')).toBe(true);
  });

  it('A01 异相（guwang.alt.charge，需 2）：统御战场能认出它 → 补满 + 必杀就绪', () => {
    const g = hitOnce('A01', 2, 1);
    const art = g.players.B.artifacts[0];
    expect(art.chargeLayer).toBe(2);
    expect(art.activeMarkerSide).toBe('left');
    // A01 的充能效果是「不败之王」（会引发待抵挡的攻击）→ 用 skillActive 直接断言必杀就绪
    const ult = art.skills.find((s) => s.kind === 'ultimate')!;
    expect(skillActive(art, ult)).toBe(true);
  });
});
