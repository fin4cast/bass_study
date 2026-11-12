/**
 * Режим набора: быстрый по умолчанию, полный — по `--full` или `BASS_FULL=1`.
 * Полный режим добавляет сценарии, помеченные `full: '<причина>'` (см. FULL_ONLY). В быстром режиме они не исчезают,
 * а попадают в отчёт как skipped с причиной.
 */
export function suiteMode(argv = process.argv.slice(2), env = process.env) {
  if (argv.includes('--full')) return 'full';
  if (env.BASS_FULL === undefined || env.BASS_FULL === '' || env.BASS_FULL === '0') return 'fast';
  if (env.BASS_FULL === '1') return 'full';
  throw new Error(`BASS_FULL допускает только 0 или 1, получено ${JSON.stringify(env.BASS_FULL)}.`);
}

/** Делит сценарии на выполняемые и пропущенные в быстром режиме; у пропущенных сохраняется причина. */
export function browserTier(checks, mode = suiteMode()) {
  for (const check of checks) {
    if (check.full !== undefined && !(typeof check.full === 'string' && check.full.trim())) throw new Error(`Сценарий ${check.name}: full должен содержать причину.`);
  }
  if (mode === 'full') return { mode, checks, skipped: [] };
  return {
    mode,
    checks: checks.filter(check => !check.full),
    skipped: checks.filter(check => check.full).map(skippedCheck),
  };
}

export const skippedCheck = ({ name, scope, full }) => ({ name, ...(scope ? { scope } : {}), status: 'skipped', reason: `Только полный набор: ${full}` });

export const FULL_ONLY = {
  hiddenTab: 'настоящая скрытая вкладка отдельного Edge через CDP',
  viewports: 'дополнительные ширины визуальной матрицы; типичная ширина в обеих темах проверяется в быстром наборе',
  liveAudio: 'live-сигнал AudioContext в реальном времени; под нагрузкой параллельного пула нестабилен, PCM и UI раздела проверяются в быстром наборе',
  separateProcess: 'отдельный процесс Edge (нативная IndexedDB в своём профиле или перезапуск браузера): долгий запуск',
  unstable: 'нестабилен в RDP/под нагрузкой',
  smoke: 'дымовой отбор: основные потоки раздела (загрузка, базовое действие, сохранение, ошибка) в быстром наборе покрыты другими сценариями',
};

/** Помечает сценарии полного набора по точным именам; неизвестное имя — ошибка, чтобы переименование не теряло отметку. */
export function markFullOnly(checks, names, reason) {
  for (const name of names) {
    const matches = checks.filter(check => check.name === name);
    if (matches.length !== 1) throw new Error(`Сценарий полного набора не найден однозначно: ${name}`);
    if (matches[0].full) throw new Error(`Сценарий уже отнесён к полному набору: ${name}`);
    matches[0].full = reason;
  }
  return checks;
}

export function browserCases(checks, argv = process.argv.slice(2)) {
  const args = argv.filter(arg => arg === '--case' || arg.startsWith('--case='));
  if (args.length === 0) return { checks, filtered: false };
  if (args.length !== 1 || !args[0].startsWith('--case=') || !args[0].slice(7).trim()) {
    throw new Error('Укажи один непустой аргумент --case=<часть названия сценария>.');
  }
  const needle = args[0].slice(7).trim();
  const matches = checks.filter(check => check.name.includes(needle));
  if (!matches.length) throw new Error(`Сценарии по --case=${needle} не найдены.`);
  return { checks: matches, filtered: true };
}
