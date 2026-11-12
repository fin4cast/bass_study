import type { RhythmPracticeClock } from '../audio/rhythm';
import { DEFAULT_PREFERENCES, type PracticeDraft } from '../storage';
import { rhythmPracticeLabel, type RhythmPracticeMaterial } from '../training/results';
import type { mountFoundation } from '../ui/foundation';
import type { mountRhythm } from '../ui/rhythm';
import type { AppSection } from './page-frame';
import type { createPracticeDrafts, PracticeBinding } from './practice-drafts';

export interface PracticeContextOptions {
  readonly drafts: ReturnType<typeof createPracticeDrafts>;
  /** Закрытие страницы или применение настроек: привязка не меняется. */
  readonly isSuspended: () => boolean;
  readonly activeModule: () => AppSection;
  readonly foundation: () => ReturnType<typeof mountFoundation> | undefined;
  readonly rhythm: () => ReturnType<typeof mountRhythm> | undefined;
}

export function rhythmPracticeBinding(practice: RhythmPracticeClock, readClock: PracticeBinding['readClock'] = () => practice): PracticeBinding {
  const material: RhythmPracticeMaterial = { kind: 'rhythm', playback: practice.playback };
  return { context: null, material, routeRef: null, label: rhythmPracticeLabel(material), readClock };
}

/** Какой материал и чьи часы сейчас питают черновик ручной практики. `view` — прежний показ черновика; блок «Не сохранено» в «Прогрессе» строит `progress-flow.ts`. */
export function createPracticeContext(options: PracticeContextOptions) {
  let bindingKey = '';

  function sync() {
    if (options.isSuspended()) return;
    let next: PracticeBinding | null = null;
    let runtimeKey: string | undefined;
    if (options.activeModule() === 'harmony') {
      const practice = options.rhythm()?.getPractice();
      if (practice) {
        runtimeKey = practice.runtimeContextKey;
        next = rhythmPracticeBinding(practice, () => {
          const live = options.rhythm()?.getPractice();
          return live?.runtimeContextKey === practice.runtimeContextKey ? live : practice;
        });
      }
    } else if (options.activeModule() === 'foundation') {
      next = options.foundation()?.practiceBinding() ?? null;
    }
    const key = runtimeKey ?? (next ? JSON.stringify({ context: next.context, material: next.material, routeRef: next.routeRef }) : '');
    if (key !== bindingKey) { options.drafts.bind(next); bindingKey = key; void options.drafts.flush().catch(() => {}); }
  }

  function view(value: PracticeDraft | null) {
    if (!value && options.activeModule() === 'harmony') return { context: null, durationMs: 0, comfortableBpm: options.rhythm()?.getPreferences().metronome.bpm ?? 92, note: '', label: 'Метроном и ритм', available: false };
    return value ? { id: value.id, createdAt: value.createdAt, timeZone: value.timeZone, context: value.context, material: value.material, routeRef: value.routeRef, durationMs: value.totalReferenceMs - value.recordedThroughMs, comfortableBpm: value.comfortableBpm, note: value.note,
      label: value.material.kind === 'rhythm' ? rhythmPracticeLabel(value.material) : value.material.kind === 'sequence' ? 'Последовательность на грифе' : 'Изучение грифа', available: true }
      : options.foundation()?.getPracticeFallback() ?? { context: null, durationMs: 0, comfortableBpm: DEFAULT_PREFERENCES.player.bpm, note: '', label: 'Изучение грифа', available: false };
  }

  return {
    sync, view,
    /** После загрузки или восстановления черновиков привязка выбирается заново. */
    reset() { bindingKey = ''; },
  };
}
