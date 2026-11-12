import { describe, expect, it } from 'vitest';
import { createExerciseSpec } from '../src/exercises';
import type { CheckSpec } from '../src/practice/plan';
import { getReviewPositionIds, makeScreenHistory, validateHistoryEntry } from '../src/storage/model';
import type { IntervalDegree } from '../src/training';
import { formatDegree } from '../src/ui/lesson/material';
import {
  advance, answerChoice, answerPosition, answersOpen, beginListen, cancelListen, checkMaterial, choiceLabels, completeListen, defaultSettings, entries, hardIndices,
  hasActivity, isDegreeKind, markedPosition, modeFor, prompt, QUESTION_KINDS, recordAnswers, recordsDegrees, retryRun, reveal, revealedAnswer, reviewMaterial,
  runStatus, scopeApplies, skip, startRun, summarize, summaryRow, wrongFeedback, type CheckRun, type QuestionKind,
} from '../src/ui/check/session';

const formB = createExerciseSpec('pentatonic-form', { shapeId: 'penta-b' });
const spec = (kind: CheckSpec['kind'], ear = false, exercise = formB, count = 6): CheckSpec => ({ version: 'check-v1', exercise, kind, count, ear });

/** Первый seed, у которого первый вопрос удовлетворяет условию (подбор материала теста, не подсказка интерфейсу). */
function runWhere(material: ReturnType<typeof checkMaterial>, mode: 'board' | 'cards', test: (run: CheckRun) => boolean) {
  for (let seed = 1; seed < 500; seed++) { const run = startRun(material, mode, seed); if (test(run)) return run; }
  throw new Error('seed not found');
}

describe('материал «Проверь себя» (контрольный пример VIS-02 r1)', () => {
  it('Am · форма B · лады 7–10: позиции и ступени', () => {
    const material = checkMaterial(spec('find-degree'));
    // Карточка VIS-02: E:8 E:10 A:7 A:10 D:7 D:10 G:7 G:9 → ♭3 4 5 ♭7 1 ♭3 4 5.
    const byId = Object.fromEntries(material.positions.map(position => [position.id, position.degree]));
    expect(byId).toEqual({ 'E:8': 'b3', 'E:10': '4', 'A:7': '5', 'A:10': 'b7', 'D:7': '1', 'D:10': 'b3', 'G:7': '4', 'G:9': '5' });
    expect(material).toMatchObject({ root: 'A', key: 'Am', earQuality: 'minor-pentatonic', fretMin: 6, fretMax: 11, material: 'Am · минорная пентатоника · форма B' });
  });
  it('без ступеней одной тоники проверка недоступна, неверное описание отклоняется', () => {
    expect(() => checkMaterial(spec('name-degree', false, createExerciseSpec('chromatic-position')))).toThrow(/нет ступеней/);
    expect(() => checkMaterial({ ...spec('name-degree'), count: 2 })).toThrow(RangeError);
  });
  it('тип вопроса задаёт способ ответа; слух — карточки и только для пентатоник и трезвучий', () => {
    expect(modeFor(checkMaterial(spec('find-degree')))).toBe('board');
    expect(modeFor(checkMaterial(spec('name-degree')))).toBe('cards');
    expect(modeFor(checkMaterial(spec('find-degree', true)))).toBe('ear');
    const major = checkMaterial(spec('name-degree', true, createExerciseSpec('scale-compact')));
    expect(major.earQuality).toBeNull();
    expect(modeFor(major)).toBe('cards');
  });
});

