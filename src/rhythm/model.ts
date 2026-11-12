export const SOUND_LABELS = Object.freeze({
  kick: 'Бочка', snare: 'Малый', closedHat: 'Закрытый хэт', openHat: 'Открытый хэт',
  clap: 'Хлопок', shaker: 'Шейкер', rim: 'Римшот', ride: 'Райд',
});
export const RHYTHM_KITS = ['wood', 'classic', 'electronic', 'bell', 'clave', 'drum'] as const;
export const RHYTHM_PATTERN_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
export const RHYTHM_PATTERN_LENGTHS = [1, 2, 3, 4] as const;
export const RHYTHM_STEPS_PER_BAR = 16;
export type RhythmSound = keyof typeof SOUND_LABELS;
export type RhythmKit = typeof RHYTHM_KITS[number];
export type RhythmPatternId = typeof RHYTHM_PATTERN_IDS[number];
export type RhythmPatternBars = typeof RHYTHM_PATTERN_LENGTHS[number];
export type RhythmStep = 0 | 1 | 2;
export type RhythmDivision = 1 | 2 | 3 | 4;
export type RhythmBpmUnit = 'quarter' | 'eighth' | 'dotted-quarter';
export type RhythmSwingMode = 'eighth' | 'sixteenth';
export interface RhythmMeter { readonly beats: number; readonly denominator: 4 | 8; readonly groups: readonly number[] }
export interface RhythmTraining {
  readonly silentEnabled: boolean; readonly soundBars: number; readonly silentBars: number;
  readonly rampEnabled: boolean; readonly stepBpm: number; readonly everyBars: number; readonly targetBpm: number;
}
export interface RhythmMetronome {
  readonly bpm: number; readonly bpmUnit: RhythmBpmUnit; readonly meter: RhythmMeter;
  readonly accents: readonly RhythmStep[]; readonly division: RhythmDivision; readonly substeps: readonly boolean[];
  readonly swing: number; readonly swingMode: RhythmSwingMode; readonly kit: RhythmKit;
  readonly accentVolume: number; readonly clickVolume: number; readonly subdivisionVolume: number;
  readonly countIn: boolean; readonly training: RhythmTraining;
}
export interface RhythmPreferences { readonly view: 'metronome' | 'rhythm'; readonly master: number; readonly metronome: RhythmMetronome }
export interface RhythmVelocityDefaults { readonly hit: number; readonly accent: number }
export const DEFAULT_RHYTHM_VELOCITY: RhythmVelocityDefaults = Object.freeze({ hit: 72, accent: 100 });
export interface RhythmChannel {
  readonly id: string; readonly name: string; readonly sound: RhythmSound;
  readonly volume: number; readonly muted: boolean; readonly solo: boolean;
  readonly velocityDefaults: RhythmVelocityDefaults;
}
export interface RhythmPatternLane { readonly channelId: string; readonly steps: readonly RhythmStep[]; readonly velocities: readonly number[] }
export interface RhythmPattern { readonly id: RhythmPatternId; readonly name: string; readonly bars: RhythmPatternBars; readonly lanes: readonly RhythmPatternLane[] }
export interface RhythmClip { readonly id: string; readonly patternId: RhythmPatternId }
export interface RhythmProject {
  readonly id: string; readonly name: string; readonly createdAt: string; readonly updatedAt: string;
  readonly bpm: number; readonly swing: number; readonly swingMode: RhythmSwingMode;
  readonly channels: readonly RhythmChannel[]; readonly patterns: readonly RhythmPattern[]; readonly chain: readonly RhythmClip[];
  readonly activePatternId: RhythmPatternId; readonly scope: 'pattern' | 'chain'; readonly repeat: 'once' | 'loop';
  readonly countIn: boolean; readonly overlay: boolean;
}
export interface RhythmPlaybackConfig { readonly preferences: RhythmPreferences; readonly project?: RhythmProject }

