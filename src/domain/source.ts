/**
 * Source domain model.
 *
 * Represents a research source discovered during exam research.
 * Sources are classified by type and confidence level, and must be
 * approved by the user before entering the knowledge base.
 */

export type SourceType = 'official' | 'community' | 'commercial' | 'user_file';

export type ConfidenceLevel =
  | 'verified'
  | 'consensus'
  | 'minority'
  | 'single_case'
  | 'disputed'
  | 'insufficient';

export interface SourceRecord {
  id: string;
  url?: string;
  title: string;
  sourceType: SourceType;
  publisher?: string;
  capturedAt: string;
  examVersion?: string;
  summary: string;
  confidenceReason: string;
  confidenceLevel: ConfidenceLevel;
  contentHash?: string;
  approved: boolean;
  approvedAt?: string;
}

/** Source authority hierarchy: official > community consensus > others. */
const SOURCE_PRIORITY: Record<SourceType, number> = {
  official: 4,
  community: 2,
  commercial: 1,
  user_file: 3,
};

export function sourcePriority(type: SourceType): number {
  return SOURCE_PRIORITY[type] ?? 0;
}

/**
 * Quality criteria for experience posts.
 * Returns a score 0-6 indicating how many criteria the post satisfies.
 */
export function experienceQualityScore(post: {
  statesOwnBaseline?: boolean;
  statesExamYear?: boolean;
  givesSpecificTimeline?: boolean;
  distinguishesPersonalVsOfficial?: boolean;
  lowCommercialOrientation?: boolean;
  hasIndependentCorroboration?: boolean;
}): number {
  let score = 0;
  if (post.statesOwnBaseline) score++;
  if (post.statesExamYear) score++;
  if (post.givesSpecificTimeline) score++;
  if (post.distinguishesPersonalVsOfficial) score++;
  if (post.lowCommercialOrientation) score++;
  if (post.hasIndependentCorroboration) score++;
  return score;
}

export function createSourceRecord(input: {
  url?: string;
  title: string;
  sourceType: SourceType;
  publisher?: string;
  examVersion?: string;
  summary: string;
  confidenceReason: string;
  confidenceLevel: ConfidenceLevel;
  contentHash?: string;
}): SourceRecord {
  return {
    id: `src_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ...input,
    capturedAt: new Date().toISOString(),
    approved: false,
  };
}
