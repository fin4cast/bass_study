import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlaybackPlan, eventAtGrid, type PlaybackConfig } from '../src/audio/plan';
import { validateCue } from '../src/audio/cue';
import { buildExercise, createExerciseSpec } from '../src/exercises';
import { REFERENCE_CONCEPTS, getConcept } from '../src/practice/concepts';
import { listenConfig, listenProgressText, loopAround, junctions, playbackConfig } from '../src/ui/play/model';
import { mapPlaybackState, type RawPlaybackState } from '../src/ui/play/port';
import { LISTEN_BPM, conceptListenPlan } from '../src/ui/reference/listen';

/** Независимый контроль R-014: научная высота по букве, знаку и октаве, без модуля `music`. */
const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as const;
function midiOfLabel(label: string): number {
  const match = /^([A-G])([♯♭]?)(\d)$/.exec(label);
  if (!match) throw new Error(label);
  return LETTER[match[1] as keyof typeof LETTER] + (match[2] === '♯' ? 1 : match[2] === '♭' ? -1 : 0) + (Number(match[3]) + 1) * 12;
}
/** Открытые струны E1 A1 D2 G2 по научной записи. */
const OPEN = { E: midiOfLabel('E1'), A: midiOfLabel('A1'), D: midiOfLabel('D2'), G: midiOfLabel('G2') } as const;
const midiOfPosition = (id: string) => { const [string, fret] = id.split(':'); return OPEN[string as keyof typeof OPEN] + Number(fret); };

/** Все события сетки одного прохода: ноты и звучащие клики. */
function gridEvents(config: PlaybackConfig) {
  const plan = createPlaybackPlan(config);
  const end = plan.finishGrid ?? plan.countInGrids + plan.passGrids;
  const events = Array.from({ length: end }, (_, grid) => eventAtGrid(plan, grid));
  return {
    plan,
    notes: events.filter(event => event.note).map(event => ({ grid: event.grid, id: event.note!.id, noteIndex: event.noteIndex })),
    clicks: events.filter(event => event.click?.audible).length,
    countIn: events.filter(event => event.phase === 'count-in').length,
  };
}

describe('«Сначала услышь»: эталон экрана игры', () => {
  const plan = buildExercise(createExerciseSpec('connect-forms'));
  const settings = { bpm: 76, countIn: true, loop: true, ladder: false, range: null };

  it('один проход всего упражнения восьмыми, без отсчёта, клика и повтора', () => {
    const { plan: playback, notes, clicks, countIn } = gridEvents(listenConfig(plan, settings));
    expect(countIn).toBe(0);
    expect(clicks).toBe(0);
    expect(playback.totalPasses).toBe(1);
    expect(playback.metronome.enabled).toBe(false);
    expect(playback.bpm).toBe(76);
    // Те же позиции, что у игры (R-026: одна последовательность), каждая — на чётной шестнадцатой.
    expect(notes.map(note => note.id)).toEqual(plan.positions.map(position => position.id));
    expect(notes.map(note => note.grid)).toEqual(plan.positions.map((_, index) => index * 2));
    expect(playback.finishGrid).toBe(plan.positions.length * 2);
  });

  it('с петлёй звучит только выбранный фрагмент', () => {
    const range = loopAround(plan, junctions(plan)[0]);
    const { notes } = gridEvents(listenConfig(plan, { ...settings, range }));
    expect(notes.map(note => note.noteIndex)).toEqual(Array.from({ length: range.toExclusive - range.from }, (_, index) => range.from + index));
    expect(notes[0].grid).toBe(0);
  });

  it('отличается от игры только отсчётом, повтором и кликом', () => {
    const game = playbackConfig(plan, settings);
    const reference = listenConfig(plan, settings);
    expect({ ...reference, countIn: game.countIn, repeat: game.repeat, metronome: game.metronome }).toEqual(game);
    expect(game.countIn).toBe(true);
    expect(game.repeat).toBe('infinite');
  });

  it('подпись транспорта во время эталона', () => {
    expect(listenProgressText(null, 16)).toBe('Звучит эталон · нота 0 из 16');
    expect(listenProgressText(4, 16, { from: 4, toExclusive: 12 })).toBe('Звучит эталон · нота 5 из 16 · петля 5–12');
  });

  it('последняя нота запланирована, но до finishAt эталон ещё звучит', () => {
    const raw = (state: RawPlaybackState['state']): RawPlaybackState => ({ state, phase: 'practice', audioTime: 3, bpm: 76, noteIndex: 15, beat: 4, passIndex: 0, totalPasses: 1, pauseReason: null });
    // `finishing` — последняя нота уже на аудиочасах, но её время не прошло: экран не объявляет «прозвучал».
    expect(mapPlaybackState(raw('finishing'), false).status).toBe('playing');
    expect(mapPlaybackState(raw('finished'), false).status).toBe('finished');
    // Без отсчёта старт — сразу «игра», но ни одна нота ещё не звучит.
    expect(mapPlaybackState({ ...raw('starting'), noteIndex: null }, false)).toMatchObject({ status: 'playing', noteIndex: null, countBeat: null });
  });
});

