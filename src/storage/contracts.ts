import type { QuestionContext } from '../training';
import type { PracticeMaterial } from '../training/results';
import type { RouteRef } from '../route';

export interface GlobalProfile {
  readonly theme: 'system' | 'light' | 'dark';
  readonly onboarding: { readonly version: 1; readonly choice: null | 'guided' | 'free'; readonly completed: boolean };
}
export const DEFAULT_PROFILE: GlobalProfile = Object.freeze({ theme: 'system', onboarding: Object.freeze({ version: 1, choice: null, completed: false }) });

export interface PracticeDraft {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly timeZone: string;
  readonly localDate: string;
  readonly context: QuestionContext | null;
  readonly material: PracticeMaterial;
  readonly routeRef: RouteRef | null;
  readonly totalReferenceMs: number;
  readonly recordedThroughMs: number;
  readonly suggestedBpm: number;
  readonly comfortableBpm: number;
  readonly note: string;
  readonly editRevision: number;
}
export interface DrainDraftRequest {
  readonly draftId: string;
  readonly historyId: string;
  readonly expectedRecordedThroughMs: number;
  readonly throughMs: number;
  readonly editRevision: number;
  readonly comfortableBpm: number;
  readonly note: string;
  readonly occurredAt: string;
  readonly timeZone: string;
  /** Fixture-only transaction abort after successful put; never supplied by UI. */
  readonly failAfterWrite?: 1 | 2;
}
