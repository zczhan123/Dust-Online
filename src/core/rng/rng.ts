export interface Rng {
  int(maxExclusive: number): number;
  rollDie(): number;
  state(): number;
}

export class SeededRng implements Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  private next(): number {
    // mulberry32
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  rollDie(): number {
    return this.int(6) + 1;
  }

  state(): number {
    return this.s;
  }
}
