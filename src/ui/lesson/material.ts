/**
 * Подписи материала упражнения для экранов «Занятие» и «Проверь себя» (VIS-10 r2, VIS-02 r1).
 * Чистый модуль: без DOM, звука и хранилища. Позиции в тексте — `E/8`.
 */
import { buildExercise, type ConceptId, type ExercisePlan, type ExerciseSpec, type ExerciseTemplateId } from '../../exercises';
import { createStructure, formatDegree, parseNote, type MusicalStructure, type StructureId } from '../../music';

/** `E:8` → `E/8`. */
export const formatPosition = (id: string) => id.replace(':', '/');
/** `b7` → `♭7`, `#4` → `♯4`. */
export { formatDegree };

export const CONCEPT_LABELS: Readonly<Record<ConceptId, string>> = Object.freeze({
  'finger-per-fret': 'палец на лад',
  'position-shift': 'смена позиции',
  semitone: 'полутон',
  octave: 'октава',
  unison: 'унисон',
  degrees: 'ступени',
  pentatonic: 'пентатоника',
  'relative-keys': 'параллельные тональности',
  'scale-formula': 'формула гаммы',
  'shared-notes': 'общие ноты',
  'form-system': 'система форм',
  triad: 'трезвучие',
  fifth: 'квинта',
  sequence: 'секвенция',
  third: 'терция',
  transposition: 'транспонирование',
  'circle-of-fifths': 'квинтовый круг',
  'seventh-chord': 'септаккорд',
  inversion: 'обращение',
  progression: 'последовательность',
  blues: 'блюз',
});

export const STRUCTURE_LABELS: Readonly<Record<StructureId, string>> = Object.freeze({
  'minor-pentatonic': 'минорная пентатоника',
  'major-pentatonic': 'мажорная пентатоника',
  major: 'мажор',
  'natural-minor': 'натуральный минор',
  'major-triad': 'мажорное трезвучие',
  'minor-triad': 'минорное трезвучие',
  'diminished-triad': 'уменьшённое трезвучие',
  'major-seventh': 'большой мажорный септаккорд',
  'dominant-seventh': 'доминантсептаккорд',
  'minor-seventh': 'малый минорный септаккорд',
  'half-diminished-seventh': 'полууменьшённый септаккорд',
  blues: 'блюзовая гамма',
});

export const PROGRESSION_LABELS: Readonly<Record<string, string>> = { 'I-IV-V': 'I–IV–V', 'ii-V-I': 'ii–V–I', 'blues-12': 'блюз 12 тактов' };
export const PATTERN_LABELS: Readonly<Record<string, string>> = { roots: 'тоники', arpeggio: 'арпеджио', approach: 'арпеджио и подходы', boogie: 'буги' };

/** Плановое время шага по шаблону (VIS-10 r2), минуты. */
export const TEMPLATE_MINUTES: Readonly<Record<ExerciseTemplateId, number>> = Object.freeze({
  'chromatic-position': 3, 'position-shift': 3, 'note-all-positions': 3, octaves: 3, 'pentatonic-form': 3,
  'pentatonic-relative': 4, 'scale-compact': 4, 'connect-forms': 5, 'pentatonic-neck': 5, 'scale-one-string': 3,
  'scale-position': 4, 'arpeggio-1358': 4, 'root-five-eight': 3, 'groups-of-three': 4, thirds: 4, 'form-transpose': 3, 'cycle-fourths': 4,
  spider: 4, 'blues-scale': 3, 'arpeggio-seventh': 4, 'arpeggio-inversion': 3, progression: 4,
});
export const CHECK_MINUTES = 3;
export const CHECK_COUNT = 6;

const SHAPE_LETTER: Readonly<Record<string, string>> = { 'penta-a': 'A', 'penta-b': 'B', 'penta-c': 'C', 'penta-d': 'D', 'penta-e': 'E', 'compact-e': 'от E', 'compact-a': 'от A' };

/** Правило перенесено в каталог упражнений: его же применяет проверка записей «Проверь себя» в хранилище. */
export { exerciseStructure } from '../../exercises';

const CHORD_SUFFIX: Partial<Readonly<Record<StructureId, string>>> = {
  'minor-pentatonic': 'm', 'natural-minor': 'm', 'minor-triad': 'm', 'diminished-triad': '°',
  'major-seventh': 'maj7', 'dominant-seventh': '7', 'minor-seventh': 'm7', 'half-diminished-seventh': 'm7♭5',
};
/** Короткое имя тональности или аккорда: `Am`, `C`, `C°`, `Cmaj7`, `G7`, `Dm7`, `Bm7♭5`. */
export function keyName(structure: Pick<MusicalStructure, 'id' | 'root'>) {
  return `${structure.root}${CHORD_SUFFIX[structure.id] ?? ''}`;
}

