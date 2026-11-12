/**
 * Справочник понятий R-027 (VIS-12 r1, утверждён 2026-11-12): чистые данные и поиск.
 * Тексты, позиции и вопросы перенесены из макета `docs/design/references/p13-r1-vis12.view.html`.
 * Модуль не обращается к DOM, звуку и базе.
 *
 * Разметка текстов (как в макете): `{p:E/5|A1}` — позиция с подписью звучащей высоты, `{p:E/5}` — позиция
 * без подписи, `{d:♭3}` — ступень, `{r:vi}` — римская цифра аккорда, `{f:1}` — палец, `**…**` — выделение.
 * Ступени, римские цифры и пальцы различаются видом (R-027), поэтому они размечены отдельно.
 */
import type { StringId } from '../music';
import type { ConceptId, ExerciseTemplateId } from '../exercises';

export type ReferenceLevel = 0 | 1 | 2 | 3 | 'rhythm' | 'reading';
export type ReferenceLens = 'notes' | 'intervals' | 'degrees' | 'chord-tones';
export type ConceptRole = 'root' | 'target' | 'shared' | 'plain';

export interface ConceptPosition {
  /** Позиция `струна:лад`, например `E:5`. */
  readonly id: string;
  /** Звучащая высота с научной октавой, как на мини-грифе: `A1`, `A♯1`, `B♭1`. */
  readonly label: string;
  /** Цвет на мини-грифе; подпись цвета — в `legend` карточки. */
  readonly role?: ConceptRole;
  readonly finger?: number;
  /** Интервал от тоники для линзы «Интервалы»: `1`, `4`, `м3`, `8`. */
  readonly interval?: string;
  /** Ступень для линз «Ступени» и «Тоны аккорда»: `1`, `♭3`, `8`. */
  readonly degree?: string;
  /** Нота только одной из соседних форм (карточка «Общие ноты»); у общей ноты не задаётся. */
  readonly form?: 'A' | 'B';
}

export interface ConceptBoard {
  readonly positions: readonly ConceptPosition[];
  readonly fretMin: number;
  readonly fretMax: number;
  /** Доступные линзы; первая не обязательно выбрана — см. `defaultLens`. */
  readonly lenses: readonly ReferenceLens[];
  readonly defaultLens: ReferenceLens;
  readonly showFingers: boolean;
  /** Линза «Ноты» показывает номер октавы (`A1`), иначе только букву (`A`). */
  readonly showOctave: boolean;
  readonly legend: readonly { readonly role: ConceptRole; readonly label: string }[];
}

export interface ConceptCheck {
  readonly question: string;
  readonly options: readonly string[];
  /** Индекс верного варианта. */
  readonly answer: number;
  readonly explanation: string;
}

export type ReferenceSection = 'rhythm' | 'songs';
export type ConceptExtra = 'octave-table' | 'b-h-note' | 'label-kinds';

interface ConceptCardBase {
  /** «Как это называется». */
  readonly name: string;
  readonly facts: readonly string[];
  /** Формула тонов и полутонов, например `ТТПТТТП`. */
  readonly formula?: string;
  readonly extras: readonly ConceptExtra[];
  /** «Зачем басисту». */
  readonly why: string;
  /** Связанные упражнения каталога R-026. */
  readonly related: readonly ExerciseTemplateId[];
  /** Ссылки вне каталога R-026 («вне каталога · раздел …»). */
  readonly sections: readonly { readonly section: ReferenceSection; readonly title: string }[];
  readonly check: ConceptCheck;
}

/** «Сыграй и послушай» полной карточки: текст и мини-гриф. */
export interface ConceptPlay extends ConceptBoard {
  readonly text: string;
  /** Форма на грифе, например «+2 струны, +2 лада». */
  readonly shape?: string;
  /** Что прозвучит по кнопке «Послушать». */
  readonly listen?: string;
}
export interface ConceptFullCard extends ConceptCardBase { readonly play: ConceptPlay }

/** Короткая карточка: мини-гриф есть не у всех. */
export interface ConceptBriefCard extends ConceptCardBase {
  readonly play: { readonly text: string; readonly board: ConceptBoard | null };
}

export interface ReferenceConcept {
  readonly id: string;
  readonly level: ReferenceLevel;
  /** Понятие показывается и на другом уровне (октава — ещё и в «Интервалах»). */
  readonly alsoLevels?: readonly ReferenceLevel[];
  readonly title: string;
  readonly summary: string;
  readonly keywords: readonly string[];
  /** Ровно одно из `full` и `brief`. */
  readonly full?: ConceptFullCard;
  readonly brief?: ConceptBriefCard;
  /** Пример будущего уровня («позже»). */
  readonly later?: true;
  /** Понятия каталога упражнений, для которых эта карточка — ответ на «Почему…». */
  readonly exerciseConcepts?: readonly ConceptId[];
}

export type ConceptTextPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'strong'; readonly text: string }
  | { readonly kind: 'position'; readonly positionId: string; readonly string: StringId; readonly fret: number; readonly label: string | null }
  | { readonly kind: 'degree' | 'roman' | 'finger'; readonly text: string };

export const REFERENCE_LEVELS: readonly { readonly id: ReferenceLevel; readonly mark: string; readonly title: string }[] = deepFreeze([
  { id: 0, mark: '0', title: 'Ориентация' },
  { id: 1, mark: '1', title: 'Интервалы как формы' },
  { id: 2, mark: '2', title: 'Ступени и гаммы' },
  { id: 3, mark: '3', title: 'Тоны аккорда' },
  { id: 'rhythm', mark: '♩', title: 'Ритм · параллельно' },
  { id: 'reading', mark: 'T', title: 'Чтение · параллельно' },
]);

