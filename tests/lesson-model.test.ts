import { describe, expect, it } from 'vitest';
import { createExerciseSpec } from '../src/exercises';
import { completeStep, createPlan, planFromTemplate, type DayPlan } from '../src/practice/plan';
import type { PracticeRecord } from '../src/practice/results';
import type { UserExercise } from '../src/practice/library';
import { exerciseStructure, formatDegree, formatPosition, materialLabel } from '../src/ui/lesson/material';
import {
  appendTemplate, basicsBadge, basicsCourse, checkContent, conceptsOfLevel, currentBasicsStep, DEFAULT_LIBRARY, exerciseBoard, exerciseKey,
  heroModel, isPentatonic, libraryModel, nextStepId, planRows, planStrip, recommendationCards, searchBasics, setStepMinutes, stepTitle,
  togglePlanContent, toggleStepEar, libraryItems, configuredItems, materialId, searchMatches,
} from '../src/ui/lesson/model';

const today = '2026-11-12';
const play = (templateId: Parameters<typeof createExerciseSpec>[0], assessment: 'clean' | 'errors' | 'slow', bpm: number, localDate: string, time: string, params = {}): PracticeRecord => ({
  kind: 'play', id: `play-${localDate}-${time}`, exerciseKey: exerciseKey(createExerciseSpec(templateId, params)), title: templateId, spec: createExerciseSpec(templateId, params), assessment, bpm, activeMs: 60000, localDate, occurredAt: `${localDate}T${time}:00.000Z`, view: 'both', wholePass: true,
});
const records: PracticeRecord[] = [
  play('chromatic-position', 'clean', 84, '2026-11-10', '18:00'),
  play('arpeggio-1358', 'clean', 69, '2026-11-11', '18:10'),
  play('connect-forms', 'errors', 76, '2026-11-11', '18:20'),
  play('chromatic-position', 'clean', 80, today, '17:00'),
];
const continuePlan = (): DayPlan => { const plan = planFromTemplate(today, 'standard'); return completeStep(plan, plan.steps[0].id); };

describe('подписи материала (контрольные примеры VIS-10 r2)', () => {
  it('пишет позиции как E/8 и ступени со знаками', () => {
    expect(formatPosition('E:8')).toBe('E/8');
    expect(formatDegree('b7')).toBe('♭7');
    expect(formatDegree('#4')).toBe('♯4');
  });
  it('EX-1, EX-2, EX-3 и пентатоника C / Am', () => {
    expect(materialLabel(createExerciseSpec('connect-forms'))).toBe('Am · формы A→B');
    // EX-2: арпеджио C-мажор от E/8.
    expect(materialLabel(createExerciseSpec('arpeggio-1358'))).toBe('C · от E/8');
    expect(materialLabel(createExerciseSpec('chromatic-position'))).toBe('позиция 5 · палец на лад');
    expect(materialLabel(createExerciseSpec('pentatonic-relative'))).toBe('C / Am · форма A');
    expect(materialLabel(createExerciseSpec('pentatonic-form', { shapeId: 'penta-b' }))).toBe('Am · минорная пентатоника · форма B');
  });
  it('ступени для проверки есть только у материала одной тоники', () => {
    expect(exerciseStructure(createExerciseSpec('pentatonic-form'))?.id).toBe('minor-pentatonic');
    expect(exerciseStructure(createExerciseSpec('root-five-eight'))?.id).toBe('major-triad');
    for (const id of ['chromatic-position', 'position-shift', 'note-all-positions', 'octaves', 'form-transpose', 'cycle-fourths'] as const) {
      expect(exerciseStructure(createExerciseSpec(id))).toBeNull();
      expect(checkContent(createExerciseSpec(id))).toBeNull();
    }
  });
  it('мини-гриф связки A→B: четыре общие позиции E/8, A/7, D/7, G/7', () => {
    const board = exerciseBoard(createExerciseSpec('connect-forms'));
    expect(board.notes.filter(note => note.kind === 'shared').map(note => note.id).sort()).toEqual(['A:7', 'D:7', 'E:8', 'G:7']);
    // Тоники A в формах A (лады 5–8) и B (лады 7–10): E/5 и D/7; D/7 — ещё и общая позиция.
    expect(board.notes.filter(note => note.root).map(note => note.id).sort()).toEqual(['D:7', 'E:5']);
    expect(board.notes.find(note => note.id === 'D:7')!.kind).toBe('shared');
    expect(board.notes.map(note => note.id).sort()).toEqual(['A:10', 'A:5', 'A:7', 'D:10', 'D:5', 'D:7', 'E:10', 'E:5', 'E:8', 'G:5', 'G:7', 'G:9']);
    expect(board.legend.map(item => item.kind)).toEqual(['a', 'b', 'shared', 'root']);
  });
  it('«одни ноты — разные тоники»: A — тоника минора, C — тоника параллельного мажора', () => {
    const board = exerciseBoard(createExerciseSpec('pentatonic-relative'));
    // Форма A пентатоники Am, лады 5–8: A на E/5 и D/7, C на E/8 и G/5.
    expect(board.notes.filter(note => note.kind === 'root').map(note => note.id).sort()).toEqual(['D:7', 'E:5']);
    expect(board.notes.filter(note => note.kind === 'b').map(note => note.id).sort()).toEqual(['E:8', 'G:5']);
    expect(board.notes.filter(note => note.kind === 'plain')).toHaveLength(4);
    expect(board.legend.map(item => item.label)).toEqual(['тоника C · C мажорная пентатоника', 'тоника A · A минорная пентатоника']);
  });
});