describe('A «На грифе»', () => {
  const material = checkMaterial(spec('find-degree'));
  it('ошибка объясняет нажатое, затем исправление; ответ раскрывается только после закрытия', () => {
    let run = runWhere(material, 'board', candidate => candidate.mode !== 'ear' && candidate.quiz.currentQuestion.target.degree === 'b7');
    expect(prompt(run, material).title).toBe('Найди ♭7');
    expect(revealedAnswer(run, material)).toBeNull();
    const before = run;
    run = answerPosition(run, 'D:7', 100);
    expect(runStatus(run)).toBe('active');
    expect(wrongFeedback(before, material, { positionId: 'D:7' })).toBe('D/7 — это 1, не ♭7. Попробуй ещё.');
    expect(wrongFeedback(before, material, { positionId: 'E:5' })).toBe('E/5 — вне материала упражнения (Am · минорная пентатоника · форма B). Ищи внутри.');
    run = answerPosition(run, 'A:10', 300);
    expect(runStatus(run)).toBe('review');
    expect(revealedAnswer(run, material)).toEqual({ degree: 'b7', positions: ['A:10'], text: '♭7 от A — A/10 G.' });
    expect(entries(run)[0]).toMatchObject({ outcome: 'corrected', errors: 1 });
  });
  it('та же ступень вне материала не засчитывается', () => {
    const run = runWhere(material, 'board', candidate => candidate.mode !== 'ear' && candidate.quiz.currentQuestion.target.degree === '1');
    // A на E/5 — тоника, но вне формы B (лады 7–10).
    expect(wrongFeedback(run, material, { positionId: 'E:5' })).toBe('E/5 — тоже 1, но вне материала упражнения. Найди её внутри.');
    expect(runStatus(answerPosition(run, 'E:5', 10))).toBe('active');
  });
  it('показ, пропуск и досрочное завершение — отдельные статусы', () => {
    let run = startRun(material, 'board', 7, 4);
    run = reveal(run, 50);
    expect(revealedAnswer(run, material)).not.toBeNull();
    run = advance(run);
    run = skip(run, 20);
    expect(revealedAnswer(run, material)).toBeNull();
    run = advance(run);
    const target = run.mode === 'board' ? run.quiz.currentQuestion.expectedPositionIds[0] : '';
    run = answerPosition(run, target, 30);
    run = advance(run);
    run = answerPosition(run, 'E:5', 40);
    const list = entries(run);
    expect(list.map(entry => entry.outcome)).toEqual(['revealed', 'skipped', 'correct', 'pending']);
    expect(recordAnswers(list).map(answer => [answer.outcome, answer.errors])).toEqual([['revealed', 0], ['skipped', 0], ['correct', 0], ['unanswered', 1]]);
    expect(summarize(run, list)).toMatchObject({ total: 4, correct: 1, corrected: 0, revealed: 1, skipped: 1, unanswered: 1, errors: 1, early: true });
    expect(hardIndices(list)).toEqual([0, 1, 3]);
    expect(summaryRow(run, material, list[1]).answer).toBe('—');
    expect(summaryRow(run, material, list[2]).answer).not.toBe('—');
  });
  it('«Повторить трудные» берёт те же вопросы с чистыми ответами', () => {
    let run = startRun(material, 'board', 11, 3);
    const targets = run.mode === 'board' ? run.quiz.questions.map(question => question.target.degree) : [];
    run = skip(run, 1); run = advance(run); run = skip(run, 1); run = advance(run); run = skip(run, 1); run = advance(run);
    expect(runStatus(run)).toBe('finished');
    const retry = retryRun(material, run, [0, 2], 99);
    expect(retry.mode === 'board' && retry.quiz.questions.map(question => question.target.degree)).toEqual([targets[0], targets[2]]);
    expect(entries(retry).map(entry => entry.outcome)).toEqual(['pending', 'pending']);
    expect(hasActivity(retry)).toBe(false);
  });
});

describe('B «Карточки»', () => {
  const material = checkMaterial(spec('name-degree'));
  it('пять ступеней минорной пентатоники; вопрос не содержит ответа', () => {
    const run = startRun(material, 'cards', 5);
    expect(choiceLabels(run)).toEqual(['1', '♭3', '4', '5', '♭7']);
    const marked = markedPosition(run)!;
    expect(prompt(run, material)).toEqual({ kind: 'Назови ступень', title: 'Какая это ступень от A?', sub: `Отмеченная нота — ${marked.replace(':', '/')}. Ответь кнопкой или клавишей 1–5.` });
    expect(revealedAnswer(run, material)).toBeNull();
  });
  it('неверная карточка, затем верная — «с исправлением»', () => {
    let run = startRun(material, 'cards', 5);
    const degree = material.positions.find(position => position.id === markedPosition(run))!.degree!;
    const right = choiceLabels(run).indexOf(formatDegree(degree));
    const wrong = (right + 1) % 5;
    const before = run;
    run = answerChoice(run, wrong, 10);
    expect(wrongFeedback(before, material, { choice: wrong })).toBe(`Не ${choiceLabels(run)[wrong]}. Попробуй ещё — считай полутоны от ближайшей A.`);
    run = answerChoice(run, right, 20);
    expect(entries(run)[0]).toMatchObject({ outcome: 'corrected', errors: 1, degree });
    expect(revealedAnswer(run, material)!.degree).toBe(degree);
  });
});