const P = (id: string, label: string, role: ConceptRole, extra: Omit<ConceptPosition, 'id' | 'label' | 'role'> = {}): ConceptPosition =>
  ({ id, label, role, ...extra });
const board = (fretMin: number, fretMax: number, positions: ConceptPosition[], legend: [ConceptRole, string][],
  options: { lenses?: ReferenceLens[]; defaultLens?: ReferenceLens; showFingers?: boolean; showOctave?: boolean } = {}): ConceptBoard => {
  const lenses = options.lenses ?? ['notes'];
  return {
    positions, fretMin, fretMax, lenses, defaultLens: options.defaultLens ?? lenses[0],
    showFingers: options.showFingers ?? false, showOctave: options.showOctave ?? false,
    legend: legend.map(([role, label]) => ({ role, label })),
  };
};
const check = (question: string, options: string[], answer: number, explanation: string): ConceptCheck => ({ question, options, answer, explanation });
type CardInput<C extends ConceptCardBase> = Omit<C, 'facts' | 'extras' | 'sections'> & Partial<Pick<ConceptCardBase, 'facts' | 'extras' | 'sections'>>;
const fullCard = (value: CardInput<ConceptFullCard>): ConceptFullCard => ({ facts: [], extras: [], sections: [], ...value });
const briefCard = (value: CardInput<ConceptBriefCard>): ConceptBriefCard => ({ facts: [], extras: [], sections: [], ...value });

const RHYTHM_SECTION = { section: 'rhythm', title: 'Раздел «Ритм» · четверти с метрономом' } as const;
const SONGS_SECTION = { section: 'songs', title: 'Раздел «Песни» · TAB и ноты песни' } as const;