describe('план на сегодня', () => {
  it('«+ в план» добавляет шаг с минутами шаблона, повторное нажатие снимает незавершённые шаги', () => {
    const plan = continuePlan();
    const content = { kind: 'exercise' as const, spec: createExerciseSpec('pentatonic-relative') };
    const added = togglePlanContent(plan, content);
    expect(added.action).toBe('added');
    expect(added.plan.steps).toHaveLength(5);
    expect(added.plan.steps.at(-1)).toMatchObject({ minutes: 4, status: 'pending' });
    expect(new Set(added.plan.steps.map(step => step.id)).size).toBe(5);
    const removed = togglePlanContent(added.plan, content);
    expect(removed.action).toBe('removed');
    expect(removed.plan.steps.map(step => step.id)).toEqual(plan.steps.map(step => step.id));
  });
  it('другой материал того же шаблона — отдельный шаг: форма B не вытесняет форму A (D-049)', () => {
    const formA = { kind: 'exercise' as const, spec: createExerciseSpec('pentatonic-form') };
    const formB = { kind: 'exercise' as const, spec: createExerciseSpec('pentatonic-form', { shapeId: 'penta-b' }) };
    const withA = togglePlanContent(createPlan('2026-11-12'), formA);
    const both = togglePlanContent(withA.plan, formB);
    expect(both.action).toBe('added');
    expect(both.plan.steps.map(step => step.content.kind === 'exercise' && (step.content.spec.params as { shapeId: string }).shapeId)).toEqual(['penta-a', 'penta-b']);
  });
  it('снятие не трогает выполненный шаг того же шаблона', () => {
    const plan = continuePlan();
    const chromatic = { kind: 'exercise' as const, spec: createExerciseSpec('chromatic-position') };
    // Шаг хроматики выполнен, поэтому «+ в план» добавляет новый, а не снимает выполненный.
    const result = togglePlanContent(plan, chromatic);
    expect(result.action).toBe('added');
    expect(result.plan.steps.filter(step => step.content.kind === 'exercise' && step.content.spec.templateId === 'chromatic-position').map(step => step.status)).toEqual(['done', 'pending']);
  });
  it('id шага не повторяется', () => {
    const plan = createPlan(today, [{ id: 'step-2', content: { kind: 'exercise', spec: createExerciseSpec('octaves') }, minutes: 3 }]);
    expect(nextStepId(plan)).toBe('step-3');
  });
  it('шаблон плана добавляется один раз', () => {
    const empty = createPlan(today);
    const once = appendTemplate(empty, 'standard');
    expect(once.steps).toHaveLength(4);
    expect(once.steps[0].status).toBe('current');
    expect(appendTemplate(once, 'standard').steps).toHaveLength(4);
  });
  it('минуты 1–60 и «+ слух» только у проверки', () => {
    const plan = continuePlan();
    expect(setStepMinutes(plan, plan.steps[1].id, 0).steps[1].minutes).toBe(1);
    expect(setStepMinutes(plan, plan.steps[1].id, 99).steps[1].minutes).toBe(60);
    const check = plan.steps[3];
    const toggled = toggleStepEar(plan, check.id);
    expect(toggled.steps[3].content.kind === 'check' && toggled.steps[3].content.spec.ear).toBe(true);
    expect(() => toggleStepEar(plan, plan.steps[1].id)).toThrow(RangeError);
  });
  it('строки плана: отметка выполненного шага за дату плана, темп и слух', () => {
    const rows = planRows(continuePlan(), records);
    expect(rows[0]).toMatchObject({ status: 'done', mark: 'Чисто' });
    expect(rows[1]).toMatchObject({ status: 'current', title: 'Связка соседних форм', meta: 'Am · формы A→B · 76 BPM', minutes: 5 });
    expect(rows[3]).toMatchObject({ check: true, ear: false, earAvailable: true, title: 'Проверь себя: назови ступень' });
    expect(rows[1].first).toBe(true);
    expect(rows[3].last).toBe(true);
  });
  it('плашка библиотеки перечисляет шаги и выделяет текущий', () => {
    const strip = planStrip(continuePlan());
    expect(strip).toMatchObject({ count: 4, minutes: 15, done: 3 });
    expect(strip.items.filter(item => item.current).map(item => item.title)).toEqual(['Связка соседних форм']);
  });
});