describe('«Послушать» в справочнике: план из данных карточки', () => {
  const expected: Record<string, string[]> = {
    semitone: ['E:5', 'E:6', 'E:7'],
    octave: ['E:5', 'D:7'],
    'octave-numbers': ['E:0', 'A:0', 'D:0', 'G:0'],
    fourth: ['E:5', 'A:5'],
    fifth: ['E:5', 'A:7', 'D:7'],
    degree: ['E:5', 'E:8', 'A:5', 'A:7', 'D:5', 'D:7', 'G:5', 'G:7'],
    'shared-notes': ['E:5', 'E:8', 'A:5', 'A:7', 'D:5', 'D:7', 'G:5', 'G:7', 'G:9', 'G:7', 'D:10', 'D:7', 'A:10', 'A:7', 'E:10', 'E:8'],
    triad: ['E:8', 'A:7', 'A:10', 'D:10'],
  };

  it('у каждой карточки с «Послушать» есть план, у остальных — нет', () => {
    const withListen = REFERENCE_CONCEPTS.filter(concept => concept.full?.play.listen).map(concept => concept.id);
    expect(withListen.sort()).toEqual(Object.keys(expected).sort());
    for (const concept of REFERENCE_CONCEPTS) {
      const plan = conceptListenPlan(concept);
      if (!withListen.includes(concept.id)) expect(plan).toBeNull();
      else expect(plan!.notes.map(note => note.positionId)).toEqual(expected[concept.id]);
    }
  });

  it('высоты совпадают с подписями мини-грифа и строкой «прозвучит»', () => {
    for (const id of Object.keys(expected)) {
      const plan = conceptListenPlan(getConcept(id)!)!;
      for (const note of plan.notes) {
        expect(note.midi, `${id} ${note.positionId}`).toBe(midiOfPosition(note.positionId));
        expect(note.midi, `${id} ${note.label}`).toBe(midiOfLabel(note.label));
      }
      const listen = getConcept(id)!.full!.play.listen!;
      const named = listen.match(/[A-G][♯♭]?\d/g);
      if (named) expect(plan.notes.map(note => note.label)).toEqual(named);
    }
    expect(conceptListenPlan(getConcept('semitone')!)!.notes.map(note => note.label)).toEqual(['A1', 'A♯1', 'B1']);
    expect(conceptListenPlan(getConcept('octave')!)!.notes.map(note => note.midi)).toEqual([33, 45]);
  });

  it('доли: до восьми нот — четверти, больше — восьмые; между нотами слышна граница', () => {
    const fifth = conceptListenPlan(getConcept('fifth')!)!;
    expect(fifth.notes.map(note => [note.beat, note.durationBeats])).toEqual([[0, 0.9], [1, 0.9], [2, 0.9]]);
    expect(fifth.cue).toEqual({ bpm: LISTEN_BPM, totalBeats: 3, notes: [{ midi: 33, beat: 0, durationBeats: 0.9 }, { midi: 40, beat: 1, durationBeats: 0.9 }, { midi: 45, beat: 2, durationBeats: 0.9 }] });
    const shared = conceptListenPlan(getConcept('shared-notes')!)!;
    // «16 восьмых» из подписи карточки.
    expect(shared.notes).toHaveLength(16);
    expect(shared.notes.map(note => note.beat)).toEqual(Array.from({ length: 16 }, (_, index) => index / 2));
    expect(shared.cue.totalBeats).toBe(8);
    for (const id of Object.keys(expected)) expect(() => validateCue(conceptListenPlan(getConcept(id)!)!.cue)).not.toThrow();
  });

  it('совпадает с упражнениями каталога, на которые ссылается карточка', () => {
    const positions = (template: Parameters<typeof createExerciseSpec>[0]) => buildExercise(createExerciseSpec(template)).positions.map(position => position.id);
    // «Общие ноты»: форма A вверх и форма B вниз — это связка соседних форм по умолчанию.
    expect(conceptListenPlan(getConcept('shared-notes')!)!.notes.map(note => note.positionId)).toEqual(positions('connect-forms'));
    // «Ступень»: форма A вверх — первая половина «Формы пентатоники вверх-вниз».
    expect(conceptListenPlan(getConcept('degree')!)!.notes.map(note => note.positionId)).toEqual(positions('pentatonic-form').slice(0, 8));
    // «Трезвучие»: подъём арпеджио 1–3–5–8 от C.
    expect(conceptListenPlan(getConcept('triad')!)!.notes.map(note => note.positionId)).toEqual(positions('arpeggio-1358').slice(0, 4));
  });
});

