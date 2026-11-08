import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/** Read-only opt-in reuse. A runner may only stop the child it starts itself. */
export async function inspectStaticServer(origin, builtIndex, reuseRequested) {
  const expected = await readFile(builtIndex);
  let response;
  try { response = await fetch(origin, { signal: AbortSignal.timeout(700) }); }
  catch { return { external: false, evidence: { reuseRequested, owned: true, mode: 'runner-owned', restartAllowed: true, shutdownAllowed: true } }; }
  if (!reuseRequested) throw new Error(`Port already occupied: ${origin}; use --reuse-server only for a matching local build`);
  assert.equal(response.status, 200, 'Existing local server did not return HTTP 200');
  const actual = Buffer.from(await response.arrayBuffer());
  assert.ok(actual.equals(expected), 'Existing server index differs from the current dist/index.html');
  return { external: true, evidence: { reuseRequested, owned: false, mode: 'external-reused', indexMatchesBuild: true, restartAllowed: false, shutdownAllowed: false } };
}
