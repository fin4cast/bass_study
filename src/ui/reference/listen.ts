/**
 * «Послушать» в карточке справочника (R-027): что звучит и как это проигрывается.
 *
 * План строится из данных карточки, а не из отдельной таблицы: подпись «прозвучит: …» (`play.listen`)
 * называет высоты (`A1, затем A2`), и каждая берётся с мини-грифа карточки по подписи позиции.
 * Если высот в подписи нет, а есть «форма A вверх, форма B вниз», ноты берутся из позиций этих форм
 * на мини-грифе по высоте. Звук — короткий сигнал `createAudioCue` на общих аудиочасах; окончание
 * определяет сигнал по `finishAt`, а не последняя запланированная нота.
 */
import { createAudioCue, type CueConfiguration } from '../../audio/cue';
import { getPosition, type StringId } from '../../music';
import { conceptBoard, type ConceptPosition, type ReferenceConcept } from '../../practice/concepts';
import { onPageVisibility } from '../page-visibility';
import type { ReferenceCommonOptions } from './view';

export interface ListenNote {
  readonly positionId: string;
  /** Подпись высоты с мини-грифа, например `A♯1`. */
  readonly label: string;
  readonly midi: number;
  /** Начало и длительность в долях (четвертях) темпа `LISTEN_BPM`. */
  readonly beat: number;
  readonly durationBeats: number;
}

export interface ConceptListenPlan {
  readonly conceptId: string;
  readonly notes: readonly ListenNote[];
  readonly cue: CueConfiguration;
}

/** Темп прослушивания карточки: спокойный, в пределах сигнала 60–120 BPM. */
export const LISTEN_BPM = 80;
/** До восьми нот — четвертями (каждую слышно отдельно), больше — восьмыми, как в упражнении. */
const QUARTERS_UP_TO = 8;
/** Звучит 90 % доли: между соседними нотами слышна граница. */
const ARTICULATION = 0.9;

const PITCH_LABEL = /[A-G][♯♭]?\d/g;
const FORM_PHRASE = /форма ([AB]) (вверх|вниз)/g;

function midiOf(position: ConceptPosition): number {
  const [string, fret] = position.id.split(':');
  return getPosition(string as StringId, Number(fret)).midi;
}

/** Позиции мини-грифа в порядке звучания или `null`, если у карточки нет «Послушать». */
export function conceptListenPositions(concept: ReferenceConcept): readonly ConceptPosition[] | null {
  const text = concept.full?.play.listen;
  const board = conceptBoard(concept);
  if (!text || !board) return null;
  const labels = text.match(PITCH_LABEL) ?? [];
  if (labels.length) {
    const used = new Set<ConceptPosition>();
    return labels.map(label => {
      const candidates = board.positions.filter(position => position.label === label);
      const position = candidates.find(candidate => !used.has(candidate)) ?? candidates[0];
      if (!position) throw new RangeError(`В карточке «${concept.title}» нет позиции ${label} для прослушивания.`);
      used.add(position);
      return position;
    });
  }
  const phrases = [...text.matchAll(FORM_PHRASE)];
  if (!phrases.length) throw new RangeError(`Прослушивание карточки «${concept.title}» не описано высотами или формами.`);
  return phrases.flatMap(([, form, direction]) => {
    const notes = board.positions.filter(position => position.form === undefined || position.form === form);
    const sorted = [...notes].sort((a, b) => midiOf(a) - midiOf(b));
    return direction === 'вверх' ? sorted : sorted.reverse();
  });
}

/** План прослушивания карточки: ноты, доли и конфигурация сигнала. Чистая функция. */
export function conceptListenPlan(concept: ReferenceConcept): ConceptListenPlan | null {
  const positions = conceptListenPositions(concept);
  if (!positions) return null;
  const slot = positions.length <= QUARTERS_UP_TO ? 1 : 0.5;
  const notes = positions.map((position, index): ListenNote => Object.freeze({
    positionId: position.id, label: position.label, midi: midiOf(position),
    beat: index * slot, durationBeats: slot * ARTICULATION,
  }));
  const cue: CueConfiguration = {
    bpm: LISTEN_BPM,
    totalBeats: positions.length * slot,
    notes: notes.map(note => ({ midi: note.midi, beat: note.beat, durationBeats: note.durationBeats })),
  };
  return Object.freeze({ conceptId: concept.id, notes: Object.freeze(notes), cue });
}

