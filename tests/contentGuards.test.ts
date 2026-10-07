import { describe, it, expect } from 'vitest';
import { ARTIFACTS, HEROES } from '../src/core/content/artifacts';
import { challengeInertSkills } from '../src/core/content/challenges';
import { SKILL_HANDLERS } from '../src/core/engine/skills';
import { createGame, skipInitialReroll, getLegalActions } from '../src/core/engine/game';
import type { DiceKind, GameState } from '../src/core/model/types';

const KINDS: DiceKind[] = ['attack', 'defense', 'meditation'];

/**
 * 结构性守卫：防「新增卡片时漏登记」这一类错误（真实事故：027 寒光·必杀的
 * `activateSkillActions` 分支漏写 → 引擎从不生成该动作 → UI 没有必杀按钮可渲染）。
 */
describe('内容 / 引擎一致性守卫', () => {
  it('所有「启动 / 激活 / 充能 / 必杀」类技能都必须有处理器（SKILL_HANDLERS）', () => {
    const missing: string[] = [];
    for (const a of Object.values(ARTIFACTS)) {
      for (const s of a.skills) {
        if (!['activate', 'activation', 'charge', 'ultimate'].includes(s.kind)) continue;
        if (!SKILL_HANDLERS[s.key]) missing.push(`${a.id}「${s.key}」`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('挑战模式削弱的技能 key 必须真实存在于神器内容（防拼写变成静默失效）', () => {
    const allKeys = new Set(Object.values(ARTIFACTS).flatMap((a) => a.skills.map((s) => s.key)));
    for (const key of challengeInertSkills()) {
      expect(allKeys.has(key)).toBe(true);
    }
  });

  it('每个英雄：神器全部激活 + 给足骰子后，所有「必杀」都必须出现在 getLegalActions', () => {
    const missing: string[] = [];
    for (const [heroKey, hero] of Object.entries(HEROES)) {
      const g: GameState = createGame({
        seed: 1,
        firstPlayer: 'A',
        heroA: hero.artifacts as unknown as [string, string, string],
        heroB: ['004', '005', '006'],
      });
      skipInitialReroll(g);
      // 直接构造"主要阶段 + 神器全激活 + 骰子充足"的局面（纯读校验，不推进流程）
      g.phase = 'main';
      g.pending = null;
      g.pendingAttack = null;
      g.ultimatesUsed = [];
      g.skillsUsedThisTurn = [];
      const p = g.players.A;
      for (const a of p.artifacts) {
        a.activeMarkerSide = 'left';
        a.count = 5; // 018 至黑 等必杀需要计数
        for (const k of KINDS) {
          p.areas[k] = [1, 2, 3, 4, 5, 6].map((v) => ({ id: `${a.id}-${k}-${v}`, value: v, kind: k }));
          g.players.B.areas[k] = [1, 2, 3, 4, 5, 6].map((v) => ({ id: `B-${a.id}-${k}-${v}`, value: v, kind: k }));
        }
      }
      const acts = getLegalActions(g);
      for (const a of p.artifacts) {
        for (const s of a.skills) {
          if (s.kind !== 'ultimate') continue;
          const offered = acts.some(
            (x) => x.t === 'skill' && x.artifactId === a.id && x.side === s.side,
          );
          if (!offered) missing.push(`${heroKey} / ${a.id}「${s.key}」`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
