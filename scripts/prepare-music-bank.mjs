import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const musicBankVendorDir = resolve(root, 'public/vendor/music-bank');
const sourceHelper = resolve(root, 'scripts/music-bank/channel-layout.mjs');
const sourceDir = resolve(root, 'node_modules/@coderline/alphatab/dist');
const coreName = 'alphaTab.core.mjs';
const expectedCoreSha256 = '7d5e9412c6d0a692c569f4b8a1afda0ef76be044f2538e6f8f43e907a2cf588e';
const digest = data => createHash('sha256').update(data).digest('hex');

export async function prepareMusicBankVendor(directory = musicBankVendorDir) {
  let pkg;
  try { pkg = JSON.parse(await readFile(resolve(sourceDir, '../package.json'), 'utf8')); }
  catch (cause) { throw new Error('Не найдена зависимость alphaTab. Выполните npm ci перед подготовкой музбанка.', { cause }); }
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
 * воспроизводится scripts/prepare-music-bank.mjs и scripts/music-bank/channel-layout.mjs.
 * Только внутреннее воспроизведение; стандартный MIDI-экспорт не поддерживает
 * эти виртуальные номера без отдельного преобразования.
 */\n`;
  // Файлы сохраняют native ESM, но получают .js для совместимости с обычными
  // статическими серверами, уже раздающими JavaScript с корректным MIME.
  const rewriteModuleUrls = source => source.replace(/(["'])\.\/(alphaTab(?:\.core|\.worker|\.worklet)?|channel-layout)\.mjs\1/g, (_match, quote, name) => `${quote}./${name}.js${quote}`);
  core = rewriteModuleUrls(notice + core);
  await mkdir(directory, { recursive: true });
  const assets = [];
  // Копируем только проверяемый ESM-путь, без непатченных UMD/min-альтернатив.
  for (const name of ['alphaTab.mjs', 'alphaTab.worker.mjs', 'alphaTab.worklet.mjs']) {
    const source = await readFile(resolve(sourceDir, name), 'utf8');
    const outputName = name.replace(/\.mjs$/, '.js'), output = rewriteModuleUrls(source);
    await writeFile(resolve(directory, outputName), output);
    assets.push({ path: outputName, sourceSha256: digest(source), sha256: digest(output) });
  }
  for (const name of ['font', 'soundfont']) await cp(resolve(sourceDir, name), resolve(directory, name), { recursive: true });
  await cp(resolve(sourceDir, '../LICENSE'), resolve(directory, 'LICENSE'));
  await cp(resolve(sourceDir, '../LICENSE.header'), resolve(directory, 'LICENSE.header'));
  const helper = await readFile(sourceHelper);
  await writeFile(resolve(directory, 'channel-layout.js'), helper);
  await writeFile(resolve(directory, 'alphaTab.core.js'), core);
  assets.push({ path: 'channel-layout.js', sourceSha256: digest(helper), sha256: digest(helper) });
  assets.push({ path: 'alphaTab.core.js', sourceSha256: expectedCoreSha256, sha256: digest(core) });
  // Удаляются только известные прежние generated имена, без рекурсивного удаления.
  for (const name of ['alphaTab.mjs', 'alphaTab.core.mjs', 'alphaTab.worker.mjs', 'alphaTab.worklet.mjs', 'channel-layout.mjs']) {
    await rm(resolve(directory, name), { force: true });
  }
  const manifest = {
    format: 'bass-study-alphatab-local-patch', version: 1,
    upstream: { package: '@coderline/alphatab', version: pkg.version, coreSha256: expectedCoreSha256, license: 'MPL-2.0' },
    channelLayout: 'music-bank-channels-v1', modifiedCoreSha256: digest(core),
    helperSha256: digest(helper), changes, assets,
    note: 'Локальная поставка музбанка bass_study. Исходники npm и GP не изменены; PCM не хранится.'
  };
  await writeFile(resolve(directory, 'patch-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifest = await prepareMusicBankVendor();
    console.log(JSON.stringify({ musicBankVendorDir, ...manifest }, null, 2));
  } catch (error) {
    console.error(`Подготовка музбанка не выполнена: ${error.message}`); process.exitCode = 1;
  }
}
