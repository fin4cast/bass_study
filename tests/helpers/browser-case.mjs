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