export const REFERENCE_CONCEPTS: readonly ReferenceConcept[] = deepFreeze<ReferenceConcept[]>([
  /* ===== 0. Ориентация ===== */
  {
    id: 'semitone', level: 0, title: 'Тон и полутон',
    summary: 'Соседний лад — полутон, через лад — тон.',
    keywords: ['полутон', 'тон', 'лад', 'шаг', 'хроматика'],
    exerciseConcepts: ['semitone', 'finger-per-fret', 'position-shift'],
    full: fullCard({
      play: {
        text: 'Поставь первый палец на {p:E/5|A1} и сыграй. Потом второй палец — {p:E/6|A♯1}, соседний лад. Потом третий — {p:E/7|B1}.',
        ...board(3, 9, [P('E:5', 'A1', 'root', { finger: 1 }), P('E:6', 'A♯1', 'target', { finger: 2 }), P('E:7', 'B1', 'target', { finger: 3 })],
          [['root', 'Старт · A1'], ['target', 'Шаг по ладам']], { showFingers: true }),
        shape: 'соседний лад = полутон · через лад = тон',
        listen: 'A1, A♯1, B1 — шаг за шагом',
      },
      name: 'Шаг на соседний лад — **полутон**, самый маленький шаг на грифе. Два полутона — **тон**: через лад, {p:E/5} → {p:E/7}.',
      facts: ['Двенадцать полутонов — и нота повторяется октавой выше: {p:E/0|E1} → {p:E/12|E2}.', 'Между E и F и между B и C — полутон: «чёрной» ноты между ними нет.'],
      why: 'Формулы гамм — это цепочки тонов и полутонов: «Т-Т-П-…» читается прямо по ладам.',
      related: ['chromatic-position', 'position-shift'],
      check: check('От {p:E/5|A1} на тон вверх по той же струне — какой лад?', ['6', '7', '8'], 1, 'Тон — два полутона: 5 + 2 = 7. Это {p:E/7|B1}.'),
    }),
  },
  {
    id: 'accidentals', level: 0, title: 'Диез и бемоль',
    summary: 'Диез ♯ поднимает ноту на полутон, бемоль ♭ опускает на полутон.',
    keywords: ['диез', 'бемоль', '♯', '♭', 'знак', 'альтерации'],
    brief: briefCard({
      play: { text: 'Сыграй {p:A/0|A1}, затем {p:A/1|A♯1}, затем {p:A/2|B1}. Средний звук назовём двумя способами.', board: null },
      name: '**Диез** ♯ поднимает ноту на полутон — на лад вверх. **Бемоль** ♭ опускает на полутон — на лад вниз. {p:A/1} — это A♯ («ля-диез») и одновременно B♭ («си-бемоль»).',
      why: 'Без диезов и бемолей не прочитать ни гамму, ни аккорд вроде B♭.',
      related: ['note-all-positions', 'chromatic-position'],
      check: check('Что такое E♭?', ['Нота на лад ниже E', 'Нота на лад выше E', 'То же, что E'], 0, 'Бемоль опускает на полутон: E♭2 — {p:A/6}, на лад ниже {p:A/7|E2}.'),
    }),
  },
  {
    id: 'enharmonic', level: 0, title: 'Энгармонизм',
    summary: 'Один звук — два имени: A♯ = B♭.',
    keywords: ['энгармонизм', 'одна', 'нота', 'два', 'имени', 'a#', 'bb'],
    brief: briefCard({
      play: {
        text: 'Сыграй {p:E/6}, потом {p:A/1}. Звук один и тот же.',
        board: board(0, 8, [P('E:6', 'A♯1', 'plain'), P('A:1', 'B♭1', 'plain')], [['plain', 'Один звук · A♯1 = B♭1']]),
      },
      name: 'Один звук — два имени. Это **энгармонизм**: A♯ = B♭. Имя выбирает гамма: в F мажоре пишут B♭, в B мажоре — A♯.',
      why: 'Знак в нотах или в названии аккорда (B♭, E♭) сразу находится на грифе, как бы он ни был записан.',
      related: ['note-all-positions', 'cycle-fourths'],
      check: check('Какое второе имя у G♯?', ['A♭', 'A♯', 'G♭'], 0, 'G♯ на полутон выше G, A♭ на полутон ниже A — это один лад.'),
    }),
  },
  {
    id: 'octave', level: 0, alsoLevels: [1], title: 'Октава',
    summary: 'Та же нота вдвое выше по частоте: +2 струны, +2 лада.',
    keywords: ['октава', '+2', 'струны', 'лада', '8', 'root-5-8'],
    exerciseConcepts: ['octave'],
    full: fullCard({
      play: {
        text: 'Первый палец — {p:E/5|A1}, третий или четвёртый — {p:D/7|A2}. Сыграй по очереди: та же нота, только выше.',
        ...board(3, 9, [P('E:5', 'A1', 'root', { interval: '1' }), P('D:7', 'A2', 'root', { interval: '8' })],
          [['root', 'Нота A в двух октавах']], { lenses: ['notes', 'intervals'], showOctave: true }),
        shape: '+2 струны, +2 лада',
        listen: 'A1, затем A2',
      },
      name: 'Это **октава**: та же нота, вдвое выше по частоте. Буква не меняется, растёт номер: A1 → A2.',
      facts: ['Октава на одной струне — через 12 ладов: {p:E/0|E1} → {p:E/12|E2}.', 'Форма «+2 струны, +2 лада» работает от струн E и A; от D и G октава вверх уходит за пределы четырёх струн.'],
      why: 'Октава — вторая опора после тоники: root–5–8, октавные грувы, проверка, что нашёл ту же ноту.',
      related: ['octaves', 'note-all-positions', 'root-five-eight'],
      check: check('Где октава от {p:A/3|C2}?', ['{p:G/5}', '{p:D/5}', '{p:G/3}'], 0, '+2 струны, +2 лада: {p:A/3} → {p:G/5|C3}. {p:D/5|G2} — квинта, {p:G/3|A♯2} — не C.'),
    }),
  },
  {
    id: 'unison', level: 0, title: 'Унисон',
    summary: 'Одна высота в двух местах: 5-й лад равен следующей открытой струне.',
    keywords: ['унисон', 'прима', 'одинаковая', 'высота', '5-й', 'лад', 'настройка'],
    exerciseConcepts: ['unison'],
    brief: briefCard({
      play: {
        text: 'Сыграй {p:E/5}, затем открытую {p:A/0}. Звучат одинаково.',
        board: board(0, 7, [P('E:5', 'A1', 'plain'), P('A:0', 'A1', 'plain')], [['plain', 'Один звук · A1']], { showOctave: true }),
      },
      name: 'Одна высота в двух местах — **унисон**. 5-й лад равен следующей открытой струне: {p:A/5} = {p:D/0|D2}, {p:D/5} = {p:G/0|G2}.',
      why: 'По 5-му ладу настраивают бас; унисон даёт выбор, где сыграть ту же ноту удобнее.',
      related: ['note-all-positions'],
      check: check('С какой открытой струной в унисоне {p:D/5}?', ['G', 'A', 'E'], 0, '5-й лад равен следующей открытой струне: {p:D/5|G2} = открытая G.'),
    }),
  },
  {
    id: 'octave-numbers', level: 0, title: 'Номера октав',
    summary: 'Цифра после буквы — номер октавы: открытая E — E1, номер растёт на ноте C.',
    keywords: ['номер', 'октавы', 'контроктава', 'большая', 'малая', 'первая', 'e1', 'a1', 'научная', 'нумерация', 'H', 'B', 'си'],
    full: fullCard({
      play: {
        text: 'Сыграй открытые струны снизу вверх: E, A, D, G. Потом {p:A/2|B1} и {p:A/3|C2} — на этом шаге номер меняется.',
        ...board(0, 5, [P('E:0', 'E1', 'plain'), P('A:0', 'A1', 'plain'), P('D:0', 'D2', 'plain'), P('G:0', 'G2', 'plain'), P('A:2', 'B1', 'target'), P('A:3', 'C2', 'root')],
          [['plain', 'Открытые струны'], ['target', 'B1'], ['root', 'C2 — номер сменился']], { showOctave: true }),
        listen: 'E1, A1, D2, G2 — открытые струны',
      },
      name: 'Цифра после буквы — **номер октавы**. Открытая E — E1, открытая D — уже D2. Номер растёт на ноте C: B1 → C2.',
      extras: ['octave-table', 'b-h-note'],
      why: 'Номер различает одну ноту в разных местах грифа и совпадает с подписями в нотах, тюнерах и программах.',
      related: ['note-all-positions', 'octaves'],
      check: check('{p:D/0|D2} — как это сказать по-русски?', ['ре контроктавы', 'ре большой октавы', 'ре малой октавы'], 1, 'C2–B2 — большая октава.'),
    }),
  },

  /* ===== 1. Интервалы как формы ===== */
  {
    id: 'fourth', level: 1, title: 'Кварта',
    summary: 'Кварта — 5 полутонов: соседняя струна, тот же лад.',
    keywords: ['кварта', '4', 'интервал', 'строй', 'квартовый', 'соседняя', 'струна', 'тот', 'же', 'лад'],
    exerciseConcepts: ['circle-of-fifths'],
    full: fullCard({
      play: {
        text: 'Сыграй {p:E/5|A1}, затем {p:A/5|D2} — тем же пальцем, перекатом.',
        ...board(3, 8, [P('E:5', 'A1', 'root', { interval: '1' }), P('A:5', 'D2', 'target', { interval: '4' })],
          [['root', 'Тоника A1'], ['target', 'Кварта D2']], { lenses: ['notes', 'intervals'] }),
        shape: 'соседняя струна, тот же лад',
        listen: 'A1, затем D2',
      },
      name: 'Это **кварта**: 5 полутонов, A → D. Бас настроен квартами, поэтому открытые E–A–D–G — тоже кварты.',
      facts: ['Кварта вниз — та же форма обратно: {p:A/5} → {p:E/5}.', 'Кварта + квинта = октава: A1 → D2 → A2.'],
      why: 'Ход на кварту — самый частый шаг баса между аккордами: C → F, G → C. Квинтовый круг — это кварты вверх.',
      related: ['cycle-fourths', 'form-transpose'],
      check: check('Кварта вверх от {p:A/3|C2}?', ['{p:D/3}', '{p:D/5}', '{p:D/2}'], 0, 'Соседняя струна, тот же лад: {p:D/3|F2}. {p:D/5|G2} — квинта, {p:D/2|E2} — большая терция.'),
    }),
  },
  {
    id: 'fifth', level: 1, title: 'Квинта',
    summary: 'Квинта — 7 полутонов: +1 струна, +2 лада.',
    keywords: ['квинта', '5', 'интервал', 'root-5-8', '+1', 'струна', '+2', 'лада'],
    exerciseConcepts: ['fifth'],
    full: fullCard({
      play: {
        text: 'Первый палец — {p:E/5|A1}, третий — {p:A/7|E2}: на струну выше и на два лада дальше. Добавь {p:D/7|A2} — получится root–5–8.',
        ...board(3, 9, [P('E:5', 'A1', 'root', { interval: '1' }), P('A:7', 'E2', 'target', { interval: '5' }), P('D:7', 'A2', 'root', { interval: '8' })],
          [['root', 'Тоника и октава'], ['target', 'Квинта E2']], { lenses: ['notes', 'intervals'] }),
        shape: '+1 струна, +2 лада',
        listen: 'A1, E2, A2 — root–5–8',
      },
      name: 'Это **квинта**: 7 полутонов, A → E. Вместе с тоникой и октавой — каркас простой басовой партии.',
      facts: ['Квинта вниз — на струну ниже и на 2 лада назад: от {p:A/5|D2} это {p:E/3|G1}.', 'На одной струне квинта — через 7 ладов: {p:E/5|A1} → {p:E/12|E2}.'],
      why: 'Тоника и квинта держат аккорд: так звучат кантри, рок и большинство простых партий.',
      related: ['root-five-eight', 'arpeggio-1358', 'cycle-fourths'],
      check: check('Квинта вверх от {p:D/5|G2}?', ['{p:G/7}', '{p:G/5}', '{p:D/7}'], 0, '+1 струна, +2 лада: {p:G/7|D3}. {p:G/5|C3} — кварта, {p:D/7|A2} — тон.'),
    }),
  },
  {
    id: 'thirds', level: 1, title: 'Терции',
    summary: 'Малая терция — 3 полутона, большая — 4: разница минора и мажора.',
    keywords: ['терция', 'малая', 'большая', 'м3', 'б3', 'мажор', 'минор'],
    exerciseConcepts: ['third'],
    brief: briefCard({
      play: {
        text: 'Сыграй {p:E/5|A1}, потом {p:A/3|C2}, потом {p:A/4|C♯2}. Второй звук темнее, третий светлее.',
        board: board(2, 7, [P('E:5', 'A1', 'root', { interval: '1' }), P('A:3', 'C2', 'target', { interval: 'м3' }), P('A:4', 'C♯2', 'plain', { interval: 'б3' })],
          [['root', 'Тоника'], ['target', 'Малая терция'], ['plain', 'Большая терция']], { lenses: ['notes', 'intervals'] }),
      },
      name: 'Это **терции**. Малая — 3 полутона (A → C), большая — 4 (A → C♯). Малая звучит темнее, большая — светлее: в этом разница минора и мажора.',
      why: 'Терция решает, мажор или минор у аккорда: её бас играет в арпеджио и проходах.',
      related: ['thirds', 'arpeggio-1358'],
      check: check('Какая терция от A — {p:A/4|C♯2}?', ['Большая', 'Малая'], 0, 'A1 → C♯2 — 4 полутона, большая терция.'),
    }),
  },

  /* ===== 2. Ступени и гаммы ===== */
  {
    id: 'degree', level: 2, title: 'Ступень',
    summary: 'Ступень — номер ноты от тоники: в Am это 1, ♭3, 4, 5, ♭7.',
    keywords: ['ступень', 'ступени', '♭3', '♭7', 'b3', 'b7', 'номер', 'от', 'тоники', 'римские', 'цифры', 'vi', 'пальцы', 'подписи'],
    exerciseConcepts: ['degrees', 'transposition', 'sequence'],
    full: fullCard({
      play: {
        text: 'Сыграй форму A пентатоники Am снизу вверх с {p:E/5|A1}. Пальцы — маленькие цифры у кружков.',
        ...board(4, 9, [
          P('E:5', 'A1', 'root', { degree: '1', finger: 1 }), P('E:8', 'C2', 'plain', { degree: '♭3', finger: 4 }),
          P('A:5', 'D2', 'plain', { degree: '4', finger: 1 }), P('A:7', 'E2', 'plain', { degree: '5', finger: 3 }),
          P('D:5', 'G2', 'plain', { degree: '♭7', finger: 1 }), P('D:7', 'A2', 'root', { degree: '1', finger: 3 }),
          P('G:5', 'C3', 'plain', { degree: '♭3', finger: 1 }), P('G:7', 'D3', 'plain', { degree: '4', finger: 3 }),
        ], [['root', 'Тоника · ступень 1'], ['plain', 'Другие ступени формы A']], { lenses: ['notes', 'degrees'], defaultLens: 'degrees', showFingers: true }),
        listen: 'форма A вверх: A1 C2 D2 E2 G2 A2 C3 D3',
      },
      name: 'Номер ноты от тоники — **ступень**. В Am: A — 1, C — {d:♭3}, D — 4, E — 5, G — {d:♭7}. Знак ♭ у ступени значит «на полутон ниже, чем в мажоре».',
      extras: ['label-kinds'],
      why: 'Ступени переносят знание с одной тоники на все: форма «1 ♭3 4 5 ♭7» звучит одинаково от любой ноты.',
      related: ['pentatonic-form', 'form-transpose', 'groups-of-three'],
      check: check('Ступень {d:♭7} в Am — какая нота?', ['G', 'F', 'G♯'], 0, 'В Am: A 1, C ♭3, D 4, E 5, G ♭7.'),
    }),
  },
  {
    id: 'major-formula', level: 2, title: 'Формула мажора',
    summary: 'Мажор строится по формуле Т-Т-П-Т-Т-Т-П.',
    keywords: ['мажор', 'формула', 'т-т-п-т-т-т-п', 'гамма', 'тон', 'полутон'],
    exerciseConcepts: ['scale-formula'],
    brief: briefCard({
      play: {
        text: 'Сыграй по струне A от {p:A/3|C2}: лады 3, 5, 7, 8, 10, 12, 14, 15. Где шаг в один лад — там полутон.',
        board: board(3, 15, [
          P('A:3', 'C2', 'root', { degree: '1' }), P('A:5', 'D2', 'target', { degree: '2' }), P('A:7', 'E2', 'target', { degree: '3' }),
          P('A:8', 'F2', 'target', { degree: '4' }), P('A:10', 'G2', 'target', { degree: '5' }), P('A:12', 'A2', 'target', { degree: '6' }),
          P('A:14', 'B2', 'target', { degree: '7' }), P('A:15', 'C3', 'root', { degree: '8' }),
        ], [['root', 'Тоника C'], ['target', 'Ступени 2–7']], { lenses: ['notes', 'degrees'] }),
      },
      formula: 'ТТПТТТП',
      name: 'Формула **мажора**: Т-Т-П-Т-Т-Т-П. Полутоны — между 3 и 4 и между 7 и 8 ступенью.',
      why: 'По формуле строится мажор от любой тоники — не нужно заучивать ноты каждой гаммы.',
      related: ['scale-one-string', 'scale-position', 'scale-compact'],
      check: check('Между какими ступенями мажора полутоны?', ['3–4 и 7–8', '2–3 и 6–7', '4–5 и 7–8'], 0, 'Т-Т-П-Т-Т-Т-П: полутон третьим и седьмым шагом.'),
    }),
  },
  {
    id: 'natural-minor', level: 2, title: 'Натуральный минор',
    summary: 'Натуральный минор строится по формуле Т-П-Т-Т-П-Т-Т.',
    keywords: ['минор', 'натуральный', 'т-п-т-т-п-т-т', '♭3', '♭6', '♭7'],
    brief: briefCard({
      play: { text: 'Сыграй по струне A с открытой: лады 0, 2, 3, 5, 7, 8, 10, 12 — от {p:A/0|A1} до {p:A/12|A2}.', board: null },
      formula: 'ТПТТПТТ',
      name: 'Формула **натурального минора**: Т-П-Т-Т-П-Т-Т. Ступени: 1 2 {d:♭3} 4 5 {d:♭6} {d:♭7}. Am — A B C D E F G.',
      why: 'Большинство рок- и поп-партий в миноре держатся на 1, {d:♭3}, 5 и {d:♭7}.',
      related: ['scale-position', 'scale-compact'],
      check: check('Сколько полутонов от 1 до {d:♭3}?', ['3', '4', '2'], 0, '{d:♭3} — малая терция, 3 полутона: A → C.'),
    }),
  },
  {
    id: 'relative-keys', level: 2, title: 'Параллельные тональности',
    summary: 'C мажор и A минор — одни ноты, разные тоники.',
    keywords: ['параллельные', 'тональности', 'c', 'мажор', 'a', 'минор', 'relative', 'одни', 'ноты', 'разные', 'тоники', 'vi'],
    exerciseConcepts: ['relative-keys'],
    brief: briefCard({
      play: { text: 'Сыграй ноты C D E G A с опорой на {p:A/3|C2}, потом те же ноты с опорой на {p:E/5|A1}. Ноты те же — «дом» другой.', board: null },
      name: 'C мажор и A минор — одни и те же ноты, разные тоники. Такие тональности называют **параллельными**. Тоника минора — 6-я ступень мажора, аккорд на ней — {r:vi}.',
      facts: ['В английских источниках это relative keys; parallel там значит одну тонику: C и Cm.'],
      why: 'Знаешь одну форму — знаешь две тональности.',
      related: ['pentatonic-relative'],
      check: check('Параллельный минор для G мажора?', ['Em', 'Gm', 'Am'], 0, '6-я ступень G мажора — E.'),
    }),
  },
  {
    id: 'pentatonic', level: 2, title: 'Пентатоника',
    summary: 'Пять нот без полутонов: Am — A C D E G.',
    keywords: ['пентатоника', 'пять', 'нот', 'форма', 'минорная', 'мажорная'],
    exerciseConcepts: ['pentatonic'],
    brief: briefCard({
      play: { text: 'Форма A от {p:E/5|A1}: по две ноты на каждой струне — первым и третьим или четвёртым пальцем.', board: null },
      name: '**Пентатоника** — пять нот без полутонов. Минорная: 1 {d:♭3} 4 5 {d:♭7} (Am: A C D E G). Мажорная: 1 2 3 5 6 (C: C D E G A) — те же ноты.',
      why: 'Пять форм пентатоники покрывают весь гриф — с них начинается свобода на грифе.',
      related: ['pentatonic-form', 'pentatonic-neck', 'groups-of-three'],
      check: check('Какой ноты нет в пентатонике Am?', ['B', 'C', 'G'], 0, 'Am пентатоника: A C D E G.'),
    }),
  },
  {
    id: 'shared-notes', level: 2, title: 'Общие ноты соседних форм',
    summary: 'Позиции, которые есть в обеих соседних формах, — мостик для перехода.',
    keywords: ['общие', 'ноты', 'соседние', 'формы', 'связка', 'позиция', 'переход', 'пентатоника'],
    exerciseConcepts: ['shared-notes', 'form-system'],
    full: fullCard({
      play: {
        text: 'Сыграй форму A вверх, затем форму B вниз. На {p:E/8|C2}, {p:A/7|E2}, {p:D/7|A2}, {p:G/7|D3} рука уже стоит — это мостик между формами.',
        ...board(4, 11, [
          P('E:5', 'A1', 'root', { degree: '1', form: 'A' }), P('E:8', 'C2', 'shared', { degree: '♭3' }),
          P('A:5', 'D2', 'target', { degree: '4', form: 'A' }), P('A:7', 'E2', 'shared', { degree: '5' }),
          P('D:5', 'G2', 'target', { degree: '♭7', form: 'A' }), P('D:7', 'A2', 'shared', { degree: '1' }),
          P('G:5', 'C3', 'target', { degree: '♭3', form: 'A' }), P('G:7', 'D3', 'shared', { degree: '4' }),
          P('E:10', 'D2', 'plain', { degree: '4', form: 'B' }), P('A:10', 'G2', 'plain', { degree: '♭7', form: 'B' }),
          P('D:10', 'C3', 'plain', { degree: '♭3', form: 'B' }), P('G:9', 'E3', 'plain', { degree: '5', form: 'B' }),
        ], [['root', 'Тоника A (на общей ноте — кольцо)'], ['target', 'Форма A · 5–8'], ['plain', 'Форма B · 7–10'], ['shared', 'Общие ноты']],
        { lenses: ['notes', 'degrees'] }),
        listen: 'форма A вверх, форма B вниз — 16 восьмых',
      },
      name: 'Позиции, которые есть в обеих формах, — **общие ноты**. У форм A и B пентатоники Am их 4.',
      facts: ['Переход: {p:E/8} — палец 4 в форме A и палец 2 в форме B; рука сдвигается на 2 лада.'],
      why: 'Через общие ноты рука переходит в соседнюю позицию без прыжка — пять форм складываются в одну карту грифа.',
      related: ['connect-forms', 'pentatonic-neck'],
      check: check('Какая позиция общая для форм A и B?', ['{p:A/7}', '{p:A/5}', '{p:G/9}'], 0, 'Общие: E/8, A/7, D/7, G/7. {p:A/5} — только в форме A, {p:G/9} — только в форме B.'),
    }),
  },

  /* ===== 3. Тоны аккорда ===== */
  {
    id: 'triad', level: 3, title: 'Трезвучие 1–3–5',
    summary: 'Три ноты через терцию — трезвучие 1–3–5.',
    keywords: ['трезвучие', 'аккорд', 'тоны', 'аккорда', '1-3-5', 'арпеджио', 'мажорное', 'минорное', 'vi', 'iv', 'римские'],
    exerciseConcepts: ['triad'],
    full: fullCard({
      play: {
        text: 'От {p:E/8|C2}: второй палец, потом {p:A/7|E2} первым, {p:A/10|G2} и {p:D/10|C3} — мизинцем. Это арпеджио C.',
        ...board(6, 11, [
          P('E:8', 'C2', 'root', { degree: '1', finger: 2 }), P('A:7', 'E2', 'target', { degree: '3', finger: 1 }),
          P('A:10', 'G2', 'target', { degree: '5', finger: 4 }), P('D:10', 'C3', 'root', { degree: '8', finger: 4 }),
        ], [['root', 'Тоника C и октава'], ['target', 'Терция и квинта']], { lenses: ['notes', 'chord-tones'], showFingers: true }),
        listen: 'C2, E2, G2, C3 — арпеджио',
      },
      name: 'Три ноты через терцию — **трезвучие**: 1–3–5. В C мажорном это C, E, G. В минорном терция малая: 1–{d:♭3}–5, Am — A, C, E.',
      facts: ['Аккорд обозначают буквой: C — мажорное трезвучие, Cm — минорное.', 'Аккорды тональности пишут римскими цифрами: в C мажоре F — {r:IV}, Am — {r:vi}.'],
      why: 'Тоны аккорда — надёжные ноты: играешь 1, 3 или 5 — и бас совпадает с гармонией.',
      related: ['arpeggio-1358', 'root-five-eight', 'thirds'],
      check: check('Где терция от {p:E/8|C2}?', ['{p:A/7}', '{p:A/8}', '{p:A/10}'], 0, '{p:A/7|E2} — большая терция. {p:A/8|F2} — кварта, {p:A/10|G2} — квинта.'),
    }),
  },
  {
    id: 'slash-chord', level: 3, later: true, title: 'Слеш-аккорд',
    summary: 'C/E — аккорд C, а в басу E: буква после черты — нота баса.',
    keywords: ['слеш', 'аккорд', 'c/e', 'бас', 'под', 'аккордом', 'обращение'],
    brief: briefCard({
      play: { text: 'Под аккорд C вместо тоники сыграй {p:A/7|E2} — его терцию. Звучит мягче и «в движении».', board: null },
      name: '**C/E** — аккорд C, а в басу E. Буква после черты — нота баса. В первой версии — чтобы узнать обозначение в песне; уровень «Аккорды» придёт позже.',
      why: 'Слеш прямо говорит басисту, какую ноту играть, когда это не тоника.',
      related: ['arpeggio-1358'],
      check: check('Что играет бас на G/B?', ['B', 'G', 'D'], 0, 'Нота после черты — нота баса.'),
    }),
  },

  /* ===== Ритм ===== */
  {
    id: 'beat-bar', level: 'rhythm', title: 'Доля и такт',
    summary: 'Доля — ровный шаг счёта, такт — группа долей.',
    keywords: ['доля', 'такт', '4/4', 'размер', 'метроном', 'счёт', 'сильная'],
    brief: briefCard({
      play: { text: 'Включи метроном на 72 и сыграй {p:A/0|A1} на каждый щелчок, на «раз» — чуть громче.', board: null },
      name: '**Доля** — ровный шаг счёта, под который хочется топать ногой. **Такт** — группа долей; в 4/4 их четыре, первая — сильная.',
      why: 'Бас вместе с барабаном держит доли — от этого зависит, качает ли песня.',
      related: ['chromatic-position'],
      sections: [RHYTHM_SECTION],
      check: check('Сколько долей в такте 4/4?', ['4', '8', '2'], 0, 'Верхняя цифра размера — число долей.'),
    }),
  },
  {
    id: 'counting', level: 'rhythm', title: 'Счёт «1 и 2 и»',
    summary: 'Восьмые делят долю пополам: цифра — на долю, «и» — посередине.',
    keywords: ['счёт', '1', 'и', '2', 'восьмые', 'доля', 'пополам'],
    brief: briefCard({
      play: { text: 'Считай вслух «1 и 2 и 3 и 4 и» и играй {p:E/5|A1} на каждый слог.', board: null },
      name: 'Восьмые делят долю пополам. Цифра — на долю, «и» — посередине между долями. «Связка соседних форм» — 16 восьмых, два такта.',
      why: 'Счёт вслух держит ровность, когда ноты меняются быстрее доли.',
      related: ['connect-forms', 'chromatic-position'],
      check: check('Сколько восьмых в такте 4/4?', ['8', '4', '16'], 0, 'Четыре доли по две восьмые.'),
    }),
  },

  /* ===== Чтение ===== */
  {
    id: 'tab', level: 'reading', title: 'TAB и чего в нём нет',
    summary: 'TAB — линии струн и цифры ладов, без длительностей, пауз и пальцев.',
    keywords: ['tab', 'табулатура', 'линии', 'струны', 'лад', 'цифра', 'длительность'],
    brief: briefCard({
      play: { text: 'Прочитай: на нижней линии 5 и 8 — это {p:E/5|A1} и {p:E/8|C2}. Сыграй их.', board: null },
      name: '**TAB** — четыре линии, сверху G, снизу E; цифра — лад. Чего в нём нет: длительностей, пауз и пальцев. Ритм бери из счёта над TAB или из нот.',
      why: 'TAB быстро показывает, где играть; что и когда — дополняют счёт и ноты.',
      related: ['connect-forms'],
      sections: [SONGS_SECTION],
      check: check('Цифра 7 на второй линии сверху — это…', ['{p:D/7}', '{p:A/7}', '{p:G/7}'], 0, 'Линии сверху вниз: G, D, A, E.'),
    }),
  },
  {
    id: 'bass-clef', level: 'reading', title: 'Басовый ключ',
    summary: 'Бас пишут на октаву выше звучания: открытая E записана как E2, а звучит E1.',
    keywords: ['басовый', 'ключ', 'ноты', 'нотоносец', 'октава', 'выше', 'звучания', 'запись'],
    brief: briefCard({
      play: { text: 'Сыграй открытую {p:E/0|E1} и найди её в нотах экрана игры: первая добавочная линейка под нотоносцем.', board: null },
      name: 'Бас пишут в **басовом ключе** на октаву выше, чем он звучит, — так ноты не уходят далеко под нотоносец. Открытая E записана как E2 на первой добавочной линейке снизу, а звучит E1.',
      why: 'Иначе почти каждую ноту баса пришлось бы писать на нескольких добавочных линейках.',
      related: ['note-all-positions'],
      sections: [SONGS_SECTION],
      check: check('В нотах для баса записано A2. Что звучит?', ['A1 — открытая A', 'A2', 'A3'], 0, 'Запись на октаву выше звучания.'),
    }),
  },
]);

