/**
 * Чистая логика «Прогресса» на стороне приложения: черновики ручной практики для блока «Не сохранено»,
 * карточка «Задания на грифе» и список истории после удаления. Без DOM, звука и хранилища.
 */
import { manualArea, manualMaterialTitle, type FretboardReview } from '../practice/history';
import type { HistoryEntry, PracticeDraft } from '../storage/model';
import { manualTempoBounds } from '../training/results';
import { describeFretboardReview, type DraftView, type FretboardReviewView } from '../ui/progress/model';

/** Несохранённое время черновика: накопленное минус уже записанное в историю. */
export const unsavedMs = (draft: Pick<PracticeDraft, 'totalReferenceMs' | 'recordedThroughMs'>) => Math.max(0, draft.totalReferenceMs - draft.recordedThroughMs);

/**
 * Черновики «Грифа» и «Ритма» для блока «Не сохранено»: черновик последнего занятия первым, дальше — недавние.
 * Черновики прохода упражнения (нужна самооценка) сюда не попадают. `errors` — видимые ошибки записи по ID.
 */
export function draftViews(drafts: readonly PracticeDraft[], currentId: string | null, errors: ReadonlyMap<string, string> = new Map()): readonly DraftView[] {
  const views: (DraftView & { readonly updatedAt: string })[] = [];
  for (const draft of drafts) {
    const area = manualArea(draft.material);
    if (!area) continue;
    const [minBpm, maxBpm] = manualTempoBounds(draft.material);
    const error = errors.get(draft.id);
    views.push({
      id: draft.id, area, title: manualMaterialTitle(draft.material, draft.context), activeMs: unsavedMs(draft),
      bpm: draft.comfortableBpm, minBpm, maxBpm, note: draft.note, localDate: draft.localDate, current: draft.id === currentId,
      updatedAt: draft.updatedAt, ...(error ? { error } : {}),
    });
  }
  views.sort((a, b) => Number(b.current) - Number(a.current) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  return Object.freeze(views.map(({ updatedAt: _updatedAt, ...view }) => Object.freeze(view)));
}

/** Темп для правки черновика: введённый, а пока поле заполнено неверно — прежний темп черновика. */
export const draftEditBpm = (entered: number | null, draft: Pick<PracticeDraft, 'comfortableBpm'>) => entered ?? draft.comfortableBpm;

/** Карточка «Задания на грифе»: без позиций для повтора карточки нет. */
export function reviewView(review: FretboardReview | null): FretboardReviewView | null {
  return review && review.positionIds.length ? describeFretboardReview(review) : null;
}

/** Подтверждённая история после удаления записи: прочие записи и их порядок не меняются. */
export function withoutHistoryEntry(history: readonly HistoryEntry[], id: string): HistoryEntry[] {
  return history.filter(entry => entry.id !== id);
}
