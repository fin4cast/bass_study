import { describe, expect, it } from 'vitest';
import { buildExercise, createExerciseSpec, EXERCISE_TEMPLATES, type ConceptId } from '../src/exercises';
import { formatMidi, getPosition, type StringId } from '../src/music';
import {
  B_H_NOTE, conceptBoard, conceptForExerciseConcept, findConcepts, getConcept, LABEL_KINDS, OCTAVE_TABLE,
  parseConceptText, REFERENCE_CONCEPTS, REFERENCE_LEVELS, type ConceptBoard, type ReferenceConcept,
} from '../src/practice/concepts';

/**
 * Независимый расчёт R-014: MIDI = открытая струна (E 28, A 33, D 38, G 43) + лад;
 * подпись разбирается как буква + знаки + научная октава, C4 = 60.
 */
const OPEN: Record<string, number> = { E: 28, A: 33, D: 38, G: 43 };
const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midiOfPosition = (id: string) => {
  const [string, fret] = id.split(/[:/]/);
  expect(Object.keys(OPEN)).toContain(string);
  expect(Number(fret)).toBeGreaterThanOrEqual(0);
  return OPEN[string] + Number(fret);
};
const midiOfLabel = (label: string) => {
  const match = /^([A-G])([♯♭]*)(\d)$/.exec(label);
  if (!match) throw new Error(`Подпись не разобрана: ${label}`);
  const shift = [...match[2]].reduce((sum, sign) => sum + (sign === '♯' ? 1 : -1), 0);
  return (Number(match[3]) + 1) * 12 + LETTER[match[1]] + shift;
};
const expectPitch = (positionId: string, label: string) => {
  expect(midiOfPosition(positionId), `${positionId} подписана ${label}`).toBe(midiOfLabel(label));
  const [string, fret] = positionId.split(/[:/]/);
  const letter = label.replace(/\d$/, '');
  expect(formatMidi(getPosition(string as StringId, Number(fret)).midi, letter)).toBe(label);
};

const boards = REFERENCE_CONCEPTS.map(concept => [concept, conceptBoard(concept)] as const)
  .filter((entry): entry is readonly [ReferenceConcept, ConceptBoard] => entry[1] !== null);

const cardOf = (concept: ReferenceConcept) => (concept.full ?? concept.brief)!;
function textsOf(concept: ReferenceConcept): string[] {
  const card = cardOf(concept);
  return [card.play.text, card.name, card.why, ...card.facts, card.check.question, card.check.explanation, ...card.check.options];
}

describe('справочник R-027: состав', () => {
  it('25 понятий по уровням макета (D-049 добавил блюзовую гамму, септаккорды, обращения и последовательность), 8 полных карточек, у каждого одна карточка', () => {
    expect(REFERENCE_CONCEPTS.map(concept => concept.id)).toEqual([
      'semitone', 'accidentals', 'enharmonic', 'octave', 'unison', 'octave-numbers',
      'fourth', 'fifth', 'thirds',
      'degree', 'major-formula', 'natural-minor', 'relative-keys', 'pentatonic', 'shared-notes', 'blues-scale',
      'triad', 'seventh-chords', 'inversions', 'chord-progression', 'slash-chord',
      'beat-bar', 'counting', 'tab', 'bass-clef',
    ]);
    expect(REFERENCE_CONCEPTS.filter(concept => concept.full).map(concept => concept.title)).toEqual([
      'Тон и полутон', 'Октава', 'Номера октав', 'Кварта', 'Квинта', 'Ступень', 'Общие ноты соседних форм', 'Трезвучие 1–3–5',
    ]);
    for (const concept of REFERENCE_CONCEPTS) expect(Boolean(concept.full) !== Boolean(concept.brief), concept.id).toBe(true);
    expect(REFERENCE_CONCEPTS.filter(concept => concept.later).map(concept => concept.id)).toEqual(['slash-chord']);
    expect(getConcept('octave')?.alsoLevels).toEqual([1]);
    const levels = new Set(REFERENCE_LEVELS.map(level => level.id));
    for (const concept of REFERENCE_CONCEPTS) expect(levels.has(concept.level)).toBe(true);
  });

  it('id уникальны и в kebab-case латиницей; у каждого понятия есть описание и ключевые слова', () => {
    const ids = REFERENCE_CONCEPTS.map(concept => concept.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const concept of REFERENCE_CONCEPTS) {
      expect(concept.id).toMatch(/^[a-z]+(?:-[a-z0-9]+)*$/);
      expect(concept.summary.trim()).not.toBe('');
      expect(concept.keywords.length).toBeGreaterThan(0);
      expect(getConcept(concept.id)).toBe(concept);
    }
    expect(getConcept('нет-такого')).toBeNull();
  });

  it('всё заморожено', () => {
    expect(Object.isFrozen(REFERENCE_CONCEPTS)).toBe(true);
    const frozenDeep = (value: unknown, path: string): void => {
      if (!value || typeof value !== 'object') return;
      expect(Object.isFrozen(value), path).toBe(true);
      for (const [key, child] of Object.entries(value)) frozenDeep(child, `${path}.${key}`);
    };
    frozenDeep(REFERENCE_CONCEPTS, 'concepts');
    frozenDeep(OCTAVE_TABLE, 'octaves');
    frozenDeep(B_H_NOTE, 'bh');
    frozenDeep(LABEL_KINDS, 'labels');
    frozenDeep(REFERENCE_LEVELS, 'levels');
    expect(() => { (REFERENCE_CONCEPTS as ReferenceConcept[]).push(REFERENCE_CONCEPTS[0]); }).toThrow(TypeError);
    expect(Object.isFrozen(findConcepts('кварта'))).toBe(true);
  });
});