export interface OctaveExample {
  /** По-русски, например «ми контроктавы». */
  readonly russian: string;
  readonly positionId: string;
  /** Научная запись звучащей высоты, например `E1`. */
  readonly label: string;
  readonly comment?: string;
}
export interface OctaveRow {
  /** Научная запись диапазона: `C1–B1` или `C4`. */
  readonly scientific: string;
  readonly octave: number;
  readonly russian: string;
  readonly examples: readonly OctaveExample[];
  readonly note?: string;
}

/** Таблица соответствия научной нумерации октав и русских названий (R-027, карточка «Номера октав»). */
export const OCTAVE_TABLE: { readonly caption: string; readonly rows: readonly OctaveRow[] } = deepFreeze({
  caption: 'Научная нумерация — основная в приложении. Русские названия — для книг и учителей.',
  rows: [
    { scientific: 'C1–B1', octave: 1, russian: 'контроктава', examples: [
      { russian: 'ми контроктавы', positionId: 'E:0', label: 'E1', comment: 'открытая E' },
      { russian: 'ля контроктавы', positionId: 'A:0', label: 'A1', comment: 'открытая A' },
    ] },
    { scientific: 'C2–B2', octave: 2, russian: 'большая октава', examples: [
      { russian: 'ре большой октавы', positionId: 'D:0', label: 'D2', comment: 'открытая D' },
      { russian: 'соль большой октавы', positionId: 'G:0', label: 'G2', comment: 'открытая G' },
      { russian: 'до большой октавы', positionId: 'A:3', label: 'C2' },
    ] },
    { scientific: 'C3–B3', octave: 3, russian: 'малая октава', examples: [
      { russian: 'до малой октавы', positionId: 'G:5', label: 'C3' },
      { russian: 'соль малой октавы', positionId: 'G:12', label: 'G3' },
    ] },
    { scientific: 'C4', octave: 4, russian: 'первая октава', examples: [
      { russian: 'до первой октавы', positionId: 'G:17', label: 'C4', comment: 'если на грифе есть 17-й лад' },
    ], note: 'Это «до» в середине клавиатуры фортепиано.' },
  ],
});

