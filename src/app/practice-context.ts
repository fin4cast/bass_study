import type { RhythmPracticeClock } from '../audio/rhythm';
import { rhythmPracticeLabel, type RhythmPracticeMaterial } from '../training/results';
import type { mountRhythm } from '../ui/rhythm';
import type { AppSection } from './page-frame';
import type { createPracticeDrafts, PracticeBinding } from './practice-drafts';

export interface PracticeContextOptions {
  readonly drafts: ReturnType<typeof createPracticeDrafts>;
  /** Закрытие страницы или применение настроек: привязка не меняется. */
  readonly isSuspended: () => boolean;
  readonly activeModule: () => AppSection;
  readonly rhythm: () => ReturnType<typeof mountRhythm> | undefined;
}

export function rhythmPracticeBinding(practice: RhythmPracticeClock, readClock: PracticeBinding['readClock'] = () => practice): PracticeBinding {
  const material: RhythmPracticeMaterial = { kind: 'rhythm', playback: practice.playback };
  return { context: null, material, routeRef: null, label: rhythmPracticeLabel(material), readClock };
}

/**
 * Какой материал и чьи часы сейчас питают черновик ручной практики. После P13-08 часы есть только у «Ритма»:
 * «Гриф» стал атласом без звука и последовательностей и черновиков не создаёт. Сохранённые черновики «Грифа»
 * (`fretboard`, `sequence`) остаются в хранилище и в «Прогрессе», но новой привязки к ним нет.
 */
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
    }
    const key = runtimeKey ?? (next ? JSON.stringify({ context: next.context, material: next.material, routeRef: next.routeRef }) : '');
    if (key !== bindingKey) { options.drafts.bind(next); bindingKey = key; void options.drafts.flush().catch(() => {}); }
  }

  return {
    sync,
    /** После загрузки или восстановления черновиков привязка выбирается заново. */
    reset() { bindingKey = ''; },
  };
}
