import { describe, it, expect } from 'vitest';
import { createGame, createChallengeGame, applyAction, skipInitialReroll, siwangShouldFire } from '../src/core/engine/game';
import { SKILL_SELECTION } from '../src/ui/skillSelection';
import { CHALLENGE_RULE_NOTES } from '../src/core/content/challenges';

describe('挑战模式 · 规则调整（批 1）', () => {
  it('024 凶弹业舞：挑战只 **5 个区域**（跳过传奇冥想区）；标准 6 个', () => {
    const sel = SKILL_SELECTION['kuangwu.ultimate'];
    const ch = createChallengeGame({ seed: 1, cardId: 'Z11', challenger: ['022', '023', '024'] });
    const a = sel.steps!({ state: ch, player: 'A', options: ['cw'] } as never).filter((s) => s.kind === 'dice');
    expect(a).toHaveLength(5);
    const std = createGame({ seed: 1, firstPlayer: 'A', heroA: ['022', '023', '024'], heroB: ['004', '005', '006'] });
    const b = sel.steps!({ state: std, player: 'A', options: ['cw'] } as never).filter((s) => s.kind === 'dice');
    expect(b).toHaveLength(6);
  });

  it('033 死亡亦逝（**挑战者**装填生效）：传奇回合结束时 → 挑战者代决（player=A / owner=B），且**只能弃最少**', async () => {
    const { driveLegendTurn } = await import('./helpers');
    // 挑战者自己带 033（挑战模式里昔日**从不使用神器效果** → 033 只能来自挑战者）
    const g = createChallengeGame({ seed: 1, cardId: 'Z12', challenger: ['031', '032', '033'] });
    const a033 = g.players.A.artifacts.find((a) => a.id === '033')!;
    a033.activeMarkerSide = 'left'; // ＝充能满、已装填生效
    a033.armedSide = 'left';
    a033.armedTurn = g.turnIndex;
    // 保证传奇此刻**有区域骰**（避免依赖它本回合技能恰好补到防御骰）
    g.players.B.areas.meditation.push({ id: 'bM', value: 3, kind: 'meditation' });
    skipInitialReroll(g);
    driveLegendTurn(g); // 传奇第 1 回合跑完 → 收尾应挂 033 代决
    const pd = g.pending as { kind?: string; player?: string; owner?: string } | null;
    expect(pd?.kind).toBe('tiaolingPick');
    expect(pd!.player).toBe('A');
    expect(pd!.owner).toBe('B');
    const all = [...g.players.B.areas.attack, ...g.players.B.areas.defense, ...g.players.B.areas.meditation];
    expect(all.length).toBeGreaterThan(0);
    const cnt = new Map<number, number>();
    for (const d of all) cnt.set(d.value, (cnt.get(d.value) ?? 0) + 1);
    const v = [...cnt.entries()].sort((x, y) => y[1] - x[1])[0][0];
    const keep = all.filter((d) => d.value === v).map((d) => d.id);
    const drop = all.filter((d) => d.value !== v).map((d) => d.id);
    // 多弃一颗（再弃一颗"该保留的"）→ 挑战模式下代决传奇：拒绝
    if (keep.length > 0) {
      expect(() => applyAction(g, { t: 'tiaolingResolve', pick: 'same', dieIds: [...drop, keep[0]] })).toThrow();
    }
    // 只弃最少 → 通过
    applyAction(g, { t: 'tiaolingResolve', pick: 'same', dieIds: drop });
    expect(
      g.players.B.areas.attack.length + g.players.B.areas.defense.length + g.players.B.areas.meditation.length,
    ).toBe(keep.length);
  });

  it('033 死亡亦逝：**未装填**（或挑战者没带）时，传奇回合结束**不**挂代决', async () => {
    const { driveLegendTurn } = await import('./helpers');
    // Z11 的预设里虽有 033，但传奇从不装填神器 → 不算生效（修正：不再有"传奇预设例外"）
    const g = createChallengeGame({ seed: 1, cardId: 'Z11', challenger: ['001', '002', '003'] });
    skipInitialReroll(g);
    driveLegendTurn(g);
    expect(g.pending?.kind ?? null).not.toBe('tiaolingPick');
  });

  it('规则面板：「规则调整」条目**不带编号**、12 条、且不含 `**` 标记', () => {
    const titles = CHALLENGE_RULE_NOTES.map((n) => n.title);
    expect(titles).toHaveLength(12);
    expect(titles.some((t) => /^\d/.test(t))).toBe(false); // 不以编号开头
    for (const t of [
      '鸣雷·雷暴（持续）',
      '幽冥·帷幕（触发）',
      '兽魂',
      '蛇蝎·共振（启动）',
      '蛇蝎·畏惧（启动）',
      '狂舞·凶弹业舞（必杀）',
      '哀歌·陷阵（持续）',
      '寒光·凛冽之音（充能）',
      '天罚·白昼之火（激活）',
      '天罚「异相」·深空之火',
      '凋零·死亡亦逝（持续）',
      '先机（战术牌）',
    ]) {
      expect(titles).toContain(t);
    }
    expect(titles).not.toContain('兽魂「异相」'); // A04＝持有者自选 → 不属调整
    for (const n of CHALLENGE_RULE_NOTES) expect(n.text).not.toContain('**');
  });
});