/** Пояснение B/H (карточка «Номера октав»). */
export const B_H_NOTE: { readonly title: string; readonly text: string } = deepFreeze({
  title: 'B или H?',
  text: 'В приложении **B = си**, как в английской записи. В части русской (и в немецкой) традиции си обозначают **H**, а буквой B — си-бемоль. Увидел в книге H — это наша B; их B — наша B♭.',
});

/** «Три вида подписей — не путай» (карточка «Ступень»). */
export const LABEL_KINDS: { readonly title: string; readonly items: readonly { readonly kind: 'degree' | 'roman' | 'finger'; readonly sample: string; readonly text: string }[] } = deepFreeze({
  title: 'Три вида подписей — не путай',
  items: [
    { kind: 'degree', sample: '♭3', text: 'ступень — номер от тоники; на грифе внутри кружка' },
    { kind: 'roman', sample: 'vi', text: 'римская цифра — аккорд на ступени: Am в C мажоре' },
    { kind: 'finger', sample: '1', text: 'палец левой руки — маленькая цифра у кружка' },
  ],
});

const BY_ID = new Map(REFERENCE_CONCEPTS.map(concept => [concept.id, concept]));

export function getConcept(id: string): ReferenceConcept | null {
  return BY_ID.get(id) ?? null;
}

