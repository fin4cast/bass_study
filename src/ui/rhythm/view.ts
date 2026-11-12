import { DEFAULT_RHYTHM_VELOCITY, RHYTHM_PATTERN_LENGTHS } from '../../rhythm/model';
import { renderPageHeader, renderPageSettingsButton } from '../../app/page-frame';

function dial(setting: string, label: string, min: number, max: number, description?: string) {
  const describedBy = description ? ` aria-describedby="${description}"` : '';
  return `<label class="rhythm-dial">
    <span class="rhythm-dial-label">${label}</span>
    <span class="rhythm-dial-scale" aria-hidden="true"><span class="rhythm-dial-face"></span></span>
    <input type="range" min="${min}" max="${max}" step="1" data-rhythm-setting="${setting}" data-rhythm-dial aria-label="${label}"${describedBy}>
  </label>`;
}

function fader(setting: string, label: string) {
  return `<label class="rhythm-channel${setting === 'master' ? ' rhythm-master' : ''}">
    <span class="rhythm-channel-name">${label}</span>
    <span class="rhythm-fader-slot"><input class="rhythm-fader" type="range" min="0" max="1" step="0.05" data-rhythm-setting="${setting}" aria-label="Громкость: ${label}"></span>
    <output data-rhythm-level></output>
  </label>`;
}

function choice(key: string, label: string, items: ReadonlyArray<readonly [string, string]>) {
  return `<div class="rhythm-choice" role="group" aria-label="${label}">
    <span>${label}</span><div class="rhythm-segment">${items.map(([value, name]) => `<button type="button" data-rhythm-choice="${key}" data-rhythm-value="${value}" aria-pressed="false">${name}</button>`).join('')}</div>
  </div>`;
}

export function paintRhythmDial(input: HTMLInputElement) {
  const min = Number(input.min);
  const fraction = (input.valueAsNumber - min) / (Number(input.max) - min);
  input.closest<HTMLElement>('.rhythm-dial')?.style.setProperty('--dial-angle', `${-135 + fraction * 270}deg`);
  const unit = input.dataset.rhythmSetting === 'bpm-slider' ? ' BPM' : '%';
  input.setAttribute('aria-valuetext', `${input.value}${unit}`);
}

export function bindRhythmDial(input: HTMLInputElement, preview: () => void, signal: AbortSignal) {
  let drag: { id: number; y: number; value: number } | null = null;
  const listen = { signal };
  function paint() { paintRhythmDial(input); preview(); }
  input.addEventListener('pointerdown', event => {
    if (input.disabled || drag || event.button !== 0) return;
    event.preventDefault();
    input.focus({ preventScroll: true });
    input.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, y: event.clientY, value: input.valueAsNumber };
  }, listen);
  input.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    const min = Number(input.min), max = Number(input.max);
    const value = drag.value + Math.round((drag.y - event.clientY) * (max - min) / 170);
    input.valueAsNumber = Math.max(min, Math.min(max, value));
    paint();
  }, listen);
  input.addEventListener('pointerup', event => {
    if (drag?.id !== event.pointerId) return;
    const changed = input.valueAsNumber !== drag.value;
    drag = null;
    if (changed) input.dispatchEvent(new Event('input', { bubbles: true }));
  }, listen);
  input.addEventListener('lostpointercapture', event => {
    if (drag?.id !== event.pointerId) return;
    input.valueAsNumber = drag.value;
    drag = null;
    paint();
  }, listen);
}

