import { describe, it, expect } from 'vitest';

/**
 * 「攻击点数 / 伤害」口径门禁（源码扫描）。
 *
 * 背景（2026-10-11 真实事故）：`PendingAttack` 三个字段极易混用——
 *   · `pa.baseValue` ＝ **攻击点数**（物理＝骰点；虚拟＝技能指定点数；已含 028「陨落」"攻击视为6"）
 *   · `pa.sourceValue` ＝ **那颗真骰的原始点数**（不做"攻击点数"判定）
 *   · `pa.value` ＝ **伤害**（＝点数 + 加成）
 * Z07「围攻」曾误用 `sourceValue`（陨落把 3 点骰改判成 6 → 不触发）；Z06「冥界行走」原用 `value`（伤害）——
 *   Z06 内黑/白两面技能不共存、`value ≡ baseValue`（当时无实际影响），但仍**按卡面"回复该攻击点数一半"统一到 `baseValue`**（口径对齐）。
 * 本文件锁死这两处别回退，并确保攻击创建点都写 `baseValue`。
 */
const RAW = import.meta.glob('../src/core/engine/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;
const srcOf = (name: string): string =>
  Object.entries(RAW).find(([k]) => k.endsWith(`/${name}.ts`))?.[1] ?? '';

describe('挑战模式 · "攻击点数"口径门禁（源码扫描）', () => {
  const combat = (): string => {
    const s = srcOf('combat');
    expect(s.length).toBeGreaterThan(0); // 确认读到了源码
    return s;
  };

  it('Z07「围攻」按**攻击点数** `pa.baseValue === 6` 判定，**不再**用 `pa.sourceValue`', () => {
    expect(combat()).toMatch(/pa\.baseValue === 6/);
    expect(combat()).not.toMatch(/pa\.sourceValue === 6/);
  });

  it('Z06「冥界行走」回血取**攻击点数** `Math.ceil((pa.baseValue ?? pa.value) / 2)`（不再直接除以 `pa.value`）', () => {
    expect(combat()).toMatch(/Math\.ceil\(\(pa\.baseValue \?\? pa.value\) \/ 2\)/);
    expect(combat()).not.toMatch(/Math\.ceil\(pa\.value \/ 2\)/);
  });

  it('攻击创建点（doAttack 实体 / virtualAttack·commitAttack 虚拟）都写 `baseValue`', () => {
    const s = combat();
    expect(s).toMatch(/baseValue: attackPoint/); // 实体攻击（doAttack）
    expect(s).toMatch(/baseValue: point/); // 虚拟 / 重新提交（virtualAttack / commitAttack）
  });
});
