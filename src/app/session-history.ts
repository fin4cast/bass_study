import { makeScreenHistory, type HistoryEntry, type HistoryMetadata } from '../storage';
import type { QuizSession } from '../training';

function metadata(): HistoryMetadata {
  return { id: `screen-${crypto.randomUUID()}`, occurredAt: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

/** Экранные задания раздела «Гриф»: одна запись истории на серию вопросов, обновляемая по мере ответов. */
export function createSessionHistory(options: {
  canPublish(): boolean;
  save(entry: HistoryEntry): void;
  failure(message: string): void;
}) {
  let quizIds = new WeakMap<object, HistoryMetadata>();

  return {
    screen(session: QuizSession) {
      if (!options.canPublish()) return;
      const value = quizIds.get(session.questions) ?? metadata();
      quizIds.set(session.questions, value);
      try {
        const entry = makeScreenHistory(session, value);
        if (entry) options.save(entry);
      } catch (failure) { options.failure(`Результат не сохранён: ${failure instanceof Error ? failure.message : String(failure)}`); }
    },
    reset() { quizIds = new WeakMap(); },
  };
}
