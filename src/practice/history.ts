/**
 * Записи «Прогресса» из истории занятий (R-011, R-026).
 * Самооценка прохода упражнения становится PlayRecord, итог «Проверь себя» — CheckRecord,
 * ручная отметка «Грифа» или «Ритма» (изучение, последовательность, ритм) — ManualRecord.
 * Прочие записи (экранные задания, слух, маршрут) в список «Прогресса» не попадают;
 * экранные задания «Грифа» дают только карточку «Повторить ошибки» (`fretboardReview`).
 * Чистый модуль: история уже проверена на границе хранилища.
 */
import { STRUCTURES } from '../music';
import { getReviewPositionIds, type HistoryEntry, type ScreenHistoryEntry } from '../storage/model';
import type { QuestionContext } from '../training';
import { rhythmPracticeLabel, type PracticeMaterial } from '../training/results';
import type { CheckRecord, ManualArea, ManualRecord, PlayRecord, PracticeRecord } from './results';

const PATTERN_NAMES = { ascending: 'вверх', descending: 'вниз', 'round-trip': 'туда и обратно', 'groups-of-three': 'группами по три' } as const;

/** Раздел ручной отметки без упражнения; `null` — проход упражнения. */
export function manualArea(material: PracticeMaterial): ManualArea | null {
  return material.kind === 'exercise' ? null : material.kind === 'rhythm' ? 'rhythm' : 'fretboard';
}

/** Короткое название материала ручной практики: «Последовательность вверх · A, минорная пентатоника». */
export function manualMaterialTitle(material: PracticeMaterial, context: QuestionContext | null): string {
  if (material.kind === 'rhythm') return rhythmPracticeLabel(material);
  if (material.kind === 'exercise') return material.title;
  const structure = context ? STRUCTURES.find(item => item.id === context.structureId)?.name ?? context.structureId : '';
  const scope = context ? ` · ${context.root}, ${structure.toLowerCase()}` : '';
  return material.kind === 'sequence' ? `Последовательность ${PATTERN_NAMES[material.pattern]}${scope}` : `Изучение грифа${scope}`;
}

export function practiceRecords(history: readonly HistoryEntry[]): readonly PracticeRecord[] {
  const records: PracticeRecord[] = [];
  for (const entry of history) {
    const { result } = entry;
    if (result.kind === 'manual' && result.material.kind === 'exercise' && result.assessment !== null) {
      const play: PlayRecord = {
        kind: 'play', id: entry.id, exerciseKey: result.material.key, title: result.material.title, spec: result.material.spec,
        assessment: result.assessment, bpm: result.comfortableBpm, activeMs: result.durationMs,
        localDate: entry.localDate, occurredAt: entry.occurredAt, view: result.material.view, wholePass: result.material.wholePass,
      };
      records.push(Object.freeze(play));
    } else if (result.kind === 'manual' && result.material.kind !== 'exercise') {
      const manual: ManualRecord = {
        kind: 'manual', id: entry.id, area: manualArea(result.material)!, title: manualMaterialTitle(result.material, result.context),
        bpm: result.comfortableBpm, activeMs: result.durationMs, note: result.note, localDate: entry.localDate, occurredAt: entry.occurredAt,
      };
      records.push(Object.freeze(manual));
    } else if (result.kind === 'check') {
      const check: CheckRecord = {
        kind: 'check', id: entry.id, exerciseKey: result.exerciseKey, title: result.title, spec: result.spec.exercise,
        checkKind: result.spec.kind, ear: result.spec.ear, activeMs: result.activeMs,
        localDate: entry.localDate, occurredAt: entry.occurredAt, answers: result.answers,
      };
      records.push(Object.freeze(check));
    }
  }
  return Object.freeze(records);
}

/** Повтор ошибок заданий «Грифа»: исходный контекст, точные позиции и причины (R-011). */
export interface FretboardReview {
  readonly context: QuestionContext;
  readonly positionIds: readonly string[];
  /** Короткое описание контекста: «A, минорная пентатоника · струны E/A/D/G · лады 5–8». */
  readonly material: string;
  /** Сессии этого контекста с ошибкой, показом или пропуском. */
  readonly sessions: number;
  readonly dates: readonly string[];
  /** Число вопросов по причинам; причины могут пересекаться. */
  readonly reasons: { readonly errors: number; readonly hints: number; readonly skipped: number };
}

const contextKey = (context: QuestionContext) => JSON.stringify({ ...context, box: context.box ?? null, positionIds: [...context.positionIds].sort() });

function contextLabel(context: QuestionContext): string {
  const structure = STRUCTURES.find(item => item.id === context.structureId)?.name ?? context.structureId;
  const strings = (['E', 'A', 'D', 'G'] as const).filter(string => context.positionIds.some(id => id.startsWith(`${string}:`)));
  const frets = context.positionIds.map(id => Number(id.split(':')[1]));
  const range = frets.length ? ` · струны ${strings.join('/')} · лады ${Math.min(...frets)}–${Math.max(...frets)}` : '';
  return `${context.root}, ${structure.toLowerCase()}${range}`;
}

/**
 * Карточка «Повторить ошибки» заданий «Грифа»: контекст самой поздней экранной сессии с ошибкой, показом
 * или пропуском; позиции — по всем экранным сессиям того же исходного контекста (как в прежней истории).
 * Без таких сессий — `null`.
 */
export function fretboardReview(history: readonly HistoryEntry[]): FretboardReview | null {
  const screens = history.filter((entry): entry is ScreenHistoryEntry => entry.result.kind === 'screen')
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
  const latest = screens.find(entry => getReviewPositionIds([entry]).length > 0);
  if (!latest) return null;
  const key = contextKey(latest.result.context);
  const group = screens.filter(entry => contextKey(entry.result.context) === key);
  const missed = group.filter(entry => getReviewPositionIds([entry]).length > 0);
  const questions = missed.flatMap(entry => entry.result.questions);
  return Object.freeze({
    context: latest.result.context,
    positionIds: getReviewPositionIds(group),
    material: contextLabel(latest.result.context),
    sessions: missed.length,
    dates: Object.freeze([...new Set(missed.map(entry => entry.localDate))].sort()),
    reasons: Object.freeze({
      errors: questions.filter(question => question.errors > 0).length,
      hints: questions.filter(question => question.hintUsed).length,
      skipped: questions.filter(question => question.skipped).length,
    }),
  });
}
