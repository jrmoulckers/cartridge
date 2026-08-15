#!/usr/bin/env node
/**
 * Vendor the dependency-free shared configuration from `jrmoulckers/engineering`
 * at a pinned ref, without a package registry.
 *
 * Why this exists: GitHub Packages authenticates *every* read, including reads
 * of a public package. For a self-hosted product that means each contributor
 * and each self-hoster must mint a token before `install` succeeds — a real
 * onboarding regression, and one the package-visibility setting does not fix.
 * `@jrmoulckers/tsconfig` and `@jrmoulckers/prettier-config` have no runtime
 * dependencies, so they can be fetched directly and committed.
 *
 * `@jrmoulckers/eslint-config` is deliberately NOT vendorable here: it depends
 * on `@eslint/js`, `typescript-eslint`, `eslint-config-prettier` and `globals`
 * at runtime. Copying its source would push four version choices back onto
 * every consumer, which is the drift the shared layer exists to remove. Install
 * that one from the registry.
 *
 * Vendoring usually trades away the version signal a registry gives you. It
 * does not here: every fetch writes `engineering-configs.lock.json` recording
 * the ref and the SHA-256 of each file, so drift is detectable and a refresh is
 * a reviewable diff.
 *
 * Usage:
 *   node scripts/vendor-configs.mjs <ref> [--dest <dir>] [--set tsconfig,prettier]
 *
 * `--dest` is a probe: it writes the fetched files somewhere else and leaves the
 * lock alone. It used to write the lock anyway, keyed by the destination, which
 * silently disarmed `--check` — every recorded path pointed at scratch, so the
 * guard verified files outside the repository and exited 0 while a vendored file
 * in the tree was tampered with. The machine that ran the probe is the one where
 * those absolute paths still resolve, so it is the least able to notice.
 *
 * Files are written byte-identical to source — no generated header — so that
 * `git diff` after a re-run shows exactly what upstream changed and nothing
 * else. Provenance lives in the lock file instead.
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';

const REPO = 'jrmoulckers/engineering';
const LOCK = 'engineering-configs.lock.json';

const SETS = {
  tsconfig: {
    // `extends` between these is relative, so a partial fetch produces a config
    // that resolves to nothing. The set is all-or-nothing on purpose.
    from: 'packages/tsconfig',
    files: [
      'base.json',
      'vite-app.json',
      'vite-node.json',
      'vite-react.json',
      'next.json',
      'node.json',
    ],
  },
  prettier: {
    from: 'packages/prettier-config',
    files: ['index.js', 'svelte.js'],
    // Upstream declares `"type": "module"` in its own package.json, which is not
    // among the files vendored here. Without a marker these `.js` files inherit
    // the module type of the nearest package.json — this repository's root —
    // so `export default` is only valid because that root happens to be ESM for
    // unrelated reasons. Removing that field is silent: every gate here still
    // exits 0 on Node 24, which merely reparses and warns, while Node below
    // 22.7 raises a SyntaxError inside Prettier with nothing pointing back to
    // vendoring. Emit the marker so the vendored tree states its own module
    // type instead of borrowing one.
    esm: true,
  },
};

class VendorError extends Error {
  constructor(message, hint) {
    super(message);
    this.hint = hint;
  }
}

/**
 * Throw rather than `process.exit()`. Exiting from inside an in-flight `fetch`
 * tears down a socket the runtime still owns, which on Windows surfaces as a
 * libuv assertion and a 0xC0000409 exit code instead of the message and the 1
 * that a consumer's CI can act on.
 */
