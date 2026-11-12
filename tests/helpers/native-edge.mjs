// Isolated native Edge for CDP scenarios that need real tabs (hidden-tab, separate profile).
// The msedge.exe launcher may relaunch itself (compatibility layer) and exit with code 0 before it
// prints "DevTools listening"; the browser then keeps running without a parent. This helper asks
// Edge to skip that relaunch, still takes the endpoint from stderr or from DevToolsActivePort in the profile, bounds the
// whole launch with a timeout, closes the browser over CDP and finally terminates every process
// whose command line names this profile. The child's stdio never keeps node alive.
import { execFile, spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

export const DEFAULT_EDGE_PATH = join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
const OUTPUT_LIMIT = 4000;

function run(file, args, timeout) {
  return new Promise(resolve => {
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => resolve({ error, stdout: String(stdout ?? '') }));
  });
}

/** PIDs of Edge processes whose command line names this profile (Windows only; elsewhere the launcher child is the browser). */
async function profileProcesses(userDataDir) {
  if (process.platform !== 'win32') return [];
  const script = "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | ForEach-Object { '{0}`t{1}' -f $_.ProcessId, $_.CommandLine }";
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 20000);
  // The relaunched browser quotes the path; child processes may not. `visibility-1` must not match `visibility-10`.
  const needle = `--user-data-dir=${userDataDir}`.toLowerCase();
  const usesProfile = command => {
    const text = command.toLowerCase().replaceAll('"', '');
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) if (/^(|\s)$/.test(text.charAt(at + needle.length))) return true;
    return false;
  };
  return stdout.split(/\r?\n/).flatMap(line => {
    const tab = line.indexOf('\t'); if (tab < 0) return [];
    const pid = Number(line.slice(0, tab));
    return Number.isInteger(pid) && usesProfile(line.slice(tab + 1)) ? [pid] : [];
  });
}

async function killProfileProcesses(userDataDir) {
  const pids = await profileProcesses(userDataDir);
  if (pids.length) await run('taskkill.exe', [...pids.flatMap(pid => ['/PID', String(pid)]), '/T', '/F'], 15000);
  return pids;
}

async function activePortEndpoint(userDataDir) {
  try {
    const [port, path] = (await readFile(join(userDataDir, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/);
    return /^\d+$/.test(port) && path?.startsWith('/devtools/browser/') ? `ws://127.0.0.1:${port}${path}` : null;
  } catch { return null; }
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
}

/**
 * Starts Edge with its own profile and connects over CDP.
 * Returns { browser, context, page, userDataDir, endpointSource, close() }. close() is idempotent and bounded; it returns
 * the leftover processes it had to terminate and throws only if some still run afterwards.
 */
export async function launchIsolatedEdge({ executablePath = DEFAULT_EDGE_PATH, userDataDir, args = [], timeoutMs = 30000 }) {
  if (!userDataDir) throw new Error('launchIsolatedEdge needs a dedicated userDataDir');
  // A file left by an earlier launch with the same profile must not be mistaken for this one.
  await rm(join(userDataDir, 'DevToolsActivePort'), { force: true });
  const child = spawn(executablePath, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`,
    // Edge otherwise relaunches itself for its compatibility layer and the launcher exits with code 0.
    '--no-first-run', '--no-default-browser-check', '--edge-skip-compat-layer-relaunch', ...args, 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', launchError = null, exit = null;
  const collect = data => { output = (output + data).slice(-OUTPUT_LIMIT); };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  child.on('error', error => { launchError = error; });
  child.on('exit', (code, signal) => { exit = { code, signal }; });
  // Neither the handle nor its pipes (possibly inherited by a relaunched browser) may keep node running.
  child.unref(); child.stdout.unref?.(); child.stderr.unref?.();

  let browser = null, closed = false, endpointSource = null;
  async function close() {
    if (closed) return null; closed = true;
    const problems = [];
    if (browser) {
      try { const session = await withTimeout(browser.newBrowserCDPSession(), 5000, 'CDP session timeout'); await withTimeout(session.send('Browser.close'), 5000, 'Browser.close timeout'); }
      catch { /* already closed or not answering; processes are terminated below */ }
      try { await withTimeout(browser.close(), 5000, 'CDP disconnect timeout'); } catch (error) { problems.push(error.message); }
    }
    // Give a normal shutdown a moment, then terminate whatever is still using this profile.
    const shutdownDeadline = Date.now() + 10000;
    while (Date.now() < shutdownDeadline && (await profileProcesses(userDataDir)).length) await delay(500);
    const terminated = await killProfileProcesses(userDataDir);
    if (exit === null && child.exitCode === null) { try { child.kill(); } catch { /* gone */ } }
    child.stdout.destroy(); child.stderr.destroy();
    const remaining = await profileProcesses(userDataDir);
    if (remaining.length) problems.push(`Edge processes still running: ${remaining.join(', ')}`);
    if (problems.length) throw new Error(`Isolated Edge cleanup (${userDataDir}): ${problems.join('; ')}`);
    return { userDataDir, endpointSource, launcherExit: exit, terminated };
  }

  try {
    const deadline = Date.now() + timeoutMs;
    let endpoint = null;
    while (!endpoint) {
      if (launchError) throw launchError;
      endpoint = output.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1] ?? null;
      if (endpoint) { endpointSource = 'stderr'; break; }
      endpoint = await activePortEndpoint(userDataDir);
      if (endpoint) { endpointSource = exit ? `DevToolsActivePort after launcher exit ${JSON.stringify(exit)}` : 'DevToolsActivePort'; break; }
      if (exit && exit.code !== 0) throw new Error(`Isolated Edge exited ${JSON.stringify(exit)} before CDP: ${output.slice(-500)}`);
      if (Date.now() > deadline) {
        throw new Error(`Isolated Edge did not expose CDP within ${timeoutMs} ms (launcher ${exit ? `exited ${JSON.stringify(exit)}` : 'still running'}, no "DevTools listening" and no DevToolsActivePort in ${userDataDir}): ${output.slice(-500)}`);
      }
      await delay(100);
    }
    const remaining = Math.max(1000, deadline - Date.now());
    browser = await withTimeout(chromium.connectOverCDP(endpoint, { noDefaults: true, timeout: remaining }), remaining + 1000, `Isolated Edge CDP connection timed out (${endpoint})`);
    const context = browser.contexts()[0];
    // Edge may open its own edge:// pages (e.g. a sync dialog) besides the requested about:blank tab.
    const page = context.pages().find(tab => tab.url() === 'about:blank') ?? context.pages().find(tab => !tab.url().startsWith('edge://')) ?? await context.newPage();
    return { browser, context, page, userDataDir, endpointSource, close };
  } catch (error) {
    try { await close(); } catch { /* the launch failure is the primary error */ }
    throw error;
  }
}
