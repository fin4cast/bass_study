import {
  DEFAULT_RHYTHM_VELOCITY, RHYTHM_PATTERN_IDS, RHYTHM_PRESETS, RHYTHM_STEPS_PER_BAR, SOUND_LABELS,
  createLanes, validateRhythmPreferences, validateRhythmProject,
  type RhythmMetronome, type RhythmPatternBars, type RhythmPatternId, type RhythmPatternLane,
  type RhythmPlaybackConfig, type RhythmPreferences, type RhythmPresetId, type RhythmProject, type RhythmSound, type RhythmStep,
} from './model';

export type RhythmBarCopy = ReadonlyMap<string, Pick<RhythmPatternLane, 'steps' | 'velocities'>>;
export type RhythmProjectEdit =
  | { readonly kind: 'settings'; readonly change: Partial<Pick<RhythmProject, 'bpm' | 'countIn' | 'swing' | 'swingMode' | 'scope' | 'repeat' | 'activePatternId'>> }
  | { readonly kind: 'overlay'; readonly enabled: boolean }
  | { readonly kind: 'resize'; readonly bars: RhythmPatternBars }
  | { readonly kind: 'bar'; readonly bar: number; readonly source: RhythmBarCopy | null }
  | { readonly kind: 'step'; readonly channelId: string; readonly bar: number; readonly step: number; readonly level: RhythmStep; readonly velocity?: number }
  | { readonly kind: 'lane-volume'; readonly id: string; readonly volume: number }
  | { readonly kind: 'lane-toggle'; readonly id: string; readonly control: 'muted' | 'solo' }
  | { readonly kind: 'lane-default'; readonly id: string; readonly control: 'hit' | 'accent'; readonly value: number }
  | { readonly kind: 'add-lane'; readonly id: string; readonly sound: RhythmSound }
  | { readonly kind: 'add-pattern'; readonly duplicate: boolean }
  | { readonly kind: 'rename-pattern'; readonly name: string }
  | { readonly kind: 'add-clip'; readonly id: string }
  | { readonly kind: 'assign-clip'; readonly id: string; readonly patternId: RhythmPatternId }
  | { readonly kind: 'move-clip'; readonly id: string; readonly move: 'left' | 'right' | 'remove' }
  | { readonly kind: 'preset'; readonly id: RhythmPresetId; readonly fallbackIds: readonly string[] };

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[] : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> } : T;
const activePattern = (project: Mutable<RhythmProject>) => project.patterns.find(pattern => pattern.id === project.activePatternId)!;
const emptyLane = (channelId: string, bars: number) => ({
  channelId, steps: Array<RhythmStep>(bars * RHYTHM_STEPS_PER_BAR).fill(0), velocities: Array<number>(bars * RHYTHM_STEPS_PER_BAR).fill(0),
});

export function metronomeTempo(metronome: RhythmMetronome, bpm: number) {
  const training = metronome.training;
  return { bpm, targetBpm: training.rampEnabled ? Math.max(training.targetBpm, bpm) : training.targetBpm };
}

export function withProjectTempo(preferences: RhythmPreferences, project: RhythmProject): RhythmPreferences {
  if (!project.overlay || project.bpm === preferences.metronome.bpm) return preferences;
  const { bpm, targetBpm } = metronomeTempo(preferences.metronome, project.bpm);
  return validateRhythmPreferences({
    ...preferences, metronome: { ...preferences.metronome, bpm, training: { ...preferences.metronome.training, targetBpm } },
  });
}

export function playbackForRhythmRun(next: RhythmPlaybackConfig, current: RhythmPlaybackConfig | null): RhythmPlaybackConfig {
  if (!current) return next;
  if (next.project && current.project && next.project.countIn !== current.project.countIn) {
    return { ...next, project: { ...next.project, countIn: current.project.countIn } };
  }
  if (!next.project && !current.project && next.preferences.metronome.countIn !== current.preferences.metronome.countIn) {
    return { preferences: { ...next.preferences, metronome: { ...next.preferences.metronome, countIn: current.preferences.metronome.countIn } } };
  }
  return next;
}

export function copyRhythmBar(project: RhythmProject, bar: number): RhythmBarCopy {
  const offset = bar * RHYTHM_STEPS_PER_BAR, end = offset + RHYTHM_STEPS_PER_BAR;
  const pattern = project.patterns.find(pattern => pattern.id === project.activePatternId)!;
  return new Map(pattern.lanes.map(lane => [lane.channelId, { steps: lane.steps.slice(offset, end), velocities: lane.velocities.slice(offset, end) }]));
}

function applyPreset(project: Mutable<RhythmProject>, id: RhythmPresetId, fallbackIds: readonly string[]) {
  const preset = RHYTHM_PRESETS.find(item => item.id === id)!;
  const lanes = createLanes(id, activePattern(project).bars);
  const sources = new Map<string, Mutable<RhythmPatternLane>>();
  for (const [index, { steps, velocities, ...channel }] of lanes.entries()) {
    const existing = project.channels.find(item => item.sound === channel.sound);
    if (!existing && project.channels.length >= 8) continue;
    const channelId = existing?.id ?? (project.channels.some(item => item.id === channel.id) ? fallbackIds[index] : channel.id);
    if (!existing) project.channels.push({ ...channel, id: channelId });
    sources.set(channelId, { channelId, steps, velocities });
  }
  for (const pattern of project.patterns) {
    const active = pattern.id === project.activePatternId;
    pattern.lanes = project.channels.map(channel => {
      const source = active ? sources.get(channel.id) : pattern.lanes.find(lane => lane.channelId === channel.id);
      return source ?? emptyLane(channel.id, pattern.bars);
    });
    if (active) pattern.name = preset.name;
  }
  project.bpm = preset.bpm; project.swing = preset.swing; project.swingMode = 'eighth';
  return sources.keys().next().value ?? project.channels[0].id;
}

