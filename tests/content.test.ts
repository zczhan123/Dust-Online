import { describe, it, expect } from 'vitest';
import { ARTIFACTS, makeArtifact } from '../src/core/content/artifacts';

describe('artifact content', () => {
  it('雨切 is column 1 with speed 4 / will 7', () => {
    const a = ARTIFACTS['001'];
    expect(a.name).toBe('雨切');
    expect(a.column).toBe(1);
    expect(a.speed).toBe(4);
    expect(a.will).toBe(7);
  });

  it('游龙 is column 2 with correct distribution', () => {
    const a = ARTIFACTS['002'];
    expect(a.column).toBe(2);
    expect(a.distribution).toEqual({ defense: [1, 6], attack: [3, 4], meditation: [2, 5] });
  });

  it('影掠 distribution', () => {
    expect(ARTIFACTS['005'].distribution).toEqual({ defense: [3], attack: [1, 2, 6], meditation: [4, 5] });
  });

  it('明镜 is column 3 with life 50 / charge 4', () => {
    const a = ARTIFACTS['003'];
    expect(a.column).toBe(3);
    expect(a.life).toBe(50);
    expect(a.chargeReq).toBe(4);
  });

  it('makeArtifact returns a fresh copy', () => {
    const a = makeArtifact('001');
    a.count = 2;
    expect(makeArtifact('001').count).toBe(0);
  });
});