describe('слух: тоника → пауза → нота', () => {
  const material = checkMaterial(spec('name-degree', true));
  it('ответы закрыты до полного конца сигнала, повтор — не ошибка', () => {
    let run = startRun(material, 'ear', 3, 2);
    expect(answersOpen(run)).toBe(false);
    expect(() => answerChoice(run, 0, 5)).toThrow();
    run = beginListen(run, 10, 80);
    expect(answersOpen(run)).toBe(false);
    const listenId = run.mode === 'ear' ? run.ear.answerState.activeListen!.id : '';
    // Три доли по 750 мс при 80 BPM: раньше 2260 мс сигнал не мог закончиться.
    expect(() => completeListen(run, 1000, listenId)).toThrow(RangeError);
    run = completeListen(run, 2300, listenId);
    expect(answersOpen(run)).toBe(true);
    run = beginListen(run, 2400, 80);
    expect(answersOpen(run)).toBe(false);
    run = cancelListen(run, 2500);
    expect(answersOpen(run)).toBe(true);
    const second = run.mode === 'ear' ? run.ear : null;
    run = beginListen(run, 2600, 80);
    run = completeListen(run, 4900, run.mode === 'ear' ? run.ear.answerState.activeListen!.id : '');
    const target = second!.currentQuestion.targetDegree;
    const right = choiceLabels(run).indexOf(formatDegree(target));
    run = answerChoice(run, right, 5000);
    expect(entries(run)[0]).toMatchObject({ outcome: 'correct', errors: 0, listens: 2 });
    run = advance(run);
    const list = entries(run);
    expect(summarize(run, list)).toMatchObject({ correct: 1, unanswered: 1, listens: 2, replays: 1, errors: 0 });
    expect(prompt(run, material).title).toBe('Какая ступень прозвучала?');
  });
});

