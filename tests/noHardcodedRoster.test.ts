import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const engineDir = join(process.cwd(), 'src', 'core', 'engine');
const engineFiles = readdirSync(engineDir).filter((f) => f.endsWith('.ts'));

describe('引擎不再硬编码 1v1 座位表', () => {
  it('没有 [\'A\', \'B\'] 字面量，也没有私有 oppOf', () => {
    const offenders: string[] = [];
    for (const file of engineFiles) {
      const text = readFileSync(join(engineDir, file), 'utf8');
      if (/\[\s*'A'\s*,\s*'B'\s*\]/.test(text)) offenders.push(`${file}: ['A','B']`);
      if (/\boppOf\b/.test(text)) offenders.push(`${file}: oppOf`);
    }
    expect(offenders).toEqual([]);
  });
});
