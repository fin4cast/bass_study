import type { mountFoundation } from '../ui/foundation';
import type { mountInput } from '../ui/input';
import type { mountRhythm } from '../ui/rhythm';
import type { mountStudio } from '../ui/studio';
import { createAudioOwner } from './audio-owner';
import type { createLessonSection } from './lesson-section';
import type { AppSection } from './page-frame';

/** Смонтированные разделы; отсутствующие в составе приложения остаются `undefined`. */
export interface AppSections {
  lesson?: ReturnType<typeof createLessonSection>;
  foundation?: ReturnType<typeof mountFoundation>;
  rhythm?: ReturnType<typeof mountRhythm>;
  studio?: ReturnType<typeof mountStudio>;
  /** Диагностика аудиовхода внутри «Настроек». */
  input?: ReturnType<typeof mountInput>;
}

export interface SectionAudioOptions {
  /** Общие условия: страница не закрывается, настройки не применяются, вкладка видима, право записи получено. */
  readonly canStartAny: () => boolean;
  readonly activeModule: () => AppSection;
}

/** Один владелец звука для всех разделов: кто может начать звук и как остановить прежнего владельца. */
export function createSectionAudio(sections: AppSections, options: SectionAudioOptions) {
  return createAudioOwner({
    canStart(owner) {
      if (!options.canStartAny()) return false;
      const { studio, lesson } = sections;
      const active = options.activeModule();
      switch (owner) {
        case 'play': return active === 'lesson' && lesson?.screen === 'play';
        case 'check': return active === 'lesson' && lesson?.screen === 'check';
        case 'rhythm': return active === 'harmony';
        case 'tracks': return active === 'tracks' && studio?.view === 'audio';
        case 'scores': return active === 'tracks' && studio?.view === 'scores';
        case 'input': return active === 'settings';
      }
    },
    participants: {
      // Экран игры встаёт на паузу (продолжение — только действием пользователя); при закрытии, восстановлении и применении настроек — остановка.
      play: reason => reason === 'owner' || reason === 'section' ? sections.lesson?.pausePlay() : sections.lesson?.stopPlay(),
      // «Проверь себя» завершает серию: начатые ответы уходят в историю.
      check: () => sections.lesson?.stopCheck(),
      rhythm: reason => reason === 'owner' ? sections.rhythm?.pause('audio-owner') : reason === 'section' ? sections.rhythm?.pause('module') : sections.rhythm?.stop(),
      tracks: () => sections.studio?.stop('audio'),
      scores: () => sections.studio?.stop('scores'),
      input: () => sections.input?.stop(),
    },
    cancelScorePreparation: () => sections.studio?.cancelScorePreparation(),
  });
}
