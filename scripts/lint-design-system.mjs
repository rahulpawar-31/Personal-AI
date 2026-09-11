#!/usr/bin/env node
// Enforces two design-system/README.md rules that have regressed before
// this lint existed:
//
// 1. "Weights: 400, 500. No 600 or 700 anywhere." — PR #329 swept the
//    codebase for this once; PR #332 reintroduced it on new icon glyphs
//    a batch later, caught only by a manual code review.
// 2. Every var(--x) reference must have a matching "--x:" definition in
//    index.css — --text-muted was referenced at 18 call sites (a real,
//    silent text-color rendering bug) before anyone noticed it was never
//    defined.
//
// See retro item #1/#2 for the incidents this closes the loop on.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_SRC = join(ROOT, 'client/src');
const INDEX_CSS = join(CLIENT_SRC, 'index.css');

function walk(dir, exts, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, exts, files);
    else if (exts.includes(extname(entry))) files.push(full);
  }
  return files;
}

function forEachLine(file, fn) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => fn(line, i + 1));
}

const errors = [];

// --- Rule 1: no fontWeight 600/650/700 ---
const FONT_WEIGHT_RE = /fontWeight:\s*['"]?(600|650|700)['"]?/g;
for (const file of walk(CLIENT_SRC, ['.js', '.jsx'])) {
  forEachLine(file, (line, lineNo) => {
    FONT_WEIGHT_RE.lastIndex = 0;
    let m;
    while ((m = FONT_WEIGHT_RE.exec(line))) {
      errors.push(`${relative(ROOT, file)}:${lineNo}  fontWeight: ${m[1]} — design-system/README.md allows only 400/500 ("No 600 or 700 anywhere")`);
    }
  });
}

// --- Rule 2: every var(--x) has a matching --x definition in index.css ---
const definedTokens = new Set();
const DEFINE_RE = /(--[a-zA-Z0-9-]+)\s*:/g;
{
  const css = readFileSync(INDEX_CSS, 'utf8');
  let m;
  while ((m = DEFINE_RE.exec(css))) definedTokens.add(m[1]);
}

const USE_RE = /var\(\s*(--[a-zA-Z0-9-]+)/g;
for (const file of walk(CLIENT_SRC, ['.js', '.jsx', '.css'])) {
  forEachLine(file, (line, lineNo) => {
    USE_RE.lastIndex = 0;
    let m;
    while ((m = USE_RE.exec(line))) {
      if (!definedTokens.has(m[1])) {
        errors.push(`${relative(ROOT, file)}:${lineNo}  var(${m[1]}) — no matching "${m[1]}:" definition in client/src/index.css`);
      }
    }
  });
}

if (errors.length > 0) {
  console.error(`design-system lint: ${errors.length} violation(s)\n`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

console.log('design-system lint: OK (fontWeight, CSS custom properties)');
