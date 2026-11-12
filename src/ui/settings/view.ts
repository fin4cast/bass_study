/**
 * Экран «Настройки» (VIS-09 r1, утверждён вариант B «Разделы»): слева разделы со сводкой, справа один раздел.
 * Модуль не обращается к хранилищу и аудиовходу: состояние приходит в `update`, действия уходят колбэками.
 * Резервная копия: предпросмотр ничего не меняет, замена — только после подтверждения галочкой; старые версии
 * данных честно отклоняются (D-042). Диагностика входа монтируется приложением в `inputMount`.
 */
import './settings.css';
import { escapeHtml } from '../html';
import {
  BPM_MAX, BPM_MIN, BPM_STEP, LABEL_LABELS, SAVE_DETAIL, SAVE_TEXT, SECTIONS, THEME_LABELS, VIEW_LABELS,
  compareCounts, countLines, errorText, formatBytes, formatCopyDate, plural, rejectionText, saveKind, sectionSummaries, stepBpm, withDefaults,
  type BackupChoice, type BackupPreview, type BackupRejection, type BoardLabels, type PlayDefaults, type PlayView, type SectionId, type SettingsState, type ThemeChoice,
} from './model';

/** `notice` — действие выполнено с оговоркой (например, копия без несохранённых изменений). */
type ActionResult = void | { readonly error: string } | { readonly notice: string };
export interface SettingsOptions {
  readonly state: SettingsState;
  readonly initialSection?: SectionId;
  /** Адрес, по которому браузер хранит данные; по умолчанию `location.origin`. */
  readonly origin?: string;
  readonly onTheme?: (theme: ThemeChoice) => void;
  readonly onPlayDefaults?: (next: PlayDefaults) => void;
  /** Скачать копию. Можно вернуть промис с `{ error }`, чтобы показать отказ в диалоге. */
  readonly onExport?: () => ActionResult | Promise<ActionResult>;
  /** Открыть выбор файла (синхронно в обработчике нажатия) и вернуть предпросмотр, отказ или `null`. */
  readonly onChooseBackup?: () => Promise<BackupChoice>;
  /** Заменить данные одной операцией. Вызывается только после подтверждения. */
  readonly onConfirmRestore?: (preview: BackupPreview) => Promise<ActionResult>;
  readonly onRetrySave?: () => void;
  readonly onRecheckWriter?: () => void;
  /** Скачать сырую копию базы браузера: всё как есть, без проверки (D-042). */
  readonly onExportRaw?: () => ActionResult | Promise<ActionResult>;
  /** Смена раздела: например, чтобы остановить аудиовход при уходе из «Аудиовхода». */
  readonly onSectionChange?: (section: SectionId) => void;
}
export interface SettingsView {
  update(state: SettingsState): void;
  setVisible(visible: boolean): void;
  dispose(): void;
  /** Пустой контейнер раздела «Аудиовход» для существующей диагностики (`src/ui/input.ts`). */
  readonly inputMount: HTMLElement;
  showSection(section: SectionId, focusTab?: boolean): void;
}

const ICONS: Readonly<Record<SectionId | 'home', string>> = {
  look: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="7"/><path d="M10 3a7 7 0 0 0 0 14z" class="st-fill"/></svg>',
  lesson: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4 3h9l3 3v11H4z"/><path d="M7 9h6M7 12h6M7 6h3"/></svg>',
  data: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><ellipse cx="10" cy="5" rx="6" ry="2.5"/><path d="M4 5v10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5"/><path d="M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5"/></svg>',
  input: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M2 10h2l2-5 3 10 3-8 2 5 2-2h2"/></svg>',
  about: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="7.5"/><path d="M10 9v5M10 6.2v.1"/></svg>',
  home: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M3 9l7-6 7 6v8H3z"/><path d="M8 17v-5h4v5"/></svg>',
};

let mounts = 0;