describe('«Сегодня»', () => {
  it('продолжает текущий шаг плана с прошлым темпом и отметкой', () => {
    const hero = heroModel({ plan: continuePlan(), records, userExercises: [], firstRun: false });
    expect(hero.mode).toBe('continue');
    expect(hero.eyebrow).toBe('Продолжить · шаг 2 из 4 плана');
    expect(hero.stepId).toBe('standard-2');
    expect(hero.stats).toEqual([{ value: '76', label: 'темп в прошлый раз' }, { value: 'С ошибками', label: 'твоя отметка' }]);
  });
  it('без плана продолжает последнее сыгранное, без истории — предлагает собрать план', () => {
    expect(heroModel({ plan: createPlan(today), records, userExercises: [], firstRun: false })).toMatchObject({ mode: 'continue', eyebrow: 'Продолжить · с прошлого занятия', stepId: null });
    expect(heroModel({ plan: createPlan(today), records: [], userExercises: [], firstRun: false }).mode).toBe('empty');
  });
  it('первый запуск — «Начни с „Основ“» без нулевой статистики', () => {
    const hero = heroModel({ plan: planFromTemplate(today, 'firstRun'), records: [], userExercises: [], firstRun: true });
    expect(hero).toMatchObject({ mode: 'first-run', title: 'Начни с «Основ»', stats: [] });
  });
  it('три рекомендации с причиной, одна — про пентатонику', () => {
    for (const history of [records, [], records.slice(0, 1)]) {
      const cards = recommendationCards(history, history.length === 0);
      expect(cards).toHaveLength(3);
      expect(cards.every(card => card.reason.length > 10)).toBe(true);
      expect(cards.some(card => card.content?.kind === 'exercise' && isPentatonic(card.content.spec))).toBe(true);
    }
    expect(recommendationCards(records.slice(0, 3), false)[0]).toMatchObject({ eyebrow: 'Следующий шаг', title: 'Связка B → C' });
  });
});

