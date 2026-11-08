import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
export const generatedVendor = resolve(root, 'generated-vendor');
const sourceDir = resolve(root, 'node_modules/@coderline/alphatab/dist');
const coreName = 'alphaTab.core.mjs';
const expectedCoreSha256 = '7d5e9412c6d0a692c569f4b8a1afda0ef76be044f2538e6f8f43e907a2cf588e';
const digest = data => createHash('sha256').update(data).digest('hex');

export async function prepareVendor() {
  const pkg = JSON.parse(await readFile(resolve(sourceDir, '../package.json'), 'utf8'));
  assert.equal(pkg.version, '1.9.0', 'Патч предназначен только для alphaTab 1.9.0');
  const input = await readFile(resolve(sourceDir, coreName));
  assert.equal(digest(input), expectedCoreSha256, 'Изменился точный исходник npm alphaTab: патч требует повторного аудита');
  const changes = [];
  let core = input.toString('utf8');
  const replace = (name, before, after, expected = 1) => {
    const found = core.split(before).length - 1;
    assert.equal(found, expected, `${name}: неожиданное число мест замены`);
    core = core.split(before).join(after); changes.push({ name, occurrences: found });
  };
  replace('Импорт единой модели виртуальных каналов', '// \\0rolldown/runtime.js',
    'import { isPercussionChannel as musicBankIsPercussionChannel, normalizeScoreChannels as musicBankNormalizeScoreChannels, sameInstrumentChannels as musicBankSameInstrumentChannels } from "./channel-layout.mjs";\n// \\0rolldown/runtime.js');
  replace('Обобщённый предикат ударных', 'static PercussionChannel = 9;',
    'static PercussionChannel = 9;\n\tstatic isPercussionChannel(channel) { return musicBankIsPercussionChannel(channel); }');
  const allocation = `\t\tconst usedChannels = /* @__PURE__ */ new Set([SynthConstants.PercussionChannel]);
\t\tfor (const track of score.tracks) {
\t\t\tif (track.staves.length === 1 && track.staves[0].isPercussion) {
\t\t\t\ttrack.playbackInfo.primaryChannel = SynthConstants.PercussionChannel;
\t\t\t\ttrack.playbackInfo.secondaryChannel = SynthConstants.PercussionChannel;
\t\t\t} else {
\t\t\t\tif (track.playbackInfo.primaryChannel !== SynthConstants.PercussionChannel) while (usedChannels.has(track.playbackInfo.primaryChannel)) track.playbackInfo.primaryChannel++;
\t\t\t\tusedChannels.add(track.playbackInfo.primaryChannel);
\t\t\t\tif (track.playbackInfo.secondaryChannel !== SynthConstants.PercussionChannel) while (usedChannels.has(track.playbackInfo.secondaryChannel)) track.playbackInfo.secondaryChannel++;
\t\t\t\tusedChannels.add(track.playbackInfo.secondaryChannel);
\t\t\t}`;
  replace('consolidate: отдельные каналы всех партий', allocation,
    '\t\tmusicBankNormalizeScoreChannels(score);\n\t\tfor (const track of score.tracks) {');
  replace('Sequencer: программы мелодических инструментов', '!(channel === SynthConstants.PercussionChannel)', '!SynthConstants.isPercussionChannel(channel)');
  replace('Sequencer: загрузка сэмплов всех ударных', 'noteOn.channel === SynthConstants.PercussionChannel', 'SynthConstants.isPercussionChannel(noteOn.channel)');
  replace('Live transpose: звучащие ударные', 'voice.playingChannel !== 9', '!SynthConstants.isPercussionChannel(voice.playingChannel)', 2);
  replace('Synth: выбор drum bank и program fallback', 'programChange.channel === 9', 'SynthConstants.isPercussionChannel(programChange.channel)');
  replace('GPIF: значок ударных', 'playbackInfo.primaryChannel === 9', 'SynthConstants.isPercussionChannel(playbackInfo.primaryChannel)');
  replace('SoundFont exclusive class ограничена своей партией',
    'if (v.playingPreset === presetIndex && v.region.group === region.group) v.endQuick(this.outSampleRate);',
    'if (v.playingPreset === presetIndex && v.region.group === region.group && (!this._channels || musicBankSameInstrumentChannels(v.playingChannel, this._channels.activeChannel))) v.endQuick(this.outSampleRate);');
  replace('MIDI note-on velocity0 гасит ноту только своего канала',
    'if (!this._channels || channel > this._channels.channelList.length) return;\n\t\tif (this._transpositionPitches.has(channel)) key += this._transpositionPitches.get(channel);',
    'if (!this._channels || channel > this._channels.channelList.length) return;\n\t\tif (vel <= 0) { this.channelNoteOff(channel, key); return; }\n\t\tif (this._transpositionPitches.has(channel)) key += this._transpositionPitches.get(channel);');
  const notice = `/*
 * Локально изменённый alphaTab 1.9.0, music-bank-channels-v1, 2026-11-08.
 * Изменения: раздельные внутренние каналы партий, расширенное распознавание
 * ударных 9+16*n, изоляция note-off/choke групп; исходные программы, bank и
 * музыкальные события сохраняются.
 * Исходный copyright и лицензия MPL-2.0 сохранены ниже. Изменённая версия
 * воспроизводится prepare-vendor.mjs и channel-layout.mjs из этого стенда.
 * Только внутреннее воспроизведение; стандартный MIDI-экспорт не поддерживает
 * эти виртуальные номера без отдельного преобразования.
 */\n`;
  core = notice + core;
  await mkdir(generatedVendor, { recursive: true });
  // Копируем только проверяемый ESM-путь, без непатченных UMD/min-альтернатив.
  for (const name of ['alphaTab.mjs', 'alphaTab.worker.mjs', 'alphaTab.worklet.mjs']) {
    await cp(resolve(sourceDir, name), resolve(generatedVendor, name));
  }
  for (const name of ['font', 'soundfont']) await cp(resolve(sourceDir, name), resolve(generatedVendor, name), { recursive: true });
  await cp(resolve(sourceDir, '../LICENSE'), resolve(generatedVendor, 'LICENSE'));
  await cp(resolve(sourceDir, '../LICENSE.header'), resolve(generatedVendor, 'LICENSE.header'));
  await cp(resolve(root, 'channel-layout.mjs'), resolve(generatedVendor, 'channel-layout.mjs'));
  await writeFile(resolve(generatedVendor, coreName), core);
  const manifest = {
    format: 'bass-study-alphatab-local-patch', version: 1,
    upstream: { package: '@coderline/alphatab', version: pkg.version, coreSha256: expectedCoreSha256, license: 'MPL-2.0' },
    channelLayout: 'music-bank-channels-v1', modifiedCoreSha256: digest(core),
    helperSha256: digest(await readFile(resolve(root, 'channel-layout.mjs'))), changes,
    note: 'Сборка локального эксперимента. Исходники npm и GP не изменены; PCM не хранится.'
  };
  await writeFile(resolve(generatedVendor, 'patch-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await prepareVendor();
  console.log(JSON.stringify({ generatedVendor, ...manifest }, null, 2));
}
