import { describe, expect, it } from 'vitest';
import { TRACK_LIMITS, assertFileMatches, createTracksManifest, decodedBytes, planTrackSegments, setTrackMix, setTracksPlayback, trackPositionAt, validateTracksManifest, type TrackDescriptor } from '../src/tracks';

function track(id = 'long', duration = 2): TrackDescriptor {
  return { id, name: `${id}.wav`, size: 1000, lastModified: 0, sha256: (id === 'long' ? 'a' : 'b').repeat(64),
    decoded: { duration, frames: duration * 48000, sampleRate: 48000, channels: 1 }, volume: 0.8, muted: false };
}
const manifest = () => createTracksManifest({ id: 'synthetic-stems', tracks: [track(), track('short', 0.75)] });

describe('общая временная шкала и [A,B) без независимых коротких циклов', () => {
  it('[0.5,1.5) отображает импульсы0.5/1 на выход0/0.5; импульс B1.5 исключён', () => {
    const clipped = setTracksPlayback(manifest(), { clip: { from: 0.5, to: 1.5 } });
    const plan = planTrackSegments(clipped);
    const long = plan.segments.find(segment => segment.trackId === 'long')!;
    expect(long).toMatchObject({ atSeconds: 0, offsetSeconds: 0.5, durationSeconds: 1, playDurationSeconds: 1, endAtSeconds: 1 });
    const sourceImpulseTimes = [0.5, 1, 1.5];
    const outputImpulseTimes = sourceImpulseTimes.filter(time => time >= long.offsetSeconds && time < long.offsetSeconds + long.durationSeconds).map(time => long.atSeconds + time - long.offsetSeconds);
    expect(outputImpulseTimes).toEqual([0, 0.5]);
  });

  it('короткий stem играет0.25с и молчит до общей границы; следующий старт не раньше1с', () => {
    const clipped = setTracksPlayback(manifest(), { clip: { from: 0.5, to: 1.5 }, loop: true });
    const plan = planTrackSegments(clipped, { cycles: 3 });
    expect(plan.durationSeconds).toBe(3);
    expect(plan.segments.filter(segment => segment.trackId === 'short').map(segment => [segment.atSeconds, segment.endAtSeconds])).toEqual([[0, 0.25], [1, 1.25], [2, 2.25]]);
    expect(plan.segments.filter(segment => segment.trackId === 'long').map(segment => [segment.atSeconds, segment.endAtSeconds])).toEqual([[0, 1], [1, 2], [2, 3]]);
  });

  it('поздняя привязка/отсутствующий участок короткой дорожки не сдвигает общий цикл', () => {
    const clipped = setTracksPlayback(manifest(), { clip: { from: 1, to: 2 } });
    const plan = planTrackSegments(clipped, { cycles: 2 });
    expect(plan.segments.map(segment => segment.trackId)).toEqual(['long', 'long']);
    expect(plan.segments.map(segment => segment.atSeconds)).toEqual([0, 1]);
    expect(plan.durationSeconds).toBe(2);
  });

  it('seek меняет первый остаток цикла, последующие сохраняют весь общий фрагмент', () => {
    const clipped = setTracksPlayback(manifest(), { clip: { from: 0.5, to: 1.5 }, loop: true });
    const plan = planTrackSegments(clipped, { startPosition: 1, cycles: 3 });
    expect(plan.durationSeconds).toBe(2.5);
    expect(plan.segments.filter(segment => segment.trackId === 'long').map(segment => [segment.atSeconds, segment.offsetSeconds])).toEqual([[0, 1], [0.5, 0.5], [1.5, 0.5]]);
    expect(trackPositionAt(clipped, 0.499, 1).position).toBeCloseTo(1.499);
    expect(trackPositionAt(clipped, 0.5, 1)).toEqual({ position: 0.5, cycleIndex: 1, finished: false });
    expect(trackPositionAt(clipped, 1.5, 1)).toEqual({ position: 0.5, cycleIndex: 2, finished: false });
  });

  it('once останавливается на B; varispeed меняет общую длительность, сохраняя source offset', () => {
    const clipped = setTracksPlayback(manifest(), { clip: { from: 0.5, to: 1.5 }, rate: 0.5 });
    expect(planTrackSegments(clipped).durationSeconds).toBe(2);
    expect(planTrackSegments(clipped).segments[0]).toMatchObject({ offsetSeconds: 0.5, durationSeconds: 1, playDurationSeconds: 2 });
    expect(trackPositionAt(clipped, 1)).toEqual({ position: 1, cycleIndex: 0, finished: false });
    expect(trackPositionAt(clipped, 2)).toEqual({ position: 1.5, cycleIndex: 0, finished: true });
    expect(trackPositionAt(clipped, 100)).toEqual({ position: 1.5, cycleIndex: 0, finished: true });
  });
});

