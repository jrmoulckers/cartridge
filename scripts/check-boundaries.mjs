#!/usr/bin/env node
/**
 * Proves the layering claims ARCHITECTURE.md makes, so they cannot quietly rot.
 *
 * An invariant nothing checks is a comment. Every rule here corresponds to a
 * sentence in ARCHITECTURE.md's "Where things live" table; if you change one,
 * change the other.
 *
 * Claims are stated by *file kind*, not by directory, because a directory claim
 * ("nothing under lib/ imports the framework") silently becomes false the day
 * someone colocates a component. Each rule below names the files it selects and
 * reports the count it actually checked, so an empty glob fails loudly rather
 * than passing vacuously.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const src = join(root, 'src');

/** Every file under `dir` whose name ends with one of `exts`, excluding tests. */
function walk(dir, exts) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => name.endsWith(e)) && !name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/**
 * Source lines with comments stripped.
 *
 * Without this every rule false-positives on its own documentation — the pure
 * modules describe themselves as having "no IndexedDB", and a naive grep reads
 * that sentence as a violation.
 */
function code(file) {
  const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return text
    .split('\n')
    .map((line, i) => ({ n: i + 1, text: line }))
    .filter(({ text }) => !/^\s*(\/\/|\*)/.test(text));
}

const failures = [];
const rules = [];

function rule(name, files, check) {
  if (files.length === 0) {
    failures.push(`${name}: matched 0 files — the glob is stale`);
    return;
  }
  const bad = [];
  for (const file of files) {
    for (const hit of check(file))
      bad.push(`    ${relative(root, file).split(sep).join('/')}:${hit}`);
  }
  rules.push({ name, count: files.length, bad });
  if (bad.length) failures.push(`${name}\n${bad.join('\n')}`);
}

const ui = walk(join(src, 'lib', 'components'), ['.svelte']).concat(
  walk(join(src, 'lib', 'pages'), ['.svelte']),
);

const pure = [
  ...walk(join(src, 'lib', 'library'), ['.ts']),
  ...walk(join(src, 'lib', 'stats'), ['.ts']),
  join(src, 'lib', 'markdown.ts'),
  join(src, 'lib', 'util.ts'),
  join(src, 'lib', 'metadata', 'match.ts'),
];

const all = walk(src, ['.ts', '.svelte']);

// "Pure logic — no DOM, no IO. Unit-tested directly."
rule('pure logic performs no IO and imports no framework', pure, (file) =>
  code(file)
    .filter(({ text }) =>
      /\bfetch\(|indexedDB|localStorage|document\.|window\.|from '.*(storage\/db|svelte)/.test(
        text,
      ),
    )
    .map(({ n }) => n),
);

// "Metadata — the only code in the app that makes a network request."
rule('only src/lib/metadata makes network requests', all, (file) => {
  if (file.includes(join('lib', 'metadata'))) return [];
  return code(file)
    .filter(({ text }) => /\bfetch\(/.test(text))
    .map(({ n }) => n);
});

// "sync.ts is pure; apply.ts is the only writer."
rule('connectors/sync.ts stays pure', [join(src, 'lib', 'connectors', 'sync.ts')], (file) =>
  code(file)
    .filter(({ text }) => /\bfetch\(|indexedDB|from '.*storage\/db/.test(text))
    .map(({ n }) => n),
);

// Persistence is reachable only through the stores and the single writer.
rule('only stores and connectors/apply.ts import storage/db', all, (file) => {
  const rel = relative(src, file).split(sep).join('/');
  const allowed =
    rel.startsWith('lib/stores/') ||
    rel === 'lib/connectors/apply.ts' ||
    rel.startsWith('lib/storage/');
  if (allowed) return [];
  return code(file)
    .filter(({ text }) => /from '.*storage\/db'/.test(text))
    .map(({ n }) => n);
});

// "UI — presentation. Reads and writes persisted data only through a store."
rule('UI never touches persistence directly', ui, (file) =>
  code(file)
    .filter(({ text }) => /\bfetch\(|indexedDB|from '.*storage\/db'/.test(text))
    .map(({ n }) => n),
);

for (const { name, count, bad } of rules) {
  console.log(`${bad.length ? 'FAIL' : 'ok  '}  ${name} (${count} file${count === 1 ? '' : 's'})`);
}

if (failures.length) {
  console.error(`\n${failures.length} boundary claim(s) in ARCHITECTURE.md no longer hold:\n`);
  for (const f of failures) console.error(f);
  process.exit(1);
}

console.log('\nAll boundary claims in ARCHITECTURE.md hold.');