describe('виды заданий R-006 по материалу (P13-08)', () => {
  const material = checkMaterial(spec('find-degree'));
  const settings = (kind: QuestionKind, scope: 'structure' | 'chromatic' = 'structure', interval: IntervalDegree = '#4') => ({ kind, scope, interval });
  const first = (kind: QuestionKind, mode: 'board' | 'cards', test: (run: CheckRun & { mode: 'board' | 'cards' }) => boolean, scope: 'structure' | 'chromatic' = 'structure') => {
    for (let seed = 1; seed < 500; seed++) {
      const run = startRun(material, mode, seed, 6, settings(kind, scope)) as CheckRun & { mode: 'board' | 'cards' };
      if (test(run)) return run;
    }
    throw new Error('seed not found');
  };

  it('вид вопроса задаёт способ ответа; несоответствие отклоняется; слух — только у ступеней', () => {
    expect(modeFor(material, false, 'find-note')).toBe('board');
    expect(modeFor(material, false, 'find-all')).toBe('board');
    expect(modeFor(material, false, 'find-pitch')).toBe('board');
    expect(modeFor(material, false, 'find-interval')).toBe('board');
    expect(modeFor(material, false, 'name-note')).toBe('cards');
    expect(modeFor(material, true, 'find-note')).toBe('board');
    expect(modeFor(material, true, 'find-degree')).toBe('ear');
    expect(() => startRun(material, 'cards', 1, 6, settings('find-note'))).toThrow(RangeError);
    expect(isDegreeKind('find-note')).toBe(false);
    expect(recordsDegrees('name-degree')).toBe(true);
    expect(recordsDegrees('find-all')).toBe(false);
    expect(QUESTION_KINDS.map(item => item.id)).toEqual(['find-degree', 'name-degree', 'find-note', 'find-all', 'name-note', 'find-pitch', 'find-interval']);
  });

  it('«Найди ноту»: любая позиция ноты в материале; другая нота и нота вне материала объясняются', () => {
    // Форма B Am (E:8 E:10 A:7 A:10 D:7 D:10 G:7 G:9): C — E/8 и D/10.
    const run = first('find-note', 'board', candidate => candidate.quiz.currentQuestion.target.name === 'C');
    expect(prompt(run, material)).toMatchObject({ kind: 'Найди ноту', title: 'Найди C' });
    expect([...run.quiz.currentQuestion.expectedPositionIds].sort()).toEqual(['D:10', 'E:8']);
    expect(wrongFeedback(run, material, { positionId: 'E:10' })).toBe('E/10 — это D, не C. Попробуй ещё.');
    expect(wrongFeedback(run, material, { positionId: 'A:3' })).toBe('A/3 — тоже C, но вне материала вопроса. Найди внутри.');
    expect(revealedAnswer(run, material)).toBeNull();
    const done = answerPosition(run, 'D:10', 50);
    expect(runStatus(done)).toBe('review');
    expect(revealedAnswer(done, material)!.text).toBe('C: E/8, D/10.');
    expect(entries(done)[0]).toMatchObject({ outcome: 'correct', errors: 0 });
  });

  it('«Найди все позиции»: частичный ответ не закрывает вопрос, повтор найденной не ошибка', () => {
    const run = first('find-all', 'board', candidate => candidate.quiz.currentQuestion.target.name === 'C');
    expect(prompt(run, material).title).toBe('Найди все C — их 2');
    let next = answerPosition(run, 'E:8', 10);
    expect(runStatus(next)).toBe('active');
    expect(next.mode !== 'ear' && next.quiz.answerState.feedback.kind).toBe('partial');
    next = answerPosition(next, 'E:8', 20);
    expect(next.mode !== 'ear' && next.quiz.answerState).toMatchObject({ errors: 0, feedback: { kind: 'duplicate' } });
    next = answerPosition(next, 'D:10', 30);
    expect(runStatus(next)).toBe('review');
    expect(entries(next)[0]).toMatchObject({ outcome: 'correct', errors: 0 });
    expect(summaryRow(next, material, entries(next)[0])).toEqual({ question: 'Найди все C', answer: 'E/8, D/10' });
  });

  it('«Назови ноту»: карточки с названиями нот, ответа нет в вопросе до закрытия', () => {
    const run = first('name-note', 'cards', candidate => candidate.quiz.currentQuestion.targetPositionId === 'A:7');
    expect(choiceLabels(run)).toHaveLength(12);
    expect(prompt(run, material)).toEqual({ kind: 'Назови ноту', title: 'Какая это нота?', sub: 'Отмеченная позиция — A/7. Октава не важна. Ответь кнопкой или клавишей 1–9.' });
    expect(revealedAnswer(run, material)).toBeNull();
    const right = run.quiz.currentQuestion.choices.findIndex(choice => choice.label === 'E');
    const wrong = (right + 1) % 12;
    expect(wrongFeedback(run, material, { choice: wrong })).toBe(`Не ${choiceLabels(run)[wrong]}. Попробуй ещё — отсчитай лады от открытой струны.`);
    let next = answerChoice(run, wrong, 10);
    next = answerChoice(next, right, 20);
    expect(entries(next)[0]).toMatchObject({ outcome: 'corrected', errors: 1 });
    expect(revealedAnswer(next, material)!.text).toBe('A/7 — E.');
    expect(summaryRow(next, material, entries(next)[0])).toEqual({ question: 'Нота A/7', answer: 'E' });
  });

  it('«Найди высоту»: та же нота в другой октаве — ошибка с объяснением', () => {
    // C3 (MIDI 48) в форме — D/10; C2 — E/8.
    const run = first('find-pitch', 'board', candidate => candidate.quiz.currentQuestion.targetMidi === 48);
    expect(prompt(run, material).title).toBe('Найди C3');
    expect(run.quiz.currentQuestion.expectedPositionIds).toEqual(['D:10']);
    expect(wrongFeedback(run, material, { positionId: 'E:8' })).toBe('E/8 — это C2: та же нота, другая октава. Нужна C3.');
    expect(runStatus(answerPosition(run, 'E:8', 5))).toBe('active');
  });

  it('«Найди интервал»: все ноты участка формы, включая ноты вне структуры', () => {
    const run = startRun(material, 'board', 3, 4, settings('find-interval', 'structure', '#4')) as CheckRun & { mode: 'board' };
    const question = run.quiz.currentQuestion;
    // Участок формы B: струны E–G, лады 7–10. ♯4 от A — D♯: E/11 и A/6 вне участка, внутри — только G/8.
    expect(question).toMatchObject({ mode: 'find-interval', target: { name: 'D♯', degree: '#4' }, context: { scope: 'chromatic' } });
    expect(question.expectedPositionIds).toEqual(['G:8']);
    expect(question.context.positionIds).toHaveLength(16);
    expect(prompt(run, material).title).toBe('Найди ♯4 от A');
    expect(wrongFeedback(run, material, { positionId: 'G:9' })).toBe('G/9 — это E, 5 от A; нужен ♯4. Считай полутоны от тоники.');
    expect(revealedAnswer(reveal(run, 10), material)!.text).toBe('♯4 от A — D♯: G/8.');
  });

  it('«Все ноты участка» добавляет ноты вне структуры к вопросам о нотах', () => {
    expect(scopeApplies('find-note')).toBe(true);
    expect(scopeApplies('find-degree')).toBe(false);
    expect(scopeApplies('find-interval')).toBe(false);
    const run = startRun(material, 'board', 5, 3, settings('find-note', 'chromatic')) as CheckRun & { mode: 'board' };
    expect(run.quiz.currentQuestion.context).toMatchObject({ scope: 'chromatic' });
    expect(run.quiz.currentQuestion.context.positionIds).toHaveLength(material.chromatic.length);
    expect(material.chromatic.some(position => !position.inStructure)).toBe(true);
  });

  it('серия прочих видов — экранная запись истории с исходным контекстом материала', () => {
    let run = startRun(material, 'board', 9, 3, settings('find-note')) as CheckRun & { mode: 'board' };
    run = answerPosition(run, run.quiz.currentQuestion.expectedPositionIds[0], 10) as typeof run;
    const entry = makeScreenHistory(run.quiz, { id: 'screen-check-1', occurredAt: '2026-11-12T10:00:00.000Z', timeZone: 'Europe/Moscow' })!;
    expect(entry.result).toMatchObject({ kind: 'screen', mode: 'find-note', plannedCount: 3, context: { root: 'A', structureId: 'minor-pentatonic', scope: 'structure' } });
    expect([...entry.result.context.positionIds].sort()).toEqual(material.positions.map(position => position.id).sort());
    expect(validateHistoryEntry(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
  });
});

describe('повтор ошибок прежних заданий (R-011, P13-08)', () => {
  it('«Назови ноту» только по позициям ошибок в исходной тональности и структуре', () => {
    const material = reviewMaterial(['E:3', 'A:5', 'E:3'], { root: 'A', structureId: 'minor-pentatonic' });
    expect(material).toMatchObject({ review: true, spec: null, plan: null, root: 'A', count: 10, earQuality: null });
    expect(material.positions.map(position => position.id)).toEqual(['E:3', 'A:5']);
    expect(defaultSettings(material)).toEqual({ kind: 'name-note', scope: 'chromatic', interval: '#4' });
    expect(modeFor(material, false, defaultSettings(material).kind)).toBe('cards');
    const run = startRun(material, 'cards', 4, 4, defaultSettings(material)) as CheckRun & { mode: 'cards' };
    expect(run.quiz.questions.every(question => ['E:3', 'A:5'].includes(question.targetPositionId!))).toBe(true);
    expect(run.quiz.currentQuestion.context).toMatchObject({ scope: 'chromatic', root: 'A', structureId: 'minor-pentatonic', positionIds: ['E:3', 'A:5'] });
    expect(() => startRun(material, 'board', 4, 4, { kind: 'find-note', scope: 'chromatic', interval: '#4' })).toThrow(/Назови ноту/);
    const target = run.quiz.currentQuestion;
    let closed = answerChoice(run, (target.choices.findIndex(choice => choice.pitchClass === target.target.pitchClass) + 1) % 12, 10);
    closed = skip(closed, 20);
    const entry = makeScreenHistory((closed as typeof run).quiz, { id: 'screen-review-1', occurredAt: '2026-11-12T10:00:00.000Z', timeZone: 'Europe/Moscow' })!;
    expect(getReviewPositionIds([entry])).toContain(target.targetPositionId);
  });

  it('пустой список и неизвестная позиция отклоняются', () => {
    expect(() => reviewMaterial([], { root: 'A', structureId: 'minor-pentatonic' })).toThrow(RangeError);
    expect(() => reviewMaterial(['B:3'], { root: 'A', structureId: 'minor-pentatonic' })).toThrow(RangeError);
    expect(() => reviewMaterial(['E:25'], { root: 'A', structureId: 'minor-pentatonic' })).toThrow(RangeError);
  });
});