function fail(message, hint) {
  throw new VendorError(message, hint);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dest' || arg === '--set') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) fail(`${arg} requires a value`);
      flags[arg.slice(2)] = value;
      i += 1;
    } else if (arg === '--check') {
      flags.check = true;
    } else if (arg === '--no-remote') {
      flags.noRemote = true;
    } else if (arg.startsWith('--')) {
      fail(
        `unknown option ${arg}`,
        'Usage: vendor-configs.mjs <ref> [--dest <dir>] [--set a,b] | vendor-configs.mjs --check [--no-remote]',
      );
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

/**
 * Report whether a newer release exists. Never throws and never fails the
 * caller: a tag pushed upstream must not turn an unrelated PR red.
 *
 * Returns null when the answer cannot be determined, and the caller must not
 * treat that as "fine". The unauthenticated limit is 60 requests per hour per
 * IP, which is not a CI edge case — it was exhausted twice in one day by one
 * person verifying one change on one machine, and each time this returned null
 * and the check went completely quiet. Silence that means "did not look"
 * renders identically to silence that means "looked, nothing to do", so the
 * caller says which one it got.
 *
 * A token is used when the environment already has one, purely to raise that
 * limit. None is required, and none is ever written anywhere.
 */
async function latestRef() {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: {
        accept: 'application/vnd.github+json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body.tag_name === 'string' ? body.tag_name : null;
  } catch {
    return null;
  }
}

/**
 * Fetch one file without throwing. `fetchFile` is fatal by design because a
 * vendor run that half-succeeds leaves a broken tree on disk. Staleness is the
 * opposite: it is advisory, so a failure here has to be reportable as "unknown"
 * rather than either killing the build or being swallowed into "fine".
 */
async function peek(ref, path) {
  try {
    const response = await fetch(`https://raw.githubusercontent.com/${REPO}/${ref}/${path}`);
    if (!response.ok) return null;
    const text = await response.text();
    return text.trim() === '' ? null : text;
  } catch {
    return null;
  }
}

/**
 * Decide whether a newer ref would actually change anything in this tree.
 *
 * A tag comparison answers "did upstream publish?", which is not the question
 * the reader has. Upstream cut 116 releases in one day and every file vendored
 * here was byte-identical across the 52 of them spanning v0.63.0 to v0.115.0 —
 * so a tag-keyed notice is a near-permanent fixture that says "act on this"
 * when there is nothing to act on. A notice that is almost always wrong trains
 * the reader to skip it, and it is then equally unread on the day it is right.
 *
 * Silence must mean "compared, nothing differs" and never "the comparison did
 * not happen", so an unreachable file yields `unknown` and still speaks. The
 * generated ESM marker has no upstream path and is excluded by construction;
 * so is any file upstream added after this SETS was written, because SETS is
 * hand-maintained here — that gap is a channel-parity question, not staleness,
 * and the notice says so rather than implying the comparison was exhaustive.
 */
async function wouldChange(latest, lock) {
  const tracked = Object.values(lock.files ?? {}).filter(
    (m) => !m.source.startsWith('(generated)'),
  );
  const changed = [];
  let unknown = 0;
  for (const meta of tracked) {
    const text = await peek(latest, meta.source);
    if (text === null) unknown += 1;
    else if (sha256(text) !== meta.sha256) changed.push(meta.source);
  }
  return { changed, unknown, compared: tracked.length };
}

/**
 * Verify the vendored tree still matches the lock, then report staleness.
 *
 * The split in severity is the whole point. Drift is a local integrity failure
 * — someone edited a generated file, or a write was lost — so it exits non-zero.
 * Staleness is an upstream event the consumer has not acted on yet, so it only
 * warns. Failing on staleness would make pinning automatic in effect: a red
 * build pressures the next person into bumping the ref without deciding to
 * accept the change, which is the property pinning exists to protect.
 *
 * These are also two unrelated operations behind one flag: an authoritative
 * offline hash comparison, and a network call to a third party. `--no-remote`
 * runs only the first, for gates under egress review or that should not reach
 * the network at all. It states the gap rather than simply doing less, because
 * a run that skipped the staleness check is otherwise indistinguishable from
 * one that ran it and found nothing. The distinction the whole flag protects:
 * a green --check means the tree matches the lock, not that the pin is current.
 */
async function check({ noRemote = false } = {}) {
  let lock;
  try {
    lock = JSON.parse(await readFile(LOCK, 'utf8'));
  } catch {
    fail(`no ${LOCK} found`, 'Run: node scripts/vendor-configs.mjs <ref>');
  }

  const entries = Object.entries(lock.files ?? {});
  if (entries.length === 0) fail(`${LOCK} records no files`, 'Re-run the vendor step.');

  const drifted = [];
  for (const [dest, meta] of entries) {
    let text;
    try {
      text = await readFile(dest, 'utf8');
    } catch {
      drifted.push(`${dest}: missing`);
      continue;
    }
    if (sha256(text) !== meta.sha256) drifted.push(`${dest}: content differs from the lock`);
  }

  if (drifted.length > 0) {
    fail(
      `${drifted.length} vendored file(s) drifted from ${LOCK}:\n  ${drifted.join('\n  ')}`,
      `These files are generated. Do not edit them — re-run: node scripts/vendor-configs.mjs ${lock.ref}`,
    );
  }

  process.stdout.write(`${entries.length} vendored file(s) match ${LOCK} at ${lock.ref}.\n`);

  if (noRemote) {
    process.stdout.write(
      `\nStaleness not checked (--no-remote). This says nothing about whether ` +
        `${lock.ref} is current.\n`,
    );
    return;
  }

  const latest = await latestRef();
  if (!latest) {
    process.stdout.write(
      `\nNotice: could not resolve the newest release, so whether ${lock.ref} is ` +
        `stale is UNKNOWN. Nothing was compared — this is not a clean bill of health.\n`,
    );
    return;
  }
  if (latest === lock.ref) return;

  const { changed, unknown, compared } = await wouldChange(latest, lock);

  if (changed.length > 0) {
    process.stdout.write(
      `\nNotice: pinned at ${lock.ref}; newest release is ${latest}, ` +
        `and ${changed.length} of ${compared} vendored file(s) differ there:\n  ` +
        `${changed.join('\n  ')}\n` +
        `This is not a failure. Update deliberately when you choose to:\n` +
        `  node scripts/vendor-configs.mjs ${latest}\n`,
    );
    return;
  }

  if (unknown > 0) {
    process.stdout.write(
      `\nNotice: pinned at ${lock.ref}; newest release is ${latest}. ` +
        `${unknown} of ${compared} file(s) could not be read there, so whether ` +
        `updating would change anything is UNKNOWN — this is not evidence either way.\n`,
    );
  }
}

/**
 * A fetch can fail in three ways and only the first is obvious. A non-200 is
 * loud. An empty 200 is quiet. A 200 carrying the wrong bytes — an HTML error
 * page, a redirect landing page, an LFS pointer — is silent, and it is the one
 * that leaves a file on disk that tools then "successfully" read as empty
 * configuration. All three are fatal here.
 */
function assertPayload(path, text) {
  if (text.trim() === '') {
    fail(`${path} came back empty`, 'The ref may exist but not contain this file.');
  }
  if (path.endsWith('.json')) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      fail(
        `${path} is not valid JSON`,
        'This is usually an HTML error page served with status 200.',
      );
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.compilerOptions) {
      fail(
        `${path} has no "compilerOptions"`,
        'It parsed, but it is not a TypeScript configuration.',
      );
    }
  } else if (!/^export /m.test(text)) {
    fail(`${path} exports nothing`, 'It downloaded, but it is not an ES module configuration.');
  }
}

