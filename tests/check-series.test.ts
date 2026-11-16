import { describe, expect, it } from 'vitest';
import { createExerciseSpec } from '../src/exercises';
import { checkSeries, startCheckQuiz } from '../src/practice/check-series';
import { validateCheckSpec, type CheckSpec } from '../src/practice/check';
import { nextQuestion, submitAnswer } from '../src/training';

/**
 * Серии `check-v2` (R-028, A9): области и цели. Контрольные области посчитаны в требованиях вручную
 * (A9.7, «Контрольные примеры областей»), а не выведены из реализации.
 */
const make = (value: Partial<CheckSpec> & Pick<CheckSpec, 'kind' | 'area' | 'subject'>): CheckSpec =>
  validateCheckSpec({ version: 'check-v2', count: 6, ear: false, ...value });
const range = (strings: string, fretMin: number, fretMax: number) => ({ type: 'range' as const, strings: [...strings] as ('E' | 'A' | 'D' | 'G')[], fretMin, fretMax });
const ids = (series: ReturnType<typeof checkSeries>) => series.positions.map(position => position.id);

describe('области проверок по диапазону', () => {
  it('f1-ea5: натуральные ноты струн E и A на ладах 0–5 — 8 позиций, 7 классов (A дважды)', () => {
    const series = checkSeries(make({ kind: 'name-note', area: range('EA', 0, 5), subject: { type: 'notes', notes: 'natural' } }), 1);
    expect(ids(series)).toEqual(['E:0', 'E:1', 'E:3', 'E:5', 'A:0', 'A:2', 'A:3', 'A:5']);
    expect(new Set(series.positions.map(position => position.pitchClass)).size).toBe(7);
    expect(series.area).toHaveLength(12);
  });
  it('h2-blues: тоника A, струны E, A, D, лады 4–7 — A, E, F♯, G, A со ступенями 1, 5, 6, ♭7, 1', () => {
    const series = checkSeries(make({ kind: 'name-degree', area: range('EAD', 4, 7), subject: { type: 'degrees', scale: { root: 'A', degrees: ['1', '5', '6', 'b7'] }, targets: null } }), 1);
    expect(ids(series)).toEqual(['E:5', 'A:7', 'D:4', 'D:5', 'D:7']);
    expect(series.positions.map(position => position.degree)).toEqual(['1', '5', '6', 'b7', '1']);
    expect(series.positions.map(position => position.noteName)).toEqual(['A', 'E', 'F♯', 'G', 'A']);
  });
  it('h2-triad: тоника C, струны A, D, G, лады 1–5 — C, E♭, E, G, C со ступенями 1, ♭3, 3, 5, 1', () => {
    const series = checkSeries(make({ kind: 'name-degree', area: range('ADG', 1, 5), subject: { type: 'degrees', scale: { root: 'C', degrees: ['1', 'b3', '3', '5'] }, targets: null } }), 1);
    expect(ids(series)).toEqual(['A:3', 'D:1', 'D:2', 'D:5', 'G:5']);
    expect(series.positions.map(position => position.degree)).toEqual(['1', 'b3', '3', '5', '1']);
  });
  it('h4-seventh: цели ♭7 и 7 ограничивают вопросы, но не варианты ответа (пять ступеней)', () => {
    const spec = make({ kind: 'name-degree', area: range('ADG', 2, 5), subject: { type: 'degrees', scale: { root: 'C', degrees: ['1', '3', '5', 'b7', '7'] }, targets: ['b7', '7'] } });
    const series = checkSeries(spec, 5);
    expect(ids(series)).toEqual(['A:2', 'G:3', 'G:4']);
    expect(series.questions.every(question => ['b7', '7'].includes(question.target.degree!))).toBe(true);
    expect(series.questions.every(question => question.choices.map(choice => choice.label).join(' ') === '1 3 5 ♭7 7')).toBe(true);
    // Без ограничения целей область — все семь позиций A9.7.
    const all = checkSeries(make({ ...spec, subject: { type: 'degrees', scale: { root: 'C', degrees: ['1', '3', '5', 'b7', '7'] }, targets: null } }), 5);
    expect(ids(all)).toEqual(['A:2', 'A:3', 'D:2', 'D:5', 'G:3', 'G:4', 'G:5']);
  });
  it('цели вопроса: меньше двух отклоняются, описание допустимой формы, но пустое по содержанию', () => {
    expect(() => checkSeries(make({ kind: 'name-note', area: range('E', 0, 1), subject: { type: 'notes', notes: 'natural' } }), 1)).not.toThrow();
    expect(() => checkSeries(make({ kind: 'find-note', area: range('E', 1, 1), subject: { type: 'notes', notes: 'natural' } }), 1)).toThrow(RangeError);
    expect(() => checkSeries(make({ kind: 'find-note', area: range('E', 2, 2), subject: { type: 'notes', notes: 'natural' } }), 1)).toThrow(RangeError);
  });
  it('материал упражнения: ступени структуры и позиции плана', () => {
    const series = checkSeries(make({ kind: 'find-degree', area: { type: 'exercise', exercise: createExerciseSpec('root-five-eight') }, subject: { type: 'degrees', scale: null, targets: null } }), 3);
    expect(new Set(series.questions.map(question => question.target.degree))).toEqual(new Set(['1', '5']));
  });
});

