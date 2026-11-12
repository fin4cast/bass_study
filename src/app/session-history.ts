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
  /** Удалённые записи: продолжение той же серии не воскрешает запись. */
  const deleted = new Set<string>();

  return {
    screen(session: QuizSession) {
      if (!options.canPublish()) return;
      const value = quizIds.get(session.questions) ?? metadata();
      quizIds.set(session.questions, value);
      if (deleted.has(value.id)) return;
      try {
        const entry = makeScreenHistory(session, value);
        if (entry) options.save(entry);
      } catch (failure) { options.failure(`Результат не сохранён: ${failure instanceof Error ? failure.message : String(failure)}`); }
    },
    markDeleted(id: string) { deleted.add(id); },
    reset() { quizIds = new WeakMap(); deleted.clear(); },
  };
}