describe('библиотека', () => {
  const state = { plan: continuePlan(), records, userExercises: [] as UserExercise[], playFrom: null };
  it('22 шаблона в 9 категориях; рекомендуемое — первым', () => {
    const model = libraryModel(state, DEFAULT_LIBRARY);
    expect(model.cards).toHaveLength(22);
    expect(model.categories[0]).toMatchObject({ id: 'all', count: 22 });
    expect(model.categories.slice(1).reduce((sum, category) => sum + category.count, 0)).toBe(22);
    expect(model.categories).toHaveLength(10);
    expect(model.cards[0]).toMatchObject({ id: 'tpl:pentatonic-relative', featured: true });
    expect(model.cards.find(card => card.id === 'tpl:connect-forms')).toMatchObject({ inPlan: true, played: true, minutes: 5 });
    expect(model.cards.find(card => card.id === 'tpl:chromatic-position')).toMatchObject({ inPlan: false, playedToday: true, bestBpm: 84 });
  });
  it('фильтры статуса, структуры и понятия; «Играть от» не фильтрует', () => {
    expect(libraryModel(state, { ...DEFAULT_LIBRARY, status: 'played' }).cards.map(card => card.id).sort()).toEqual(['tpl:arpeggio-1358', 'tpl:chromatic-position', 'tpl:connect-forms']);
    expect(libraryModel(state, { ...DEFAULT_LIBRARY, structureId: 'major-pentatonic' }).cards).toHaveLength(0);
    expect(libraryModel(state, { ...DEFAULT_LIBRARY, structureId: 'minor-pentatonic' }).cards.map(card => card.id)).toContain('tpl:pentatonic-relative');
    expect(libraryModel(state, { ...DEFAULT_LIBRARY, concept: 'shared-notes' }).cards.map(card => card.id).sort()).toEqual(['tpl:connect-forms', 'tpl:pentatonic-neck']);
    const fromD = libraryModel({ ...state, playFrom: 'D' }, DEFAULT_LIBRARY);
    expect(fromD.cards).toHaveLength(22);
    expect(fromD.cards.find(card => card.id === 'tpl:pentatonic-form')!.material).toBe('Dm · минорная пентатоника · форма A');
  });
  it('свои упражнения — отдельная категория с ключом user:', () => {
    const own: UserExercise = { version: 'user-exercise-v1', id: 'mine', name: 'Моя форма <B>', spec: createExerciseSpec('pentatonic-form', { root: 'E' }), createdAt: '2026-11-12T10:00:00.000Z' };
    const model = libraryModel({ ...state, userExercises: [own] }, { ...DEFAULT_LIBRARY, category: 'user' });
    expect(model.cards).toEqual([expect.objectContaining({ key: 'user:mine', title: 'Моя форма <B>', builtin: false })]);
    expect(exerciseKey(own.spec, [own])).toBe('user:mine');
    expect(stepTitle({ kind: 'exercise', spec: own.spec }, [own])).toBe('Моя форма <B>');
    expect(libraryItems(null, [own])).toHaveLength(23);
  });
  it('настроенный материал карточки важнее «Играть от»: ключ, «в плане», лучший темп и то, что сохраняет ☆ (D-049)', () => {
    const formB = createExerciseSpec('pentatonic-form', { root: 'E', shapeId: 'penta-b' });
    const cardSpecs = new Map([['tpl:pentatonic-form', formB]]);
    const plan = togglePlanContent(createPlan(today), { kind: 'exercise', spec: createExerciseSpec('pentatonic-form') }).plan;
    const withB = { ...state, plan, playFrom: 'D', records: [...records, play('pentatonic-form', 'clean', 92, '2026-11-11', '19:00', { root: 'E', shapeId: 'penta-b' })] };
    const card = libraryModel(withB, DEFAULT_LIBRARY, cardSpecs).cards.find(item => item.id === 'tpl:pentatonic-form')!;
    expect(card).toMatchObject({ key: 'builtin:pentatonic-form.E.minor-pentatonic.penta-b', configured: true, inPlan: false, bestBpm: 92, material: 'Em · минорная пентатоника · форма B' });
    expect(card.content).toEqual({ kind: 'exercise', spec: formB });
    // Форма A в плане отмечена только на ненастроенной карточке, форма B — другой материал.
    expect(libraryModel({ ...withB, playFrom: null }, DEFAULT_LIBRARY).cards.find(item => item.id === 'tpl:pentatonic-form')).toMatchObject({ inPlan: true, configured: false, bestBpm: null });
    // ☆ ищет материал по id карточки, а не по ключу, — сохраняется настроенная форма B.
    expect(configuredItems('D', [], cardSpecs).find(item => item.id === 'tpl:pentatonic-form')!.spec).toEqual(formB);
    // Настройка чужого шаблона под id карточки не применяется.
    expect(configuredItems(null, [], new Map([['tpl:octaves', formB]])).find(item => item.id === 'tpl:octaves')!.spec.templateId).toBe('octaves');
  });
});