describe('переносимый manifest без PCM и проверяемая повторная привязка', () => {
  it('сохраняет только идентичность/decoded metadata/mix/cues и проходит JSONroundtrip', () => {
    const current = manifest();
    expect(current).toMatchObject({ format: 'bass-study-tracks', schemaVersion: 1, id: 'synthetic-stems', clip: { from: 0, to: 2 }, loop: false, rate: 1 });
    expect(validateTracksManifest(JSON.parse(JSON.stringify(current)))).toEqual(current);
    expect(JSON.stringify(current)).not.toMatch(/base64|audioBuffer|objectURL/);
    expect(decodedBytes(current.tracks)).toBe((96000 + 36000) * 4);
  });

  it('правильный hash/размер принимаются независимо от имени и даты, неверный не меняет ожидаемый track', () => {
    const descriptor = track(); const before = JSON.stringify(descriptor);
    expect(() => assertFileMatches(descriptor, { sha256: 'a'.repeat(64), size: 1000 })).not.toThrow();
    expect(() => assertFileMatches(descriptor, { sha256: 'A'.repeat(64), size: 1000 })).not.toThrow();
    expect(() => assertFileMatches(descriptor, { sha256: 'b'.repeat(64), size: 1000 })).toThrow(/не совпадает/);
    expect(() => assertFileMatches(descriptor, { sha256: 'a'.repeat(64), size: 999 })).toThrow(/не совпадает/);
    expect(JSON.stringify(descriptor)).toBe(before);
  });

  it('параметры каждого микса независимы и изменения immutable', () => {
    const current = manifest();
    const changed = setTrackMix(current, 'short', { muted: true, volume: 0.2 });
    expect(changed.tracks[0]).toEqual(current.tracks[0]);
    expect(changed.tracks[1]).toMatchObject({ muted: true, volume: 0.2 });
    expect(current.tracks[1]).toMatchObject({ muted: false, volume: 0.8 });
    expect(Object.isFrozen(changed.tracks[1].decoded)).toBe(true);
    expect(() => setTrackMix(current, 'unknown', { volume: 0.2 })).toThrow(/Неизвестная/);
  });

  it('не замораживает объекты вызывающего кода', () => {
    const descriptor = track(); const items = [descriptor];
    createTracksManifest({ id: 'independent', tracks: items });
    expect(Object.isFrozen(descriptor)).toBe(false);
    expect(Object.isFrozen(items)).toBe(false);
  });

  it('ограничивает исходники и суммарный PCM до декодирования/после декодирования соответственно', () => {
    expect(TRACK_LIMITS).toMatchObject({ sourcePerFile: 67108864, sourceTotal: 268435456, decodedTotal: 536870912, maxTracks: 4 });
    expect(() => createTracksManifest({ id: 'too-large', tracks: [{ ...track(), size: 67108865 }] })).toThrow(/Размер файла/);
    const large = { ...track(), decoded: { duration: 1000, frames: 48000000, sampleRate: 48000, channels: 2 } };
    expect(() => createTracksManifest({ id: 'pcm-large', tracks: [large, { ...large, id: 'other' }] })).toThrow(/512 МиБ/);
    expect(() => createTracksManifest({ id: 'five', tracks: Array.from({ length: 5 }, (_, index) => track(String(index))) })).toThrow(/четырёх/);
  });

  it('отвергает неверные clips, rate и seek, не изменяя предыдущий набор', () => {
    const current = manifest(); const before = JSON.stringify(current);
    for (const clip of [{ from: 1, to: 0.5 }, { from: -1, to: 1 }, { from: 0, to: 3 }, { from: 1, to: 1.01 }]) expect(() => setTracksPlayback(current, { clip })).toThrow();
    expect(() => setTracksPlayback(current, { rate: 0.4 })).toThrow();
    expect(() => setTracksPlayback(current, { rate: 1.6 })).toThrow();
    expect(() => planTrackSegments(current, { startPosition: 3 })).toThrow();
    expect(() => planTrackSegments(current, { cycles: 0 })).toThrow();
    expect(JSON.stringify(current)).toBe(before);
  });

  it('отвергает неверный format, hash, PCM metadata, дубли ID и внедрённые данные', () => {
    const original = manifest();
    for (const mutation of [
      (value: any) => { value.schemaVersion = 2; }, (value: any) => { value.tracks[0].sha256 = 'wrong'; },
      (value: any) => { value.tracks[0].decoded.duration = 300; }, (value: any) => { value.tracks[0].decoded.channels = 9; },
      (value: any) => { value.tracks[1].id = value.tracks[0].id; }, (value: any) => { value.tracks[0].base64 = 'data'; },
    ]) { const invalid = JSON.parse(JSON.stringify(original)); mutation(invalid); expect(() => validateTracksManifest(invalid)).toThrow(); }
    let calls = 0; const bad = JSON.parse(JSON.stringify(original));
    Object.defineProperty(bad.tracks, '0', { enumerable: true, get() { calls++; return original.tracks[0]; } });
    expect(() => validateTracksManifest(bad)).toThrow(); expect(calls).toBe(0);
  });
});