describe('варианты ответа и тексты', () => {
  it('«Назови ноту», натуральные: семь карточек C D E F G A B', () => {
    const series = checkSeries(make({ kind: 'name-note', area: range('EA', 0, 12), subject: { type: 'notes', notes: 'natural' } }), 2);
    expect(series.questions[0].choices.map(choice => choice.label)).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
  });
  it('«Назови ноту», все ноты: двенадцать карточек от C, у нот со знаком — двойная подпись', () => {
    const series = checkSeries(make({ kind: 'name-note', area: range('EADG', 0, 12), subject: { type: 'notes', notes: 'all' } }), 2);
    expect(series.questions[0].choices.map(choice => choice.label)).toEqual(['C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B']);
  });
  it('нота со знаком в «найди» называется одним именем: диез при чётном seed вопроса, бемоль при нечётном', () => {
    const series = checkSeries(make({ kind: 'find-note', area: range('EADG', 0, 12), subject: { type: 'notes', notes: 'all' }, count: 12 }), 7);
    for (const question of series.questions) {
      if (question.target.pitchClass === 1 || [3, 6, 8, 10].includes(question.target.pitchClass)) {
        const flat = question.seed % 2 === 1;
        expect(question.prompt.includes('♭'), question.prompt).toBe(flat);
        expect(question.prompt.includes('♯'), question.prompt).toBe(!flat);
      }
    }
  });
  it('тоника аккорда: «Найди тонику аккорда <нота><суффикс>», суффикс — пусто, m или 7; цель записи — обозначение', () => {
    const series = checkSeries(make({ kind: 'find-note', area: range('EA', 0, 12), subject: { type: 'chord-root', notes: 'natural' } }), 4);
    for (const question of series.questions) {
      const match = /^Найди тонику аккорда ([A-G])(m|7|)\.$/.exec(question.prompt);
      expect(match, question.prompt).not.toBeNull();
      expect(question.recordTarget).toBe(`${match![1]}${match![2]}`);
    }
  });
  it('римская цифра: «Тональность C мажор. Найди тонику аккорда <цифра>», цель — класс высоты ступени', () => {
    const series = checkSeries(make({ kind: 'find-note', area: range('EA', 0, 12), subject: { type: 'roman-root', key: 'C' }, count: 7 }), 1);
    const byRoman = new Map(series.questions.map(question => [question.recordTarget, question.target.pitchClass]));
    expect(Object.fromEntries(byRoman)).toEqual({ I: 0, ii: 2, iii: 4, IV: 5, V: 7, vi: 9, 'vii°': 11 });
    expect(series.questions[0].prompt).toMatch(/^Тональность C мажор\. Найди тонику аккорда /);
  });
});

describe('правило набора spread-v1 (A9.3)', () => {
  const spec = make({ kind: 'find-note', area: range('EA', 0, 12), subject: { type: 'notes', notes: 'natural' } });
  it('серия воспроизводится по seed и меняется с другим seed', () => {
    expect(checkSeries(spec, 11).questions.map(question => question.id)).toEqual(checkSeries(spec, 11).questions.map(question => question.id));
    expect(checkSeries(spec, 11).questions.map(question => question.target.pitchClass)).not.toEqual(checkSeries(spec, 12).questions.map(question => question.target.pitchClass));
  });
  it('пока целей не меньше, чем вопросов, цели не повторяются; иначе встречаются почти поровну', () => {
    for (const seed of [1, 2, 3, 99]) {
      const classes = checkSeries(spec, seed).questions.map(question => question.target.pitchClass);
      expect(new Set(classes).size, `seed ${seed}`).toBe(6);
    }
    const long = checkSeries(make({ ...spec, count: 20 }), 5).questions.map(question => question.target.pitchClass);
    const counts = [...new Set(long)].map(pitchClass => long.filter(item => item === pitchClass).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });
  it('все ноты: в серии из шести вопросов три цели со знаком, начиная со знака', () => {
    const all = make({ kind: 'find-note', area: range('EADG', 0, 12), subject: { type: 'notes', notes: 'all' } });
    for (const seed of [1, 2, 3, 4]) {
      const classes = checkSeries(all, seed).questions.map(question => question.target.pitchClass);
      const marked = classes.map(pitchClass => ![0, 2, 4, 5, 7, 9, 11].includes(pitchClass));
      expect(marked, `seed ${seed}`).toEqual([true, false, true, false, true, false]);
    }
  });
});

describe('серия как сессия training', () => {
  it('ответ позицией и карточкой проверяется теми же правилами; правильный ответ не нужен до ответа', () => {
    const board = startCheckQuiz(make({ kind: 'find-note', area: range('EA', 0, 5), subject: { type: 'notes', notes: 'natural' } }), 3);
    const question = board.currentQuestion;
    const wrong = board.currentQuestion.context.positionIds.find(id => !question.expectedPositionIds.includes(id))!;
    expect(submitAnswer(board, wrong, 100).answerState.errors).toBe(1);
    const done = submitAnswer(board, question.expectedPositionIds[0], 100);
    expect(done.status).toBe('review');
    expect(nextQuestion(done).questionIndex).toBe(1);

    const cards = startCheckQuiz(make({ kind: 'name-note', area: range('EA', 0, 5), subject: { type: 'notes', notes: 'natural' } }), 3);
    expect(submitAnswer(cards, `pc:${cards.currentQuestion.target.pitchClass}`, 50).answerState.firstAttemptCorrect).toBe(true);
    expect(cards.questionPolicy).toBe('spread-v1');
  });
  it('find-all называет число позиций и принимает все', () => {
    const quiz = startCheckQuiz(make({ kind: 'find-all', area: range('EADG', 0, 12), subject: { type: 'notes', notes: 'all' } }), 6);
    const question = quiz.currentQuestion;
    expect(question.prompt).toContain(`: ${question.expectedPositionIds.length}.`);
    let session = quiz;
    for (const id of question.expectedPositionIds) session = submitAnswer(session, id, 10);
    expect(session.status).toBe('review');
  });
});