function invalid(message: string): never { throw new RangeError(message); }
function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(`${label}: нужен обычный объект.`);
  const data = value as Record<string, unknown>;
  const own = Reflect.ownKeys(data);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(data, key)!, 'value'))) {
    invalid(`${label}: неизвестные, отсутствующие или вычисляемые поля.`);
  }
  return data;
}
function list(value: unknown, min: number, max: number, label: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < min || value.length > max) invalid(`${label}: недопустимая длина массива.`);
  const own = Reflect.ownKeys(value);
  if (own.length !== value.length + 1 || own.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value')))) {
    invalid(`${label}: нужен плотный массив без дополнительных полей.`);
  }
  return value;
}
function number(value: unknown, min: number, max: number, label: string, integer = true): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) invalid(`${label}: число вне допустимого диапазона.`);
  return value;
}
function choice<T extends string | number>(value: unknown, options: readonly T[], label: string): T {
  if (!options.includes(value as T)) invalid(`${label}: неизвестное значение.`);
  return value as T;
}
function flag(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') invalid(`${label}: требуется true или false.`);
  return value;
}
function name(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 80 || !value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) invalid(`${label}: недопустимое название.`);
  return value;
}
function id(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{1,96}$/u.test(value)) invalid(`${label}: недопустимый идентификатор.`);
  return value;
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid('Проект: дата должна быть в формате ISO UTC.');
  return value;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function unique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) invalid(`${label}: идентификаторы должны быть уникальны.`);
}
export function defaultRhythmMeter(beats: number, denominator: 4 | 8): RhythmMeter {
  number(beats, 2, 12, 'Число долей'); choice(denominator, [4, 8], 'Знаменатель размера');
  let groups = [beats];
  if (denominator === 8) {
    if (beats === 5) groups = [2, 3];
    else if (beats === 7) groups = [2, 2, 3];
    else if ([6, 9, 12].includes(beats)) groups = Array<number>(beats / 3).fill(3);
  }
  return freeze({ beats, denominator, groups });
}
export function defaultRhythmAccents(meter: RhythmMeter): RhythmStep[] {
  const accents: RhythmStep[] = Array<RhythmStep>(meter.beats).fill(1);
  let index = 0;
  for (const group of meter.groups) { accents[index] = 2; index += group; }
  return accents;
}
export function allowsDottedQuarter(meter: RhythmMeter): boolean {
  return meter.denominator === 8 && meter.groups.length > 0 && meter.groups.every(group => group === 3);
}
export function validateRhythmMeter(value: unknown): RhythmMeter {
  const data = record(value, ['beats', 'denominator', 'groups'], 'Размер');
  const beats = number(data.beats, 2, 12, 'Число долей');
  const denominator = choice(data.denominator, [4, 8] as const, 'Знаменатель размера');
  const groups = list(data.groups, 1, beats, 'Группы долей').map(group => number(group, 1, beats, 'Размер группы'));
  if (groups.reduce((sum, group) => sum + group, 0) !== beats) invalid('Группы должны в сумме давать число долей такта.');
  return freeze({ beats, denominator, groups });
}
function validateTraining(value: unknown, bpm: number): RhythmTraining {
  const data = record(value, ['silentEnabled', 'soundBars', 'silentBars', 'rampEnabled', 'stepBpm', 'everyBars', 'targetBpm'], 'Тренировка');
  const training = {
    silentEnabled: flag(data.silentEnabled, 'Немые такты'), soundBars: number(data.soundBars, 1, 16, 'Звучащие такты'),
    silentBars: number(data.silentBars, 1, 16, 'Немые такты'), rampEnabled: flag(data.rampEnabled, 'Рост темпа'),
    stepBpm: number(data.stepBpm, 1, 20, 'Шаг роста'), everyBars: number(data.everyBars, 1, 32, 'Тактов между повышениями'),
    targetBpm: number(data.targetBpm, 30, 240, 'Целевой BPM'),
  };
  if (training.rampEnabled && training.targetBpm < bpm) invalid('Цель роста темпа должна быть не ниже исходного BPM.');
  return training;
}
export function validateRhythmMetronome(value: unknown): RhythmMetronome {
  const data = record(value, ['bpm', 'bpmUnit', 'meter', 'accents', 'division', 'substeps', 'swing', 'swingMode', 'kit', 'accentVolume', 'clickVolume', 'subdivisionVolume', 'countIn', 'training'], 'Метроном');
  const meter = validateRhythmMeter(data.meter);
  const bpmUnit = choice(data.bpmUnit, ['quarter', 'eighth', 'dotted-quarter'] as const, 'Единица BPM');
  if (bpmUnit === 'dotted-quarter' && !allowsDottedQuarter(meter)) invalid('Четверть с точкой доступна для размера из групп по три восьмых.');
  const bpm = number(data.bpm, 30, 240, 'BPM');
  const division = choice(data.division, [1, 2, 3, 4] as const, 'Подразделение');
  const substepCount = meter.beats * (division - 1);
  return freeze({ bpm, bpmUnit, meter, division,
    accents: list(data.accents, meter.beats, meter.beats, 'Акценты').map(level => choice(level, [0, 1, 2] as const, 'Акцент')),
    substeps: list(data.substeps, substepCount, substepCount, 'Подразделения').map(value => flag(value, 'Подразделение')),
    swing: number(data.swing, 50, 70, 'Свинг'), swingMode: choice(data.swingMode, ['eighth', 'sixteenth'] as const, 'Тип свинга'),
    kit: choice(data.kit, RHYTHM_KITS, 'Набор звуков'), accentVolume: number(data.accentVolume, 0, 1, 'Громкость акцента', false),
    clickVolume: number(data.clickVolume, 0, 1, 'Громкость долей', false), subdivisionVolume: number(data.subdivisionVolume, 0, 1, 'Громкость делений', false),
    countIn: flag(data.countIn, 'Отсчёт'), training: validateTraining(data.training, bpm),
  });
}
export function validateRhythmPreferences(value: unknown): RhythmPreferences {
  const data = record(value, ['view', 'master', 'metronome'], 'Настройки ритма');
  return freeze({ view: choice(data.view, ['metronome', 'rhythm'] as const, 'Вкладка'), master: number(data.master, 0, 1, 'Общая громкость', false), metronome: validateRhythmMetronome(data.metronome) });
}
export const DEFAULT_RHYTHM_PREFERENCES = validateRhythmPreferences({
  view: 'metronome', master: .65, metronome: {
    bpm: 92, bpmUnit: 'quarter', meter: defaultRhythmMeter(4, 4), accents: [2, 1, 1, 1], division: 1, substeps: [],
    swing: 50, swingMode: 'eighth', kit: 'wood', accentVolume: .8, clickVolume: .8, subdivisionVolume: .35, countIn: false,
    training: { silentEnabled: false, soundBars: 3, silentBars: 1, rampEnabled: false, stepBpm: 2, everyBars: 8, targetBpm: 120 },
  },
});