/** Apply an edit without reading the clock, creating IDs or touching audio, DOM or storage. */
export function applyRhythmProjectEdit(project: RhythmProject, preferences: RhythmPreferences, edit: RhythmProjectEdit, at: number) {
  const next = structuredClone(project) as Mutable<RhythmProject>;
  const pattern = activePattern(next);
  let selectedLane: string | undefined;
  switch (edit.kind) {
    case 'settings': Object.assign(next, edit.change); break;
    case 'overlay':
      if (edit.enabled && !next.overlay) next.bpm = preferences.metronome.bpm;
      next.overlay = edit.enabled;
      break;
    case 'resize': {
      const length = edit.bars * RHYTHM_STEPS_PER_BAR;
      for (const lane of pattern.lanes) {
        lane.steps = Array.from({ length }, (_, index) => lane.steps[index] ?? 0);
        lane.velocities = Array.from({ length }, (_, index) => lane.velocities[index] ?? 0);
      }
      pattern.bars = edit.bars;
      break;
    }
    case 'bar': {
      const offset = edit.bar * RHYTHM_STEPS_PER_BAR;
      for (const lane of pattern.lanes) {
        const source = edit.source?.get(lane.channelId) ?? emptyLane(lane.channelId, 1);
        lane.steps.splice(offset, RHYTHM_STEPS_PER_BAR, ...source.steps);
        lane.velocities.splice(offset, RHYTHM_STEPS_PER_BAR, ...source.velocities);
      }
      break;
    }
    case 'step': {
      const lane = pattern.lanes.find(lane => lane.channelId === edit.channelId)!;
      const defaults = next.channels.find(channel => channel.id === edit.channelId)!.velocityDefaults;
      const index = edit.bar * RHYTHM_STEPS_PER_BAR + edit.step;
      lane.steps[index] = edit.level;
      lane.velocities[index] = edit.level === 0 ? 0 : edit.velocity ?? (edit.level === 2 ? defaults.accent : defaults.hit) / 100;
      break;
    }
    case 'lane-volume':
    case 'lane-toggle':
    case 'lane-default': {
      const lane = next.channels.find(channel => channel.id === edit.id);
      if (!lane) break;
      if (edit.kind === 'lane-volume') lane.volume = edit.volume;
      else if (edit.kind === 'lane-toggle') lane[edit.control] = !lane[edit.control];
      else lane.velocityDefaults[edit.control] = edit.value;
      break;
    }
    case 'add-lane':
      if (next.channels.length < 8 && !next.channels.some(channel => channel.sound === edit.sound)) {
        next.channels.push({ id: edit.id, sound: edit.sound, name: SOUND_LABELS[edit.sound], volume: .65, muted: false, solo: false,
          velocityDefaults: { ...DEFAULT_RHYTHM_VELOCITY } });
        for (const item of next.patterns) item.lanes.push(emptyLane(edit.id, item.bars));
      }
      break;
    case 'add-pattern': {
      const id = RHYTHM_PATTERN_IDS.find(value => !next.patterns.some(item => item.id === value));
      if (!id) break;
      next.patterns.push(edit.duplicate ? { ...structuredClone(pattern), id, name: `${pattern.name.slice(0, 41)} · копия` }
        : { id, name: `Паттерн ${id}`, bars: 1, lanes: next.channels.map(channel => emptyLane(channel.id, 1)) });
      next.activePatternId = id;
      break;
    }
    case 'rename-pattern': pattern.name = edit.name; break;
    case 'add-clip':
      if (next.chain.length < 8) next.chain.push({ id: edit.id, patternId: next.activePatternId });
      break;
    case 'assign-clip': {
      const clip = next.chain.find(clip => clip.id === edit.id);
      if (clip) clip.patternId = edit.patternId;
      break;
    }
    case 'move-clip': {
      const index = next.chain.findIndex(clip => clip.id === edit.id);
      if (index < 0) break;
      if (edit.move === 'remove') {
        if (next.chain.length > 1) next.chain.splice(index, 1);
      } else {
        const target = index + (edit.move === 'left' ? -1 : 1);
        if (target >= 0 && target < next.chain.length) [next.chain[index], next.chain[target]] = [next.chain[target], next.chain[index]];
      }
      break;
    }
    case 'preset': selectedLane = applyPreset(next, edit.id, edit.fallbackIds); break;
  }
  next.updatedAt = new Date(Math.max(at, Date.parse(next.updatedAt))).toISOString();
  const checked = validateRhythmProject(next);
  return { project: checked, preferences: withProjectTempo(preferences, checked), selectedLane };
}