async function fetchFile(ref, path) {
  const url = `https://raw.githubusercontent.com/${REPO}/${ref}/${path}`;
  let response;
  try {
    response = await fetch(url);
  } catch (cause) {
    fail(`could not reach ${url}`, String(cause.message ?? cause));
  }
  if (!response.ok) {
    fail(
      `${url} returned HTTP ${response.status}`,
      `Check that ref '${ref}' exists in ${REPO} and contains this path.`,
    );
  }
  const text = await response.text();
  assertPayload(path, text);
  return text;
}

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (flags.check) {
    if (positional.length > 0) {
      fail('--check takes no ref', 'It verifies the ref already recorded in the lock file.');
    }
    await check({ noRemote: flags.noRemote === true });
    return;
  }
  if (flags.noRemote) {
    fail('--no-remote only applies to --check', 'A vendor run must fetch to vendor anything.');
  }
  const ref = positional[0];
  if (!ref) {
    fail('a ref is required', 'Pass a tag, not a branch: node scripts/vendor-configs.mjs v1.2.3');
  }
  const dest = flags.dest ?? 'config/engineering';
  const isProbe = flags.dest !== undefined;
  const names = (flags.set ?? Object.keys(SETS).join(',')).split(',').map((s) => s.trim());
  for (const name of names) {
    if (!SETS[name]) fail(`unknown set '${name}'`, `Known sets: ${Object.keys(SETS).join(', ')}`);
  }

  // Fetch and validate everything before writing anything. A partial write is
  // worse than a failed one: the tools would run against a mix of refs and
  // report success.
  const staged = [];
  for (const name of names) {
    const { from, files, esm } = SETS[name];
    for (const file of files) {
      const path = `${from}/${file}`;
      const text = await fetchFile(ref, path);
      staged.push({ name, path, file, text, dest: join(dest, name, file) });
    }
    if (esm) {
      // Synthesized, not fetched: upstream's own package.json carries a name,
      // version and peer ranges that would be false here. Only the module type
      // transfers. It is staged like any other file so the lock hashes it and
      // `--check` reports a hand-edit as drift.
      staged.push({
        name,
        path: `(generated) ESM module marker for ${from}`,
        file: 'package.json',
        text: `${JSON.stringify({ type: 'module' }, null, 2)}\n`,
        dest: join(dest, name, 'package.json'),
      });
    }
  }

  for (const item of staged) {
    await mkdir(dirname(item.dest), { recursive: true });
    await writeFile(item.dest, item.text, 'utf8');
  }

  const lock = {
    repository: REPO,
    ref,
    fetchedAt: new Date().toISOString(),
    refresh: `node scripts/vendor-configs.mjs <newer-ref>`,
    files: Object.fromEntries(
      staged.map((item) => [
        item.dest.split('\\').join('/'),
        { source: item.path, sha256: sha256(item.text) },
      ]),
    ),
  };

  let previous = null;
  try {
    previous = JSON.parse(await readFile(LOCK, 'utf8'));
  } catch {
    // No previous lock: this is a first vendor.
  }

  process.stdout.write(`Vendored ${staged.length} file(s) from ${REPO}@${ref} into ${dest}/\n`);

  if (previous && previous.ref !== ref) {
    // Compare by upstream source path, not by destination. A destination-keyed
    // lookup misses every entry the moment `--dest` moves, so the count reports
    // "all changed" for a refresh that changed nothing.
    const before = new Map(
      Object.values(previous.files ?? {}).map((meta) => [meta.source, meta.sha256]),
    );
    const changed = staged.filter((item) => before.get(item.path) !== sha256(item.text));
    process.stdout.write(
      `Ref moved ${previous.ref} -> ${ref}; ${changed.length} file(s) changed content.\n`,
    );
  }

  if (isProbe) {
    process.stdout.write(
      `--dest given, so ${LOCK} was NOT written: it records what this repository ` +
        `vendors, and pointing it at a scratch directory would make --check verify ` +
        `files outside the tree and pass regardless of drift.\n`,
    );
    return;
  }

  await writeFile(LOCK, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  process.stdout.write(`Recorded ref and SHA-256 of each file in ${LOCK}. Commit both.\n`);
}

try {
  await main();
} catch (error) {
  if (!(error instanceof VendorError)) throw error;
  process.stderr.write(`error: ${error.message}\n`);
  if (error.hint) process.stderr.write(`       ${error.hint}\n`);
  process.exitCode = 1;
}
