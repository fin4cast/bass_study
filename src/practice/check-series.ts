/**
 * Серия вопросов шага проверки `check-v2` (R-028, дополнение A9.2–A9.4): области, цели и тексты. Чистый модуль:
 * из описания и `seed` строит те же `Question`, что читает `training` (ответ, показ, итог), по правилу набора `spread-v1`.
 */
import { buildExercise, exerciseStructure } from '../exercises';
import {
  annotatePositions, createScaleStructure, createStructure, formatDegree, getPositions, parseNote,
  type AnnotatedPosition, type MusicalStructure, type StringId,
} from '../music';
import { startQuizFromQuestions, type Question, type QuizSession } from '../training';
import { randomUint32 } from '../training/quiz-rules-v1';
import type { CheckSpec } from './check';

const NATURAL_CLASSES: ReadonlySet<number> = new Set([0, 2, 4, 5, 7, 9, 11]);
const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const;
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'] as const;
const CHORD_SUFFIXES = ['', 'm', '7'] as const;
const ROMAN = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'] as const;

/** Подпись карточки «Назови ноту»: у ноты со знаком двойная — `C♯/D♭`. */
const cardLabel = (pitchClass: number) => (NATURAL_CLASSES.has(pitchClass) ? SHARP_NAMES[pitchClass] : `${SHARP_NAMES[pitchClass]}/${FLAT_NAMES[pitchClass]}`);
/** Одно имя ноты в вопросе: диезное при чётном `seed` вопроса, бемольное при нечётном. */
const askName = (pitchClass: number, seed: number) => (seed % 2 === 0 ? SHARP_NAMES[pitchClass] : FLAT_NAMES[pitchClass]);

export interface CheckSeries {
  readonly questions: readonly Question[];
  /** Структура, по которой подписаны ноты и ступени. */
  readonly structure: MusicalStructure;
  /** Все позиции области — гриф проверки показывает их, ответ вне области — «вне диапазона вопроса». */
  readonly area: readonly AnnotatedPosition[];
  /** Позиции, о которых спрашивают (с фильтром натуральных нот и целей). */
  readonly positions: readonly AnnotatedPosition[];
}

function areaPositions(spec: CheckSpec): readonly AnnotatedPosition[] {
  const structure = areaStructure(spec);
  if (spec.area.type === 'range') {
    return annotatePositions(getPositions({ strings: spec.area.strings as StringId[], fretMin: spec.area.fretMin, fretMax: spec.area.fretMax }), structure);
  }
  const plan = buildExercise(spec.area.exercise);
  return annotatePositions([...new Map(plan.positions.map(position => [position.id, position])).values()], structure);
}

function areaStructure(spec: CheckSpec): MusicalStructure {
  const { subject } = spec;
  if (subject.type === 'degrees') {
    if (subject.scale) return createScaleStructure(subject.scale.root, subject.scale.degrees);
    const structure = spec.area.type === 'exercise' ? exerciseStructure(spec.area.exercise) : null;
    if (!structure) throw new RangeError('В материале этого упражнения нет ступеней одной тоники — проверка ступеней недоступна.');
    return structure;
  }
  return createStructure(subject.type === 'roman-root' ? parseNote(subject.key).name : 'C', 'major');
}

const unique = <T>(items: readonly T[]) => [...new Set(items)];

/** Перемешивание по `seed`: тот же xorshift и тасование Фишера — Йетса, что у серий `training`. */
function shuffle<T>(items: readonly T[], next: () => number): T[] {
  const list = [...items];
  for (let index = list.length - 1; index > 0; index--) { const swap = next() % (index + 1); [list[index], list[swap]] = [list[swap], list[index]]; }
  return list;
}

/**
 * Серия вопросов по описанию (A9). Бросает `RangeError`, если целей меньше двух или у цели нет позиции в области —
 * описание допустимой формы, но пустое по содержанию.
 */