export interface ConceptListenState {
  /** Понятие, которое звучит или готовится; `null` — тишина. */
  readonly conceptId: string | null;
  readonly status: 'idle' | 'starting' | 'playing';
  /** Пояснение для карточки: прозвучало, остановлено, не разрешено. */
  readonly message: string;
}

export interface ConceptListenerOptions {
  /** Владелец звука разрешает старт; `false` — звук не начинается. */
  readonly onBeforeListen: () => boolean;
  /** Звук справочника закончился или остановлен: владелец может отпустить аудиочасы. */
  readonly onListenEnd?: () => void;
  readonly onChange: (state: ConceptListenState) => void;
}

/**
 * Проигрыватель «Послушать»: один сигнал за раз; повторное нажатие на том же понятии останавливает.
 * При скрытии вкладки сигнал останавливается: короткий пример слушают заново, а не продолжают.
 */
export function createConceptListener(options: ConceptListenerOptions) {
  const controller = new AbortController();
  let state: ConceptListenState = { conceptId: null, status: 'idle', message: '' };
  let disposed = false;
  let token = 0;

  const cue = createAudioCue({
    onComplete() {
      if (disposed || state.status !== 'playing') return;
      finish('Прозвучало. Нажми ещё раз, чтобы повторить.');
    },
  });

  function set(next: ConceptListenState) {
    state = next;
    options.onChange(state);
  }
  function finish(message: string) {
    const wasActive = state.status !== 'idle';
    set({ conceptId: null, status: 'idle', message });
    if (wasActive) options.onListenEnd?.();
  }

  async function play(concept: ReferenceConcept) {
    if (disposed) return;
    if (state.status !== 'idle' && state.conceptId === concept.id) { stop('Остановлено.'); return; }
    const plan = conceptListenPlan(concept);
    if (!plan) return;
    if (state.status !== 'idle') stop('');
    if (!options.onBeforeListen()) {
      set({ conceptId: null, status: 'idle', message: 'Звук сейчас не запускается: вкладка не активна или звук занят.' });
      return;
    }
    const run = ++token;
    set({ conceptId: concept.id, status: 'starting', message: '' });
    try {
      await cue.play(plan.cue);
      if (disposed || run !== token) return;
      // Сигнал поставлен на аудиочасы; «прозвучало» скажет только onComplete после finishAt.
      set({ conceptId: concept.id, status: 'playing', message: '' });
    } catch (failure) {
      if (disposed || run !== token) return;
      finish(`Звук не запустился: ${failure instanceof Error ? failure.message : String(failure)}`);
    }
  }

  function stop(message = '') {
    if (disposed) return;
    ++token;
    cue.stop();
    // Остановка в тишине не придумывает «остановлено»: только убирает прежнее пояснение при смене карточки.
    if (state.status !== 'idle') finish(message);
    else if (!message && state.message) set({ conceptId: null, status: 'idle', message: '' });
  }

  onPageVisibility(controller.signal, () => { if (state.status !== 'idle') stop('Остановлено: вкладка скрывалась.'); });

  return {
    play,
    stop,
    get state() { return state; },
    dispose() {
      if (disposed) return;
      ++token;
      cue.stop();
      const wasActive = state.status !== 'idle';
      disposed = true;
      controller.abort();
      cue.dispose();
      state = { conceptId: null, status: 'idle', message: '' };
      if (wasActive) options.onListenEnd?.();
    },
  };
}

/** Слушатель карточки по опциям хоста; `null` — звук справочника не подключён. */
export function referenceListener(options: ReferenceCommonOptions, card: () => { readonly current: { readonly id: string } | null; setListening(playing: boolean, message: string): void }) {
  if (!options.onBeforeListen) return null;
  return createConceptListener({
    onBeforeListen: options.onBeforeListen,
    onListenEnd: options.onListenEnd,
    onChange(state) {
      const shown = card();
      shown.setListening(state.status !== 'idle' && state.conceptId === shown.current?.id, state.message);
    },
  });
}
