import { DEFAULT_RHYTHM_VELOCITY, type LegacyRhythmVelocityDefaults, type RhythmVelocityDefaults } from '../rhythm/model';

function percent(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100 ? value : fallback;
}

export const readLegacyRhythmVelocityDefaults: LegacyRhythmVelocityDefaults = channel => {
  const defaults = { ...DEFAULT_RHYTHM_VELOCITY };
  try {
    defaults.hit = percent(Number(localStorage.getItem('bass-study.rhythm.new-hit-velocity')), defaults.hit);
    const key = `bass-study.rhythm.track-velocity:${JSON.stringify([channel.sound, channel.id])}`;
    const track = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<RhythmVelocityDefaults> | null;
    defaults.hit = percent(track?.hit, defaults.hit);
    defaults.accent = percent(track?.accent, defaults.accent);
  } catch {
    // Browser settings may be unavailable or damaged. Keep the valid fallback.
  }
  return defaults;
};
