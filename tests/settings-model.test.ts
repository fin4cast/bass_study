import { describe, expect, it } from 'vitest';
import {
  BPM_MAX, BPM_MIN, SECTIONS, clampBpm, compareCounts, countLines, formatBytes, rejectionText, saveKind, sectionSummaries, stepBpm, withDefaults,
  type PlayDefaults, type SettingsState,
} from '../src/ui/settings/model';

const defaults: PlayDefaults = { view: 'tabBoard', newExerciseView: 'board', countIn: true, labels: 'notes', bpm: 60 };
const state: SettingsState = { theme: 'light', playDefaults: defaults, saveStatus: 'saved', writer: 'owner', version: '1.4.0', dataVersion: 11 };

describe('разделы настроек (вариант B)', () => {
  it('пять разделов в утверждённом порядке', () => {
    expect(SECTIONS.map(section => section.id)).toEqual(['look', 'lesson', 'data', 'input', 'about']);
    expect(SECTIONS.map(section => section.short)).toEqual(['Оформление', 'Занятие', 'Данные', 'Аудиовход', 'О приложении']);
  });
  it('сводка раздела описывает текущее состояние словами', () => {
    expect(sectionSummaries(state)).toEqual({
      look: 'Светлая', lesson: 'Таб + гриф · отсчёт 4', data: 'Сохранено', input: 'Проверка сигнала', about: 'Версия 1.4.0',
    });
    const dark = sectionSummaries({ ...state, theme: 'dark', playDefaults: { ...defaults, view: 'memory', countIn: false }, saveStatus: { error: 'Тема' }, inputSummary: 'Подключён' });
    expect(dark).toMatchObject({ look: 'Тёмная', lesson: 'По памяти · отсчёт выкл', data: 'Не сохранено', input: 'Подключён' });
    expect(sectionSummaries({ ...state, writer: 'other-tab', saveStatus: { error: 'x' } }).data).toBe('Только просмотр');
  });
  it('вторая вкладка важнее ошибки записи, ошибка важнее «сохраняем»', () => {
    expect(saveKind({ saveStatus: 'saved', writer: 'owner' })).toBe('ok');
    expect(saveKind({ saveStatus: 'saving', writer: 'owner' })).toBe('saving');
    expect(saveKind({ saveStatus: { error: 'x' }, writer: 'owner' })).toBe('error');
    expect(saveKind({ saveStatus: { error: 'x' }, writer: 'other-tab' })).toBe('other');
  });
});

describe('умолчания занятия', () => {
  it('темп меняется шагом и не выходит за границы', () => {
    expect(stepBpm(defaults, 4).bpm).toBe(64);
    expect(stepBpm({ ...defaults, bpm: BPM_MIN }, -4).bpm).toBe(BPM_MIN);
    expect(stepBpm({ ...defaults, bpm: BPM_MAX }, 4).bpm).toBe(BPM_MAX);
    expect(clampBpm(Number.NaN)).toBe(BPM_MIN);
    expect(Object.isFrozen(stepBpm(defaults, 4))).toBe(true);
  });
  it('отклоняет неизвестные значения', () => {
    expect(withDefaults(defaults, { view: 'board' }).view).toBe('board');
    expect(withDefaults(defaults, { newExerciseView: null }).newExerciseView).toBeNull();
    expect(() => withDefaults(defaults, { view: 'piano' as never })).toThrow();
    expect(() => withDefaults(defaults, { labels: 'roman' as never })).toThrow();
  });
});

describe('резервная копия', () => {
  const copy = { history: 131, exercises: 5, rhythm: 2, drafts: 0 };
  const current = { history: 148, exercises: 6, rhythm: 3, drafts: 1 };
  it('состав копии со склонением', () => {
    expect(countLines(current)).toEqual(['настройки и тема', 'история занятий — 148 записей', 'свои упражнения — 6', 'ритм-проекты — 3', 'незаконченная практика — 1']);
    expect(countLines({ history: 1, rhythm: 0, drafts: 0 })[1]).toBe('история занятий — 1 запись');
    expect(countLines(undefined)).toContain('история занятий');
  });
  it('сравнивает копию с текущими данными и считает потерю истории', () => {
    const compared = compareCounts(copy, current);
    expect(compared.lostHistory).toBe(17);
    expect(compared.rows.map(row => row.label)).toEqual(['История занятий', 'Свои упражнения', 'Ритм-проекты', 'Незаконченная практика', 'Настройки и тема']);
    expect(compareCounts(current, copy).lostHistory).toBe(0);
    expect(compareCounts({ history: 1, rhythm: 0, drafts: 0 }, { history: 1, rhythm: 0, drafts: 0 }).rows.map(row => row.label)).not.toContain('Свои упражнения');
  });
  it('честно отклоняет копию прежней версии данных (D-042)', () => {
    const text = rejectionText({ kind: 'error', reason: 'version', fileName: 'old.json', fileVersion: 10 }, 11);
    expect(text.title).toBe('Эта копия не подходит');
    expect(text.text).toBe('«old.json» сделана для версии данных 10, а сейчас версия 11.');
    expect(text.note).toMatch(/Старые копии не загружаются/);
    expect(rejectionText({ kind: 'error', reason: 'invalid' }, 11).title).toBe('Это не копия тренажёра');
  });
  it('размер файла по-русски', () => {
    expect(formatBytes(512)).toBe('512 Б');
    expect(formatBytes(186_000)).toBe('182 КБ');
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3,5 МБ');
    expect(formatBytes(-1)).toBe('');
  });
});