describe('«Основы»', () => {
  it('во всём курсе у каждого понятия свой материал упражнения (D-049)', () => {
    const owner = new Map<string, string>();
    for (const step of basicsCourse([]).flatMap(level => level.steps)) {
      if (step.kind !== 'exercise' || step.content?.kind !== 'exercise') continue;
      const id = materialId(step.content.spec);
      expect(owner.get(id) ?? step.conceptId, `${id}: ${owner.get(id)} и ${step.conceptId}`).toBe(step.conceptId);
      owner.set(id, step.conceptId);
    }
    expect(owner.size).toBeGreaterThan(20);
  });
  it('уровни R-027 и шаги «понятие → упражнение → проверка»', () => {
    const levels = basicsCourse([]);
    expect(levels.map(level => level.key)).toEqual(['0', '1', '2', '3', 'rhythm', 'reading']);
    expect(levels.filter(level => level.lane === 'side').map(level => level.key)).toEqual(['rhythm', 'reading']);
    for (const level of levels) {
      for (let index = 0; index < level.steps.length; index += 3) {
        expect(level.steps.slice(index, index + 3).map(step => step.kind)).toEqual(['concept', 'exercise', 'check']);
      }
    }
    expect(levels.flatMap(level => level.steps).some(step => step.title.includes('Слеш'))).toBe(false);
  });
  it('первый запуск: уровень 0 текущий, ничего не выполнено и ничего не заблокировано', () => {
    const levels = basicsCourse([]);
    expect(levels[0].status).toBe('current');
    expect(levels.slice(1).every(level => level.status === 'open')).toBe(true);
    expect(levels.every(level => level.doneCount === 0)).toBe(true);
    expect(currentBasicsStep(levels[0])).toMatchObject({ kind: 'concept', conceptId: 'semitone' });
    expect(levels[0].total).toBe(levels[0].steps.filter(step => !step.title.startsWith('Вопрос карточки')).length);
    expect(basicsBadge(levels)).toBe('ур. 0');
  });
  it('пентатоника и общие ноты идут на уровне 2 раньше гамм', () => {
    expect(conceptsOfLevel(2).map(concept => concept.id)).toEqual(['degree', 'pentatonic', 'shared-notes', 'relative-keys', 'major-formula', 'natural-minor', 'blues-scale']);
  });
  it('сыгранное упражнение отмечает шаг и его понятие', () => {
    const levels = basicsCourse(records);
    const semitone = levels[0].steps.filter(step => step.conceptId === 'semitone');
    expect(semitone.map(step => step.done)).toEqual([true, true, false]);
    expect(levels[0].status).toBe('current');
    expect(levels[0].doneCount).toBeGreaterThan(0);
    // Вопрос карточки не хранит результат — текущим становится следующее понятие, а не он.
    expect(currentBasicsStep(levels[0])).toMatchObject({ kind: 'concept', conceptId: 'accidentals' });
  });
  it('проверка шага существует только для материала со ступенями, иначе — вопрос карточки', () => {
    for (const step of basicsCourse([]).flatMap(level => level.steps).filter(item => item.kind === 'check')) {
      if (step.content) expect(step.content.kind === 'check' && exerciseStructure(step.content.spec.exercise)).toBeTruthy();
      else expect(step.title).toMatch(/^Вопрос карточки/);
    }
  });
  it('поиск находит понятия и упражнения', () => {
    const hits = searchBasics('пентатоника', basicsCourse([]), libraryItems(null, []));
    expect(hits.some(hit => hit.kind === 'concept' && hit.title === 'Пентатоника')).toBe(true);
    expect(hits.some(hit => hit.kind === 'exercise' && hit.title === 'Пентатоника по всему грифу')).toBe(true);
    expect(searchBasics('   ', basicsCourse([]), [])).toEqual([]);
  });
  it('поиск по началу слова находит цели, понятия и упражнения: «минорная гамма», «минорную гамму», «паук», «блюз»', () => {
    const find = (query: string) => searchBasics(query, basicsCourse([]), libraryItems(null, []));
    for (const query of ['минорная гамма', 'минорную гамму']) {
      const hits = find(query);
      expect(hits.filter(hit => hit.kind === 'goal').map(hit => hit.title), query).toContain('Натуральный минор');
      expect(hits.some(hit => hit.kind === 'concept'), query).toBe(true);
    }
    expect(find('гамма').filter(hit => hit.kind === 'goal').map(hit => hit.title)).toEqual(expect.arrayContaining(['Мажорная гамма', 'Натуральный минор']));
    expect(find('паук').map(hit => hit.title)).toEqual(expect.arrayContaining(['Четыре пальца', 'Паук: четыре пальца по грифу']));
    expect(find('блюз').map(hit => hit.title)).toEqual(expect.arrayContaining(['Блюз', 'Блюзовая гамма']));
    expect(find('септаккорд').some(hit => hit.kind === 'exercise' && hit.title === 'Арпеджио септаккорда 1–3–5–7')).toBe(true);
    // Короткое слово ищется только как подстрока; длинное — по основе.
    expect(searchMatches('гам', 'гамма')).toBe(true);
    expect(searchMatches('мин', 'минорная')).toBe(true);
    expect(searchMatches('минорную', 'минорная')).toBe(true);
    expect(searchMatches('мажорную', 'минорная')).toBe(false);
  });
});
