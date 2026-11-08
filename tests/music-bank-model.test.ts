import { describe, expect, it } from 'vitest';
import v1 from './fixtures/v1-backup.json?raw';
import v2 from './fixtures/v2-backup.json?raw';
import v3 from './fixtures/v3-backup.json?raw';
import v4 from './fixtures/v4-backup.json?raw';
import v5 from './fixtures/v5-backup.json?raw';
import v6 from './fixtures/v6-backup.json?raw';
import { DEFAULT_MUSIC_BANK_PREFERENCES, MUSIC_BANK_LIMITS, bindMusicBankFile, musicBankSha256, normalizeMusicBankRelativePath, validateMusicBankFile, validateMusicBankPreferences, type MusicBankPreferences } from '../src/music-bank/model';
import { createMusicBankCatalog, searchMusicBankCatalog } from '../src/music-bank/catalog';
import { DEFAULT_PREFERENCES, createMemoryStudyStore, emptySnapshot, parseBackup, validatePreferences, validateSnapshot } from '../src/storage';
import { createTracksManifest } from '../src/tracks';

const copy = <T>(value: T): T => structuredClone(value);
function preferences(): MusicBankPreferences {
  return { ...DEFAULT_MUSIC_BANK_PREFERENCES, file: { name: 'Песня.gp4', relativePath: 'Исполнитель/Песня.gp4', size: 3, sha256: 'a'.repeat(64), title: 'Песня', artist: 'Исполнитель', trackCount: 2, barCount: 8 },
    tracks: [{ index: 0, name: 'Ударные 1', visible: false, audible: true, solo: false, volume: .25 }, { index: 1, name: 'Ударные 2', visible: true, audible: false, solo: true, volume: 1.5 }], speed: .75, range: { fromBar: 3, toBar: 5 }, loop: true };
}
function file(name: string, path: string, bytes = new Uint8Array([1, 2, 3])): File {
  const value = new File([bytes.buffer as ArrayBuffer], name, { lastModified: 1234 });
  Object.defineProperty(value, 'webkitRelativePath', { value: path });
  return value;
}

