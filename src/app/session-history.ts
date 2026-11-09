import type { EarSession } from '../ear';
import type { RouteResult } from '../route';
import { makeEarHistory, makeRouteHistory, makeScreenHistory, type HistoryEntry, type HistoryMetadata } from '../storage';
import type { QuizSession } from '../training';

function metadata(kind: 'screen' | 'ear' | 'route'): HistoryMetadata {
  return { id: `${kind}-${crypto.randomUUID()}`, occurredAt: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

export function createSessionHistory(options: {
  canPublish(): boolean;
  save(entry: HistoryEntry): void;
  failure(message: string): void;
  finishScreen(): void;
  finishEar(): void;
  finishRoute(routeId: string): void;
}) {
  let quizIds = new WeakMap<object, HistoryMetadata>();
  const routeIds = new Map<string, HistoryMetadata>();
  const deleted = new Set<string>();
  const active = new Map<'screen' | 'ear', string>();
  const finish = new Map<string, () => void>();

  function closeQuiz(kind: 'screen' | 'ear') {
    const id = active.get(kind);
    if (id) finish.delete(id);
    active.delete(kind);
  }

  function quiz(kind: 'screen' | 'ear', questions: object, entryFor: (value: HistoryMetadata) => HistoryEntry | null) {
    if (!options.canPublish()) return;
    const value = quizIds.get(questions) ?? metadata(kind);
    quizIds.set(questions, value);
    if (deleted.has(value.id)) return;
    try {
      const entry = entryFor(value);
      if (active.get(kind) !== value.id) closeQuiz(kind);
      active.set(kind, value.id);
      finish.set(value.id, kind === 'ear' ? options.finishEar : options.finishScreen);
      if (entry) options.save(entry);
    } catch (failure) { options.failure(`Результат не сохранён: ${failure instanceof Error ? failure.message : String(failure)}`); }
  }

  return {
    screen(session: QuizSession) { quiz('screen', session.questions, value => makeScreenHistory(session, value)); },
    ear(session: EarSession) { quiz('ear', session.questions, value => makeEarHistory(session, value)); },
    route(result: RouteResult) {
      if (!options.canPublish()) return;
      const value = routeIds.get(result.id) ?? metadata('route');
      routeIds.set(result.id, value);
      if (deleted.has(value.id)) return;
      try {
        const entry = makeRouteHistory(result, value);
        if (result.status === 'finished') finish.delete(value.id);
        else finish.set(value.id, () => options.finishRoute(result.id));
        if (entry) options.save(entry);
      } catch (failure) { options.failure(`Маршрут не сохранён: ${failure instanceof Error ? failure.message : String(failure)}`); }
    },
    closeQuiz,
    markDeleted(id: string) {
      deleted.add(id);
      finish.get(id)?.();
      finish.delete(id);
    },
    reset() { quizIds = new WeakMap(); routeIds.clear(); deleted.clear(); active.clear(); finish.clear(); },
  };
}
