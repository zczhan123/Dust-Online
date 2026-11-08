import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(process.cwd(), 'src', 'ui', 'styles.css'), 'utf8');

describe('2v2 战斗壳 CSS 门禁', () => {
  it('描述打开时是玩家框内滚动，不再整页滚动', () => {
    expect(css).not.toContain('html.mode-2v2-show-text');
    expect(css).toMatch(/\.board--2v2\.show-text \.player \.pbody[\s\S]{0,90}overflow-y:\s*auto/);
  });

  it('药丸态左右居中，技能头是 1v1 行内流', () => {
    expect(css).toMatch(/\.board--2v2 \.player \.skills--inline--only\s*\{[\s\S]{0,160}flex-direction:\s*row/);
    expect(css).toMatch(/\.board--2v2 \.player \.skills--inline--only > \.skill\s*\{[\s\S]{0,160}flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.board--2v2 \.player \.skill-part-head\s*\{[\s\S]{0,80}display:\s*block/);
    expect(css).not.toMatch(/\.skill-type[\s\S]{0,160}width:\s*2\.\dem/);
    expect(css).toMatch(/\.board--2v2 \.player \.skill-text\s*\{[\s\S]{0,80}display:\s*inline/);
  });

  it('类型药丸有固定高度、无固定宽度', () => {
    const block =
      css.match(/\.board--2v2 \.player \.skills--inline--only \.skill-type,[\s\S]*?\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(block).toMatch(/display:\s*inline-flex/);
    expect(block).toMatch(/align-items:\s*center/);
    expect(block).toMatch(/height:\s*1\.6em/);
    expect(block).toMatch(/line-height:\s*1\b/);
    expect(block).not.toMatch(/(^|[\s;])width\s*:/);
  });

  it('第三列整块药丸只覆盖左右内边距，上下继承普通条目', () => {
    const block =
      css.match(/\.board--2v2 \.player \.skills--inline--only \.skill-part\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(block).toMatch(/padding-left:\s*2px/);
    expect(block).toMatch(/padding-right:\s*2px/);
    expect(block).not.toMatch(/(^|[\s;])padding\s*:/);
  });

  it('第三列横向并排时清掉纵向 margin-top', () => {
    expect(css).toMatch(/\.skills--inline--only \.skill-part\s*\{[\s\S]{0,80}margin-top:\s*0/);
  });

  it('5/7 字长名字横向借位，宽屏正常、窄屏才收紧', () => {
    const base =
      css.match(/\.board--2v2 \.player \.skills--inline\.skills--borrow\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(base).toMatch(/display:\s*flex/);
    expect(base).toMatch(/flex-direction:\s*row/);
    expect(base).toMatch(/flex-wrap:\s*wrap/);
    expect(base).not.toMatch(/padding-left:/);
    expect(css).toMatch(/\.skills--inline\.skills--borrow > \.skill--right\s*\{[\s\S]{0,80}margin-left:\s*auto/);
    expect(css).toMatch(/\.skill-part-head--nowrap \.skill-name[\s\S]{0,80}white-space:\s*nowrap/);

    const medium =
      css.match(/@media \(max-width: 1900px\)[\s\S]*?\.skills--borrow \.skill-type\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(medium).toMatch(/margin-right:\s*4px/);
    expect(css).toMatch(/@media \(max-width: 1900px\)[\s\S]{0,500}\.skills--borrow \.skill\s*\{[\s\S]{0,80}padding-left:\s*2px/);

    const compact =
      css.match(/@media \(max-width: 1550px\)[\s\S]*?\.skills--borrow \.skill-type\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(compact).toMatch(/margin-right:\s*2px/);
    expect(css).toMatch(/@media \(max-width: 1550px\)[\s\S]{0,500}\.skills--borrow \.skill\s*\{[\s\S]{0,80}padding-left:\s*0/);
  });

  it('队伍生命条按中间两块骰区计算，不再写死 420px', () => {
    expect(css).not.toMatch(/\.board--2v2 \.lifeline--team[\s\S]{0,200}width:\s*420px/);
    expect(css).toMatch(/--team-life-w:\s*calc\(/);
    expect(css).toMatch(/--team-life-inset:\s*56px/);
    expect(css).toMatch(/\.board--2v2 \.lifeline--team\s*\{[\s\S]{0,120}width:\s*var\(--team-life-w\)/);
  });

  it('快速操作栏：攻守标记右侧占满高度，列表不换行，提示贴顶', () => {
    const zone =
      css.match(/\.board--2v2 \.actionzone\s*\{([\s\S]*?)\}/g)?.pop() ?? '';
    expect(zone).toMatch(/display:\s*flex/);
    expect(zone).toMatch(/flex-direction:\s*column/);
    expect(zone).toMatch(/padding-right:\s*92px/);
    expect(css).toMatch(/\.board--2v2 \.actionzone > \.zone-side\s*\{[\s\S]{0,180}position:\s*absolute/);
    expect(css).toMatch(/\.board--2v2 \.actionzone > \.zone-side \.stance-token\s*\{[\s\S]{0,140}height:\s*100%/);
    expect(css).toMatch(/\.board--2v2 \.actionzone \.option-row\s*\{[\s\S]{0,120}gap:\s*8px/);
  });
});
