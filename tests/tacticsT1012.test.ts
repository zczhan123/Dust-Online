// 战术牌 T10「迂回」/ T11「迷烟」/ T12「激进」
import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll, getLegalActions } from '../src/core/engine/game';
import { TACTIC_BY_ID, tacticDisplayText, TACTIC_POOL } from '../src/core/content/tactics';
import type { GameState } from '../src/core/model/types';

const mk = (tacticA: string, heroA: [string, string, string] = ['001', '002', '003']): GameState =>
  createGame({
    seed: 1,
    firstPlayer: 'A',
    heroA,
    heroB: ['001', '002', '003'],
    tacticA,
    tacticB: 'T04',
  });

describe('T10「迂回」', () => {
  it('第一次切换「不含激活技能」的神器 → 挂待决策，放置 2 个 1 点骰', () => {
    const g = mk('T10');
    skipInitialReroll(g);
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    g.players.A.areas.meditation = [{ id: 'm', value: 3, kind: 'meditation' }];
    g.players.A.areas.defense = []; // 清空，便于精确断言放置结果
    g.players.A.areas.attack = [];
    g.players.A.artifacts.find((a) => a.id === '001')!.activeMarkerSide = 'left'; // 预置标记 → 本次是"切换"
    applyAction(g, { t: 'dustRise', artifactId: '001', costSlots: [{ dieIds: ['m'] }] });
    expect(g.pending?.kind).toBe('yuhuiPlace');
    applyAction(g, { t: 'yuhuiPlace', areas: ['defense', 'meditation'] });
    expect(g.players.A.areas.defense).toHaveLength(1);
    expect(g.players.A.areas.defense[0].value).toBe(1);
    expect(g.players.A.areas.meditation.filter((d) => d.value === 1)).toHaveLength(1);
    expect(g.players.A.tacticOnceUsed).toBe(true);
  });

  it('切换「含激活技能」的神器 → 不触发', () => {
    const g = mk('T10', ['016', '002', '003']); // 016 第一列含「激活」技能
    skipInitialReroll(g);
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    g.players.A.areas.meditation = [{ id: 'm', value: 3, kind: 'meditation' }];
    g.players.A.artifacts.find((a) => a.id === '016')!.activeMarkerSide = 'left';
    applyAction(g, { t: 'dustRise', artifactId: '016', costSlots: [{ dieIds: ['m'] }] });
    expect(g.players.A.tacticOnceUsed).toBe(false);
    expect(g.pending?.kind).not.toBe('yuhuiPlace');
  });
});

describe('T11「迷烟」', () => {
  it('首个回合仍保留重掷阶段（无 T11 时为尘起）', () => {
    const g = mk('T11');
    skipInitialReroll(g);
    expect(g.phase).toBe('reroll');
    const g2 = mk('T04');
    skipInitialReroll(g2);
    expect(g2.phase).toBe('dustRise');
  });

  it('初始生命：自己 +3、对方 −3；显示文本', () => {
    const base = createGame({ seed: 1, firstPlayer: 'A' });
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T11', tacticB: 'T04' });
    expect(g.players.A.life).toBe(base.players.A.life + 3);
    expect(g.players.A.lifeMax).toBe(base.players.A.lifeMax + 3);
    expect(g.players.B.life).toBe(base.players.B.life - 3);
    expect(g.players.B.lifeMax).toBe(base.players.B.lifeMax - 3);
    expect(TACTIC_BY_ID.T11.lifeMods).toEqual([
      { who: 'self', amount: 3 },
      { who: 'opp', amount: 3 },
    ]);
    expect(tacticDisplayText(TACTIC_BY_ID.T11)).toBe(
      '你在自己的第一个回合仍具有重掷阶段；提高你的初始生命3点，降低对方初始生命3点。',
    );
  });
});

describe('T12「激进」', () => {
  it('首个尘起阶段可对第三列神器额外充能 1 次（且只此 1 次）', () => {
    const g = mk('T12');
    skipInitialReroll(g);
    expect(g.phase).toBe('dustRise');
    g.activePlayer = 'A';
    g.players.A.areas.meditation = [
      { id: 'm1', value: 3, kind: 'meditation' },
      { id: 'm2', value: 4, kind: 'meditation' },
      { id: 'm3', value: 5, kind: 'meditation' },
    ];
    applyAction(g, { t: 'dustRise', artifactId: '003', costSlots: [{ dieIds: ['m1'] }] });
    expect(g.dustRiseNormalCount).toBe(1);
    expect(g.players.A.tacticOnceUsed).toBe(false);
    g.freeDustRise = 0; // 003「明镜」充能会赠予免费尘起，测试中清掉以聚焦 T12
    applyAction(g, { t: 'dustRise', artifactId: '003', costSlots: [{ dieIds: ['m2'] }] });
    expect(g.players.A.tacticOnceUsed).toBe(true);
    g.freeDustRise = 0; // 充能又赠予了免费尘起，清掉以验证"第三次被拒"
    expect(() => applyAction(g, { t: 'dustRise', artifactId: '003', costSlots: [{ dieIds: ['m3'] }] })).toThrow();
  });

  it('UI 路径：用掉正常尘起后，getLegalActions 仍给出第三列充能（且无其它神器）', () => {
    const g = mk('T12');
    skipInitialReroll(g);
    g.activePlayer = 'A';
    g.players.A.areas.meditation = [
      { id: 'm1', value: 3, kind: 'meditation' },
      { id: 'm2', value: 4, kind: 'meditation' },
    ];
    applyAction(g, { t: 'dustRise', artifactId: '003', costSlots: [{ dieIds: ['m1'] }] });
    g.freeDustRise = 0;
    const legal = getLegalActions(g).filter((a) => a.t === 'dustRise');
    expect(legal.length).toBeGreaterThan(0);
    expect(legal.every((a) => a.artifactId === '003')).toBe(true); // 只放行第三列（T12 额外充能）
    applyAction(g, legal[0]);
    expect(g.players.A.areas.meditation.length).toBe(0); // 第二次仍正常支付冥想骰
    expect(g.players.A.tacticOnceUsed).toBe(true); // 走的是 T12 额外充能
  });
});

describe('战术牌池含 T10/T11/T12', () => {
  it('TACTIC_POOL 含三张', () => {
    for (const id of ['T10', 'T11', 'T12']) expect(TACTIC_POOL).toContain(id);
  });
});