export function validateRhythmChannel(value: unknown): RhythmChannel {
  const data = record(value, ['id', 'name', 'sound', 'volume', 'muted', 'solo', 'velocityDefaults'], 'Инструмент');
  const channel = { id: id(data.id, 'Инструмент'), name: name(data.name, 'Инструмент'),
    sound: choice(data.sound, Object.keys(SOUND_LABELS) as RhythmSound[], 'Звук инструмента'),
    volume: number(data.volume, 0, 1.5, 'Громкость инструмента', false), muted: flag(data.muted, 'Mute'), solo: flag(data.solo, 'Solo'),
  };
  const defaults = record(data.velocityDefaults, ['hit', 'accent'], 'Сила новых ударов');
  return freeze({
    ...channel,
    velocityDefaults: {
      hit: number(defaults.hit, 1, 100, 'Сила нового удара'),
      accent: number(defaults.accent, 1, 100, 'Сила нового акцента'),
    },
  });
}
function validatePattern(value: unknown, channels: readonly RhythmChannel[]): RhythmPattern {
  const data = record(value, ['id', 'name', 'bars', 'lanes'], 'Паттерн');
  const bars = choice(data.bars, RHYTHM_PATTERN_LENGTHS, 'Длина паттерна');
  const length = bars * RHYTHM_STEPS_PER_BAR;
  const lanes = list(data.lanes, channels.length, channels.length, 'Строки паттерна').map(value => {
    const lane = record(value, ['channelId', 'steps', 'velocities'], 'Строка паттерна');
    const channelId = id(lane.channelId, 'Инструмент паттерна');
    if (!channels.some(channel => channel.id === channelId)) invalid('Паттерн содержит ссылку на неизвестный инструмент.');
    const steps = list(lane.steps, length, length, 'Шаги паттерна').map(step => choice(step, [0, 1, 2] as const, 'Шаг паттерна'));
    const velocities = list(lane.velocities, length, length, 'Сила ударов').map(velocity => number(velocity, 0, 1, 'Сила удара', false));
    return { channelId, steps, velocities };
  });
  unique(lanes.map(lane => lane.channelId), 'Строки паттерна');
  return { id: choice(data.id, RHYTHM_PATTERN_IDS, 'Номер паттерна'), name: name(data.name, 'Паттерн'), bars, lanes };
}
export function validateRhythmProject(value: unknown): RhythmProject {
  const data = record(value, ['id', 'name', 'createdAt', 'updatedAt', 'bpm', 'swing', 'swingMode', 'channels', 'patterns', 'chain', 'activePatternId', 'scope', 'repeat', 'countIn', 'overlay'], 'Проект ритма');
  const channels = list(data.channels, 1, 8, 'Инструменты').map(validateRhythmChannel);
  unique(channels.map(channel => channel.id), 'Инструменты');
  const patterns = list(data.patterns, 1, 8, 'Паттерны').map(value => validatePattern(value, channels));
  unique(patterns.map(pattern => pattern.id), 'Паттерны');
  const chain = list(data.chain, 1, 8, 'Цепочка').map(value => {
    const clip = record(value, ['id', 'patternId'], 'Клип');
    const patternId = choice(clip.patternId, RHYTHM_PATTERN_IDS, 'Паттерн клипа');
    if (!patterns.some(pattern => pattern.id === patternId)) invalid('Клип ссылается на отсутствующий паттерн.');
    return { id: id(clip.id, 'Клип'), patternId };
  });
  unique(chain.map(clip => clip.id), 'Клипы');
  const activePatternId = choice(data.activePatternId, RHYTHM_PATTERN_IDS, 'Выбранный паттерн');
  if (!patterns.some(pattern => pattern.id === activePatternId)) invalid('Выбранный паттерн отсутствует.');
  const createdAt = date(data.createdAt), updatedAt = date(data.updatedAt);
  if (Date.parse(updatedAt) < Date.parse(createdAt)) invalid('Дата изменения проекта раньше создания.');
  return freeze({ id: id(data.id, 'Проект'), name: name(data.name, 'Проект'), createdAt, updatedAt,
    bpm: number(data.bpm, 30, 240, 'BPM проекта'), swing: number(data.swing, 50, 70, 'Свинг'),
    swingMode: choice(data.swingMode, ['eighth', 'sixteenth'] as const, 'Тип свинга'), channels, patterns, chain, activePatternId,
    scope: choice(data.scope, ['pattern', 'chain'] as const, 'Материал воспроизведения'), repeat: choice(data.repeat, ['once', 'loop'] as const, 'Повтор'),
    countIn: flag(data.countIn, 'Отсчёт'), overlay: flag(data.overlay, 'Клик поверх ритма'),
  });
}
export function validateRhythmPlaybackConfig(value: unknown): RhythmPlaybackConfig {
  const hasProject = value !== null && typeof value === 'object' && Object.hasOwn(value, 'project');
  const data = record(value, hasProject ? ['preferences', 'project'] : ['preferences'], 'Материал ритмической практики');
  const preferences = validateRhythmPreferences(data.preferences);
  const project = hasProject ? validateRhythmProject(data.project) : undefined;
  if (preferences.view === 'rhythm' && !project) invalid('Для ритм-секции нужен проект.');
  return freeze(preferences.view === 'rhythm' ? { preferences, project: project! } : { preferences });
}