/** Карточка для ссылки «Почему…» с экрана игры. */
export function conceptForExerciseConcept(id: ConceptId): ReferenceConcept | null {
  return REFERENCE_CONCEPTS.find(concept => concept.exerciseConcepts?.includes(id)) ?? null;
}

/** Мини-гриф понятия: у полной карточки — всегда, у короткой — если есть. */
export function conceptBoard(concept: ReferenceConcept): ConceptBoard | null {
  return concept.full?.play ?? concept.brief?.play.board ?? null;
}

const normalize = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/♭/g, 'b').replace(/♯/g, '#');
const HAYSTACK = new Map(REFERENCE_CONCEPTS.map(concept =>
  [concept.id, normalize([concept.title, concept.summary, ...concept.keywords].join(' '))]));

/** Поиск по названию, короткому описанию и ключевым словам: все слова запроса, без учёта регистра и ё/е. */
export function findConcepts(query: string): readonly ReferenceConcept[] {
  if (typeof query !== 'string') throw new TypeError('Запрос поиска должен быть строкой.');
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return REFERENCE_CONCEPTS;
  return Object.freeze(REFERENCE_CONCEPTS.filter(concept => {
    const haystack = HAYSTACK.get(concept.id)!;
    return words.every(word => haystack.includes(word));
  }));
}

