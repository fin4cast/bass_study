import { describe, expect, it } from 'vitest';
import backupJson from './fixtures/backup.json?raw';
import { createExerciseSpec } from '../src/exercises';
import { annotatePositions, createStructure, getPosition } from '../src/music';
import { fretboardReview, manualMaterialTitle, practiceRecords } from '../src/practice/history';
import { difficulties, exerciseProgress, minutesByDay } from '../src/practice/results';
import { makeManualHistory, makeScreenHistory, parseBackup, type HistoryEntry, type PracticeDraft } from '../src/storage';
import { createManualPracticeResult, nextQuestion, revealAnswer, startQuiz, submitAnswer, type QuestionContext } from '../src/training';
import type { PracticeMaterial } from '../src/training/results';
import { draftEditBpm, draftViews, reviewView, unsavedMs, withoutHistoryEntry } from '../src/app/progress-flow';
import { createSessionHistory } from '../src/app/session-history';
import { calendarWeeks, dayRecords, describeFretboardReview, formatDraftTime, parseTempo, progressRows, weekSummary } from '../src/ui/progress/model';

const structure = createStructure('A', 'minor-pentatonic');
const positions = annotatePositions([getPosition('E', 5), getPosition('E', 8), getPosition('A', 5)], structure);
const context: QuestionContext = { scope: 'structure', root: 'A', structureId: 'minor-pentatonic', positionIds: ['E:5', 'E:8', 'A:5'] };
const sequence: PracticeMaterial = { kind: 'sequence', pattern: 'ascending', routePositionIds: ['E:5', 'E:8', 'A:5'], duration: 'eighth', fragment: { from: 0, toExclusive: 3 }, box: null };
const rhythm = (() => {
  const entry = parseBackup(backupJson).history.find(item => item.result.kind === 'manual' && item.result.material.kind === 'rhythm')!;
  return entry.result.kind === 'manual' ? entry.result.material : null;
})()!;
const meta = (id: string, occurredAt: string) => ({ id, occurredAt, timeZone: 'Europe/Moscow' });

const manualEntry = (id: string, occurredAt: string, material: PracticeMaterial, durationMs: number, bpm = 80, note = '') =>
  makeManualHistory(createManualPracticeResult({ context: material.kind === 'rhythm' ? null : context, material, comfortableBpm: bpm, durationMs, note }), meta(id, occurredAt));
const playEntry = (id: string, occurredAt: string, assessment: 'clean' | 'errors' | 'slow', bpm: number) => makeManualHistory(createManualPracticeResult({
  context: null, comfortableBpm: bpm, durationMs: 120_000, assessment,
  material: { kind: 'exercise', key: 'user:arp', title: 'Моё арпеджио', spec: createExerciseSpec('arpeggio-1358'), view: 'board', wholePass: true },
}), meta(id, occurredAt));

function quiz(count = 2) { return startQuiz({ positions, structure, mode: 'name-note', scope: 'structure', seed: 7 }, count); }
/** Первый вопрос: ошибка, затем верный ответ. */
function withError(id: string, occurredAt: string, questionContext = context) {
  let session = quiz();
  const target = session.questions[0].target.name;
  session = submitAnswer(session, target === 'C' ? 'D' : 'C', 300);
  session = submitAnswer(session, target, 900);
  const entry = makeScreenHistory(nextQuestion(session), meta(id, occurredAt))!;
  return questionContext === context ? entry : { ...entry, result: { ...entry.result, context: questionContext } } as HistoryEntry;
}
function allCorrect(id: string, occurredAt: string) {
  let session = quiz(1);
  session = submitAnswer(session, session.questions[0].target.name, 400);
  return makeScreenHistory(session, meta(id, occurredAt))!;
}