export function rhythmMarkup(id: string) {
  return `
    ${renderPageHeader('harmony', {
      id: `${id}-heading`, className: 'rhythm-header',
      actions: renderPageSettingsButton(`${id}-settings-toggle`, `${id}-metro-settings`),
      navigation: `<div class="workspace-tabs rhythm-tabs" role="tablist" aria-label="Инструмент ритмической практики">
        <button type="button" id="${id}-metro-tab" role="tab" aria-selected="true" aria-controls="${id}-metro" data-rhythm-mode="metronome">Метроном</button>
        <button type="button" id="${id}-rack-tab" role="tab" aria-selected="false" aria-controls="${id}-rack" data-rhythm-mode="rhythm" tabindex="-1">Ритм-секция</button>
      </div>`,
    })}
    <div class="rhythm-content">
    <section id="${id}-metro" role="tabpanel" aria-labelledby="${id}-metro-tab" data-rhythm-panel="metronome" class="rhythm-metro">
      <div class="rhythm-workspace">
        <section class="rhythm-card rhythm-pulse">
          <div class="rhythm-deck-header">
            <div class="rhythm-deck-title"><h2>Пульс и акценты</h2></div>
            <div class="rhythm-deck-context"><button type="button" class="text-button button-compact rhythm-lesson-tempo" data-rhythm-action="lesson-tempo" title="Темп нового упражнения в «Занятии»; правка темпа метронома в четвертях обновляет его" hidden></button><span class="rhythm-muted" data-rhythm-output="division-label"></span><span class="rhythm-muted" data-rhythm-output="meter-summary" hidden></span><span class="rhythm-meter-readout" data-rhythm-output="meter-label"></span></div>
          </div>
          <div class="rhythm-playing-field" tabindex="0" role="region" aria-label="Акценты долей">
            <div class="rhythm-beats" data-rhythm-output="beats"></div>
          </div>
          <div class="rhythm-metro-secondary">
            <section class="rhythm-card rhythm-sounds" aria-label="Звук метронома">
              <details class="learning-help">
                <summary class="section-disclosure"><strong>Звук</strong><span class="rhythm-muted" data-rhythm-output="kit-name"></span></summary>
                <div class="rhythm-segment rhythm-kit-list" data-rhythm-output="kits" role="group" aria-label="Тембр клика"></div>
              </details>
              <button type="button" class="secondary-button button-compact" data-rhythm-action="preview">Прослушать</button>
            </section>
            <details class="learning-help rhythm-training">
              <summary class="section-disclosure"><strong>Тренировка</strong><span class="rhythm-muted" data-rhythm-output="training-summary"></span></summary>
              <div class="rhythm-training-fields">
                <fieldset><legend><label class="rhythm-check"><input type="checkbox" data-rhythm-setting="silentEnabled">Немые такты</label></legend><label>Со звуком<input class="form-control form-control-compact" type="number" min="1" max="16" data-rhythm-setting="soundBars"></label><label>Без звука<input class="form-control form-control-compact" type="number" min="1" max="16" data-rhythm-setting="silentBars"></label></fieldset>
                <fieldset><legend><label class="rhythm-check"><input type="checkbox" data-rhythm-setting="rampEnabled">Рост темпа</label></legend><label>Шаг BPM<input class="form-control form-control-compact" type="number" min="1" max="20" data-rhythm-setting="stepBpm"></label><label>Каждые N тактов<input class="form-control form-control-compact" type="number" min="1" max="32" data-rhythm-setting="everyBars"></label><label>До BPM<input class="form-control form-control-compact" type="number" min="30" max="240" data-rhythm-setting="targetBpm" aria-describedby="${id}-ramp-help"></label><small class="rhythm-muted" id="${id}-ramp-help">При росте темпа цель поднимается, если исходный BPM оказался выше.</small></fieldset>
              </div>
            </details>
          </div>
        </section>
        <aside class="settings-panel settings-panel-framed rhythm-side-scroll" id="${id}-metro-settings" data-rhythm-settings-panel="metronome" tabindex="-1" aria-labelledby="${id}-metro-settings-title" hidden>
          <div class="section-title"><h2 id="${id}-metro-settings-title">Настройки метронома</h2><button type="button" class="text-button button-compact rhythm-settings-close" data-rhythm-settings-close>Свернуть</button></div>
          <section class="rhythm-metro-parameters" aria-label="Параметры пульса">
            <div class="rhythm-meter-settings" role="group" aria-label="Размер такта">
              <label class="rhythm-control"><span class="form-label">Доли</span><input class="form-control form-control-compact" type="number" min="2" max="12" data-rhythm-setting="beats"></label>
              ${choice('denominator', 'Размер', [['4', '/4'], ['8', '/8']])}
            </div>
            <div class="rhythm-choice" role="group" aria-label="Подразделение доли">
              <span>Подразделение</span>
              <div class="rhythm-segment">
                <button type="button" data-rhythm-division="1" aria-pressed="true">Четверти</button><button type="button" data-rhythm-division="2" aria-pressed="false">Восьмые</button><button type="button" data-rhythm-division="3" aria-pressed="false">Триоли</button><button type="button" data-rhythm-division="4" aria-pressed="false">Шестнадцатые</button>
              </div>
            </div>
            <label class="rhythm-control"><span class="form-label">Группы</span><input class="form-control form-control-compact" type="text" maxlength="31" data-rhythm-setting="groups" placeholder="2+2+3"></label>
            ${choice('bpmUnit', 'Единица BPM', [['quarter', 'Четверть'], ['eighth', 'Восьмая'], ['dotted-quarter', 'Четверть с точкой']])}
            ${choice('metro-swing-mode', 'Рисунок свинга', [['eighth', 'Половины доли'], ['sixteenth', 'Внутри пары']])}
            <p class="rhythm-muted rhythm-swing-help" id="${id}-swing-help" data-rhythm-output="swing-explanation"></p>
          </section>
        </aside>
      </div>
    </section>
    <section id="${id}-rack" role="tabpanel" aria-labelledby="${id}-rack-tab" data-rhythm-panel="rhythm" class="rhythm-groove" hidden>
      <div class="rhythm-workspace">
        <section class="rhythm-card rhythm-constructor" aria-label="Конструктор паттернов">
          <div class="rhythm-deck-header rhythm-constructor-top">
            <div class="rhythm-deck-title"><span>Паттерн</span><h2 data-rhythm-output="pattern-title"></h2></div>
            <div class="rhythm-deck-keys">
              <div class="rhythm-pattern-tabs rhythm-segment" data-rhythm-output="patterns" role="group" aria-label="Паттерны"></div>
              <div class="rhythm-bar-controls">
                <div class="rhythm-bar-tabs rhythm-segment" data-rhythm-output="bars" role="group" aria-label="Такт для редактирования"></div>
              </div>
            </div>
          </div>
          <div class="rhythm-rack-scroll" tabindex="0" aria-label="Сетка 4/4, 16 шагов на такт">
            <div class="rhythm-playing-field" tabindex="0" role="region" aria-label="Дорожки ритм-секции">
              <div class="rhythm-rack" data-rhythm-output="rack"></div>
            </div>
          </div>
        </section>
        <div class="rhythm-groove-detail-scroll">
          <aside class="settings-panel settings-panel-framed rhythm-side-scroll" id="${id}-rack-settings" data-rhythm-settings-panel="rhythm" tabindex="-1" aria-labelledby="${id}-rack-settings-title" hidden>
            <div class="section-title"><h2 id="${id}-rack-settings-title">Параметры ритма</h2><button type="button" class="text-button button-compact rhythm-settings-close" data-rhythm-settings-close>Свернуть</button></div>
            <div class="rhythm-advanced rhythm-editor">
              <section class="rhythm-editor-pattern" aria-label="Паттерн">
                <label class="rhythm-control rhythm-name"><span class="form-label">Название</span><input class="form-control form-control-compact" type="text" maxlength="50" data-rhythm-setting="pattern-name" aria-label="Название паттерна"></label>
                ${choice('bars', 'Длина паттерна', RHYTHM_PATTERN_LENGTHS.map(bars => [String(bars), bars === 1 ? '1 такт' : `${bars} такта`]))}
                <div class="rhythm-action-strip"><button type="button" class="text-button button-compact" data-rhythm-action="add-pattern">Создать</button><button type="button" class="text-button button-compact" data-rhythm-action="duplicate-pattern">Дублировать</button></div>
                ${choice('rhythm-swing-mode', 'Пары свинга', [['eighth', 'Восьмые'], ['sixteenth', 'Шестнадцатые']])}
              </section>
              <section class="rhythm-playback-settings" aria-label="Воспроизведение">
                <div class="rhythm-choice" role="group" aria-label="Повтор ритма"><span>Повтор</span><div class="rhythm-segment"><button type="button" data-rhythm-repeat="once" aria-pressed="false">Один проход</button><button type="button" data-rhythm-repeat="loop" aria-pressed="true">По кругу</button></div></div>
                <label class="rhythm-overlay-switch">
                  <input type="checkbox" role="switch" data-rhythm-setting="rhythmClick" aria-describedby="${id}-overlay-help">
                  <span class="rhythm-overlay-switch-face" aria-hidden="true"></span>
                  <span>Метроном поверх</span>
                  <span class="rhythm-switch-value" aria-hidden="true"><span>Выкл.</span><span>Вкл.</span></span>
                </label>
              </section>
              <details class="learning-help rhythm-editor-bar">
                <summary class="section-disclosure">Действия с тактом</summary>
                <div class="rhythm-action-strip"><button type="button" class="text-button button-compact" data-rhythm-action="copy-bar">Копировать такт</button><button type="button" class="text-button button-compact" data-rhythm-action="clear-bar">Очистить</button></div>
              </details>
              <details class="learning-help rhythm-editor-sounds">
                <summary class="section-disclosure">Дорожки</summary>
                <div class="rhythm-segment rhythm-sound-bank" data-rhythm-output="sounds" role="group" aria-label="Инструмент для добавления"></div>
                <button type="button" class="text-button button-compact" data-rhythm-action="add-lane">Добавить дорожку</button>
              </details>
            </div>
          </aside>
          <div class="rhythm-groove-tools" tabindex="0" role="region" aria-label="Сила удара, цепочка и проекты">
            <section class="rhythm-card rhythm-chain-card">
              <div class="rhythm-chain-heading">
                <div class="rhythm-card-heading"><h2>Цепочка</h2><button type="button" class="rhythm-utility" data-rhythm-action="add-clip" aria-label="Добавить блок" title="Добавить блок">+</button><span class="rhythm-muted" data-rhythm-output="chain-length"></span></div>
                <div class="rhythm-choice rhythm-scope" role="group" aria-label="Что проигрывать"><span>Играть</span><div class="rhythm-segment"><button type="button" data-rhythm-scope="pattern" aria-pressed="true">Паттерн</button><button type="button" data-rhythm-scope="chain" aria-pressed="false">Цепочку</button></div></div>
              </div>
              <div class="rhythm-chain" data-rhythm-output="chain" aria-label="Порядок паттернов"></div>
              <div class="rhythm-clip-editor" data-rhythm-output="clip-editor" hidden></div>
            </section>
            <div class="rhythm-groove-extras">
            <details class="rhythm-velocity">
              <summary class="section-disclosure">Сила и акцент удара <span class="rhythm-accent-hint" aria-hidden="true">ПКМ по шагу — акцент</span></summary>
              <div class="rhythm-velocity-scroll"><div data-rhythm-output="velocity"></div></div>
              <div class="rhythm-velocity-actions">
                <button type="button" class="text-button button-compact" data-rhythm-action="accent-step">Акцент удара</button>
                <div class="rhythm-velocity-defaults" role="group" aria-labelledby="${id}-velocity-default-track">
                  <strong id="${id}-velocity-default-track" data-rhythm-output="velocity-default-track"></strong>
                  <label class="rhythm-new-velocity" title="Сила обычного удара при добавлении и снятии акцента">
                    <span>Сила нового удара</span>
                    <input class="form-control form-control-compact" type="number" min="1" max="100" step="1" value="${DEFAULT_RHYTHM_VELOCITY.hit}" required data-rhythm-default-velocity>
                    <span aria-hidden="true">%</span>
                  </label>
                  <label class="rhythm-new-velocity">
                    <span>Сила нового акцента</span>
                    <input class="form-control form-control-compact" type="number" min="1" max="100" step="1" value="${DEFAULT_RHYTHM_VELOCITY.accent}" required data-rhythm-default-accent>
                    <span aria-hidden="true">%</span>
                  </label>
                </div>
              </div>
            </details>
            <details class="rhythm-card rhythm-library">
              <summary class="section-disclosure">Партии и проекты</summary>
              <div class="rhythm-library-body">
                <section><h2>Готовые партии</h2><div class="rhythm-preset-list" data-rhythm-output="presets"></div></section>
                <section class="rhythm-project-library"><h2>Мои проекты <span class="rhythm-muted" data-rhythm-output="project-count"></span></h2><div data-rhythm-output="projects"></div><button type="button" class="secondary-button button-compact" data-rhythm-action="new-project">Новый проект</button></section>
                <section class="rhythm-project-tools" aria-label="Текущий проект">
                  <label class="rhythm-name">Имя проекта <input class="form-control form-control-compact" type="text" maxlength="50" data-rhythm-setting="project-name" aria-label="Имя проекта"></label>
                  <div class="rhythm-action-strip"><button type="button" class="primary-button button-compact" data-rhythm-action="save-project">Сохранить проект</button><button type="button" class="secondary-button button-compact" data-rhythm-action="duplicate-project">Сохранить копию</button></div>
                </section>
              </div>
            </details>
            </div>
          </div>
        </div>
      </div>
    </section>
    </div>
    <div class="rhythm-transport-options">
      <span class="sr-only" id="${id}-overlay-help" data-rhythm-output="overlay-help"></span>
      <p class="rhythm-status" role="status" data-rhythm-output="status" tabindex="-1"></p>
      <button type="button" class="secondary-button button-compact" data-rhythm-action="retry-project" hidden>Повторить сохранение</button>
      <p class="rhythm-error status-error" data-rhythm-output="error" role="alert" hidden></p>
    </div>
    <section class="rhythm-transport" aria-label="Темп и воспроизведение">
      <div class="rhythm-transport-line">
        <div class="rhythm-tempo">
          <label class="rhythm-bpm-display">
            <span class="rhythm-bpm-caption">
              <span class="rhythm-bpm-caption-default" aria-hidden="true">Темп</span>
              <span id="${id}-linked-tempo" data-rhythm-output="linked-tempo" hidden>Общий BPM</span>
            </span>
            <span class="rhythm-bpm-readout">
              <input type="number" min="30" max="240" data-rhythm-setting="bpm" aria-label="Темп, BPM" value="92">
              <span class="rhythm-bpm-unit" aria-hidden="true"><span data-rhythm-output="tempo-unit">♩</span> BPM</span>
            </span>
          </label>
          <div class="rhythm-tempo-nudges">
            <button type="button" data-rhythm-action="slower" aria-label="Уменьшить темп на один BPM">−</button>
            <button type="button" data-rhythm-action="tap" aria-label="Настучать темп" title="Настучать темп">TAP</button>
            <button type="button" data-rhythm-action="faster" aria-label="Увеличить темп на один BPM">+</button>
          </div>
        </div>
        <div class="rhythm-dial-bank">
          <div class="rhythm-tempo-dial">
            ${dial('bpm-slider', 'Темп', 30, 240)}
            <div class="rhythm-tempo-limits" aria-hidden="true"><span>30</span><span>240</span></div>
          </div>
          <div class="rhythm-swing-dock" data-rhythm-dock="metronome">
            ${dial('metronomeSwing', 'Свинг', 50, 70, id + '-swing-help')}<output data-rhythm-output="metro-swing"></output>
          </div>
          <div class="rhythm-swing-dock" data-rhythm-dock="rhythm" hidden>
            ${dial('rhythm-swing', 'Свинг', 50, 70)}<output data-rhythm-output="rhythm-swing"></output>
          </div>
        </div>
        <div class="rhythm-play-module">
          <output class="rhythm-position" data-rhythm-output="position" aria-live="off">
            <span class="rhythm-position-phase" data-rhythm-output="position-phase">Остановлено</span>
            <span class="rhythm-position-detail" data-rhythm-output="position-detail"></span>
          </output>
          <div class="rhythm-play-buttons">
            <button type="button" class="rhythm-photo-key" data-rhythm-action="start" aria-keyshortcuts="Space" title="Старт (пробел)"><span class="rhythm-key-face" aria-hidden="true">▶</span><span>Старт</span></button>
            <button type="button" class="rhythm-photo-key" data-rhythm-action="pause" aria-keyshortcuts="Space" title="Пауза (пробел)" disabled><span class="rhythm-key-face" aria-hidden="true">Ⅱ</span><span>Пауза</span></button>
            <button type="button" class="rhythm-photo-key" data-rhythm-action="resume" aria-label="Продолжить" aria-keyshortcuts="Space" title="Продолжить с той же позиции, без отсчёта (пробел)" hidden><span class="rhythm-key-face" aria-hidden="true">▶</span><span>Дальше</span></button>
            <button type="button" class="rhythm-photo-key" data-rhythm-action="stop" aria-keyshortcuts="Escape" title="Стоп и к началу; следующий старт — с отсчётом, если он включён (Esc)" disabled><span class="rhythm-key-face" aria-hidden="true">■</span><span>Стоп</span></button>
          </div>
          <label class="rhythm-count-in">
            <input type="checkbox" role="switch" data-rhythm-setting="countIn" aria-describedby="${id}-count-in-help">
            <span class="rhythm-count-in-track" aria-hidden="true"></span>
            <span class="rhythm-count-in-caption">Отсчёт
              <span class="rhythm-count-in-value rhythm-switch-value" aria-hidden="true"><span>Выкл.</span><span>Вкл.</span></span>
            </span>
          </label>
          <span id="${id}-count-in-help" class="sr-only">Один такт перед новым стартом</span>
        </div>
        <div class="rhythm-mix-module" role="group" aria-label="Микшер">
          <h2>Микшер</h2>
          <div class="rhythm-mix-board">
            <div class="rhythm-mix-channels" data-rhythm-dock="metronome">${fader('accentVolume', 'Акцент')}${fader('clickVolume', 'Доля')}${fader('subdivisionVolume', 'Деления')}</div>
            <div class="rhythm-mix-channels" data-rhythm-dock="rhythm" data-rhythm-output="mixer" hidden></div>
            ${fader('master', 'Общий')}
          </div>
        </div>
      </div>
      <span class="sr-only" role="status" data-rhythm-output="transport-announcement"></span>
      <div class="rhythm-countin" data-rhythm-output="countin" hidden><small>Отсчёт</small><span data-rhythm-output="countin-value"></span></div>
    </section>`;
}

export function rhythmButton(text: string, data: Record<string, string>, label?: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  for (const [key, value] of Object.entries(data)) button.dataset[key] = value;
  if (label) button.setAttribute('aria-label', label);
  return button;
}
