import { describe, it, expect } from 'vitest';
import { ARTIFACT_TEXT } from '../src/core/content/artifactText';
import { ARTIFACTS, makeArtifact } from '../src/core/content/artifacts';
import { artifactSkillName, skillBubbleName } from '../src/ui/render';
import type { SkillDef } from '../src/core/model/types';

/**
 * 神器技能名「唯一取名来源」门禁。
 *
 * 真实事故：2v2 技能名显示成神器名（「影掠」而不是「影袭」）——根因是
 * `ARTIFACT_TEXT` **没有 `key` 字段**，按 skillKey 去查永远查不到 → 退化成卡名。
 * 本测试把「45 件神器 × 每一条技能」全部扫一遍，任何一条取不到正确名字都会红。
 */

/** `SkillDef.kind` → 卡面文案类型词（与 `render.ts` 的 `KIND_TYPE_WORD` 同口径，测试内独立维护防"同源作弊"）。 */
const KIND_TYPE_WORD: Record<SkillDef['kind'], string> = {
  activate: '启动',
  activation: '激活',
  trigger: '触发',
  continuous: '持续',
  charge: '充能',
  ultimate: '必杀',
};

/** 卡面文案 `type` → `SkillDef.kind`（合写类型如「持续 / 触发」取第一条）。 */
function kindOfText(type: string): SkillDef['kind'] {
  const parts = type.split('/').map((t) => t.trim());
  for (const [kind, word] of Object.entries(KIND_TYPE_WORD) as [SkillDef['kind'], string][]) {
    if (parts.includes(word)) return kind;
  }
  throw new Error(`未知技能类型：${type}`);
}

const ARTIFACT_IDS = Object.keys(ARTIFACTS).sort();

describe('神器技能名唯一来源', () => {
  it('ARTIFACT_TEXT 与 ARTIFACTS 的 id 集合完全一致（不允许单边缺条）', () => {
    expect(Object.keys(ARTIFACT_TEXT).sort()).toEqual(ARTIFACT_IDS);
  });

  it('每件神器 × 每条技能：artifactSkillName(侧, kind) 都能取到该条文案的名字', () => {
    const failures: string[] = [];
    for (const id of ARTIFACT_IDS) {
      const art = makeArtifact(id);
      expect(art.skills.length).toBeGreaterThan(0);
      for (const skill of art.skills) {
        const name = artifactSkillName(id, skill.side, skill.kind);
        const label = `${id}/${skill.side}/${skill.kind}`;
        if (!name) {
          failures.push(`${label} → 空`);
          continue;
        }
        if (/\.[a-z]/i.test(name)) failures.push(`${label} → 像内部 key：${name}`);
        // 与卡面文案逐条对齐（不是"取到了就行"）
        const expected = ARTIFACT_TEXT[id]?.skills.find(
          (s) =>
            s.side === skill.side &&
            s.type.split('/').some((t) => t.trim() === KIND_TYPE_WORD[skill.kind]),
        )?.name;
        if (name !== expected) failures.push(`${label} → ${name}（应为 ${expected}）`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('反向：每条卡面文案都能被 artifactSkillName 取到（含「持续 / 触发」合写）', () => {
    const failures: string[] = [];
    for (const id of ARTIFACT_IDS) {
      const text = ARTIFACT_TEXT[id];
      for (const s of text.skills) {
        const name = artifactSkillName(id, s.side, kindOfText(s.type));
        if (name !== s.name) failures.push(`${id}/${s.side}/${s.type} → ${name}（应为 ${s.name}）`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('不给 kind 时退回该侧第一条（历史口径，不返回空）', () => {
    for (const id of ARTIFACT_IDS) {
      for (const side of ['left', 'right', 'only'] as const) {
        const onSide = ARTIFACT_TEXT[id].skills.filter((s) => s.side === side);
        if (onSide.length === 0) continue;
        expect(artifactSkillName(id, side)).toBe(onSide[0].name);
      }
    }
  });

  it('未知神器返回 undefined，绝不编造型号', () => {
    expect(artifactSkillName('999', 'left', 'activate')).toBeUndefined();
    expect(artifactSkillName('', 'only')).toBeUndefined();
  });
});

describe('skillBubbleName（1v1 / 2v2 共用取名）', () => {
  /** 取一个最小可用的 2v2 局面，把 A1 的神器换成一整排做全量扫描。 */
  async function stateWithAllArtifacts() {
    const { createTwoVTwoGame } = await import('../src/core/engine/game');
    const state = createTwoVTwoGame({
      seats: {
        A1: ['001', '002', '003'],
        A2: ['004', '005', '006'],
        B1: ['007', '008', '009'],
        B2: ['010', '011', '012'],
      },
      firstTeam: 'A',
      seed: 7,
      startPhase: false,
    });
    state.players.A1.artifacts = ARTIFACT_IDS.map((id) => makeArtifact(id));
    return state;
  }

  it('45 件神器 × 每一条技能 key：返回非空、不含内部 key 形态', async () => {
    const state = await stateWithAllArtifacts();
    const failures: string[] = [];
    for (const id of ARTIFACT_IDS) {
      const art = makeArtifact(id);
      for (const skill of art.skills) {
        const name = skillBubbleName(state, 'A1', id, skill.side, skill.key);
        const label = `${id}/${skill.key}`;
        if (!name) failures.push(`${label} → 空`);
        else if (/\.[a-z]/i.test(name)) failures.push(`${label} → 像内部 key：${name}`);
        else {
          const expected = artifactSkillName(id, skill.side, skill.kind);
          if (name !== expected) failures.push(`${label} → ${name}（应为 ${expected}）`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('未知 skillKey 仍能退回到该侧名字（不炸、不返回 key）', async () => {
    const state = await stateWithAllArtifacts();
    const name = skillBubbleName(state, 'A1', '005', 'right', 'no.such.key');
    expect(name).toBe(artifactSkillName('005', 'right'));
    expect(name.length).toBeGreaterThan(0);
  });
});