/* ---------- Живой сигнал на подставных аудиочасах ---------- */
type Listener = typeof import('../src/ui/reference/listen');
let listenModule: Listener;
let clock: { currentTime: number; oscillators: number; started: number[] };
let frames: FrameRequestCallback[] = [];

function stubAudio() {
  clock = { currentTime: 0, oscillators: 0, started: [] };
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
  const node = () => ({ connect() {}, disconnect() {} });
  const context = {
    get currentTime() { return clock.currentTime; }, state: 'running', sampleRate: 48000, destination: node(),
    async resume() {},
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), type: '', frequency: param(), Q: param() }),
    createOscillator: () => { clock.oscillators++; return { ...node(), type: '', frequency: param(), start(at: number) { clock.started.push(at); }, stop() {} }; },
  };
  vi.stubGlobal('AudioContext', class { constructor() { return context; } });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
}
const flushFrames = () => { const pending = frames; frames = []; pending.forEach(callback => callback(0)); };

describe('«Послушать»: запланированное не выдаётся за прозвучавшее', () => {
  beforeEach(async () => { vi.resetModules(); frames = []; stubAudio(); listenModule = await import('../src/ui/reference/listen'); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('«прозвучало» — только после finishAt по аудиочасам, а не когда ноты поставлены', async () => {
    const states: string[] = [];
    const ended = vi.fn();
    const listener = listenModule.createConceptListener({ onBeforeListen: () => true, onListenEnd: ended, onChange: state => states.push(`${state.status}:${state.message}`) });
    const concept = getConcept('fifth')!;
    await listener.play(concept);
    expect(listener.state).toMatchObject({ status: 'playing', conceptId: 'fifth' });
    expect(clock.oscillators).toBe(3);
    const seconds = 60 / LISTEN_BPM;
    const lastStart = Math.max(...clock.started);
    const finishAt = clock.started[0] + 3 * seconds;
    // Все ноты уже на аудиочасах, последняя началась, но её доля не кончилась.
    clock.currentTime = lastStart + 0.01;
    flushFrames();
    expect(listener.state.status).toBe('playing');
    expect(ended).not.toHaveBeenCalled();
    clock.currentTime = finishAt + 0.001;
    flushFrames();
    expect(listener.state).toMatchObject({ status: 'idle', conceptId: null, message: 'Прозвучало. Нажми ещё раз, чтобы повторить.' });
    expect(ended).toHaveBeenCalledTimes(1);
    expect(states).toEqual(['starting:', 'playing:', 'idle:Прозвучало. Нажми ещё раз, чтобы повторить.']);
    listener.dispose();
  });

  it('остановка посреди сигнала не объявляет «прозвучало»; поздний кадр ничего не меняет', async () => {
    const ended = vi.fn();
    const listener = listenModule.createConceptListener({ onBeforeListen: () => true, onListenEnd: ended, onChange: () => {} });
    await listener.play(getConcept('octave')!);
    clock.currentTime = 0.5;
    listener.stop('Остановлено.');
    expect(listener.state).toMatchObject({ status: 'idle', message: 'Остановлено.' });
    clock.currentTime = 10;
    flushFrames();
    expect(listener.state.message).toBe('Остановлено.');
    expect(ended).toHaveBeenCalledTimes(1);
    // Повторная остановка в тишине не создаёт нового пояснения и не отпускает владельца второй раз.
    listener.stop('Остановлено.');
    expect(ended).toHaveBeenCalledTimes(1);
    listener.dispose();
  });

  it('повторное нажатие на том же понятии останавливает; скрытая вкладка останавливает', async () => {
    const listener = listenModule.createConceptListener({ onBeforeListen: () => true, onChange: () => {} });
    await listener.play(getConcept('octave')!);
    await listener.play(getConcept('octave')!);
    expect(listener.state).toMatchObject({ status: 'idle', message: 'Остановлено.' });
    await listener.play(getConcept('fourth')!);
    expect(listener.state.status).toBe('playing');
    Object.assign(document, { hidden: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(listener.state).toMatchObject({ status: 'idle', message: 'Остановлено: вкладка скрывалась.' });
    listener.dispose();
  });

  it('без разрешения владельца звука ничего не планируется', async () => {
    const listener = listenModule.createConceptListener({ onBeforeListen: () => false, onChange: () => {} });
    await listener.play(getConcept('octave')!);
    expect(clock.oscillators).toBe(0);
    expect(listener.state.status).toBe('idle');
    expect(listener.state.message).toMatch(/не запускается/);
    listener.dispose();
  });
});

describe('владелец звука «reference»', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  async function setup(panelOpen: boolean, screen: 'play' | 'reference') {
    vi.resetModules();
    const { createSectionAudio } = await import('../src/app/sections');
    const calls: string[] = [];
    const lesson = { screen, pausePlay: () => calls.push('pausePlay'), stopPlay: () => calls.push('stopPlay'), stopCheck: () => calls.push('stopCheck'), stopReference: () => calls.push('stopReference') };
    const referencePanel = { isOpen: panelOpen, stopListening: () => calls.push('panel.stopListening') };
    const sections = { lesson, referencePanel } as unknown as Parameters<typeof createSectionAudio>[0];
    const audio = createSectionAudio(sections, { canStartAny: () => true, activeModule: () => 'lesson' });
    return { audio, calls };
  }

  it('панель поверх игры: звук справочника ставит игру на паузу, а продолжение игры останавливает справочник', async () => {
    const { audio, calls } = await setup(true, 'play');
    expect(audio.claim('play')).toBe(true);
    expect(audio.claim('reference')).toBe(true);
    expect(calls).toEqual(['pausePlay']);
    calls.length = 0;
    expect(audio.claim('play')).toBe(true);
    expect(calls).toEqual(['panel.stopListening', 'stopReference']);
  });

  it('без открытой панели звук справочника разрешён только на странице справочника', async () => {
    expect((await setup(false, 'play')).audio.claim('reference')).toBe(false);
    expect((await setup(false, 'reference')).audio.claim('reference')).toBe(true);
  });
});
