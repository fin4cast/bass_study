export const SOUND_LABELS = Object.freeze({
  kick: 'Бочка', snare: 'Малый', closedHat: 'Закрытый хэт', openHat: 'Открытый хэт',
  clap: 'Хлопок', shaker: 'Шейкер', rim: 'Римшот', ride: 'Райд',
});

const hits = (normal = [], accent = []) => Array.from({ length: 16 }, (_, i) => accent.includes(i) ? 2 : normal.includes(i) ? 1 : 0);
const eighths = [0, 2, 4, 6, 8, 10, 12, 14];
const sixteenths = Array.from({ length: 16 }, (_, i) => i);
const patterns = {
  rock: { name: 'Прямой рок', style: 'Rock', description: 'Малый на 2 и 4, ровные восьмые хэта.', bpm: 92, swing: 50,
    sounds: { kick: hits([8, 10], [0]), snare: hits([], [4, 12]), closedHat: hits(eighths), openHat: hits() } },
  funk: { name: 'Фанк', style: 'Funk', description: 'Синкопированная бочка и тихие дополнительные удары малого.', bpm: 102, swing: 54,
    sounds: { kick: hits([3, 6, 10, 14], [0]), snare: hits([7, 11, 15], [4, 12]), closedHat: hits(sixteenths.filter(i => i !== 14), [0, 8]), openHat: hits([14]) } },
  shuffle: { name: 'Шаффл', style: 'Shuffle', description: 'Длинная и короткая восьмые: свинг 66%, сетка остаётся шестнадцатой.', bpm: 86, swing: 66,
    sounds: { kick: hits([8], [0]), snare: hits([], [4, 12]), closedHat: hits(eighths), openHat: hits() } },
  blues: { name: 'Блюзовый пульс', style: 'Blues', description: 'Неторопливый свинговый рисунок с райдом и малым на 2 и 4.', bpm: 72, swing: 66,
    sounds: { kick: hits([8], [0]), snare: hits([10], [4, 12]), closedHat: hits([4, 12]), openHat: hits(), ride: hits(eighths, [0, 8]) } },
  latin: { name: 'Латинский пульс', style: 'Latin', description: 'Синкопированный римшот и ровный шейкер.', bpm: 108, swing: 50,
    sounds: { kick: hits([6, 8, 14], [0]), snare: hits(), closedHat: hits(), openHat: hits(), rim: hits([0, 3, 6, 10, 12]), shaker: hits(sixteenths, [0, 4, 8, 12]) } },
  disco: { name: 'Диско', style: 'Disco', description: 'Бочка на каждой четверти, открытый хэт между долями.', bpm: 116, swing: 50,
    sounds: { kick: hits([4, 8, 12], [0]), snare: hits([], [4, 12]), closedHat: hits([0, 4, 8, 12]), openHat: hits([2, 6, 10, 14]), clap: hits([4, 12]) } },
  blank: { name: 'Пустой паттерн', style: 'Свой рисунок', description: 'Четыре пустых канала: собери рисунок с нуля.', bpm: 92, swing: 50,
    sounds: { kick: hits(), snare: hits(), closedHat: hits(), openHat: hits() } },
};

export const RHYTHM_PRESETS = Object.freeze(Object.entries(patterns).map(([id, { sounds, ...descriptor }]) => Object.freeze({ id, ...descriptor })));

/** Свежие независимые массивы; редактирование не меняет каталог или другой паттерн. */
export function createLanes(presetId = 'rock', bars = 1) {
  if (!Object.hasOwn(patterns, presetId)) throw new RangeError('Неизвестный ритмический рисунок.');
  const preset = patterns[presetId];
  if (!Number.isInteger(bars) || bars < 1 || bars > 4) throw new RangeError('В паттерне нужно от 1 до 4 тактов.');
  return Object.entries(preset.sounds).map(([sound, source]) => ({
    id: sound, name: SOUND_LABELS[sound], sound, volume: sound === 'closedHat' || sound === 'shaker' ? 0.5 : 0.7,
    muted: false, solo: false, steps: Array.from({ length: bars * 16 }, (_, i) => source[i % 16]),
  }));
}