const hits = (normal: readonly number[] = [], accent: readonly number[] = []): RhythmStep[] =>
  Array.from({ length: 16 }, (_, index) => accent.includes(index) ? 2 : normal.includes(index) ? 1 : 0);
const eighths = [0, 2, 4, 6, 8, 10, 12, 14];
const sixteenths = Array.from({ length: 16 }, (_, index) => index);
const presets = {
  rock: { name: 'Прямой рок', style: 'Rock', description: 'Малый на 2 и 4, ровные восьмые хэта.', bpm: 92, swing: 50,
    sounds: { kick: hits([8, 10], [0]), snare: hits([], [4, 12]), closedHat: hits(eighths), openHat: hits() } },
  funk: { name: 'Фанк', style: 'Funk', description: 'Синкопированная бочка и тихие дополнительные удары малого.', bpm: 102, swing: 54,
    sounds: { kick: hits([3, 6, 10, 14], [0]), snare: hits([7, 11, 15], [4, 12]), closedHat: hits(sixteenths.filter(index => index !== 14), [0, 8]), openHat: hits([14]) } },
  shuffle: { name: 'Шаффл', style: 'Shuffle', description: 'Длинная и короткая восьмые, свинг 66%.', bpm: 86, swing: 66,
    sounds: { kick: hits([8], [0]), snare: hits([], [4, 12]), closedHat: hits(eighths), openHat: hits() } },
  blues: { name: 'Блюзовый пульс', style: 'Blues', description: 'Неторопливый свинг с райдом и малым на 2 и 4.', bpm: 72, swing: 66,
    sounds: { kick: hits([8], [0]), snare: hits([10], [4, 12]), closedHat: hits([4, 12]), openHat: hits(), ride: hits(eighths, [0, 8]) } },
  latin: { name: 'Латинский пульс', style: 'Latin', description: 'Синкопированный римшот и ровный шейкер.', bpm: 108, swing: 50,
    sounds: { kick: hits([6, 8, 14], [0]), snare: hits(), closedHat: hits(), openHat: hits(), rim: hits([0, 3, 6, 10, 12]), shaker: hits(sixteenths, [0, 4, 8, 12]) } },
  disco: { name: 'Диско', style: 'Disco', description: 'Бочка на четвертях, открытый хэт между долями.', bpm: 116, swing: 50,
    sounds: { kick: hits([4, 8, 12], [0]), snare: hits([], [4, 12]), closedHat: hits([0, 4, 8, 12]), openHat: hits([2, 6, 10, 14]), clap: hits([4, 12]) } },
  blank: { name: 'Пустой паттерн', style: 'Свой рисунок', description: 'Четыре пустых канала для нового рисунка.', bpm: 92, swing: 50,
    sounds: { kick: hits(), snare: hits(), closedHat: hits(), openHat: hits() } },
};
export type RhythmPresetId = keyof typeof presets;
export const RHYTHM_PRESETS = freeze(Object.entries(presets).map(([id, { sounds, ...descriptor }]) => ({ id: id as RhythmPresetId, ...descriptor })));
export function createLanes(presetId: RhythmPresetId = 'rock', bars: RhythmPatternBars = 1) {
  if (!Object.hasOwn(presets, presetId)) invalid('Неизвестный ритмический рисунок.');
  choice(bars, RHYTHM_PATTERN_LENGTHS, 'Длина паттерна');
  return (Object.entries(presets[presetId].sounds) as [RhythmSound, RhythmStep[]][]).map(([sound, source]) => {
    const steps = Array.from({ length: bars * RHYTHM_STEPS_PER_BAR }, (_, index) => source[index % 16]);
    return { id: sound, name: SOUND_LABELS[sound], sound, volume: sound === 'closedHat' || sound === 'shaker' ? .5 : .7,
      muted: false, solo: false, velocityDefaults: { ...DEFAULT_RHYTHM_VELOCITY }, steps,
      velocities: steps.map<number>(step => step === 2 ? 1 : step === 1 ? .72 : 0) };
  });
}
export function createDefaultRhythmProject(projectId = 'rhythm-default', projectName = 'Мой ритм', nowISO = new Date().toISOString()): RhythmProject {
  const channels = createLanes().map(({ steps, velocities, ...channel }) => channel);
  const patterns = RHYTHM_PATTERN_IDS.slice(0, 3).map((id, index) => {
    const lanes = createLanes().map(lane => ({ channelId: lane.id, steps: lane.steps, velocities: lane.velocities }));
    if (index === 1) { lanes[0].steps[14] = 1; lanes[0].velocities[14] = .72; }
    if (index === 2) { lanes[1].steps.splice(12, 4, 2, 1, 1, 2); lanes[1].velocities.splice(12, 4, 1, .55, .72, 1); }
    return { id, name: ['Основной грув', 'Вариация', 'Сбивка'][index], bars: 1, lanes };
  });
  return validateRhythmProject({ id: projectId, name: projectName, createdAt: nowISO, updatedAt: nowISO,
    bpm: 92, swing: 50, swingMode: 'eighth', channels, patterns,
    chain: ['A', 'A', 'A', 'B', 'A', 'A', 'B', 'C'].map((patternId, index) => ({ id: `clip-${index + 1}`, patternId })),
    activePatternId: 'A', scope: 'pattern', repeat: 'loop', countIn: false, overlay: false,
  });
}