describe('ручные отметки «Грифа» и «Ритма» в «Прогрессе»', () => {
  const history = [
    manualEntry('seq', '2026-11-12T08:00:00.000Z', sequence, 5 * 60_000, 84, 'ровно на восьмых'),
    manualEntry('board', '2026-11-12T08:30:00.000Z', { kind: 'fretboard', box: null }, 0, 70),
    manualEntry('rhythm', '2026-11-11T08:00:00.000Z', rhythm, 3 * 60_000, 96),
    playEntry('p1', '2026-11-12T09:00:00.000Z', 'errors', 90),
    playEntry('p2', '2026-11-12T09:30:00.000Z', 'errors', 92),
  ];
  const records = practiceRecords(history);

  it('становятся ManualRecord с ID, разделом, темпом, временем и заметкой, без самооценки', () => {
    const manual = records.filter(record => record.kind === 'manual');
    expect(manual).toEqual([
      { kind: 'manual', id: 'seq', area: 'fretboard', title: 'Последовательность вверх · A, минорная пентатоника', bpm: 84, activeMs: 300_000, note: 'ровно на восьмых', localDate: '2026-11-12', occurredAt: '2026-11-12T08:00:00.000Z' },
      { kind: 'manual', id: 'board', area: 'fretboard', title: 'Изучение грифа · A, минорная пентатоника', bpm: 70, activeMs: 0, note: '', localDate: '2026-11-12', occurredAt: '2026-11-12T08:30:00.000Z' },
      { kind: 'manual', id: 'rhythm', area: 'rhythm', title: manualMaterialTitle(rhythm, null), bpm: 96, activeMs: 180_000, note: '', localDate: '2026-11-11', occurredAt: '2026-11-11T08:00:00.000Z' },
    ]);
    expect(manual.every(record => !('assessment' in record))).toBe(true);
    expect(records.filter(record => record.kind === 'play').map(record => record.id)).toEqual(['p1', 'p2']);
  });

  it('входят в минуты по дням источника «Игра» и «Всё», но не «Проверь себя»', () => {
    expect([...minutesByDay(records, 'play')]).toEqual([['2026-11-11', 3], ['2026-11-12', 9]]);
    expect([...minutesByDay(records, 'all')]).toEqual([['2026-11-11', 3], ['2026-11-12', 9]]);
    expect([...minutesByDay(records, 'check')]).toEqual([]);
    expect(weekSummary(records, '2026-11-12', 'play').minutes).toBe(12);
    const week = calendarWeeks(records, '2026-11-12', 'all', 1)[0];
    expect(week.days.find(day => day.date === '2026-11-11')).toMatchObject({ minutes: 3, records: 1, kinds: ['play'] });
  });

  it('видны в записях дня календаря и исчезают при фильтре «Проверь себя»', () => {
    const day = dayRecords(records, '2026-11-12', 'play');
    expect(day.records.map(record => record.id)).toEqual(['seq', 'board', 'p1', 'p2']);
    expect(dayRecords(records, '2026-11-12', 'check')).toMatchObject({ records: [], hidden: 4 });
  });

  it('не влияют на лучший темп, строки упражнений и трудные места', () => {
    const playsOnly = records.filter(record => record.kind !== 'manual');
    expect(exerciseProgress(records)).toEqual(exerciseProgress(playsOnly));
    expect(difficulties(records)).toEqual(difficulties(playsOnly));
    expect(progressRows(records, 'all').map(row => row.key)).toEqual(['user:arp']);
    expect(progressRows(records, 'play')[0]).toMatchObject({ bestCleanBpm: null, passes: [{ id: 'p1' }, { id: 'p2' }] });
  });
});

describe('карточка «Задания на грифе»', () => {
  it('без экранных ошибок карточки нет', () => {
    expect(fretboardReview([])).toBe(null);
    expect(fretboardReview([allCorrect('ok', '2026-11-12T10:00:00.000Z'), playEntry('p', '2026-11-12T11:00:00.000Z', 'errors', 80)])).toBe(null);
    expect(reviewView(null)).toBe(null);
  });

  it('берёт контекст последней сессии с ошибками и позиции getReviewPositionIds по этому контексту', () => {
    const other: QuestionContext = { ...context, positionIds: ['E:5', 'E:8', 'A:5', 'A:7'] };
    const early = withError('early', '2026-11-10T10:00:00.000Z');
    const late = withError('late', '2026-11-12T10:00:00.000Z');
    const otherContext = withError('other', '2026-11-11T10:00:00.000Z', other);
    const clean = allCorrect('clean-latest', '2026-11-12T12:00:00.000Z');
    const review = fretboardReview([early, otherContext, late, clean])!;
    expect(review.context).toEqual(context);
    expect(review.sessions).toBe(2);
    expect(review.dates).toEqual(['2026-11-10', '2026-11-12']);
    expect(review.positionIds.length).toBeGreaterThan(0);
    expect(review.positionIds.every(id => context.positionIds.includes(id))).toBe(true);
    expect(review.reasons).toEqual({ errors: 2, hints: 0, skipped: 0 });
    expect(review.material).toBe('A, минорная пентатоника · струны E/A · лады 5–8');
  });

  it('показ ответа тоже даёт позицию для повтора; описание склоняет число позиций', () => {
    const shown = makeScreenHistory(revealAnswer(quiz(1), 500), meta('shown', '2026-11-12T10:00:00.000Z'))!;
    const review = fretboardReview([shown])!;
    expect(review.reasons).toEqual({ errors: 0, hints: 1, skipped: 0 });
    const view = describeFretboardReview(review);
    expect(view).toMatchObject({ count: 1, title: 'Задания на грифе: 1 позиция с ошибками', reasons: 'В вопросах: показ ответа — 1.' });
    expect(view.detail).toBe('A, минорная пентатоника · струны E/A · лады 5–8 · 12 ноя');
    expect(describeFretboardReview({ ...review, positionIds: ['E:5', 'E:8', 'A:5'] }).title).toBe('Задания на грифе: 3 позиции с ошибками');
  });
});

