import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? files(target) : target.endsWith('.md') ? [target] : [];
  });
}
const documents = [path.join(root, 'README.md'), path.join(root, 'AGENTS.md'), ...files(path.join(root, 'docs'))];
const failures = [];
let checked = 0;
const anchors = new Map();
function getAnchors(file) {
  if (anchors.has(file)) return anchors.get(file);
  const content = fs.readFileSync(file, 'utf8').replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, '');
  const found = new Set();
  const headings = new Map();
  for (const match of content.matchAll(/<a\s+id=["']([^"']+)["'][^>]*>/g)) {
    if (found.has(match[1])) failures.push(`${path.relative(root, file)}: duplicate anchor #${match[1]}`);
    found.add(match[1]);
  }
  for (const match of content.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const slug = match[1].toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
    const index = headings.get(slug) ?? 0;
    found.add(index ? `${slug}-${index}` : slug);
    headings.set(slug, index + 1);
  }
  anchors.set(file, found);
  return found;
}
for (const file of documents) {
  getAnchors(file);
  const content = fs.readFileSync(file, 'utf8').replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, '');
  for (const match of content.matchAll(/\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)) {
    const target = match[1] ?? match[2];
    if (/^[a-z][a-z\d+.-]*:/i.test(target)) continue;
    checked++;
    const [relative, fragment] = target.split('#');
    let resolved;
    try { resolved = relative ? path.resolve(path.dirname(file), decodeURIComponent(relative)) : file; }
    catch { failures.push(`${path.relative(root, file)}: invalid link ${target}`); continue; }
    if (!fs.existsSync(resolved)) failures.push(`${path.relative(root, file)}: missing ${target}`);
    else if (fragment && resolved.endsWith('.md') && !getAnchors(resolved).has(decodeURIComponent(fragment))) failures.push(`${path.relative(root, file)}: missing anchor ${target}`);
  }
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`${documents.length} documents; ${checked} local links and anchors passed.`);