describe('справочник R-027: высоты и мини-грифы', () => {
  it('каждая позиция мини-грифа подписана своей звучащей высотой', () => {
    let count = 0;
    for (const [concept, board] of boards) {
      for (const position of board.positions) {
        expectPitch(position.id, position.label);
        count += 1;
      }
      expect(new Set(board.positions.map(position => position.id)).size, concept.id).toBe(board.positions.length);
    }
    expect(boards.map(([concept]) => concept.id)).toEqual([
      'semitone', 'enharmonic', 'octave', 'unison', 'octave-numbers', 'fourth', 'fifth', 'thirds', 'degree', 'major-formula', 'shared-notes', 'triad',
    ]);
    expect(count).toBe(55);
  });

  it('окно ладов покрывает все позиции; линзы, легенда и пальцы согласованы', () => {
    for (const [concept, board] of boards) {
      expect(board.fretMin, concept.id).toBeLessThanOrEqual(board.fretMax);
      for (const position of board.positions) {
        const fret = Number(position.id.split(':')[1]);
        expect(fret, `${concept.id} ${position.id}`).toBeGreaterThanOrEqual(board.fretMin);
        expect(fret, `${concept.id} ${position.id}`).toBeLessThanOrEqual(board.fretMax);
        if (board.lenses.includes('intervals')) expect(position.interval, `${concept.id} ${position.id}`).toBeTruthy();
        if (board.lenses.includes('degrees') || board.lenses.includes('chord-tones')) expect(position.degree, `${concept.id} ${position.id}`).toBeTruthy();
        if (board.showFingers) expect(position.finger, `${concept.id} ${position.id}`).toBeGreaterThanOrEqual(1);
      }
      expect(board.lenses[0]).toBe('notes');
      expect(board.lenses).toContain(board.defaultLens);
      const roles = new Set(board.positions.map(position => position.role));
      expect(new Set(board.legend.map(entry => entry.role)), concept.id).toEqual(roles);
    }
    expect(getConcept('degree') && conceptBoard(getConcept('degree')!)?.defaultLens).toBe('degrees');
  });

  it('все размеченные позиции в текстах, вариантах и таблице октав совпадают с высотой', () => {
    let labelled = 0;
    const texts = [...REFERENCE_CONCEPTS.flatMap(textsOf), B_H_NOTE.text];
    for (const text of texts) {
      for (const [, id, label] of text.matchAll(/\{p:([^|}]+)(?:\|([^}]+))?\}/g)) {
        midiOfPosition(id);
        if (label) { expectPitch(id, label); labelled += 1; }
      }
      expect(() => parseConceptText(text)).not.toThrow();
      expect(text).not.toMatch(/\{(?![pdrf]:)/);
    }
    expect(labelled).toBeGreaterThan(50);
    for (const row of OCTAVE_TABLE.rows) {
      for (const example of row.examples) {
        expectPitch(example.positionId, example.label);
        expect(midiOfLabel(example.label)).toBeGreaterThanOrEqual((row.octave + 1) * 12);
        expect(midiOfLabel(example.label)).toBeLessThan((row.octave + 2) * 12);
      }
    }
  });

  it('контрольные примеры экрана: октава, кварта, квинта, унисон, энгармонизм', () => {
    expect(midiOfPosition('D:7') - midiOfPosition('E:5')).toBe(12);
    expect(midiOfPosition('A:5') - midiOfPosition('E:5')).toBe(5);
    expect(midiOfPosition('A:7') - midiOfPosition('E:5')).toBe(7);
    expect(midiOfPosition('E:5')).toBe(midiOfPosition('A:0'));
    expect(midiOfPosition('E:6')).toBe(midiOfPosition('A:1'));
    expect(midiOfLabel('A♯1')).toBe(midiOfLabel('B♭1'));
    const enharmonic = conceptBoard(getConcept('enharmonic')!)!;
    expect(enharmonic.positions.map(position => position.label)).toEqual(['A♯1', 'B♭1']);
  });

  it('карточки форм совпадают с планами каталога упражнений', () => {
    const connect = buildExercise(createExerciseSpec('connect-forms'));
    const formA = connect.notes.filter(note => note.segment === 0);
    const formB = connect.notes.filter(note => note.segment === 1);
    const idsA = new Set(formA.map(note => note.id));
    const idsB = new Set(formB.map(note => note.id));
    const shared = conceptBoard(getConcept('shared-notes')!)!;
    expect(new Set(shared.positions.filter(position => position.role === 'shared').map(position => position.id)))
      .toEqual(new Set([...idsA].filter(id => idsB.has(id))));
    expect(new Set(shared.positions.filter(position => position.form === 'A').map(position => position.id)))
      .toEqual(new Set([...idsA].filter(id => !idsB.has(id))));
    expect(new Set(shared.positions.filter(position => position.form === 'B').map(position => position.id)))
      .toEqual(new Set([...idsB].filter(id => !idsA.has(id))));
    expect(getConcept('shared-notes')!.full!.name).toContain(`их ${idsA.size + idsB.size - new Set([...idsA, ...idsB]).size}.`);

    const degree = conceptBoard(getConcept('degree')!)!;
    expect(degree.positions.map(position => [position.id, position.finger, position.degree?.replace('♭', 'b')]))
      .toEqual(formA.map(note => [note.id, note.finger, note.degree]));

    const arpeggio = buildExercise(createExerciseSpec('arpeggio-1358')).notes.slice(0, 4);
    const triad = conceptBoard(getConcept('triad')!)!;
    expect(triad.positions.map(position => [position.id, position.label, position.finger]))
      .toEqual(arpeggio.map(note => [note.id, note.name, note.finger]));
  });
});

