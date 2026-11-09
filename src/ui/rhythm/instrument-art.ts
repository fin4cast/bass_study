import type { RhythmSound } from '../../rhythm/model';

const fill = 'var(--instrument-fill, transparent)';
const accent = 'var(--instrument-accent, currentColor)';
const hatPlate = `<path d="M4 16c5-1 8-2.6 9.5-5h5c1.5 2.4 4.5 4 9.5 5v2c-5.5 2.5-18.5 2.5-24 0Z" fill="${fill}"/>`;

const art: Record<RhythmSound, string> = {
  kick: `
    <path d="m9 21.5-3.5 5.5m17.5-5.5 3.5 5.5"/>
    <circle cx="16" cy="14.2" r="9.7" fill="${fill}"/>
    <path d="M16 23.5v-6m-1.6 6h3.2l2 3.5h-7.2Z"/>
    <circle cx="16" cy="16.7" r="1.45" fill="${accent}" stroke="none"/>`,
  snare: `
    <path d="M5 15.4v6.7c0 2.7 4.9 4.9 11 4.9s11-2.2 11-4.9v-6.7" fill="${fill}"/>
    <ellipse cx="16" cy="15.4" rx="11" ry="4"/>
    <path d="M10 20.5v3m12-3v3M10 15 23 5m-7 10L28 8.5"/>`,
  closedHat: `
    <path d="M16 5.5V11m0 9v7m-3.5 0h7"/>
    ${hatPlate}
    <path d="M5.5 17h21" stroke="${accent}"/>`,
  openHat: `
    <path d="M16 4v3m0 9v2.5m0 6.3V28m-3.5 0h7"/>
    <g transform="translate(0 -4)">${hatPlate}</g>
    <path d="M4 21.5c5.5-.6 8.4-1.6 10-3h4c1.6 1.4 4.5 2.4 10 3v1.5c-5.5 2.4-18.5 2.4-24 0Z" fill="${fill}"/>`,
  clap: `
    <path d="m4.5 24 4.2-5.9 4.3-3.2 2.2-4.2c.6-1.1 2.2-.6 1.9.6l-1 3.9 3.4-2.8c1.3-1.1 2.7.5 1.6 1.8l-4.2 5.3c-1.4 1.8-2.8 2.8-4.7 3.4l-2.3 5Z" fill="${fill}"/>
    <path d="m27.6 24-3.8-5.8-3.9-3.6-2-4.6c-.5-1.1-2.1-.8-1.9.4l.8 4.5-3.5-2.8c-1.3-1-2.6.6-1.6 1.8l4.2 5.5c1.4 1.8 2.8 2.9 4.7 3.5l2.3 5Z" fill="${fill}"/>
    <path d="M16 6V3.5M10.4 8.4 8.5 6.6m13.1 1.8 1.9-1.8" stroke="${accent}"/>`,
  shaker: `
    <g transform="rotate(35 16 16)">
      <path d="M14 19.5v6.7a2 2 0 0 0 4 0v-6.7"/>
      <rect x="10.5" y="4.5" width="11" height="16" rx="5.5" fill="${fill}"/>
      <path d="M11 14h10" stroke="${accent}"/>
    </g>
    <path d="M9 6.5A9.5 9.5 0 0 0 5 13m17.5 5.5a9.5 9.5 0 0 0 4.2-6" stroke="${accent}"/>`,
  rim: `
    <path d="M5 17v3.7c0 2.7 4.9 4.8 11 4.8s11-2.1 11-4.8V17" fill="${fill}"/>
    <ellipse cx="16" cy="17" rx="11" ry="4.8" fill="${fill}"/>
    <path d="M12 21.5 26 7.5m-8.9 3.8-.6-3.1"/>
    <circle cx="12" cy="21.5" r="1.5" fill="${accent}" stroke="none"/>`,
  ride: `
    <path d="M16 17v6.5l-5.5 4m5.5-4 5.5 4"/>
    <g transform="rotate(-12 16 13)">
      <path d="M3.5 14c1.8-2.2 6.3-3.3 9.2-3.6l1.8-2.4h3l1.8 2.4c2.9.3 7.4 1.4 9.2 3.6v1.8c-6.8 2.1-18.2 2.1-25 0Z" fill="${fill}"/>
      <path d="M16 8V5.5" stroke="${accent}"/>
    </g>`,
};

export function rhythmInstrumentArt(sound: RhythmSound): string {
  return `<svg class="rhythm-instrument-art" viewBox="0 0 32 32" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="var(--instrument-ink, currentColor)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${art[sound]}</g></svg>`;
}