describe('черновики для блока «Не сохранено»', () => {
  const draft = (id: string, material: PracticeMaterial, total: number, recorded: number, updatedAt: string, note = ''): PracticeDraft => ({
    id, createdAt: '2026-11-12T08:00:00.000Z', updatedAt, timeZone: 'Europe/Moscow', localDate: '2026-11-12',
    context: material.kind === 'rhythm' || material.kind === 'exercise' ? null : context, material, routeRef: null,
    totalReferenceMs: total, recordedThroughMs: recorded, suggestedBpm: 80, comfortableBpm: 88, note, editRevision: 1,
  });
  const exercise: PracticeMaterial = { kind: 'exercise', key: 'user:arp', title: 'Моё арпеджио', spec: createExerciseSpec('arpeggio-1358'), view: 'board', wholePass: true };

  it('показывают только несохранённое время, текущий черновик первым, без черновиков упражнений', () => {
    const drafts = [
      draft('old', sequence, 90_000, 30_000, '2026-11-12T08:05:00.000Z', 'заметка'),
      draft('rhythm', rhythm, 40_000, 0, '2026-11-12T09:00:00.000Z'),
      draft('current', sequence, 10_000, 0, '2026-11-12T07:00:00.000Z'),
      draft('exercise', exercise, 10_000, 0, '2026-11-12T10:00:00.000Z'),
    ];
    const views = draftViews(drafts, 'current', new Map([['old', 'Отметка не сохранена: квота']]));
    expect(views.map(view => view.id)).toEqual(['current', 'rhythm', 'old']);
    expect(views[0]).toEqual({ id: 'current', area: 'fretboard', title: 'Последовательность вверх · A, минорная пентатоника', activeMs: 10_000, bpm: 88, minBpm: 40, maxBpm: 220, note: '', localDate: '2026-11-12', current: true });
    expect(views[1]).toMatchObject({ area: 'rhythm', minBpm: 30, maxBpm: 240, current: false });
    expect(views[2]).toMatchObject({ activeMs: 60_000, note: 'заметка', error: 'Отметка не сохранена: квота' });
    expect(unsavedMs({ totalReferenceMs: 5, recordedThroughMs: 9 })).toBe(0);
  });

  it('неверный темп в поле оставляет прежний темп черновика', () => {
    expect(parseTempo('96', 40, 220)).toBe(96);
    expect(parseTempo(' 96 ', 40, 220)).toBe(96);
    for (const text of ['', '39', '221', '9.5', '1e2', 'abc']) expect(parseTempo(text, 40, 220)).toBe(null);
    expect(draftEditBpm(null, { comfortableBpm: 88 })).toBe(88);
    expect(draftEditBpm(100, { comfortableBpm: 88 })).toBe(100);
    expect([formatDraftTime(45_000), formatDraftTime(125_000), formatDraftTime(0)]).toEqual(['45 с', '2 мин 05 с', '0 с']);
  });
});

describe('удаление записи истории', () => {
  it('убирает только выбранную запись, сохраняя порядок остальных', () => {
    const history = [playEntry('a', '2026-11-12T09:00:00.000Z', 'clean', 80), playEntry('b', '2026-11-12T09:10:00.000Z', 'clean', 84), playEntry('c', '2026-11-12T09:20:00.000Z', 'clean', 88)];
    expect(withoutHistoryEntry(history, 'b').map(entry => entry.id)).toEqual(['a', 'c']);
    expect(withoutHistoryEntry(history, 'missing')).toEqual(history);
    expect(practiceRecords(withoutHistoryEntry(history, 'b')).map(record => record.id)).toEqual(['a', 'c']);
  });

  it('удалённая экранная серия не воскресает при следующем ответе той же серии', () => {
    const saved: HistoryEntry[] = [];
    const sessions = createSessionHistory({ canPublish: () => true, save: entry => saved.push(entry), failure: () => {} });
    let session = quiz();
    session = submitAnswer(session, session.questions[0].target.name, 400);
    sessions.screen(session);
    expect(saved).toHaveLength(1);
    sessions.markDeleted(saved[0].id);
    sessions.screen(nextQuestion(session));
    expect(saved).toHaveLength(1);
    sessions.reset();
    sessions.screen(nextQuestion(session));
    expect(saved).toHaveLength(2);
    expect(saved[1].id).not.toBe(saved[0].id);
  });
});