describe('死亡亦逝（033）· 唯一判定 siwangShouldFire（两条回合结束路径共用）', () => {
  it('任一方装填生效 → 双方各自回合结束都要执行；该回合玩家区域为空则否', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['031', '032', '033'], heroB: ['004', '005', '006'] });
    g.players.A.areas.meditation = [{ id: 'aM', value: 2, kind: 'meditation' }];
    g.players.B.areas.attack = [{ id: 'bA', value: 2, kind: 'attack' }];
    expect(siwangShouldFire(g, 'A')).toBe(false); // 未装填 → 不生效
    const a033 = g.players.A.artifacts.find((a) => a.id === '033')!;
    a033.activeMarkerSide = 'left'; // ＝充能满、已装填生效
    a033.armedSide = 'left';
    a033.armedTurn = g.turnIndex;
    expect(siwangShouldFire(g, 'A')).toBe(true); // 装填方自己回合结束 → 执行
    expect(siwangShouldFire(g, 'B')).toBe(true); // **另一方**回合结束也要执行（「双方在各自的回合结束时」）
    g.players.B.areas = { attack: [], defense: [], meditation: [] };
    expect(siwangShouldFire(g, 'B')).toBe(false); // 该回合玩家区域为空 → 无事可做、不弹
  });
});

describe('挑战模式 · 神器引发的选择＝一律由挑战者代决（批 3）', () => {
  it('026 陷阵：决策人若落在传奇(B) → 由挑战者代决（player=A / owner=A），且三种模式都不自动选', async () => {
    const { driveLegendTurn, toMain } = await import('./helpers');
    for (const settleMode of ['manual', 'favor', 'against'] as const) {
      const g = createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['025', '026', '027'], settleMode });
      const a026 = g.players.A.artifacts.find((a) => a.id === '026')!;
      a026.activeMarkerSide = 'left';
      a026.armedSide = 'left';
      a026.armedTurn = g.turnIndex;
      g.players.A.life = 50;
      g.players.B.life = 20; // 传奇生命更低 → 本应由(B)决策
      skipInitialReroll(g);
      driveLegendTurn(g); // 传奇第 1 回合 → 挑战者回合开始
      toMain(g);
      applyAction(g, { t: 'advance' }); // 结束挑战者主要阶段 → 传奇第 2 回合
      driveLegendTurn(g); // 传奇第 2 回合 → 挑战者第 2 回合（重掷阶段）
      applyAction(g, { t: 'advance' }); // 结束重掷阶段 → 触发「陷阵」
      const pd = g.pending as { kind?: string; player?: string; owner?: string } | null;
      expect(pd?.kind).toBe('xianzhenPick');
      expect(pd!.player).toBe('A'); // 决策人＝挑战者（不因 settleMode 自动选）
      expect(pd!.owner).toBe('A'); // 骰子仍是挑战者(A)的
    }
  });
});
