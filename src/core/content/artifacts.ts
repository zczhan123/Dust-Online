import type { Artifact } from '../model/types';

type ArtifactBase = Omit<Artifact, 'activeMarkerSide' | 'count' | 'chargeLayer'>;

export const ARTIFACTS: Record<string, ArtifactBase> = {
  '001': { id: '001', name: '雨切', column: 1, speed: 4, will: 7 },
  '002': { id: '002', name: '游龙', column: 2, distribution: { defense: [1, 6], attack: [3, 4], meditation: [2, 5] } },
  '003': { id: '003', name: '明镜', column: 3, life: 50, chargeReq: 4 },
  '004': { id: '004', name: '不祥', column: 1, speed: 4, will: 8 },
  '005': { id: '005', name: '影掠', column: 2, distribution: { defense: [3], attack: [1, 2, 6], meditation: [4, 5] } },
  '006': { id: '006', name: '完杀', column: 3, life: 50, chargeReq: 4 },
};

export function makeArtifact(id: string): Artifact {
  const base = ARTIFACTS[id];
  if (!base) throw new Error(`unknown artifact: ${id}`);
  return {
    ...base,
    distribution: base.distribution
      ? {
          defense: [...base.distribution.defense],
          attack: [...base.distribution.attack],
          meditation: [...base.distribution.meditation],
        }
      : undefined,
    activeMarkerSide: null,
    count: 0,
    chargeLayer: 0,
  };
}

export const HEROES = {
  kong: { name: '雨中剑圣 空', artifacts: ['001', '002', '003'] },
  ying: { name: '永暗之刃 影', artifacts: ['004', '005', '006'] },
} as const;