export function mountSettings(container: HTMLElement, options: SettingsOptions): SettingsView {
  const uid = `st${++mounts}`;
  let state = options.state;
  let section: SectionId = options.initialSection ?? 'look';
  let disposed = false;
  let toastTimer = 0;
  const origin = options.origin ?? (typeof location !== 'undefined' ? location.origin : '');

  const seg = (key: 'view' | 'labels', items: Readonly<Record<string, string>>, label: string) =>
    `<div class="st-seg" role="group" aria-label="${escapeHtml(label)}">${Object.entries(items).map(([id, text]) => `<button type="button" data-set="${key}" data-value="${id}" aria-pressed="false" data-lock>${escapeHtml(text)}</button>`).join('')}</div>`;
  const toggle = (key: 'countIn' | 'newExerciseView', label: string) =>
    `<button type="button" class="st-switch" role="switch" aria-checked="false" data-switch="${key}" data-lock><span class="st-track" aria-hidden="true"></span><span class="st-switch-label">${escapeHtml(label)}</span></button>`;
  const row = (title: string, help: string, control: string, extra = '') =>
    `<div class="st-row"><div class="st-row-text"><strong>${escapeHtml(title)}</strong><span class="st-help">${escapeHtml(help)}</span>${extra}</div><div class="st-row-ctl">${control}</div></div>`;
  const themeCard = (theme: ThemeChoice, hint: string) =>
    `<button type="button" class="st-theme" data-theme-choice="${theme}" aria-pressed="false" data-lock><span class="st-prev is-${theme}" aria-hidden="true"><span class="st-prev-nav"><i></i><i></i><i></i><i></i></span><span class="st-prev-main"><b></b><i></i><i></i><span class="st-prev-neck"></span></span></span><span class="st-theme-name"><span class="st-radio" aria-hidden="true"></span><span>${escapeHtml(THEME_LABELS[theme])}<br><small>${escapeHtml(hint)}</small></span></span></button>`;
  const step = (n: number, title: string, text: string, button = '') =>
    `<div class="st-step"><span class="st-step-n" aria-hidden="true">${n}</span><h3><span class="st-sr">Шаг ${n}. </span>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p>${button}</div>`;

  const bodies: Record<SectionId, string> = {
    look: `<div class="st-card"><p class="st-text">Тема меняется сразу и запоминается. Тот же переключатель есть внизу меню.</p>
      <div class="st-themes" role="group" aria-label="Тема">${themeCard('light', 'Светлый фон, тёмный текст')}${themeCard('dark', 'Тёмный фон, светлый текст')}</div></div>`,
    lesson: `<div class="st-card"><div class="st-rows">
      ${row('Вид экрана игры', 'С этого вида открываются упражнения. Во время игры вид меняется, не останавливая её, и запоминается для упражнения.', seg('view', VIEW_LABELS, 'Вид экрана игры'), `<span class="st-subrow">${toggle('newExerciseView', 'Новое упражнение — с «Гриф крупно»')}</span>`)}
      ${row('Отсчёт перед стартом', 'Четыре доли перед первой нотой. После паузы игра продолжается без отсчёта.', toggle('countIn', 'Отсчёт 4 доли'))}
      ${row('Подписи на грифе', 'Что написано в кружках нот. На экране игры можно сменить.', seg('labels', LABEL_LABELS, 'Подписи на грифе'))}
      ${row('Темп нового упражнения', 'Дальше упражнение помнит свой темп.', `<span class="st-stepper"><button type="button" class="st-icon-btn" data-bpm="-${BPM_STEP}" aria-label="Медленнее на ${BPM_STEP}">−</button><output data-bpm-out aria-live="polite" aria-label="Темп нового упражнения"></output><button type="button" class="st-icon-btn" data-bpm="${BPM_STEP}" aria-label="Быстрее на ${BPM_STEP}">+</button><small>BPM</small></span>`)}
    </div></div>`,
    data: `<div class="st-steps">
        ${step(1, 'Скачай копию', 'Один файл JSON со всем, что ты сохранил: настройки, история, ритм-проекты.', '<button type="button" class="primary-button" data-dialog-open="download" data-lock>Скачать копию (JSON)</button>')}
        ${step(2, 'Храни её вне браузера', 'Например, в папке с документами или в облаке. Браузер может очистить данные сайта, а файл останется.')}
        ${step(3, 'Восстанови, когда нужно', 'Сначала покажем, что внутри, — это ничего не меняет. Замена — после подтверждения.', '<button type="button" class="secondary-button" data-dialog-open="restore" data-lock>Восстановить из копии…</button>')}
      </div>
      <div class="st-card">
        <div class="st-where">${ICONS.home}<div><strong>Всё хранится в этом браузере на этом компьютере</strong><span>Адрес тренажёра — <span class="st-code">${escapeHtml(origin || 'этот адрес')}</span>. Другой браузер или другой адрес этих данных не видит. Браузер может очистить данные сайта, поэтому храни копию отдельно.</span></div></div>
        <div class="st-state"><span data-save-line><span class="st-dot"></span><span data-save-detail></span></span><span data-writer-line></span></div>
        <div class="st-cols"><div><strong class="st-text">В копии</strong><ul class="st-list-dots" data-copy-list></ul></div><div><strong class="st-text">Не входят</strong><ul class="st-list-dots"><li>аудиофайлы и партитуры — после восстановления их нужно выбрать заново в «Песнях»</li></ul></div></div>
        <p class="st-note"><strong>Копия подходит только для текущей версии данных (<span data-data-version></span>).</strong> Если обновление тренажёра меняет устройство данных, сохранённое начинается заново, а копии прежней версии не загружаются.</p>
      </div>
      <div class="st-raw" data-raw-slot></div>`,
    input: `<div class="st-card"><p class="st-info">Это диагностика сигнала: она показывает, доходит ли звук баса до компьютера, но игру не оценивает.</p>
      <div class="st-input-mount" data-input-mount></div></div>`,
    about: `<div class="st-card"><dl class="st-dl">
      <dt>Версия</dt><dd data-about-version></dd>
      <dt>Где работает</dt><dd>Edge на Windows, адрес <span class="st-code">${escapeHtml(origin || 'этот адрес')}</span>. Сеть не нужна: всё нужное лежит внутри приложения.</dd>
      <dt>Документация</dt><dd>В папке проекта: README.md и docs — требования, план, устройство, решения.</dd>
      <dt>Библиотеки</dt><dd>VexFlow — MIT; alphaTab — MPL-2.0</dd>
      <dt>Шрифты нот</dt><dd>Bravura и Academico — SIL Open Font License 1.1</dd>
      <dt>Тексты лицензий</dt><dd>Поставляются вместе с приложением: папки licenses и vendor/music-bank рядом с собранными файлами</dd>
    </dl></div>`,
  };

  container.classList.add('p13-settings');
  container.innerHTML = `
    <header class="st-top">
      <div><h1 class="st-title" tabindex="-1" data-title>Настройки</h1><p class="st-sub">Оформление, умолчания занятия, резервная копия и проверка аудиовхода.</p></div>
      <span class="st-save" role="status" data-save-head><span class="st-dot"></span><span data-save-text></span></span>
    </header>
    <div class="st-banners" data-banners></div>
    <div class="st-layout">
      <div class="st-tabs" role="tablist" aria-orientation="vertical" aria-label="Разделы настроек">${SECTIONS.map(item => `<button type="button" role="tab" class="st-tab" id="${uid}-tab-${item.id}" aria-controls="${uid}-pane-${item.id}" aria-selected="false" tabindex="-1" data-section="${item.id}">${ICONS[item.id]}<b>${escapeHtml(item.short)}</b><small data-summary="${item.id}"></small></button>`).join('')}</div>
      <div class="st-panes">${SECTIONS.map(item => `<section class="st-pane" role="tabpanel" id="${uid}-pane-${item.id}" aria-labelledby="${uid}-tab-${item.id}" data-pane="${item.id}" hidden><div class="st-pane-head"><h2 tabindex="-1">${escapeHtml(item.title)}</h2><p class="st-sub">${escapeHtml(item.lead)}</p></div>${bodies[item.id]}</section>`).join('')}</div>
    </div>
    <dialog class="st-dialog" aria-labelledby="${uid}-dlg-title" data-dialog></dialog>
    <div class="st-toast" role="status" aria-live="polite" data-toast></div>`;

  const $ = <T extends HTMLElement = HTMLElement>(selector: string, scope: ParentNode = container) => scope.querySelector<T>(selector);
  const $$ = <T extends HTMLElement = HTMLElement>(selector: string, scope: ParentNode = container) => [...scope.querySelectorAll<T>(selector)];
  const dialog = $<HTMLDialogElement>('[data-dialog]')!;
  const inputMount = $('[data-input-mount]')!;
  const locked = () => state.writer === 'other-tab';

  function toast(text: string) {
    const box = $('[data-toast]')!;
    box.textContent = text;
    box.classList.add('is-on');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => box.classList.remove('is-on'), 3200);
  }

  /* ---------- Синхронизация разметки с состоянием ---------- */
  let lastBanners = '';
  function sync() {
    const defaults = state.playDefaults;
    const kind = saveKind(state);
    for (const button of $$('[data-theme-choice]')) button.setAttribute('aria-pressed', String(button.dataset.themeChoice === state.theme));
    for (const button of $$('[data-set]')) button.setAttribute('aria-pressed', String(defaults[button.dataset.set as 'view' | 'labels'] === button.dataset.value));
    for (const button of $$('[data-switch]')) {
      const on = button.dataset.switch === 'countIn' ? defaults.countIn : defaults.newExerciseView === 'board';
      button.setAttribute('aria-checked', String(on));
    }
    $('[data-bpm-out]')!.textContent = String(defaults.bpm);
    for (const button of $$<HTMLButtonElement>('[data-bpm]')) button.disabled = locked() || (Number(button.dataset.bpm) < 0 ? defaults.bpm <= BPM_MIN : defaults.bpm >= BPM_MAX);
    for (const element of $$<HTMLButtonElement>('[data-lock]')) element.disabled = locked();

    const head = $('[data-save-head]')!;
    head.className = `st-save is-${kind}`;
    $('[data-save-text]')!.textContent = SAVE_TEXT[kind];
    $('[data-save-line]')!.className = `is-${kind}`;
    $('[data-save-detail]')!.textContent = SAVE_DETAIL[kind];
    $('[data-writer-line]')!.textContent = locked() ? 'Здесь только просмотр.' : 'Записывает эта вкладка; во второй вкладке будет только просмотр.';
    $('[data-copy-list]')!.innerHTML = countLines(state.counts).map(line => `<li>${escapeHtml(line)}</li>`).join('');
    $('[data-data-version]')!.textContent = String(state.dataVersion);
    $('[data-about-version]')!.textContent = `bass.study ${state.version} · версия данных ${state.dataVersion}`;
    const summaries = sectionSummaries(state);
    for (const element of $$('[data-summary]')) element.textContent = summaries[element.dataset.summary as SectionId];

    syncRaw();

    const banners: string[] = [];
    if (locked()) banners.push(`<div class="st-banner" role="region" aria-label="Тренажёр открыт в другой вкладке"><div><strong>Тренажёр открыт в другой вкладке.</strong><p>Записывать данные может только одна вкладка — так сохранённое не перепутается. Здесь сейчас только просмотр. Закрой ту вкладку и нажми «Проверить снова».</p></div><div class="st-banner-actions"><button type="button" class="secondary-button" data-recheck>Проверить снова</button></div></div>`);
    if (kind === 'error') banners.push(`<div class="st-banner is-warn" role="alert"><div><strong>Не сохранилось: ${escapeHtml(errorText(state.saveStatus))}</strong><p>Изменение видно на экране, но не записано. Сообщение останется, пока повтор не пройдёт.</p></div><div class="st-banner-actions"><button type="button" class="secondary-button" data-retry>Повторить сохранение</button></div></div>`);
    const html = banners.join('');
    if (html !== lastBanners) {
      const box = $('[data-banners]')!;
      const hadFocus = box.contains(document.activeElement);
      box.innerHTML = html;
      lastBanners = html;
      if (hadFocus) ($('[data-banners] button') ?? $('[data-save-head]') ?? $('[data-title]'))?.focus();
    }
  }

  /* ---------- Сырая копия базы ---------- */
  let lastRaw = '';
  let rawBusy = false;
  const RAW_TEXT = 'Сырая копия — всё содержимое базы этого браузера как есть, без проверки. Восстановить из неё можно только вручную; для переноса и восстановления нужна обычная копия JSON.';
  function rawButton() {
    return `<button type="button" class="secondary-button" data-raw-export${rawBusy ? ' disabled' : ''}>${rawBusy ? 'Готовим сырую копию…' : 'Скачать сырую копию базы'}</button>`;
  }
  function syncRaw() {
    const issue = state.dataIssue?.trim() ?? '';
    const html = issue
      ? `<div class="st-banner is-warn" role="region" aria-label="Не всё прочиталось" data-raw-warning><div><strong>Часть сохранённого не прочиталась</strong><p>${escapeHtml(issue)}</p><p>${escapeHtml(RAW_TEXT)}</p></div><div class="st-banner-actions">${rawButton()}</div></div>`
      : `<details class="st-card st-more" data-raw-more><summary>Подробнее</summary><p class="st-text">${escapeHtml(RAW_TEXT)}</p><div>${rawButton()}</div></details>`;
    if (html === lastRaw) return;
    const slot = $('[data-raw-slot]')!;
    const details = $<HTMLDetailsElement>('[data-raw-more]', slot);
    const open = details?.open ?? false;
    const hadFocus = slot.contains(document.activeElement);
    slot.innerHTML = html;
    lastRaw = html;
    const next = $<HTMLDetailsElement>('[data-raw-more]', slot);
    if (next && open) next.open = true;
    if (hadFocus) ($('[data-raw-export]', slot) ?? $('summary', slot))?.focus();
  }
  async function exportRaw() {
    if (rawBusy || !options.onExportRaw) return;
    rawBusy = true; syncRaw();
    let result: ActionResult;
    try { result = await options.onExportRaw(); }
    catch (error) { result = { error: error instanceof Error ? error.message : 'неизвестная ошибка' }; }
    if (disposed) return;
    rawBusy = false; syncRaw();
    if (result && 'error' in result) toast(`Сырая копия не скачалась: ${result.error}`);
    else toast(result && 'notice' in result ? result.notice : 'Сырая копия базы скачана. Это не резервная копия: восстановление из неё — вручную.');
  }

  function showSection(next: SectionId, focusTab = false) {
    const changed = next !== section;
    section = next;
    for (const tab of $$('[data-section]')) {
      const on = tab.dataset.section === next;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    for (const pane of $$('[data-pane]')) pane.hidden = pane.dataset.pane !== next;
    if (focusTab) $(`[data-section="${next}"]`)?.focus();
    if (changed) options.onSectionChange?.(next);
  }

  /* ---------- Действия занятия ---------- */
  function setDefaults(next: PlayDefaults) {
    if (locked()) return;
    state = { ...state, playDefaults: next };
    sync();
    options.onPlayDefaults?.(next);
  }

  /* ---------- Диалоги копии ---------- */
  type Step = 'download' | 'exporting' | 'pick' | 'choosing' | 'preview' | 'reject' | 'replacing' | 'done' | 'failed';
  let dialogStep: Step | null = null;
  let opener: HTMLElement | null = null;
  let preview: BackupPreview | null = null;
  let rejection: BackupRejection | null = null;
  let failure = '';
  let confirmed = false;
  let dialogToken = 0;

  const close = (label: string) => `<button type="button" class="secondary-button" data-dlg="close">${escapeHtml(label)}</button>`;
  const eyebrow = (text: string) => `<p class="st-eyebrow">${escapeHtml(text)}</p>`;
  const title = (text: string) => `<h2 id="${uid}-dlg-title" tabindex="-1">${escapeHtml(text)}</h2>`;
  function dialogHtml(stepName: Step) {
    if (stepName === 'download' || stepName === 'exporting') return `${eyebrow('Резервная копия')}${title('Скачать копию')}
      <p>Один файл JSON. Сохрани его вне браузера.</p>
      <ul class="st-list-dots">${countLines(state.counts).map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
      <p class="st-help">Аудиофайлы и партитуры в копию не входят.</p>
      ${saveKind(state) === 'error' ? '<p class="st-warn">Последнее изменение не записано. В копию попадёт только сохранённое — сначала можно повторить сохранение.</p>' : ''}
      ${failure ? `<p class="st-warn" role="alert">Копия не скачалась: ${escapeHtml(failure)}</p>` : ''}
      <div class="st-dlg-actions">${close('Отмена')}<button type="button" class="primary-button" data-dlg="export"${stepName === 'exporting' ? ' disabled' : ''}>${stepName === 'exporting' ? 'Готовим копию…' : 'Скачать'}</button></div>`;
    if (stepName === 'pick' || stepName === 'choosing') return `${eyebrow('Шаг 1 из 3 · выбери файл')}${title('Восстановить из копии')}
      <p>Сначала покажем, что внутри копии. Пока ты не подтвердишь замену, ничего не меняется.</p>
      <div class="st-dlg-actions">${close('Отмена')}<button type="button" class="primary-button" data-dlg="choose"${stepName === 'choosing' ? ' disabled' : ''}>${stepName === 'choosing' ? 'Читаем файл…' : 'Выбрать файл…'}</button></div>`;
    if (stepName === 'preview' && preview) {
      const compared = compareCounts(preview.counts, preview.current);
      const facts = [formatCopyDate(preview.createdAt) && `сделана ${formatCopyDate(preview.createdAt)}`, preview.sizeBytes !== undefined && formatBytes(preview.sizeBytes)].filter(Boolean).join(' · ');
      return `${eyebrow('Шаг 2 из 3 · проверь')}${title('Что внутри копии')}
        <p><span class="st-code">${escapeHtml(preview.fileName)}</span>${facts ? ` · ${escapeHtml(facts)}` : ''}. Копия подходит. Предпросмотр ничего не изменил.</p>
        <table class="st-cmp"><thead><tr><th scope="col">Данные</th><th scope="col" class="st-n">В копии</th><th scope="col" class="st-n">Сейчас</th></tr></thead><tbody>${compared.rows.map(item => `<tr><th scope="row">${escapeHtml(item.label)}</th><td class="st-n">${escapeHtml(item.copy)}</td><td class="st-n">${escapeHtml(item.now)}</td></tr>`).join('')}</tbody></table>
        <p class="st-warn">Копия заменит всё сохранённое целиком — объединения нет.${compared.lostHistory ? ` Сейчас записей истории больше, чем в копии: ${compared.lostHistory} ${plural(compared.lostHistory, 'запись пропадёт', 'записи пропадут', 'записей пропадут')}.` : ''} Перед заменой остановим звук и текущее упражнение. <button type="button" class="st-inline" data-dlg="export-current">Сначала скачать текущую копию</button></p>
        <label class="st-check"><input type="checkbox" data-dlg-confirm${confirmed ? ' checked' : ''}><span>Понимаю, что текущие данные будут заменены</span></label>
        <div class="st-dlg-actions"><button type="button" class="text-button st-grow" data-dlg="back">← Другой файл</button>${close('Отмена')}<button type="button" class="primary-button" data-dlg="replace"${confirmed ? '' : ' disabled'}>Заменить данные</button></div>`;
    }
    if (stepName === 'reject' && rejection) {
      const text = rejectionText(rejection, state.dataVersion);
      return `${eyebrow('Шаг 2 из 3 · проверь')}${title(text.title)}
        <p>${escapeHtml(text.text)} <strong>Ничего не изменилось.</strong></p>
        ${text.note ? `<p class="st-note">${escapeHtml(text.note)}</p>` : ''}
        <div class="st-dlg-actions"><button type="button" class="text-button st-grow" data-dlg="back">← Другой файл</button>${close('Закрыть')}</div>`;
    }
    if (stepName === 'replacing') return `${eyebrow('Шаг 3 из 3')}${title('Заменяем данные…')}<p>Одна операция: либо заменится всё, либо ничего.</p>`;
    if (stepName === 'done' && preview) return `${eyebrow('Шаг 3 из 3 · готово')}${title('Данные восстановлены')}
      <p class="st-ok">Всё заменено одной операцией из копии ${escapeHtml(preview.fileName)}: ${escapeHtml(countLines(preview.counts).slice(1).join(', '))}. Настройки из копии уже действуют.</p>
      <p class="st-help">Аудиофайлы и партитуры выбери заново в «Песнях».</p>
      <div class="st-dlg-actions"><button type="button" class="primary-button" data-dlg="close">Готово</button></div>`;
    if (stepName === 'failed') return `${eyebrow('Шаг 3 из 3')}${title('Замена не прошла')}
      <p class="st-warn" role="alert">${escapeHtml(failure || 'Не удалось заменить данные.')} <strong>Сохранённое осталось прежним.</strong></p>
      <div class="st-dlg-actions"><button type="button" class="text-button st-grow" data-dlg="back">← Другой файл</button>${close('Закрыть')}</div>`;
    return '';
  }
  function showStep(next: Step, focus = true) {
    dialogStep = next;
    dialog.innerHTML = `<div class="st-dlg">${dialogHtml(next)}</div>`;
    if (!focus) return;
    const target = ({ download: '[data-dlg="export"]', pick: '[data-dlg="choose"]', done: '[data-dlg="close"]' } as Partial<Record<Step, string>>)[next];
    ((target ? $(target, dialog) : null) ?? $(`#${uid}-dlg-title`, dialog))?.focus();
  }
  function openDialog(kind: 'download' | 'restore', from: HTMLElement) {
    if (locked() || dialog.open) return;
    opener = from;
    preview = null; rejection = null; failure = ''; confirmed = false;
    dialogToken++;
    dialog.showModal();
    showStep(kind === 'download' ? 'download' : 'pick');
  }
  /** Во время замены и подготовки копии диалог не закрывается; ожидание файла можно отменить (поздний ответ отбрасывается). */
  const busy = () => dialogStep === 'replacing' || dialogStep === 'exporting';
  function closeDialog() { if (dialog.open && !busy()) dialog.close(); }
  function onDialogClose() {
    const back = opener;
    opener = null; dialogStep = null; preview = null; rejection = null; confirmed = false; failure = '';
    dialogToken++;
    dialog.innerHTML = '';
    if (back?.isConnected && !(back as HTMLButtonElement).disabled) back.focus();
    else $('[data-title]')?.focus();
  }
  function onDialogCancel(event: Event) { if (busy()) event.preventDefault(); }
  function onDialogChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.matches('[data-dlg-confirm]')) return;
    confirmed = input.checked;
    const replace = $<HTMLButtonElement>('[data-dlg="replace"]', dialog);
    if (replace) replace.disabled = !confirmed;
  }
  async function runExport(stepAfter: Step | null) {
    const token = dialogToken;
    failure = '';
    if (stepAfter) showStep('exporting', false);
    let result: ActionResult;
    try { result = await options.onExport?.(); }
    catch (error) { result = { error: error instanceof Error ? error.message : 'неизвестная ошибка' }; }
    if (disposed || token !== dialogToken) return;
    if (result && 'error' in result) {
      failure = result.error;
      if (stepAfter) showStep(stepAfter);
      else toast(`Копия не скачалась: ${result.error}`);
      return;
    }
    if (stepAfter) { dialog.close(); }
    toast(result && 'notice' in result ? result.notice : 'Копия скачана. Сохрани файл вне браузера.');
  }
  async function choose() {
    if (!options.onChooseBackup) return;
    const token = dialogToken;
    const pending = options.onChooseBackup();
    showStep('choosing', false);
    let choice: BackupChoice;
    try { choice = await pending; }
    catch (error) { choice = { kind: 'error', reason: 'read', message: error instanceof Error ? error.message : undefined }; }
    if (disposed || token !== dialogToken || !dialog.open) return;
    if (!choice) { showStep('pick'); return; }
    confirmed = false;
    if (choice.kind === 'preview') { preview = choice; rejection = null; showStep('preview'); }
    else { rejection = choice; preview = null; showStep('reject'); }
  }
  async function replace() {
    if (!preview || !confirmed || !options.onConfirmRestore) return;
    const token = dialogToken;
    const candidate = preview;
    showStep('replacing');
    let result: ActionResult;
    try { result = await options.onConfirmRestore(candidate); }
    catch (error) { result = { error: error instanceof Error ? error.message : 'неизвестная ошибка' }; }
    if (disposed || token !== dialogToken) return;
    if (result && 'error' in result) { failure = result.error; showStep('failed'); return; }
    showStep('done');
  }
  function onDialogClick(event: MouseEvent) {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-dlg]');
    if (!button || button.disabled) return;
    const action = button.dataset.dlg;
    if (action === 'close') closeDialog();
    else if (action === 'export') void runExport('download');
    else if (action === 'export-current') { button.disabled = true; button.textContent = 'Готовим текущую копию…'; void runExport(null).then(() => { if (button.isConnected) button.textContent = 'Текущая копия скачана'; }); }
    else if (action === 'choose') void choose();
    else if (action === 'back') { preview = null; rejection = null; failure = ''; confirmed = false; showStep('pick'); }
    else if (action === 'replace') void replace();
  }

  /* ---------- События экрана ---------- */
  function onClick(event: MouseEvent) {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button || button.disabled || dialog.contains(button) || !container.contains(button)) return;
    if (button.dataset.section) { showSection(button.dataset.section as SectionId); return; }
    if (button.dataset.themeChoice) {
      if (locked()) return;
      const theme = button.dataset.themeChoice as ThemeChoice;
      state = { ...state, theme };
      sync();
      options.onTheme?.(theme);
      return;
    }
    if (button.dataset.set) {
      const key = button.dataset.set as 'view' | 'labels';
      setDefaults(withDefaults(state.playDefaults, key === 'view' ? { view: button.dataset.value as PlayView } : { labels: button.dataset.value as BoardLabels }));
      return;
    }
    if (button.dataset.switch === 'countIn') { setDefaults(withDefaults(state.playDefaults, { countIn: !state.playDefaults.countIn })); return; }
    if (button.dataset.switch === 'newExerciseView') { setDefaults(withDefaults(state.playDefaults, { newExerciseView: state.playDefaults.newExerciseView === 'board' ? null : 'board' })); return; }
    if (button.dataset.bpm) { setDefaults(stepBpm(state.playDefaults, Number(button.dataset.bpm))); return; }
    if (button.dataset.dialogOpen) { openDialog(button.dataset.dialogOpen as 'download' | 'restore', button); return; }
    if (button.matches('[data-retry]')) { options.onRetrySave?.(); return; }
    if (button.matches('[data-raw-export]')) { void exportRaw(); return; }
    if (button.matches('[data-recheck]')) { options.onRecheckWriter?.(); toast('Проверяем, свободна ли запись…'); }
  }
  function onKeydown(event: KeyboardEvent) {
    const tab = (event.target as HTMLElement).closest?.<HTMLElement>('[data-section]');
    if (!tab) return;
    const ids = SECTIONS.map(item => item.id);
    const index = ids.indexOf(tab.dataset.section as SectionId);
    const next = ({ ArrowDown: ids[(index + 1) % ids.length], ArrowUp: ids[(index - 1 + ids.length) % ids.length], Home: ids[0], End: ids[ids.length - 1] } as Record<string, SectionId>)[event.key];
    if (!next) return;
    event.preventDefault();
    showSection(next, true);
  }
  container.addEventListener('click', onClick);
  container.addEventListener('keydown', onKeydown);
  dialog.addEventListener('click', onDialogClick);
  dialog.addEventListener('change', onDialogChange);
  dialog.addEventListener('cancel', onDialogCancel);
  dialog.addEventListener('close', onDialogClose);

  showSection(section);
  sync();

  return {
    inputMount,
    showSection,
    update(next: SettingsState) {
      if (disposed) return;
      state = next;
      sync();
      if (locked() && dialog.open && !busy()) dialog.close();
      else if (dialog.open && (dialogStep === 'download' || dialogStep === 'preview')) {
        const hadFocus = dialog.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.dlg ?? null : null;
        showStep(dialogStep, false);
        if (hadFocus) $<HTMLElement>(`[data-dlg="${hadFocus}"]`, dialog)?.focus();
      }
    },
    setVisible(visible: boolean) {
      if (disposed) return;
      container.hidden = !visible;
      if (!visible && dialog.open && !busy()) dialog.close();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      window.clearTimeout(toastTimer);
      if (dialog.open) dialog.close();
      container.removeEventListener('click', onClick);
      container.removeEventListener('keydown', onKeydown);
      dialog.removeEventListener('click', onDialogClick);
      dialog.removeEventListener('change', onDialogChange);
      dialog.removeEventListener('cancel', onDialogCancel);
      dialog.removeEventListener('close', onDialogClose);
      container.classList.remove('p13-settings');
      container.innerHTML = '';
    },
  };
}

export type { SettingsState, PlayDefaults, BackupPreview, BackupRejection, BackupChoice, SectionId } from './model';