export type RhythmSource = 'accent' | 'click' | 'subdivision' | `lane:${string}`;
export interface RhythmHit {
  readonly source: RhythmSource; readonly sound: RhythmSound | 'accent' | 'normal' | 'subdivision';
  readonly velocity: number; readonly offset?: number;
}
export interface RhythmPosition {
  readonly phase: 'count-in' | 'practice'; readonly bar: number; readonly absoluteBar: number;
  readonly patternBar: number | null; readonly patternId: RhythmPatternId | null; readonly clipId: string | null;
  readonly beat: number; readonly step: number; readonly subdivision: number; readonly silent: boolean;
}
export interface RhythmFrame {
  readonly index: number; readonly position: RhythmPosition; readonly bpm: number; readonly duration: number;
  readonly hits: readonly RhythmHit[]; readonly barStart: boolean;
}
interface CompiledBar { readonly pattern: RhythmPattern; readonly patternBar: number; readonly clipId: string | null }
export interface RhythmPlan {
  readonly config: RhythmPlaybackConfig; readonly meter: RhythmMeter; readonly division: RhythmDivision;
  readonly practiceStepsPerBar: number; readonly countInSteps: number; readonly totalSteps: number | null;
  readonly bars: readonly CompiledBar[];
  readonly overlayHits: readonly (readonly RhythmHit[])[];
}
export function createRhythmPlan(input: RhythmPlaybackConfig): RhythmPlan {
  const config = validateRhythmPlaybackConfig(input);
  const project = config.project;
  const meter = project ? defaultRhythmMeter(4, 4) : config.preferences.metronome.meter;
  const division = project ? 4 : config.preferences.metronome.division;
  const practiceStepsPerBar = meter.beats * division;
  const countInSteps = (project?.countIn ?? config.preferences.metronome.countIn) ? meter.beats : 0;
  const bars: CompiledBar[] = [];
  if (project) {
    const clips = project.scope === 'chain' ? project.chain : [{ id: null, patternId: project.activePatternId }];
    for (const clip of clips) {
      const pattern = project.patterns.find(pattern => pattern.id === clip.patternId)!;
      for (let patternBar = 1; patternBar <= pattern.bars; patternBar++) bars.push({ pattern, patternBar, clipId: clip.id });
    }
  }
  const overlayHits = project?.overlay ? compileOverlayHits(project, config.preferences.metronome) : [];
  return freeze({ config, meter, division, practiceStepsPerBar, countInSteps, bars, overlayHits,
    totalSteps: project?.repeat === 'once' ? countInSteps + bars.length * practiceStepsPerBar : null });
}
export function rhythmBeatSeconds(bpm: number, unit: RhythmBpmUnit, denominator: 4 | 8): number {
  const quarters = unit === 'quarter' ? 1 : unit === 'eighth' ? .5 : 1.5;
  return 60 / bpm / quarters * (4 / denominator);
}
export function rhythmStepFraction(division: RhythmDivision, subdivision: number, swing: number, mode: RhythmSwingMode): number {
  const ratio = swing / 100;
  if (division === 2) return subdivision === 0 ? ratio : 1 - ratio;
  if (division === 4) {
    const long = mode === 'eighth' ? subdivision < 2 : subdivision % 2 === 0;
    return (long ? ratio : 1 - ratio) / 2;
  }
  return 1 / division;
}

