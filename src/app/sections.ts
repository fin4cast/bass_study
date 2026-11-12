import type { mountEar } from '../ui/ear';
import type { mountFoundation } from '../ui/foundation';
import type { mountInput } from '../ui/input';
import type { mountIntroduction } from '../ui/introduction';
import type { mountRhythm } from '../ui/rhythm';
import type { mountRoute } from '../ui/route';
import type { mountStudio } from '../ui/studio';
import { createAudioOwner } from './audio-owner';
import type { AppSection } from './page-frame';

/** Смонтированные разделы; отсутствующие в составе приложения остаются `undefined`. */
export interface AppSections {
  foundation?: ReturnType<typeof mountFoundation>;
  ear?: ReturnType<typeof mountEar>;
  rhythm?: ReturnType<typeof mountRhythm>;
  studio?: ReturnType<typeof mountStudio>;
  input?: ReturnType<typeof mountInput>;
  route?: ReturnType<typeof mountRoute>;
  introduction?: ReturnType<typeof mountIntroduction>;
}

export interface SectionAudioOptions {
  /** Общие условия: страница не закрывается, настройки не применяются, вкладка видима, право записи получено. */
  readonly canStartAny: () => boolean;
  readonly activeModule: () => AppSection;
  readonly introductionOpen: () => boolean;
}

/** Один владелец звука для всех разделов: кто может начать звук и как остановить прежнего владельца. */
export function createSectionAudio(sections: AppSections, options: SectionAudioOptions) {
  return createAudioOwner({
    canStart(owner) {
      if (!options.canStartAny()) return false;
      const { foundation, studio } = sections;
      const active = options.activeModule();
      switch (owner) {
        case 'sequence': return active === 'foundation' && foundation?.mode === 'sequence' && foundation.rangeIsValid();
        case 'ear': return active === 'ear';
        case 'rhythm': return active === 'harmony';
        case 'tracks': return active === 'tracks' && studio?.view === 'audio';
        case 'scores': return active === 'tracks' && studio?.view === 'scores';
        case 'input': return active === 'input';
        case 'introduction': return options.introductionOpen();
      }
    },
    participants: {
      sequence: () => sections.foundation?.stop(),
      ear: reason => reason === 'retire' ? sections.ear?.stop('Страница закрывается') : sections.ear?.pauseListening(reason === 'route' ? 'Активный таймер приостановлен.' : undefined),
      rhythm: reason => reason === 'owner' || reason === 'route' ? sections.rhythm?.pause('audio-owner') : reason === 'section' ? sections.rhythm?.pause('module') : sections.rhythm?.stop(),
      tracks: () => sections.studio?.stop('audio'),
      scores: () => sections.studio?.stop('scores'),
      input: () => sections.input?.stop(),
      introduction: () => sections.introduction?.stop(),
    },
    cancelScorePreparation: () => sections.studio?.cancelScorePreparation(),
  });
}