describe('переносимые настройки свободного музбанка', () => {
  it('сохраняет произвольный состав, независимые представления и включительные такты', () => {
    const input = preferences(), validated = validateMusicBankPreferences(input);
    expect(validated).toEqual(input);
    expect(validated.tracks.map(track => [track.visible, track.audible, track.solo, track.volume])).toEqual([[false, true, false, .25], [true, false, true, 1.5]]);
    expect(validated.range).toEqual({ fromBar: 3, toBar: 5 });
    expect(validateMusicBankPreferences({ ...input, notation: { staff: false, tab: false } }).notation).toEqual({ staff: false, tab: false });
    expect(validateMusicBankPreferences({ ...input, tracks: input.tracks.map(t => ({ ...t, visible: false, audible: false })) }).tracks.every(t => !t.visible && !t.audible)).toBe(true);
    expect(Object.isFrozen(validated.file)).toBe(true); expect(Object.isFrozen(validated.tracks[0])).toBe(true);
    expect(validated.file).not.toBe(input.file); expect(validated.tracks).not.toBe(input.tracks);
  });

  it('проверяет весь микшер, соответствие файлу и диапазон вместо молчаливого старого контекста', () => {
    const mutations = [
      (p: any) => { p.tracks[1].index = 0; }, (p: any) => { p.tracks.reverse(); }, (p: any) => { p.tracks.pop(); },
      (p: any) => { p.file.trackCount = 3; }, (p: any) => { p.tracks = new Array(2); }, (p: any) => { p.tracks.extra = 1; },
      (p: any) => { p.range.toBar = 9; }, (p: any) => { p.range.fromBar = 6; }, (p: any) => { p.range.fromBar = 1.5; },
      (p: any) => { p.file = null; }, (p: any) => { p.file.barCount = 0; }, (p: any) => { p.file.trackCount = 0; },
    ];
    for (const mutate of mutations) { const p = copy(preferences()); mutate(p); expect(() => validateMusicBankPreferences(p)).toThrow(); }
    expect(() => validateMusicBankPreferences({ ...DEFAULT_MUSIC_BANK_PREFERENCES, loop: true })).toThrow(/файл/);
    expect(() => validateMusicBankPreferences({ ...DEFAULT_MUSIC_BANK_PREFERENCES, range: { fromBar: 1, toBar: 2 } })).toThrow(/файл/);
  });

  it('отвергает NaN, Infinity, неверные пределы и типы', () => {
    for (const change of [
      (p: any) => { p.speed = NaN; }, (p: any) => { p.speed = .24; }, (p: any) => { p.speed = 2.1; },
      (p: any) => { p.master = Infinity; }, (p: any) => { p.master = -1; }, (p: any) => { p.tracks[0].volume = 1.51; },
      (p: any) => { p.file.size = MUSIC_BANK_LIMITS.maxFileBytes + 1; }, (p: any) => { p.file.size = 1.5; },
      (p: any) => { p.follow = 'true'; }, (p: any) => { p.notation.staff = 1; }, (p: any) => { p.version = 2; },
    ]) { const p = copy(preferences()); change(p); expect(() => validateMusicBankPreferences(p)).toThrow(); }
  });

  it('запрещает runtime-поля, accessor и скрытые свойства до чтения их значений', () => {
    let getterCalls = 0;
    const p = copy(preferences()); Object.defineProperty(p.file!, 'sha256', { enumerable: true, get() { getterCalls++; return 'a'.repeat(64); } });
    expect(() => validateMusicBankPreferences(p)).toThrow(/JSON/); expect(getterCalls).toBe(0);
    for (const [key, value] of [['pcm', [0, 1]], ['fileHandle', {}], ['catalog', []], ['playbackTime', 5], ['playing', true]]) expect(() => validateMusicBankPreferences({ ...preferences(), [String(key)]: value })).toThrow();
    const withSymbol = Object.assign(copy(preferences()), { [Symbol('secret')]: true }); expect(() => validateMusicBankPreferences(withSymbol)).toThrow();
    const data = copy(preferences()); Object.defineProperty(data.tracks[0], 'rawFile', { value: {}, enumerable: false }); expect(() => validateMusicBankPreferences(data)).toThrow();
  });

  it('принимает кириллицу и требует нормализованный безопасный относительный путь', () => {
    expect(normalizeMusicBankRelativePath('Банк\\Группа\\Песня.gp4')).toBe('Банк/Группа/Песня.gp4');
    for (const path of ['/root/file.gp4', 'C:/music/file.gp4', '../file.gp4', 'a/../file.gp4', 'a//file.gp4', 'a/./file.gp4', 'a/\u0000.gp4']) expect(() => normalizeMusicBankRelativePath(path)).toThrow();
    expect(() => validateMusicBankFile({ ...preferences().file, relativePath: 'Группа\\Песня.gp4' })).toThrow();
    expect(() => validateMusicBankFile({ ...preferences().file, relativePath: 'Группа/Другая.gp4' })).toThrow(/соответствует/);
    expect(() => validateMusicBankFile({ ...preferences().file, name: '../Песня.gp4' })).toThrow();
    expect(() => validateMusicBankFile({ ...preferences().file, sha256: 'A'.repeat(64) })).toThrow(/SHA/);
  });

  it('повторно связывает только точные байты, разрешая другое имя', async () => {
    const bytes = new Uint8Array([1, 2, 3]), sha256 = await musicBankSha256(bytes);
    expect(sha256).toBe('039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');
    const expected = validateMusicBankFile({ ...preferences().file, sha256 });
    expect(await bindMusicBankFile(file('Другое имя.gp4', ''), expected)).toEqual(bytes);
    await expect(bindMusicBankFile(file('Песня.gp4', '', new Uint8Array([3, 2, 1])), expected)).rejects.toThrow(/SHA/);
    let read = false; await expect(bindMusicBankFile({ size: 4, async arrayBuffer() { read = true; return bytes.buffer; } }, expected)).rejects.toThrow(/Размер/); expect(read).toBe(false);
  });
});

describe('каталог только в памяти страницы', () => {
  it('индексирует пути без чтения партитур и сохраняет одинаковые имена разных аранжировок', () => {
    const first = file('Song.gp4', 'Банк/First/Song.gp4'), second = file('Song.gp4', 'Банк/Second/Song.gp4'), extensionless = file('Regression', 'Банк/Dream/Regression');
    for (const f of [first, second, extensionless]) Object.defineProperty(f, 'arrayBuffer', { value() { throw new Error('Каталог не должен читать содержимое'); } });
    const catalog = createMusicBankCatalog([first, second, extensionless]);
    expect(catalog).toHaveLength(3); expect(catalog[0].file).toBe(first); expect(Object.isFrozen(catalog)).toBe(true);
    expect(searchMusicBankCatalog(catalog, 'song second').map(item => item.relativePath)).toEqual(['Банк/Second/Song.gp4']);
    expect(searchMusicBankCatalog(catalog, 'банк regression').map(item => item.name)).toEqual(['Regression']);
    expect(searchMusicBankCatalog(catalog, '  ')).toBe(catalog);
  });
  it('не принимает дубли пути и ошибочные файлы частично', () => {
    const first = file('Song.gp4', 'Банк/Song.gp4');
    const original = createMusicBankCatalog([first]);
    expect(() => createMusicBankCatalog([first, first])).toThrow(/повторяется/);
    expect(() => createMusicBankCatalog([first, file('empty.gp4', '', new Uint8Array())])).toThrow(/размер/);
    expect(original).toHaveLength(1); expect(original[0].file).toBe(first);
  });
});