const plans = new Map<string, ExercisePlan>();
/** Построение плана с памятью по описанию: превью, подписи и гриф читают одну модель. */
export function exercisePlan(spec: ExerciseSpec): ExercisePlan {
  const key = JSON.stringify(spec);
  let plan = plans.get(key);
  if (!plan) { plan = buildExercise(spec); if (plans.size > 200) plans.clear(); plans.set(key, plan); }
  return plan;
}

export function fretRange(plan: ExercisePlan) {
  const frets = plan.notes.map(note => note.fret);
  return { min: Math.min(...frets), max: Math.max(...frets) };
}

/** Материал одной строкой: тоника, структура, форма или позиция. */
export function materialLabel(spec: ExerciseSpec): string {
  const plan = exercisePlan(spec);
  const first = plan.notes[0];
  const note = (value: string) => parseNote(value).name;
  switch (spec.templateId) {
    case 'chromatic-position': return `позиция ${spec.params.startFret} · палец на лад`;
    case 'position-shift': return `струна ${spec.params.string} · лады ${spec.params.startFret}–${spec.params.startFret + spec.params.shifts + 3}`;
    case 'note-all-positions': return `нота ${note(spec.params.note)} · все струны`;
    case 'octaves': return `нота ${note(spec.params.note)} · струны E и A`;
    case 'pentatonic-form': case 'groups-of-three': {
      const structure = createStructure(spec.params.root, spec.params.structureId);
      return `${keyName(structure)} · ${STRUCTURE_LABELS[structure.id]} · форма ${SHAPE_LETTER[spec.params.shapeId]}`;
    }
    case 'pentatonic-relative': {
      const major = createStructure(spec.params.minorRoot, 'natural-minor').notes[2].name;
      return `${major} / ${note(spec.params.minorRoot)}m · форма ${SHAPE_LETTER[spec.params.shapeId]}`;
    }
    case 'connect-forms': {
      const structure = createStructure(spec.params.root, spec.params.structureId);
      const order = ['penta-a', 'penta-b', 'penta-c', 'penta-d', 'penta-e'];
      const next = order[(order.indexOf(spec.params.shapeId) + 1) % order.length];
      return `${keyName(structure)} · формы ${SHAPE_LETTER[spec.params.shapeId]}→${SHAPE_LETTER[next]}`;
    }
    case 'pentatonic-neck': return `${keyName(createStructure(spec.params.root, spec.params.structureId))} · 5 форм подряд`;
    case 'scale-compact': case 'thirds': return `${note(spec.params.root)} · ${STRUCTURE_LABELS[spec.params.structureId]} · от ${formatPosition(first.id)}`;
    case 'scale-one-string': return `${note(spec.params.root)} · ${STRUCTURE_LABELS[spec.params.structureId]} · струна ${spec.params.string}`;
    case 'scale-position': return `${note(spec.params.root)} · ${STRUCTURE_LABELS[spec.params.structureId]} · ${plan.segments[0].label.replace(/^Позиция /, 'позиция ')}`;
    case 'arpeggio-1358': return `${keyName(createStructure(spec.params.root, spec.params.structureId))} · от ${formatPosition(first.id)}`;
    case 'root-five-eight': return `${note(spec.params.root)} · тоника, квинта, октава · от ${formatPosition(first.id)}`;
    case 'form-transpose': return `форма ${SHAPE_LETTER[spec.params.shapeId]} · ${spec.params.roots.map(note).join(' → ')}`;
    case 'cycle-fourths': return `R–5–8 · ${plan.segments.map(segment => segment.label.split(' · ')[0]).join(', ')}`;
    case 'spider': return `пальцы ${[...spec.params.pattern].join('-')} · лады ${spec.params.startFret}–${spec.params.startFret + spec.params.positions + 2}`;
    case 'blues-scale': return `${note(spec.params.root)} · блюзовая гамма · от ${formatPosition(first.id)}`;
    case 'arpeggio-seventh': return `${keyName(createStructure(spec.params.root, spec.params.structureId))} · от ${formatPosition(first.id)}`;
    case 'arpeggio-inversion': return `${keyName(createStructure(spec.params.root, spec.params.structureId))} · ${spec.params.inversion}-е обращение · от ${formatPosition(first.id)}`;
    case 'progression': return `${note(spec.params.root)} · ${PROGRESSION_LABELS[spec.params.progression]} · ${PATTERN_LABELS[spec.params.pattern]}`;
  }
}
