import {
  RHYTHM_PRESETS, SOUND_LABELS,
  type RhythmKit, type RhythmPattern, type RhythmPatternBars, type RhythmPreferences, type RhythmProject, type RhythmSound,
} from '../../rhythm/model';
import { rhythmInstrumentArt } from './instrument-art';
import { rhythmButton } from './view';

/** Узлы редактора ритма из состояния: разметка без обработчиков. Обработчики и фокус остаются в `ui/rhythm.ts`. */

type Channel = RhythmProject['channels'][number];
type Lane = RhythmPattern['lanes'][number];

const LEVELS = ['Без щелчка', 'Доля', 'Акцент'];
export const RHYTHM_KITS: ReadonlyArray<readonly [RhythmKit, string, string]> = [
  ['wood', 'Дерево', 'Мягкий короткий щелчок'], ['classic', 'Классический', 'Чёткий механический пульс'],
  ['electronic', 'Электронный', 'Чистый короткий тон'], ['bell', 'Колокольчик', 'Светлый звонкий акцент'],
  ['clave', 'Клавес', 'Сухой деревянный удар'], ['drum', 'Ударные', 'Бочка и малый'],
];

export function rhythmKitButtons(): HTMLButtonElement[] {
  return RHYTHM_KITS.map(([id, name, description]) => {
    const button = rhythmButton(name, { rhythmKit: id });
    const hint = document.createElement('small'); hint.textContent = description; button.append(hint);
    return button;
  });
}

export function rhythmPresetButtons(): HTMLButtonElement[] {
  return RHYTHM_PRESETS.map(preset => {
    const button = rhythmButton(preset.name, { rhythmPreset: preset.id });
    const hint = document.createElement('small'); hint.textContent = `${preset.bpm} BPM · 4/4${preset.swing > 50 ? ' · свинг' : ''}`; button.append(hint);
    return button;
  });
}

export function rhythmBeatGroups(metro: RhythmPreferences['metronome']): HTMLElement[] {
  const starts = new Set<number>();
  let start = 0;
  for (const group of metro.meter.groups) { starts.add(start); start += group; }
  return metro.accents.map((level, index) => {
    const group = document.createElement('div'); group.className = `rhythm-beat-group${starts.has(index) ? ' is-group-start' : ''}`;
    const beat = rhythmButton(String(index + 1), { rhythmBeat: String(index), rhythmFocus: `beat-${index}`, level: String(level) }, `Доля ${index + 1}. ${LEVELS[level]}`);
    beat.className = 'rhythm-beat';
    const lamp = document.createElement('span'); lamp.className = 'rhythm-beat-lamp'; lamp.setAttribute('aria-hidden', 'true');
    const label = document.createElement('small'); label.textContent = level === 0 ? 'Пауза' : LEVELS[level];
    beat.append(lamp, label); group.append(beat);
    if (metro.division > 1) {
      const subdivisions = document.createElement('div'); subdivisions.className = 'rhythm-substeps';
      for (let subdivision = 1; subdivision < metro.division; subdivision++) {
        const key = index * (metro.division - 1) + subdivision - 1;
        const step = rhythmButton('·', { rhythmSubstep: String(subdivision), rhythmSubIndex: String(key), rhythmFocus: `sub-${key}` }, `Доля ${index + 1}, подразделение ${subdivision}`);
        step.className = 'rhythm-substep'; step.setAttribute('aria-pressed', String(metro.substeps[key])); subdivisions.append(step);
      }
      group.append(subdivisions);
    }
    return group;
  });
}

export function rhythmProjectRows(projects: readonly RhythmProject[], currentId: string, unavailable: boolean): HTMLElement[] {
  return projects.map(entry => {
    const row = document.createElement('div'); row.className = 'rhythm-project-row';
    const open = rhythmButton(entry.name, { rhythmOpenProject: entry.id, rhythmFocus: `project-${entry.id}` });
    open.disabled = unavailable; open.setAttribute('aria-pressed', String(entry.id === currentId));
    const remove = rhythmButton('Удалить', { rhythmDeleteProject: entry.id, rhythmFocus: `delete-${entry.id}` }, `Удалить проект «${entry.name}»`);
    remove.className = 'text-button button-compact';
    remove.disabled = unavailable; row.append(open, remove); return row;
  });
}