const STRING_IDS: readonly StringId[] = ['E', 'A', 'D', 'G'];
const TOKEN = /\*\*(.+?)\*\*|\{([pdrf]):([^{}]+)\}/g;

/** Разбирает разметку текста карточки на части для отображения. */
export function parseConceptText(text: string): readonly ConceptTextPart[] {
  if (typeof text !== 'string') throw new TypeError('Текст карточки должен быть строкой.');
  const parts: ConceptTextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > last) parts.push({ kind: 'text', text: text.slice(last, match.index) });
    last = match.index + match[0].length;
    if (match[1] !== undefined) { parts.push({ kind: 'strong', text: match[1] }); continue; }
    const [, , kind, body] = match;
    if (kind === 'd') parts.push({ kind: 'degree', text: body });
    else if (kind === 'r') parts.push({ kind: 'roman', text: body });
    else if (kind === 'f') parts.push({ kind: 'finger', text: body });
    else parts.push(parsePositionToken(body));
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return deepFreeze(parts);
}

function parsePositionToken(body: string): ConceptTextPart {
  const match = /^([EADG])\/(\d{1,2})(?:\|(.+))?$/.exec(body);
  if (!match) throw new RangeError(`Некорректная позиция в тексте карточки: ${body}.`);
  const string = match[1] as StringId;
  const fret = Number(match[2]);
  if (!STRING_IDS.includes(string) || fret > 24) throw new RangeError(`Некорректная позиция в тексте карточки: ${body}.`);
  return { kind: 'position', positionId: `${string}:${fret}`, string, fret, label: match[3] ?? null };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
