import { createBoxSelection, getBoxInstance, validateBoxSelection, type BoxSelection } from '../music/boxes';
import { annotatePositions, createStructure, formatMidi, getPosition, type StringId, type StructureId } from '../music';
import { createSequence, type SequencePattern, type TrainingScope, type QuestionPolicy } from '../training';
import { createPlaybackPlan } from '../audio/plan';
import { createRouteTimerV1, replayRouteTimerV1, type RouteEvent, type RouteResult, type RouteSession } from './timer-v1';
export { advanceRouteSession, pauseRouteSession, resumeRouteSession, nextRouteStep, stopRouteSession, getRouteResult, linkRouteSession } from './timer-v1';
export type { RouteEvent, RouteResult, RouteSession } from './timer-v1';

export const ROUTE_STEPS = Object.freeze([
  Object.freeze({ id: 'fretboard' as const, name: 'Гриф', plannedMs: 180_000, instruction: 'Найди C, E и G в форме от E/8: шесть вопросов, по два на каждую ноту. После серии можно повторить её до конца блока.' }),
  Object.freeze({ id: 'ear' as const, name: 'Слух', plannedMs: 180_000, instruction: 'Сначала изучи подписанные образцы C2–C2, C2–E2, C2–G2. Затем ответь на шесть слуховых вопросов без карты.' }),
  Object.freeze({ id: 'sequence' as const, name: 'Практика', plannedMs: 240_000, instruction: 'Играй C2–E2–G2–C3: E/8 → A/7 → A/10 → D/10. Четверти, 60 BPM, повтор по кругу; отсчёт — четыре доли.' }),
] as const);

export type RouteStep = typeof ROUTE_STEPS[number]['id'];
export type RouteStatus = 'running' | 'paused' | 'between' | 'finished';
export type RoutePauseReason = 'manual' | 'hidden';
export interface RouteRef { readonly routeId: string; readonly step: RouteStep }
export interface RouteSessionLink { readonly id: string; readonly kind: 'screen' | 'ear' | 'manual'; readonly step: RouteStep }
export interface RouteMaterial {
  readonly kind: 'triad-route-v1' | 'free-route-v1'; readonly root: string; readonly structureId: StructureId; readonly box: BoxSelection | null;
  readonly referencePositionIds: readonly string[]; readonly referenceMidi: number; readonly questionPolicy: QuestionPolicy; readonly questionCount: 6;
  readonly earQuality: 'major' | 'minor'; readonly earCount: 6; readonly earBpm: 60; readonly duration: RoutePlayerSettings['duration']; readonly bpm: number; readonly repeat: RoutePlayerSettings['repeat']; readonly countIn: boolean;
  readonly pattern: SequencePattern; readonly scope: TrainingScope; readonly sequencePositionIds: readonly string[]; readonly player: RoutePlayerSettings;
}
export interface RoutePlayerSettings {
  readonly bpm: number; readonly duration: 'quarter' | 'eighth' | 'sixteenth'; readonly repeat: 'once' | 'infinite' | 'ladder';
  readonly countIn: boolean; readonly showPulse: boolean; readonly from: number | null; readonly to: number | null;
  readonly ladderStart: number; readonly ladderEnd: number; readonly ladderStep: number; readonly ladderRepeats: number;
  readonly metronome: boolean; readonly metronomeMode: 'all' | 'two-four' | 'gap-2-2'; readonly subdivision: 'quarter' | 'eighth' | 'sixteenth';
  readonly bassVolume: number; readonly clickVolume: number;
}
const ROUTE_PLAYER: RoutePlayerSettings = Object.freeze({ bpm: 60, duration: 'quarter', repeat: 'infinite', countIn: true, showPulse: true, from: null, to: null,
  ladderStart: 60, ladderEnd: 100, ladderStep: 5, ladderRepeats: 2, metronome: true, metronomeMode: 'all', subdivision: 'quarter', bassVolume: 70, clickVolume: 50 });
