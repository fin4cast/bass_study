import { describe, expect, it } from 'vitest';
import { createExerciseSpec } from '../src/exercises';
import type { CheckSpec } from '../src/practice/plan';
import { formatDegree } from '../src/ui/lesson/material';
import {
  advance, answerChoice, answerPosition, answersOpen, beginListen, cancelListen, checkMaterial, choiceLabels, completeListen, entries, hardIndices,
  hasActivity, markedPosition, modeFor, prompt, recordAnswers, retryRun, reveal, revealedAnswer, runStatus, skip, startRun, summarize, summaryRow,
  wrongFeedback, type CheckRun,
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