function clickHit(metronome: RhythmMetronome, beat: number, subdivision: number): RhythmHit | undefined {
  if (subdivision) {
    const active = metronome.substeps[beat * (metronome.division - 1) + subdivision - 1];
    return active ? { source: 'subdivision', sound: 'subdivision', velocity: 1 } : undefined;
  }
  const accent = metronome.accents[beat];
  if (accent === 2) return { source: 'accent', sound: 'accent', velocity: 1 };
  if (accent === 1) return { source: 'click', sound: 'normal', velocity: 1 };
}

function compileOverlayHits(project: RhythmProject, metronome: RhythmMetronome): RhythmHit[][] {
  const hits = Array.from({ length: RHYTHM_STEPS_PER_BAR }, (): RhythmHit[] => []);
  // Сначала совмещаем обе сетки в долях четверти, затем переводим отступы в секунды.
  const epsilon = 1e-9;
  const stepStarts = [0];
  for (let step = 0; step < RHYTHM_STEPS_PER_BAR; step++) {
    stepStarts.push(stepStarts[step] + rhythmStepFraction(4, step % 4, project.swing, project.swingMode));
  }
  const clickBeat = 4 / metronome.meter.denominator;
  let step = 0;
  for (let beat = 0; beat < 4 / clickBeat; beat++) {
    let at = beat * clickBeat;
    for (let subdivision = 0; subdivision < metronome.division; subdivision++) {
      while (step + 1 < hits.length && at + epsilon >= stepStarts[step + 1]) step++;
      const hit = clickHit(metronome, beat % metronome.meter.beats, subdivision);
      if (hit) {
        const offset = at - stepStarts[step];
        hits[step].push(offset > epsilon ? { ...hit, offset: offset * 60 / project.bpm } : hit);
      }
      at += clickBeat * rhythmStepFraction(metronome.division, subdivision, metronome.swing, metronome.swingMode);
    }
  }
  return hits;
}