describe('справочник R-027: упражнения и проверка', () => {
  const templateIds = new Set(EXERCISE_TEMPLATES.map(template => template.id));

  it('связанные упражнения существуют в каталоге, ответы проверки в пределах вариантов', () => {
    for (const concept of REFERENCE_CONCEPTS) {
      const card = cardOf(concept);
      expect(card.related.length + card.sections.length, concept.id).toBeGreaterThan(0);
      for (const id of card.related) expect(templateIds.has(id), `${concept.id} → ${id}`).toBe(true);
      expect(new Set(card.related).size).toBe(card.related.length);
      expect(Number.isInteger(card.check.answer)).toBe(true);
      expect(card.check.answer).toBeGreaterThanOrEqual(0);
      expect(card.check.answer).toBeLessThan(card.check.options.length);
      expect(new Set(card.check.options).size).toBe(card.check.options.length);
    }
    expect(cardOf(getConcept('beat-bar')!).sections.map(section => section.section)).toEqual(['rhythm']);
  });

  it('каждое понятие каталога упражнений ведёт к одной карточке справочника', () => {
    const catalogue = [...new Set(EXERCISE_TEMPLATES.flatMap(template => template.concepts))].sort();
    expect(catalogue).toHaveLength(21);
    const owners = new Map<ConceptId, string[]>();
    for (const concept of REFERENCE_CONCEPTS) {
      for (const id of concept.exerciseConcepts ?? []) owners.set(id, [...(owners.get(id) ?? []), concept.id]);
    }
    expect([...owners.keys()].sort()).toEqual(catalogue);
    for (const id of catalogue) {
      expect(owners.get(id), id).toHaveLength(1);
      expect(conceptForExerciseConcept(id)?.id).toBe(owners.get(id)![0]);
    }
    expect(conceptForExerciseConcept('circle-of-fifths')?.id).toBe('fourth');
    expect(conceptForExerciseConcept('third')?.id).toBe('thirds');
  });
});

