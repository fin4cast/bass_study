// Локальное расширение виртуальных каналов alphaTab 1.9.0 для музбанка bass_study.
// Исходные GP-файлы не изменяются. Эти номера относятся к внутреннему синтезатору,
// а не к стандартному SMF/MIDI с четырьмя битами номера канала.
export const CHANNEL_LAYOUT_VERSION = 'music-bank-channels-v1';

export function isPercussionChannel(channel) {
  return Number.isInteger(channel) && channel >= 0 && channel % 16 === 9;
}

// Два мелодических канала одной партии сохраняют общую exclusive class:
// второй канал нужен движку для специальных приёмов, а не другого инструмента.
export function sameInstrumentChannels(a, b) {
  if (a === b) return true;
  if (![a, b].every(n => Number.isInteger(n) && n >= 0) || isPercussionChannel(a) || isPercussionChannel(b)) return false;
  const pair = n => Math.floor((n - Math.floor((n + 7) / 16)) / 2);
  return pair(a) === pair(b);
}

/**
 * Назначить непересекающиеся виртуальные каналы всем партиям в памяти.
 * Партия, где ударные и мелодические станы смешаны, получает мелодическую пару — так
 * штатный alphaTab назначает каналы любой партии, кроме одного ударного стана, — и
 * помечается `mixed`: её ударный стан звучит мелодическим инструментом, остальные партии
 * назначаются как обычно.
 */
export function normalizeScoreChannels(score) {
  if (!score || !Array.isArray(score.tracks)) throw new TypeError('Ожидается Score с партиями');
  // Сначала проверить весь материал: при отказе не оставлять частичное назначение.
  const kinds = score.tracks.map(track => {
    if (!track.playbackInfo || !Array.isArray(track.staves) || !track.staves.length) throw new TypeError('Партия без музыкального стана');
    const percussion = track.staves.map(staff => Boolean(staff.isPercussion));
    return { percussion: percussion.every(Boolean), mixed: percussion.some(Boolean) && !percussion.every(Boolean) };
  });
  let melodic = 0, percussion = 0;
  const nextMelodic = () => {
    while (isPercussionChannel(melodic)) melodic++;
    return melodic++;
  };
  const tracks = score.tracks.map((track, index) => {
    const previous = [track.playbackInfo.primaryChannel, track.playbackInfo.secondaryChannel];
    const { percussion: drums, mixed } = kinds[index];
    const primary = drums ? 9 + 16 * percussion++ : nextMelodic();
    const secondary = drums ? primary : nextMelodic();
    track.playbackInfo.primaryChannel = primary;
    track.playbackInfo.secondaryChannel = secondary;
    return { index, percussion: drums, mixed, previous, channels: [primary, secondary] };
  });
  return { version: CHANNEL_LAYOUT_VERSION, changed: tracks.some(t => t.previous.some((n, i) => n !== t.channels[i])), tracks };
}