/** Линейка и строки каналов; состояние шагов рисует `paintSteps`. */
export function rhythmRackRows(project: RhythmProject, selectedLane: string): HTMLElement[] {
  const ruler = document.createElement('div'); ruler.className = 'rhythm-rack-ruler';
  const meter = document.createElement('span'); meter.textContent = '4/4'; ruler.append(meter);
  for (let beat = 1; beat <= 4; beat++) {
    const span = document.createElement('span'); span.className = 'rhythm-rack-beat'; span.textContent = String(beat); ruler.append(span);
  }
  const rows = project.channels.map(channel => {
    const row = document.createElement('div'); row.className = `rhythm-rack-row${channel.muted ? ' is-muted' : ''}`; row.dataset.rhythmLane = channel.id;
    const controls = document.createElement('div'); controls.className = 'rhythm-lane-controls';
    const name = rhythmButton('', { rhythmSelectLane: channel.id, rhythmFocus: `lane-${channel.id}` }, `Выбрать канал ${channel.name}`);
    name.className = 'rhythm-lane-name'; name.setAttribute('aria-pressed', String(channel.id === selectedLane));
    name.innerHTML = rhythmInstrumentArt(channel.sound);
    const label = document.createElement('span'); label.textContent = channel.name; name.append(label);
    controls.append(name); row.append(controls);
    for (let beat = 0; beat < 4; beat++) {
      const bank = document.createElement('div'); bank.className = 'rhythm-pad-bank';
      for (let offset = 0; offset < 4; offset++) {
        const step = beat * 4 + offset;
        const button = rhythmButton('', { rhythmStep: String(step), rhythmChannel: channel.id, rhythmFocus: `step-${channel.id}-${step}` });
        button.className = 'rhythm-step';
        button.title = 'Правый клик или Shift+Enter — переключить акцент';
        button.setAttribute('aria-keyshortcuts', 'Shift+Enter');
        bank.append(button);
      }
      row.append(bank);
    }
    return row;
  });
  return [ruler, ...rows];
}

/** Строка силы ударов выбранного канала в выбранном такте; проценты и выбор рисует `paintVelocity`. */
export function rhythmVelocityRow(channel: Channel, lane: Lane, selectedBar: number): HTMLElement {
  const row = document.createElement('div'); row.className = 'rhythm-velocity-row';
  const label = document.createElement('div'); label.className = 'rhythm-velocity-label';
  const name = document.createElement('strong'); name.textContent = channel.name;
  const level = document.createElement('output'); level.className = 'rhythm-velocity-value'; level.setAttribute('aria-live', 'off');
  label.append(name, level); row.append(label);
  for (let beat = 0; beat < 4; beat++) {
    const bank = document.createElement('div'); bank.className = 'rhythm-pad-bank';
    for (let offset = 0; offset < 4; offset++) {
      const step = beat * 4 + offset;
      const cell = document.createElement('div'); cell.className = 'rhythm-velocity-cell';
      const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '1'; slider.step = '.01';
      slider.value = String(lane.velocities[selectedBar * 16 + step]); slider.dataset.rhythmVelocity = String(step);
      slider.dataset.rhythmFocus = `velocity-${step}`; slider.setAttribute('aria-label', `Сила удара ${channel.name}, шаг ${step + 1}`);
      const track = document.createElement('span'); track.className = 'rhythm-velocity-track'; track.setAttribute('aria-hidden', 'true');
      cell.append(track, slider); bank.append(cell);
    }
    row.append(bank);
  }
  return row;
}

export function paintRhythmFader(input: HTMLInputElement, value = input.valueAsNumber) {
  const label = `${Math.round(value * 100)}%`;
  input.setAttribute('aria-valuetext', label);
  input.closest('.rhythm-channel')!.querySelector<HTMLOutputElement>('[data-rhythm-level]')!.value = label;
}

export function rhythmMixerStrips(project: RhythmProject): HTMLElement[] {
  return project.channels.map(channel => {
    const strip = document.createElement('div'); strip.className = 'rhythm-channel';
    const title = document.createElement('span'); title.className = 'rhythm-channel-name'; title.textContent = channel.name; title.title = channel.name;
    const slot = document.createElement('span'); slot.className = 'rhythm-fader-slot';
    const volume = document.createElement('input'); volume.type = 'range'; volume.className = 'rhythm-fader';
    volume.min = '0'; volume.max = '1.5'; volume.step = '.05'; volume.value = String(channel.volume);
    volume.dataset.rhythmVolume = channel.id; volume.dataset.rhythmFocus = `volume-${channel.id}`; volume.setAttribute('aria-label', `Громкость ${channel.name}`);
    slot.append(volume);
    const level = document.createElement('output'); level.dataset.rhythmLevel = '';
    const keys = document.createElement('div'); keys.className = 'rhythm-channel-keys';
    const mute = rhythmButton('M', { rhythmMute: channel.id, rhythmFocus: `mute-${channel.id}` }, `${channel.name}. Заглушить`);
    mute.className = 'rhythm-lane-mute'; mute.setAttribute('aria-pressed', String(channel.muted)); mute.title = 'Заглушить';
    const solo = rhythmButton('S', { rhythmSolo: channel.id, rhythmFocus: `solo-${channel.id}` }, `${channel.name}. Соло`);
    solo.className = 'rhythm-lane-solo'; solo.setAttribute('aria-pressed', String(channel.solo)); solo.title = 'Соло';
    keys.append(mute, solo); strip.append(title, slot, level, keys); paintRhythmFader(volume, channel.volume);
    return strip;
  });
}