export function rhythmFrameAt(plan: RhythmPlan, index: number, tempoBaseBar = 0): RhythmFrame | null {
  number(index, 0, Number.MAX_SAFE_INTEGER, 'Шаг');
  if (plan.totalSteps !== null && index >= plan.totalSteps) return null;
  const { config, meter, division, countInSteps, practiceStepsPerBar } = plan;
  const { metronome } = config.preferences;
  const project = config.project;
  const bpm = project?.bpm ?? metronome.bpm;
  const unit = project ? 'quarter' : metronome.bpmUnit;
  if (index < countInSteps) {
    const strong = (project ? [0] : meter.groups.slice(0, -1).reduce<number[]>((starts, size) => [...starts, starts.at(-1)! + size], [0])).includes(index);
    return { index, position: { phase: 'count-in', bar: 1, absoluteBar: 0, patternBar: null, patternId: null, clipId: null, beat: index + 1, step: index, subdivision: 0, silent: false },
      bpm, duration: rhythmBeatSeconds(bpm, unit, meter.denominator), hits: [{ source: strong ? 'accent' : 'click', sound: strong ? 'accent' : 'normal', velocity: 1 }], barStart: index === 0 };
  }
  const practiceStep = index - countInSteps;
  const absoluteBar = Math.floor(practiceStep / practiceStepsPerBar) + 1;
  const step = practiceStep % practiceStepsPerBar;
  const bar = project ? (absoluteBar - 1) % plan.bars.length + 1 : absoluteBar;
  const subdivision = step % division;
  const beat = Math.floor(step / division) + 1;
  const compiled = project ? plan.bars[bar - 1] : null;
  const training = metronome.training;
  const silent = !project && training.silentEnabled && (absoluteBar - 1) % (training.soundBars + training.silentBars) >= training.soundBars;
  const effectiveBpm = !project && training.rampEnabled
    ? Math.min(training.targetBpm, bpm + Math.floor(Math.max(0, absoluteBar - 1 - tempoBaseBar) / training.everyBars) * training.stepBpm) : bpm;
  const hits: RhythmHit[] = [];
  if (!silent && compiled && project) {
    const laneStep = (compiled.patternBar - 1) * RHYTHM_STEPS_PER_BAR + step;
    for (const channel of project.channels) {
      const lane = compiled.pattern.lanes.find(lane => lane.channelId === channel.id)!;
      if (lane.steps[laneStep] && lane.velocities[laneStep] > 0) hits.push({ source: `lane:${channel.id}`, sound: channel.sound, velocity: lane.velocities[laneStep] });
    }
    if (project.overlay) hits.push(...plan.overlayHits[step]);
  } else if (!silent && !project) {
    const hit = clickHit(metronome, beat - 1, subdivision);
    if (hit) hits.push(hit);
  }
  return { index, position: { phase: 'practice', bar, absoluteBar, patternBar: compiled?.patternBar ?? null, patternId: compiled?.pattern.id ?? null,
    clipId: compiled?.clipId ?? null, beat, step, subdivision, silent }, bpm: effectiveBpm,
    duration: rhythmBeatSeconds(effectiveBpm, unit, meter.denominator) * rhythmStepFraction(division, subdivision, project?.swing ?? metronome.swing, project?.swingMode ?? metronome.swingMode),
    hits, barStart: step === 0 };
}