export function checkSeries(spec: CheckSpec, seed: number): CheckSeries {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Seed должен быть целым числом от 0 до 4294967295.');
  const structure = areaStructure(spec);
  const area = areaPositions(spec);
  const subject = spec.subject;
  const kind = spec.kind;
  // Позиции, о которых спрашивают.
  let positions: readonly AnnotatedPosition[];
  if (subject.type === 'degrees') {
    positions = area.filter(position => position.inStructure && (subject.targets === null || subject.targets.includes(position.degree!)));
  } else if (subject.type === 'roman-root') positions = area;
  else positions = subject.notes === 'natural' ? area.filter(position => NATURAL_CLASSES.has(position.pitchClass)) : area;
  if (!positions.length) throw new RangeError('В выбранной области нет подходящих нот. Измените струны, лады или цели.');

  const naming = kind === 'name-note' || kind === 'name-degree';
  // Цели: у «назови» — позиции, у «найди» — классы высоты (у ступеней — по ступеням, у римской цифры — по цифрам).
  type Target = { readonly key: string; readonly pitchClass: number; readonly positionId?: string; readonly degree?: string | null; readonly roman?: string };
  let targets: Target[];
  if (subject.type === 'roman-root') {
    const key = createStructure(parseNote(subject.key).name, 'major');
    targets = ROMAN.map((roman, index) => ({ key: roman, pitchClass: key.notes[index].pitchClass, roman, degree: String(index + 1) }))
      .filter(target => positions.some(position => position.pitchClass === target.pitchClass));
  } else if (naming) targets = positions.map(position => ({ key: position.id, pitchClass: position.pitchClass, positionId: position.id, degree: position.degree }));
  else if (subject.type === 'degrees') targets = unique(positions.map(position => position.degree!)).map(degree => ({ key: degree, pitchClass: positions.find(position => position.degree === degree)!.pitchClass, degree }));
  else targets = unique(positions.map(position => position.pitchClass)).map(pitchClass => ({ key: String(pitchClass), pitchClass }));
  if (targets.length < 2) throw new RangeError('В области меньше двух целей для вопросов: расширьте диапазон.');

  // Порядок целей в серии (A9.3): перемешать по seed, брать по кругу; при notes: 'all' — чередовать цели со знаком и натуральные, начиная со знака.
  const next = randomUint32(seed);
  const accidentalSplit = (subject.type === 'notes' || subject.type === 'chord-root') && subject.notes === 'all';
  const accidental = targets.filter(target => !NATURAL_CLASSES.has(target.pitchClass));
  let order: Target[];
  if (accidentalSplit && accidental.length && accidental.length < targets.length) {
    const marked = shuffle(accidental, next), plain = shuffle(targets.filter(target => NATURAL_CLASSES.has(target.pitchClass)), next);
    order = Array.from({ length: spec.count }, (_, index) => (index % 2 === 0 ? marked[Math.floor(index / 2) % marked.length] : plain[Math.floor(index / 2) % plain.length]));
  } else {
    const list = shuffle(targets, next);
    order = Array.from({ length: spec.count }, (_, index) => list[index % list.length]);
  }
  const seeds = order.map(() => next());

  const naturalOnly = (subject.type === 'notes' || subject.type === 'chord-root') && subject.notes === 'natural';
  const choices = kind === 'name-degree'
    ? structure.notes.map(note => ({ id: `pc:${note.pitchClass}`, label: formatDegree(note.degree), pitchClass: note.pitchClass }))
    : Array.from({ length: 12 }, (_, pitchClass) => pitchClass).filter(pitchClass => !naturalOnly || NATURAL_CLASSES.has(pitchClass))
      .map(pitchClass => ({ id: `pc:${pitchClass}`, label: cardLabel(pitchClass), pitchClass }));
  const context = { scope: 'chromatic' as const, root: structure.root, structureId: structure.id, positionIds: area.map(position => position.id) };

  const questions = order.map((target, index): Question => {
    const questionSeed = seeds[index];
    const expected = naming ? [target.positionId!]
      : positions.filter(position => (subject.type === 'degrees' ? position.degree === target.degree : position.pitchClass === target.pitchClass)).map(position => position.id);
    const matching = positions.filter(position => position.pitchClass === target.pitchClass).map(position => position.id);
    const spelled = target.degree !== undefined && subject.type === 'degrees' ? structure.notes.find(note => note.pitchClass === target.pitchClass)!.name : askName(target.pitchClass, questionSeed);
    const here = naming ? positions.find(position => position.id === target.positionId)! : null;
    let prompt: string;
    let record: string;
    switch (kind) {
      case 'name-note': prompt = `Назови ноту: струна ${here!.string}, лад ${here!.fret}. Октава не влияет на выбор имени.`; record = naturalOnly ? SHARP_NAMES[target.pitchClass] : cardLabel(target.pitchClass); break;
      case 'name-degree': prompt = `Какая это ступень от ${structure.root}: струна ${here!.string}, лад ${here!.fret}?`; record = target.degree!; break;
      case 'find-degree': prompt = `Найди ступень ${formatDegree(target.degree)} от ${structure.root}.`; record = target.degree!; break;
      case 'find-all': prompt = `Найди все позиции ноты ${spelled}: ${matching.length}.`; record = cardLabel(target.pitchClass); break;
      default:
        if (subject.type === 'chord-root') {
          const chord = `${spelled}${CHORD_SUFFIXES[questionSeed % 3]}`;
          prompt = `Найди тонику аккорда ${chord}.`; record = chord;
        } else if (subject.type === 'roman-root') {
          prompt = `Тональность ${structure.root} мажор. Найди тонику аккорда ${target.roman}.`; record = target.roman!;
        } else { prompt = `Найди ноту ${spelled}.`; record = cardLabel(target.pitchClass); }
    }
    const expectedIds = kind === 'find-all' || kind === 'find-note' || kind === 'find-degree' ? (subject.type === 'degrees' ? expected : matching) : expected;
    return Object.freeze({
      id: `q-${questionSeed.toString(16)}-${kind}-${naming ? target.positionId : target.key}`,
      mode: kind, prompt, seed: questionSeed, context,
      target: Object.freeze({ pitchClass: target.pitchClass, name: spelled, degree: target.degree ?? null }),
      targetMidi: null, ...(naming ? { targetPositionId: target.positionId } : {}),
      expectedPositionIds: Object.freeze(expectedIds), choices: Object.freeze(choices),
      answerRule: naming ? 'pitch-class' as const : kind === 'find-all' ? 'all-positions' as const : 'any-position' as const,
      recordTarget: record,
    });
  });
  return Object.freeze({ questions: Object.freeze(questions), structure, area: Object.freeze(area), positions: Object.freeze(positions) });
}

/** Сессия серии: вопросы по правилу `spread-v1` и ответы теми же функциями `training`. */
export function startCheckQuiz(spec: CheckSpec, seed: number): QuizSession {
  return startQuizFromQuestions(checkSeries(spec, seed).questions, seed, 'spread-v1');
}