/** Карточки цепочки и общая длина в тактах. */
export function rhythmChainClips(project: RhythmProject, selectedIndex: number): { readonly clips: HTMLElement[]; readonly bars: number } {
  let bars = 0;
  const clips = project.chain.map((clip, index) => {
    const pattern = project.patterns.find(item => item.id === clip.patternId)!;
    const card = rhythmButton('', { rhythmClip: clip.id, rhythmClipPattern: pattern.id, rhythmFocus: `clip-title-${clip.id}` }, `Блок ${index + 1}. Паттерн ${pattern.id}. ${pattern.name}`);
    card.className = 'rhythm-clip'; card.setAttribute('aria-pressed', String(index === selectedIndex));
    card.title = pattern.name;
    const mark = document.createElement('span'); mark.className = 'rhythm-clip-mark'; mark.textContent = pattern.id;
    const name = document.createElement('span'); name.className = 'rhythm-clip-name'; name.textContent = pattern.name;
    const range = document.createElement('span'); range.className = 'rhythm-clip-range';
    range.textContent = pattern.bars === 1 ? `Такт ${bars + 1}` : `Такты ${bars + 1}–${bars + pattern.bars}`;
    bars += pattern.bars; card.append(mark, name, range);
    return card;
  });
  return { clips, bars };
}

/** Редактор выбранного блока цепочки: заголовок, выбор паттерна, перемещение и удаление. */
export function rhythmClipEditor(project: RhythmProject, selectedIndex: number): HTMLElement[] {
  const clip = project.chain[selectedIndex];
  const title = document.createElement('strong'); title.className = 'rhythm-clip-editor-title';
  title.textContent = `Блок ${selectedIndex + 1} · ${project.patterns.find(pattern => pattern.id === clip.patternId)!.name}`;
  const patterns = document.createElement('div'); patterns.className = 'rhythm-segment';
  patterns.setAttribute('role', 'group'); patterns.setAttribute('aria-label', `Паттерн блока ${selectedIndex + 1}`);
  for (const item of project.patterns) {
    const key = rhythmButton(item.id, {
      rhythmClipSelect: clip.id, rhythmValue: item.id, rhythmFocus: `clip-${clip.id}-${item.id}`,
    }, `Паттерн ${item.id}. ${item.name}`);
    key.title = item.name;
    key.setAttribute('aria-pressed', String(item.id === clip.patternId)); patterns.append(key);
  }
  const controls = document.createElement('div'); controls.className = 'rhythm-clip-actions';
  for (const [move, label, text] of [['left', 'Переместить влево', '←'], ['right', 'Переместить вправо', '→'], ['remove', 'Убрать', '×']] as const) {
    const button = rhythmButton(text, { rhythmClipAction: move, rhythmClipId: clip.id, rhythmFocus: `clip-${move}-${clip.id}` }, `${label} блок ${selectedIndex + 1}`);
    button.title = label;
    button.disabled = move === 'left' ? selectedIndex === 0 : move === 'right' ? selectedIndex + 1 === project.chain.length : project.chain.length === 1;
    controls.append(button);
  }
  return [title, patterns, controls];
}

export function rhythmPatternButtons(project: RhythmProject, activeId: string): HTMLButtonElement[] {
  return project.patterns.map(item => {
    const button = rhythmButton(item.id, { rhythmPattern: item.id, rhythmFocus: `pattern-${item.id}` }, `Паттерн ${item.id}. ${item.name}`);
    button.setAttribute('aria-pressed', String(item.id === activeId)); return button;
  });
}

/** Кнопки тактов паттерна и, если длина позволяет, «+ Такт». */
export function rhythmBarButtons(bars: RhythmPatternBars, selectedBar: number, nextLength: RhythmPatternBars | undefined): HTMLButtonElement[] {
  const buttons = Array.from({ length: bars }, (_, index) => {
    const button = rhythmButton(`Такт ${index + 1}`, { rhythmBar: String(index), rhythmFocus: `bar-${index}` });
    button.setAttribute('aria-pressed', String(index === selectedBar)); return button;
  });
  if (nextLength !== undefined) {
    const addBar = rhythmButton('+ Такт', { rhythmAction: 'add-bar', rhythmFocus: `bar-${bars}` }, `Добавить такт ${nextLength}`);
    addBar.className = 'rhythm-add-bar';
    addBar.title = `Добавить пустой такт ${nextLength}`;
    buttons.push(addBar);
  }
  return buttons;
}

export function rhythmSoundButtons(sounds: readonly RhythmSound[]): HTMLButtonElement[] {
  return sounds.map(sound => {
    const button = rhythmButton('', { rhythmChoice: 'new-sound', rhythmValue: sound, rhythmFocus: `sound-${sound}` });
    button.innerHTML = rhythmInstrumentArt(sound);
    const label = document.createElement('span'); label.textContent = SOUND_LABELS[sound]; button.append(label);
    return button;
  });
}
