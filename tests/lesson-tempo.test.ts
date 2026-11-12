import { describe, expect, it } from 'vitest';
import { clampLessonTempo, lessonTempoAfterMetronomeEdit, lessonTempoOffer, sharesLessonTempo } from '../src/rhythm/lesson-tempo';

const metronome = (patch: Partial<{ view: 'metronome' | 'rhythm'; bpm: number; bpmUnit: 'quarter' | 'eighth' | 'dotted-quarter'; transportIdle: boolean }> = {}) =>
  ({ view: 'metronome' as const, bpm: 92, bpmUnit: 'quarter' as const, transportIdle: true, ...patch });

describe('темп занятия (D-046)', () => {
  it('держится в диапазоне экрана игры 40–220 и округляется', () => {
    expect(clampLessonTempo(30)).toBe(40);
    expect(clampLessonTempo(240)).toBe(220);
    expect(clampLessonTempo(92.4)).toBe(92);
    expect(() => clampLessonTempo(Number.NaN)).toThrow(RangeError);
  });

  it('делится только метроном в четвертях: грув и другие единицы BPM не связаны', () => {
    expect(sharesLessonTempo(metronome())).toBe(true);
    expect(sharesLessonTempo(metronome({ view: 'rhythm' }))).toBe(false);
    expect(sharesLessonTempo(metronome({ bpmUnit: 'eighth' }))).toBe(false);
    expect(sharesLessonTempo(metronome({ bpmUnit: 'dotted-quarter' }))).toBe(false);
  });

  it('правка темпа метронома обновляет темп занятия, только если он меняется', () => {
    expect(lessonTempoAfterMetronomeEdit(metronome({ bpm: 100 }), 72)).toBe(100);
    expect(lessonTempoAfterMetronomeEdit(metronome({ bpm: 72 }), 72)).toBeNull();
    expect(lessonTempoAfterMetronomeEdit(metronome({ bpm: 30 }), 72)).toBe(40);
    expect(lessonTempoAfterMetronomeEdit(metronome({ bpm: 30 }), 40)).toBeNull();
    expect(lessonTempoAfterMetronomeEdit(metronome({ bpm: 100 }), null)).toBe(100);
    expect(lessonTempoAfterMetronomeEdit(metronome({ bpm: 100, view: 'rhythm' }), 72)).toBeNull();
    expect(lessonTempoAfterMetronomeEdit(metronome({ bpm: 100, bpmUnit: 'eighth' }), 72)).toBeNull();
  });

  it('«Ритм» предлагает темп занятия только остановленным и отличающимся', () => {
    expect(lessonTempoOffer(metronome({ bpm: 92 }), 72)).toBe(72);
    expect(lessonTempoOffer(metronome({ bpm: 72 }), 72)).toBeNull();
    expect(lessonTempoOffer(metronome({ transportIdle: false }), 72)).toBeNull();
    expect(lessonTempoOffer(metronome({ view: 'rhythm' }), 72)).toBeNull();
    expect(lessonTempoOffer(metronome({ bpmUnit: 'eighth' }), 72)).toBeNull();
    expect(lessonTempoOffer(metronome(), null)).toBeNull();
  });

  it('метроном вне диапазона занятия на его границе не порождает встречного предложения', () => {
    expect(lessonTempoOffer(metronome({ bpm: 30 }), 40)).toBeNull();
    expect(lessonTempoOffer(metronome({ bpm: 240 }), 220)).toBeNull();
    expect(lessonTempoOffer(metronome({ bpm: 30 }), 72)).toBe(72);
  });
});
