export function rhythmMarkup(id: string) {
  return `
    <div class="rhythm-tabs" role="tablist" aria-label="Инструмент ритмической практики">
      <button type="button" id="${id}-metro-tab" role="tab" aria-selected="true" aria-controls="${id}-metro" data-rhythm-mode="metronome">Метроном</button>
      <button type="button" id="${id}-rack-tab" role="tab" aria-selected="false" aria-controls="${id}-rack" data-rhythm-mode="rhythm" tabindex="-1">Ритм-секция</button>
    </div>
    <section class="rhythm-transport" aria-label="Темп и воспроизведение">
      <div class="rhythm-transport-line">
        <div class="rhythm-play-buttons">
          <button type="button" class="rhythm-primary" data-rhythm-action="start"><span aria-hidden="true">▶</span> Старт</button>
          <button type="button" data-rhythm-action="pause" disabled>Пауза</button>
          <button type="button" data-rhythm-action="resume" hidden>Продолжить</button>
          <button type="button" data-rhythm-action="stop" disabled>Стоп</button>
        </div>
        <div class="rhythm-tempo"><button type="button" data-rhythm-action="slower" aria-label="Уменьшить темп на один BPM">−</button>
          <label>Темп, BPM <span aria-hidden="true" data-rhythm-output="tempo-unit">♩</span><input type="number" min="30" max="240" data-rhythm-setting="bpm" value="92"></label>
          <button type="button" data-rhythm-action="faster" aria-label="Увеличить темп на один BPM">+</button>
        </div>
        <button type="button" data-rhythm-action="tap">Настучать темп</button>
        <label class="rhythm-master">Громкость<input type="range" min="0" max="1" step="0.05" data-rhythm-setting="master" value="0.65"></label>
        <label class="rhythm-check"><input type="checkbox" data-rhythm-setting="countIn">Отсчёт · 1 такт</label>
        <output class="rhythm-position" data-rhythm-output="position" aria-live="off">Остановлено</output>
      </div>
      <span class="sr-only" role="status" data-rhythm-output="transport-announcement"></span>
      <label class="rhythm-tempo-slider"><span aria-hidden="true">30</span><input type="range" min="30" max="240" value="92" aria-label="Ползунок темпа" data-rhythm-setting="bpm-slider"><span aria-hidden="true">240</span></label>
      <p class="rhythm-muted" data-rhythm-output="linked-tempo" hidden>Темп связан между вкладками. В ритм-секции BPM отсчитывается четвертями.</p>
      <p class="rhythm-error" data-rhythm-output="error" role="alert" hidden></p>
    </section>
    <section id="${id}-metro" role="tabpanel" aria-labelledby="${id}-metro-tab" data-rhythm-panel="metronome" class="rhythm-metro">
      <div class="rhythm-stack">
        <section class="rhythm-card rhythm-pulse"><div class="rhythm-card-heading"><h2>Пульс и акценты</h2><span class="rhythm-muted" data-rhythm-output="meter-label"></span></div>
          <div class="rhythm-inline rhythm-meter-settings">
            <label>Доли<input type="number" min="2" max="12" data-rhythm-setting="beats"></label>
            <label>Размер<select data-rhythm-setting="denominator" aria-label="Знаменатель размера"><option value="4">/4</option><option value="8">/8</option></select></label>
            <label>Группы<input type="text" maxlength="31" data-rhythm-setting="groups" placeholder="2+2+3"></label>
            <label>Единица BPM<select data-rhythm-setting="bpmUnit"><option value="quarter">Четверть</option><option value="eighth">Восьмая</option><option value="dotted-quarter">Четверть с точкой</option></select></label>
          </div>
          <div class="rhythm-beats" data-rhythm-output="beats" aria-label="Акценты долей"></div>
          <p class="rhythm-muted">Нажми на долю, чтобы изменить её щелчок. Подразделения включаются отдельно.</p>
        </section>
        <section class="rhythm-card"><h2>Подразделение доли</h2>
          <div class="rhythm-divisions" role="group" aria-label="Подразделение доли">
            <button type="button" data-rhythm-division="1" aria-pressed="true">♩ Доли</button><button type="button" data-rhythm-division="2" aria-pressed="false">♫ Восьмые</button><button type="button" data-rhythm-division="3" aria-pressed="false">Триоли</button><button type="button" data-rhythm-division="4" aria-pressed="false">♬ Шестнадцатые</button>
          </div>
          <div class="rhythm-inline"><label>Свинг <input type="range" min="50" max="70" step="1" data-rhythm-setting="metronomeSwing" aria-describedby="${id}-swing-help"><output data-rhythm-output="metro-swing"></output></label><label>Рисунок<select data-rhythm-setting="metro-swing-mode" aria-label="Свинг метронома" aria-describedby="${id}-swing-help"><option value="eighth">Половины доли</option><option value="sixteenth">Внутри каждой пары</option></select></label></div>
          <p class="rhythm-muted" id="${id}-swing-help" data-rhythm-output="swing-explanation"></p>
        </section>
        <details class="rhythm-card rhythm-training"><summary><strong>Тренировка пульса</strong><span class="rhythm-muted">Немые такты и рост темпа</span></summary>
          <div class="rhythm-training-fields">
            <fieldset><legend><label class="rhythm-check"><input type="checkbox" data-rhythm-setting="silentEnabled">Немые такты</label></legend><label>Со звуком<input type="number" min="1" max="16" data-rhythm-setting="soundBars"></label><label>Без звука<input type="number" min="1" max="16" data-rhythm-setting="silentBars"></label></fieldset>
            <fieldset><legend><label class="rhythm-check"><input type="checkbox" data-rhythm-setting="rampEnabled">Рост темпа</label></legend><label>Шаг BPM<input type="number" min="1" max="20" data-rhythm-setting="stepBpm"></label><label>Каждые N тактов<input type="number" min="1" max="32" data-rhythm-setting="everyBars"></label><label>До BPM<input type="number" min="30" max="240" data-rhythm-setting="targetBpm" aria-describedby="${id}-ramp-help"></label><small class="rhythm-muted" id="${id}-ramp-help">При росте темпа цель поднимается, если исходный BPM оказался выше.</small></fieldset>
          </div>
        </details>
      </div>
      <section class="rhythm-card rhythm-sounds" aria-label="Звук метронома"><h2>Звук метронома</h2><div class="rhythm-kit-list" data-rhythm-output="kits"></div>
        <div class="rhythm-voice-volumes"><label>Акцент<input type="range" min="0" max="1" step="0.05" data-rhythm-setting="accentVolume" aria-label="Громкость акцента"></label><label>Обычная доля<input type="range" min="0" max="1" step="0.05" data-rhythm-setting="clickVolume" aria-label="Громкость обычной доли"></label><label>Подразделения <input type="range" min="0" max="1" step="0.05" data-rhythm-setting="subdivisionVolume" aria-label="Громкость подразделений"></label></div>
        <button type="button" data-rhythm-action="preview">Прослушать</button>
      </section>
    </section>
    <section id="${id}-rack" role="tabpanel" aria-labelledby="${id}-rack-tab" data-rhythm-panel="rhythm" class="rhythm-groove" hidden>
      <div class="rhythm-groove-heading"><div class="rhythm-scope" role="group" aria-label="Что проигрывать"><span>Играть</span><button type="button" data-rhythm-scope="pattern" aria-pressed="true">Паттерн</button><button type="button" data-rhythm-scope="chain" aria-pressed="false">Цепочку</button></div><label class="rhythm-field">Повтор<select data-rhythm-setting="repeat" aria-label="Повтор ритма"><option value="once">Один проход</option><option value="loop">По кругу</option></select></label><label class="rhythm-check"><input type="checkbox" data-rhythm-setting="rhythmClick" aria-describedby="${id}-overlay-help">Метроном поверх</label></div>
      <p class="rhythm-muted" id="${id}-overlay-help" data-rhythm-output="overlay-help"></p>
      <div class="rhythm-rack-layout">
        <aside class="rhythm-card rhythm-library"><h2>Готовые партии</h2><div class="rhythm-preset-list" data-rhythm-output="presets"></div>
          <details class="rhythm-project-library"><summary>Мои проекты <span data-rhythm-output="project-count"></span></summary><div data-rhythm-output="projects"></div><button type="button" data-rhythm-action="new-project">Новый проект</button></details>
        </aside>
        <div class="rhythm-stack">
          <section class="rhythm-card rhythm-constructor" aria-label="Конструктор паттернов">
            <div class="rhythm-constructor-top"><div class="rhythm-pattern-tabs" data-rhythm-output="patterns" aria-label="Паттерны"></div><button type="button" data-rhythm-action="add-pattern">+ Паттерн</button><button type="button" data-rhythm-action="duplicate-pattern">Дублировать</button></div>
            <div class="rhythm-editor-tools"><label class="rhythm-name">Паттерн<input type="text" maxlength="50" data-rhythm-setting="pattern-name" aria-label="Название паттерна"></label><label class="rhythm-field">Длина<select data-rhythm-setting="bars"><option value="1">1 такт</option><option value="2">2 такта</option><option value="4">4 такта</option></select></label><div data-rhythm-output="bars" class="rhythm-bar-tabs" aria-label="Такт для редактирования"></div><button type="button" data-rhythm-action="copy-bar">Копировать такт</button><button type="button" data-rhythm-action="clear-bar">Очистить такт</button></div>
            <div class="rhythm-rack-scroll" tabindex="0" aria-label="Сетка 4/4, 16 шагов на такт"><div class="rhythm-rack" data-rhythm-output="rack"></div><div data-rhythm-output="velocity"></div></div>
            <div class="rhythm-rack-tools"><label class="rhythm-field">Инструмент<select data-rhythm-setting="new-sound" aria-label="Инструмент для добавления"></select></label><button type="button" data-rhythm-action="add-lane">+ Добавить</button><button type="button" data-rhythm-action="accent-step">Акцент удара</button><label>Общий свинг <input type="range" min="50" max="70" step="1" data-rhythm-setting="rhythm-swing"><output data-rhythm-output="rhythm-swing"></output></label><label>Пары<select data-rhythm-setting="rhythm-swing-mode" aria-label="Общий свинг ритм-секции"><option value="eighth">Восьмые</option><option value="sixteenth">Шестнадцатые</option></select></label></div>
          </section>
          <section class="rhythm-card rhythm-chain-card"><div class="rhythm-card-heading"><h2>Цепочка паттернов</h2><span class="rhythm-muted" data-rhythm-output="chain-length"></span></div><div class="rhythm-chain" data-rhythm-output="chain" aria-label="Порядок паттернов"></div><button type="button" data-rhythm-action="add-clip">+ Блок</button></section>
          <section class="rhythm-card rhythm-project-tools" aria-label="Текущий проект"><label class="rhythm-name">Имя проекта<input type="text" maxlength="50" data-rhythm-setting="project-name"></label><button type="button" data-rhythm-action="save-project">Сохранить проект</button><button type="button" data-rhythm-action="duplicate-project">Сохранить копию</button></section>
        </div>
      </div>
    </section>
    <p class="rhythm-status" role="status" data-rhythm-output="status">Выбери параметры и нажми «Старт».</p>`;
}

export function rhythmButton(text: string, data: Record<string, string>, label?: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  for (const [key, value] of Object.entries(data)) button.dataset[key] = value;
  if (label) button.setAttribute('aria-label', label);
  return button;
}
