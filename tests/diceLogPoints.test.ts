import { describe, it, expect } from 'vitest';
import { createGame } from '../src/core/engine/game';
import { refillPhase, endPhase } from '../src/core/engine/phases';
import { SeededRng } from '../src/core/rng/rng';

describe('"获得/补充骰子"的战报带点数（全模式统一）', () => {
  it('补充阶段：`补充 N 颗能力骰（…）` 带实际点数', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    g.players.A.areas = { attack: [], defense: [], meditation: [] }; // 清空 → 补充阶段必有得补
    refillPhase(g, 'A', new SeededRng(7));
    const after = [...g.players.A.areas.attack, ...g.players.A.areas.defense, ...g.players.A.areas.meditation];
    expect(after.length).toBeGreaterThan(0);
    const text = g.log.map((l) => l.text).join('\n');
    const seq = after
      .map((d) => d.value)
      .sort((a, b) => a - b)
      .join('/');
    expect(text).toContain(`补充 ${after.length} 颗能力骰（${seq}）`);
  });
});

describe('"弃置骰子"的战报带点数（全模式统一）', () => {
  it('结束阶段：`弃置 N 颗能力骰（超出意志上限：…）` 带实际点数', () => {
    const g = createGame({ seed: 3, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    const p = g.players.A;
    p.areas = { attack: [], defense: [], meditation: [] };
    for (let v = 1; v <= 12; v++) p.areas.meditation.push({ id: `m${v}`, value: ((v - 1) % 6) + 1, kind: 'meditation' });
    const n = endPhase(g, 'A');
    expect(n).toBeGreaterThan(0);
    const text = g.log.map((l) => l.text).join('\n');
    expect(text).toMatch(/弃置 \d+ 颗能力骰（超出意志上限：[\d点、]+）/);
  });
});
