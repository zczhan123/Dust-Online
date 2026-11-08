import { ARTIFACT_TEXT } from '../../core/content/artifactText';
import { ARTIFACTS, SPECIAL_ARTIFACT_NOTE, isAltArtifact } from '../../core/content/artifacts';
export interface ArtifactDetailCard {
  name: string;
  weapon?: string;
  special?: boolean;
}

export function artifactDetailTitle(a: ArtifactDetailCard): string {
  return `${a.name}${a.weapon ? `（${a.weapon}）` : ''}${a.special ? '　〔特典〕' : ''}`;
}

export function artifactDetailKind(id: string, a?: ArtifactDetailCard): string {
  if (a?.special) return '特典';
  return isAltArtifact(id) ? '异相' : '';
}

export function artifactDetailSkills(id: string): NonNullable<(typeof ARTIFACT_TEXT)[string]>['skills'] {
  return ARTIFACT_TEXT[id]?.skills ?? [];
}

export function artifactDetailNote(id: string): string | undefined {
  return ARTIFACTS[id]?.special ? SPECIAL_ARTIFACT_NOTE : undefined;
}