function freezeMaterial<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freezeMaterial); Object.freeze(value); } return value; }
function playerSettings(value: RoutePlayerSettings): RoutePlayerSettings {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== Object.keys(ROUTE_PLAYER).length || Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !Object.hasOwn(descriptor, 'value'))) throw new RangeError('Снимок плеера должен содержать только обычные JSON-поля.');
  if (!value || typeof value !== 'object' || Object.keys(value).length !== Object.keys(ROUTE_PLAYER).length || Object.keys(ROUTE_PLAYER).some(key => !Object.hasOwn(value, key))) throw new RangeError('Неполный снимок настроек плеера маршрута.');
  const numeric = { bpm: [40, 220], ladderStart: [40, 220], ladderEnd: [40, 220], ladderStep: [1, 180], ladderRepeats: [1, 20], bassVolume: [0, 100], clickVolume: [0, 100] };
  for (const [key, [min, max]] of Object.entries(numeric)) { const number = value[key as keyof RoutePlayerSettings]; if (typeof number !== 'number' || !Number.isInteger(number) || number < min || number > max) throw new RangeError('Некорректные числовые настройки маршрута.'); }
  if (!['quarter', 'eighth', 'sixteenth'].includes(value.duration) || !['quarter', 'eighth', 'sixteenth'].includes(value.subdivision) || !['once', 'infinite', 'ladder'].includes(value.repeat) || !['all', 'two-four', 'gap-2-2'].includes(value.metronomeMode)
    || [value.countIn, value.showPulse, value.metronome].some(flag => typeof flag !== 'boolean') || value.ladderStart > value.ladderEnd
    || [value.from, value.to].some(index => index !== null && (!Number.isInteger(index) || index < 1))) throw new RangeError('Некорректный снимок ритма и фрагмента.');
  return Object.freeze(Object.fromEntries(Object.keys(ROUTE_PLAYER).map(key => [key, value[key as keyof RoutePlayerSettings]]))) as unknown as RoutePlayerSettings;
}
export function createFreeRouteMaterial(input: {
  readonly box: BoxSelection | null; readonly root?: string; readonly structureId?: StructureId; readonly referencePositionIds?: readonly string[];
  readonly pattern: SequencePattern; readonly scope?: TrainingScope; readonly player: RoutePlayerSettings;
}): RouteMaterial {
  const box = input.box ? validateBoxSelection(input.box) : null;
  const structure = createStructure(box?.root ?? input.root ?? '', box?.structureId ?? input.structureId!);
  const ids = box ? getBoxInstance(box).referencePositionIds : input.referencePositionIds ?? [];
  if (!ids.length || new Set(ids).size !== ids.length) throw new RangeError('Выбери полную форму или непустую область маршрута.');
  const positions = annotatePositions(ids.map(id => { const match = /^([EADG]):(\d+)$/.exec(id); if (!match) throw new RangeError('Неверная позиция маршрута.'); const position = getPosition(match[1] as StringId, Number(match[2])); if (position.id !== id) throw new RangeError('Позиция маршрута должна иметь канонический ID.'); return position; }), structure);
  const scope = box ? 'structure' : input.scope ?? 'structure';
  const sequence = createSequence({ positions, structure, box, pattern: input.pattern, scope });
  const heights = new Set(positions.map(position => position.midi));
  const earQuality = structure.id.startsWith('minor') || structure.id === 'natural-minor' ? 'minor' : 'major';
  const third = earQuality === 'minor' ? 3 : 4;
  const referenceMidi = positions.filter(position => position.isRoot && heights.has(position.midi + third) && heights.has(position.midi + 7)).sort((a, b) => a.midi - b.midi)[0]?.midi;
  if (referenceMidi === undefined) throw new RangeError('В выбранном материале нужны тоника, её терция и квинта выше. Выбери полную учебную форму.');
  const player = playerSettings(input.player);
  createPlaybackPlan({ notes: sequence.notes, range: { from: (player.from ?? 1) - 1, toExclusive: player.to ?? sequence.notes.length }, duration: player.duration, bpm: player.bpm, countIn: player.countIn,
    repeat: player.repeat === 'ladder' ? { kind: 'ladder', start: player.ladderStart, end: player.ladderEnd, step: player.ladderStep, repeatsPerTempo: player.ladderRepeats } : player.repeat,
    metronome: { enabled: player.metronome, mode: player.metronomeMode, subdivision: player.subdivision } });
  return freezeMaterial({ kind: 'free-route-v1', root: structure.root, structureId: structure.id, box, referencePositionIds: [...ids], referenceMidi, questionPolicy: 'shape-6-v1', questionCount: 6,
    earQuality, earCount: 6, earBpm: 60, duration: player.duration, bpm: player.bpm, repeat: player.repeat, countIn: player.countIn, pattern: input.pattern, scope, sequencePositionIds: sequence.notes.map(note => note.id), player });
}
export function getRouteInstruction(material: RouteMaterial, step: RouteStep): string {
  const structure = createStructure(material.root, material.structureId);
  if (step === 'fretboard') return `Найди ноты ${structure.root} · ${structure.name.toLowerCase()}: шесть вопросов в точных ${material.box ? 'позициях формы' : 'сохранённых позициях'}. ${material.questionPolicy === 'triad-6-v1' ? 'По два вопроса на C, E и G.' : 'Ноты выбираются без повторов, пока позволяет число классов.'} После серии можно повторить её до конца блока.`;
  if (step === 'ear') {
    const triad = createStructure(material.root, material.earQuality === 'major' ? 'major-triad' : 'minor-triad');
    return `Изучи подписанные образцы от ${formatMidi(material.referenceMidi, structure.root)}: ${triad.notes.map(note => formatMidi(material.referenceMidi + note.semitones, note.name)).join(', ')}. Затем ответь на шесть слуховых вопросов без карты.`;
  }
  const duration = { quarter: 'четверти', eighth: 'восьмые', sixteenth: 'шестнадцатые' }[material.duration];
  const from = material.player.from ?? 1; const to = material.player.to ?? material.sequencePositionIds.length;
  const tempo = material.repeat === 'ladder'
    ? `лестница ${material.player.ladderStart}–${material.player.ladderEnd} BPM, шаг ${material.player.ladderStep} BPM, проходов на темп: ${material.player.ladderRepeats}`
    : `${material.bpm} BPM; ${material.repeat === 'infinite' ? 'по кругу' : 'один проход'}`;
  return `Сыграй сохранённый маршрут ${structure.root} · ${structure.name.toLowerCase()}: ноты ${from}–${to} включительно (${to - from + 1} из ${material.sequencePositionIds.length}); ${duration}; ${tempo}. ${material.countIn ? 'Отсчёт — четыре доли.' : 'Отсчёт выключен.'} Комфортный темп отметь отдельно.`;
}
export function createRouteMaterial(): RouteMaterial {
  const box = createBoxSelection({ root: 'C', structureId: 'major-triad', shapeId: 'compact-e', anchorString: 'E', anchorFret: 8 });
  return freezeMaterial({ ...createFreeRouteMaterial({ box, pattern: 'ascending', player: ROUTE_PLAYER }), kind: 'triad-route-v1', questionPolicy: 'triad-6-v1' });
}
function validateRouteMaterialV1(value: unknown): RouteMaterial {
  const base = createRouteMaterial();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RangeError('Нужен исходный материал маршрута.');
  const raw = value as Record<string, unknown>;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(raw).length !== Object.keys(base).length || Object.values(Object.getOwnPropertyDescriptors(raw)).some(descriptor => !Object.hasOwn(descriptor, 'value'))) throw new RangeError('Материал маршрута должен содержать только обычные JSON-поля.');
  if (Object.keys(raw).length !== Object.keys(base).length || Object.keys(base).some(key => !Object.hasOwn(raw, key))) throw new RangeError('Неверные поля материала маршрута.');
  const expected = raw.kind === 'triad-route-v1' ? base : raw.kind === 'free-route-v1' ? createFreeRouteMaterial({ box: raw.box === null ? null : validateBoxSelection(raw.box), root: raw.root as string, structureId: raw.structureId as StructureId,
    referencePositionIds: raw.referencePositionIds as string[], pattern: raw.pattern as SequencePattern, scope: raw.scope as TrainingScope, player: raw.player as RoutePlayerSettings }) : null;
  if (!expected || Object.keys(expected).some(key => {
    if (key === 'box') return raw.box === null ? expected.box !== null : JSON.stringify(validateBoxSelection(raw.box)) !== JSON.stringify(expected.box);
    if (key === 'player') return JSON.stringify(playerSettings(raw.player as RoutePlayerSettings)) !== JSON.stringify(expected.player);
    if (key === 'referencePositionIds' || key === 'sequencePositionIds') return !Array.isArray(raw[key]) || raw[key].length !== expected[key].length || raw[key].some((id: unknown, index: number) => id !== expected[key][index]);
    return raw[key] !== expected[key as keyof RouteMaterial];
  })) throw new RangeError('Материал не соответствует сохранённому учебному контексту.');
  return expected;
}
export const validateRouteMaterial = validateRouteMaterialV1;

interface RouteStart {
  readonly id: string;
  readonly material?: RouteMaterial | null;
  readonly sessionLinks?: readonly RouteSessionLink[];
}
function startRouteSessionV1(config: RouteStart): RouteSession {
  const material = config.material === null ? null : validateRouteMaterialV1(config.material ?? createRouteMaterial());
  return createRouteTimerV1({ ...config, material });
}
export const startRouteSession = startRouteSessionV1;

export function replayRouteResultV1(input: RouteStart & { readonly events: readonly RouteEvent[]; readonly asOfMs: number }): RouteResult {
  return replayRouteTimerV1(startRouteSessionV1(input), input);
}
export const replayRouteResult = replayRouteResultV1;