describe('schema7: музбанк отдельно от legacy-аудиофайлов и неизменённая история', () => {
  it.each([[1, v1], [2, v2], [3, v3], [4, v4], [5, v5], [6, v6]] as const)('мигрирует буквальную версию %i с пустым musicBank', (_version, json) => {
    const before = JSON.parse(json), bytes = JSON.stringify(before), next = parseBackup(json);
    expect(next.schemaVersion).toBe(7); expect(next.preferences.musicBank).toBeNull();
    expect(next.presets.every(p => p.preferences.musicBank === null)).toBe(true);
    expect(JSON.stringify(before)).toBe(bytes); expect(parseBackup(JSON.stringify(next))).toEqual(next);
  });

  it('сохраняет буквально весь profile/draft/history v6 и старые записи WAV/MP3', () => {
    const before = JSON.parse(v6), next = parseBackup(v6);
    expect(next.profile).toEqual({ theme: 'dark', onboarding: { version: 1, choice: 'guided', completed: true } });
    expect(next.profile).toEqual(before.profile); expect(next.practiceDrafts).toEqual(before.practiceDrafts); expect(next.history).toEqual(before.history);
    expect(next.preferences).toEqual({ ...before.preferences, musicBank: null });
    expect(next.presets).toEqual(before.presets.map((p: any) => ({ ...p, preferences: { ...p.preferences, musicBank: null } })));
  });

  it('не допускает подмену версии и скрытые новые поля в старой копии', () => {
    const previous = JSON.parse(v6); previous.preferences.musicBank = null;
    expect(() => parseBackup(JSON.stringify(previous))).toThrow(/неизвестные/);
    expect(() => parseBackup(JSON.stringify({ ...emptySnapshot(), schemaVersion: 8 }))).toThrow(/версия/);
    for (const mutate of [(p: any) => { p.profile.theme = 'auto'; }, (p: any) => { p.practiceDrafts[0].recordedThroughMs = 999999; }, (p: any) => { p.practiceDrafts[0].localDate = '2026-11-08'; }]) {
      const old = JSON.parse(v6); mutate(old); expect(() => parseBackup(JSON.stringify(old))).toThrow();
    }
  });

  it('экспортирует metadata музбанка вместе с прежним manifest, без каталога и исходных байтов', async () => {
    const tracks = createTracksManifest({ id: 'legacy-audio', tracks: [{ id: 'stem-1', name: 'bass.wav', size: 40044, lastModified: 1234, sha256: 'b'.repeat(64), decoded: { duration: 1, frames: 20000, sampleRate: 20000, channels: 1 }, volume: .65, muted: true }] });
    const store = createMemoryStudyStore(); await store.savePreferences({ ...DEFAULT_PREFERENCES, activeModule: 'tracks', tracks, musicBank: preferences() });
    const json = await store.exportBackup(), snapshot = parseBackup(json);
    expect(snapshot.preferences.tracks).toEqual(tracks); expect(snapshot.preferences.musicBank).toEqual(preferences()); expect(snapshot.schemaVersion).toBe(7);
    expect(json).not.toMatch(/arrayBuffer|fileHandle|rawFile|"pcm"|catalog|playbackTime/);
    const fresh = createMemoryStudyStore(); await fresh.restore(json, { confirmed: true }); expect(await fresh.readSnapshot()).toEqual(snapshot);
  });

  it('валидирует musicBank даже в неактивном разделе и каждом preset до отмены/замены базы', async () => {
    const store = createMemoryStudyStore(); await store.restore(v6, { confirmed: true }); const before = await store.readSnapshot();
    const good = validateSnapshot({ ...before, preferences: { ...before.preferences, musicBank: preferences() } });
    await store.restore(JSON.stringify(good), { confirmed: false }); expect(await store.readSnapshot()).toBe(before);
    const bad: any = copy(good); bad.preferences.activeModule = 'foundation'; bad.preferences.musicBank.tracks[1].index = 7;
    expect(() => validateSnapshot(bad)).toThrow(); await expect(store.restore(JSON.stringify(bad), { confirmed: true })).rejects.toMatchObject({ code: 'INVALID_DATA' }); expect(await store.readSnapshot()).toBe(before);
    const preset = { id: 'bad-bank', name: 'Плохой музбанк', createdAt: '2026-11-08T22:30:00.000Z', preferences: { ...DEFAULT_PREFERENCES, musicBank: { ...preferences(), rawFile: {} } } };
    expect(() => validateSnapshot({ ...emptySnapshot(), presets: [preset] })).toThrow();
    expect(() => validatePreferences({ ...DEFAULT_PREFERENCES, musicBank: undefined })).toThrow();
  });
});
