// 「获得骰」按归属拆分：换视角时，**新视角那一方/那一队**的获得要延后到切换后播。
// 真实事故：2v2 换手（上家结束、下家开始）时，下家的补充骰在**旧视角**里飞完才切画面。
import { describe, it, expect } from 'vitest';
import { splitDeferredAdds } from '../src/ui/motion';

type Seat = 'A1' | 'A2' | 'B1' | 'B2';
const SEATS_OF: Record<string, Seat> = { a1: 'A1', a2: 'A2', b1: 'B1', b2: 'B2' };
const ownerSeat = (id: string): Seat | null => SEATS_OF[id] ?? null;

const SIDES: Record<string, 'A' | 'B'> = { a1: 'A', b1: 'B' };
const ownerSide = (id: string): 'A' | 'B' | null => SIDES[id] ?? null;

describe('splitDeferredAdds（获得骰按归属拆分）', () => {
  it('不换视角：全部现在播', () => {
    const r = splitDeferredAdds(['a1', 'b1'], null, ownerSeat);
    expect(r.now).toEqual(['a1', 'b1']);
    expect(r.deferred).toEqual([]);
  });

  it('1v1：只延后"新视角那一方"的骰', () => {
    const r = splitDeferredAdds(['a1', 'b1'], 'B', ownerSide);
    expect(r.now).toEqual(['a1']);
    expect(r.deferred).toEqual(['b1']);
  });

  it('2v2：一组座位（新视角那一队）一起延后', () => {
    const r = splitDeferredAdds(['a1', 'a2', 'b1', 'b2'], ['B1', 'B2'], ownerSeat);
    expect(r.now).toEqual(['a1', 'a2']);
    expect(r.deferred).toEqual(['b1', 'b2']);
  });

  it('找不到属主的骰一律"现在播"（否则会被藏起来却永远不播）', () => {
    const r = splitDeferredAdds(['ghost', 'b1'], ['B1', 'B2'], ownerSeat);
    expect(r.now).toEqual(['ghost']);
    expect(r.deferred).toEqual(['b1']);
  });

  it('顺序保持不变（动画按原顺序播）', () => {
    const r = splitDeferredAdds(['b2', 'a1', 'b1', 'a2'], ['B1', 'B2'], ownerSeat);
    expect(r.now).toEqual(['a1', 'a2']);
    expect(r.deferred).toEqual(['b2', 'b1']);
  });
});
