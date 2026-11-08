import { describe, it, expect } from 'vitest';
import { applyAction, createTwoVTwoGame, getLegalActions } from '../src/core/engine/game';
import { checkLifeEnd, pumpAttackQueue, resolveBlock, attackDamageBonus } from '../src/core/engine/combat';
import { incrementDustfall } from '../src/core/engine/dustfall';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';

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

describe('2v2 阶段 5 审计', () => {
  it('013 三段攻击逐段翻面，目标逐段生效', () => {
    const cfg = setup();
    cfg.seats.A1 = ['013', '002', '003'];
    cfg.dice = { A1: { attack: [], defense: [], meditation: [2, 5] } };
    const g = createTwoVTwoGame(cfg);
    const ids = g.players.A1.areas.meditation.map((d) => d.id);
    g.pending = { kind: 'dianxing', player: 'A1', values: [1, 2, 3] };

    applyAction(g, { t: 'dianxing', dieIds: ids, targets: ['B1', 'B2', 'B1'] });
    expect(g.pendingAttack?.defender).toBe('B1');
    expect(g.stance).toBe('attackPicks');

    resolveBlock(g, undefined, 'B1');
    pumpAttackQueue(g);
    expect(g.pendingAttack?.defender).toBe('B2');
    expect(g.stance).toBe('defensePicks');

    resolveBlock(g, undefined, 'B2');
    pumpAttackQueue(g);
    expect(g.pendingAttack?.defender).toBe('B1');
    expect(g.stance).toBe('attackPicks');

    resolveBlock(g, undefined, 'B1');
    pumpAttackQueue(g);
    expect(g.pendingAttack).toBeNull();
    expect(g.stance).toBe('defensePicks');
  });

  it('双方同时归零：当前行动方队伍判胜', () => {
    const g = createTwoVTwoGame(setup());
    g.teams!.A.life = 0;
    g.teams!.B.life = 0;
    checkLifeEnd(g);
    expect(g.phase).toBe('gameOver');
    expect(g.winner).toBe('A');
  });

  it('尘落 10：按团队生命比较，不由空白的个人生命决定', () => {
    const g = createTwoVTwoGame(setup());
    g.dustfall = 9;
    g.teams!.A.life = 70;
    g.teams!.B.life = 90;
    incrementDustfall(g);
    expect(g.phase).toBe('gameOver');
    expect(g.winner).toBe('B');
  });

  it('020 由攻击者决定；A04 由兽魂持有者决定', () => {
    const mk = (id: '020' | 'A04') => {
      const cfg = setup();
      cfg.seats.B2 = [id, '011', '012'];
      cfg.dice = {
        A1: { attack: [3], defense: [], meditation: [] },
        B2: { attack: [], defense: [], meditation: [] },
      };
      const g = createTwoVTwoGame(cfg);
      const card = g.players.B2.artifacts.find((a) => a.id === id)!;
      card.activeMarkerSide = 'left';
      card.count = id === '020' ? 1 : 2;
      const atk = g.players.A1.areas.attack[0];
      applyAction(g, { t: 'attack', costSlots: [{ dieIds: [atk.id] }], target: 'B2' });
      resolveBlock(g, undefined, 'B2');
      return g;
    };
    expect(mk('020').pending).toMatchObject({ kind: 'shouhunCancel', player: 'A1' });
    expect(mk('A04').pending).toMatchObject({ kind: 'shouhunCancel', player: 'B2' });
  });

  it('030 每位玩家按自己的第一次攻击计 +3', () => {
    const cfg = setup();
    cfg.seats.A1 = ['030', '002', '003'];
    const g = createTwoVTwoGame(cfg);
    g.players.A1.artifacts.find((a) => a.id === '030')!.activeMarkerSide = 'left';
    g.attacksThisTurn.A1 = 0;
    g.attacksThisTurn.A2 = 0;
    expect(attackDamageBonus(g, 'A1').value).toBe(3);
    expect(attackDamageBonus(g, 'A2').value).toBe(3);
    g.attacksThisTurn.A1 = 1;
    expect(attackDamageBonus(g, 'A1').value).toBe(0);
    expect(attackDamageBonus(g, 'A2').value).toBe(3);
  });
});

  it('2v2 激活/技能动作按真实敌方座位取对手，不把 A1 当 A', () => {
    const cfg = setup();
    cfg.seats.A1 = ['023', '002', '003'];
    cfg.dice = { A1: { attack: [1, 2], defense: [], meditation: [] }, B1: { attack: [], defense: [3], meditation: [] } };
    const g = createTwoVTwoGame(cfg);
    g.phase = 'main';
    g.activePlayer = 'A1';
    const art = g.players.A1.artifacts.find((a) => a.id === '023')!;
    art.activeMarkerSide = 'left';
    art.armedSide = 'left';
    art.armedTurn = g.turnIndex;
    let acts: ReturnType<typeof getLegalActions> = [];
    expect(() => { acts = getLegalActions(g); }).not.toThrow();
    expect(acts.some((a) => a.t === 'skill' && a.artifactId === '023')).toBe(true);
  });