describe('справочник R-027: таблица октав и B/H', () => {
  it('научная нумерация: C1 = 24, C2 = 36, C3 = 48, C4 = 60; открытые струны E1 A1 D2 G2', () => {
    expect(OCTAVE_TABLE.rows.map(row => [row.scientific, row.russian])).toEqual([
      ['C1–B1', 'контроктава'], ['C2–B2', 'большая октава'], ['C3–B3', 'малая октава'], ['C4', 'первая октава'],
    ]);
    expect(OCTAVE_TABLE.rows.map(row => midiOfLabel(`C${row.octave}`))).toEqual([24, 36, 48, 60]);
    expect(OCTAVE_TABLE.rows.map(row => getPosition('E', 0).midi >= (row.octave + 1) * 12)).toEqual([true, false, false, false]);
    const examples = new Map(OCTAVE_TABLE.rows.flatMap(row => row.examples.map(example => [example.positionId, example.label])));
    expect(['E:0', 'A:0', 'D:0', 'G:0'].map(id => [examples.get(id), midiOfPosition(id)]))
      .toEqual([['E1', 28], ['A1', 33], ['D2', 38], ['G2', 43]]);
    expect(OCTAVE_TABLE.rows[0].examples[0]).toMatchObject({ russian: 'ми контроктавы', label: 'E1', comment: 'открытая E' });
    expect(getConcept('octave-numbers')!.full!.extras).toEqual(['octave-table', 'b-h-note']);
  });

  it('пояснение B/H: в приложении B — это си', () => {
    expect(B_H_NOTE.title).toBe('B или H?');
    expect(B_H_NOTE.text).toContain('**B = си**');
    expect(B_H_NOTE.text).toContain('**H**');
  });
});

describe('справочник R-027: поиск', () => {
  const ids = (query: string) => findConcepts(query).map(concept => concept.id);

  it('пустой запрос возвращает все понятия по порядку', () => {
    expect(findConcepts('')).toBe(REFERENCE_CONCEPTS);
    expect(ids('   ')).toHaveLength(25);
  });

  it('находит по названию, ключевым словам и ступеням; регистр и ё/е не мешают', () => {
    expect(ids('кварта')).toEqual(['fourth']);
    expect(ids('КВАРТА')).toEqual(['fourth']);
    expect(ids('H')).toEqual(['octave-numbers']);
    expect(ids('h')).toEqual(['octave-numbers']);
    expect(ids('E1')).toContain('octave-numbers');
    expect(ids('счет')).toEqual(ids('счёт'));
    expect(ids('счет')).toContain('counting');
    expect(ids('Счёт доля')).toEqual(['beat-bar', 'counting']);
    expect(ids('♭3')).toEqual(ids('b3'));
    expect(ids('b3')).toContain('degree');
    expect(ids('октава')[0]).toBe('octave');
  });

  it('бессмыслица ничего не находит', () => {
    expect(findConcepts('щщщфыв')).toEqual([]);
    expect(findConcepts('кварта щщщ')).toEqual([]);
  });
});

describe('разметка текстов карточек', () => {
  it('разбирает позиции, ступени, римские цифры, пальцы и выделение', () => {
    expect(parseConceptText('Сыграй {p:E/5|A1}, затем {p:A/1}: {d:♭3}, {r:vi}, палец {f:1} — **октава**.')).toEqual([
      { kind: 'text', text: 'Сыграй ' },
      { kind: 'position', positionId: 'E:5', string: 'E', fret: 5, label: 'A1' },
      { kind: 'text', text: ', затем ' },
      { kind: 'position', positionId: 'A:1', string: 'A', fret: 1, label: null },
      { kind: 'text', text: ': ' },
      { kind: 'degree', text: '♭3' },
      { kind: 'text', text: ', ' },
      { kind: 'roman', text: 'vi' },
      { kind: 'text', text: ', палец ' },
      { kind: 'finger', text: '1' },
      { kind: 'text', text: ' — ' },
      { kind: 'strong', text: 'октава' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('отклоняет позицию вне строя E–A–D–G', () => {
    expect(() => parseConceptText('{p:B/5}')).toThrow(RangeError);
    expect(() => parseConceptText('{p:E/25}')).toThrow(RangeError);
  });
});
