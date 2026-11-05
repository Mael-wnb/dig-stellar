#!/usr/bin/env node
// Checks that every relative Markdown link and every backtick-quoted `docs/...` path in the
// repository's *.md files points at an existing file or directory. No dependencies.
// Usage: node tools/check-doc-links.mjs   (exit 1 when at least one target is missing)
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skipDirs = new Set(['node_modules', '.git', 'dist', '.vercel', '.next', 'coverage']);

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

// A path we cannot resolve literally (glob, placeholder, ellipsis) is not checked.
const unresolvable = /[*{}<>…]|\.\.\.|\s|YYYY|-xx-/;

function clean(target) {
  let t = target.replace(/#.*$/, '').replace(/:\d+([-–]\d+)?$/, '').replace(/[.,;:)]+$/, '');
  try { t = decodeURIComponent(t); } catch { /* keep as is */ }
  return t;
}

const mdLink = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const backtickDocs = /`(docs\/[^`]+)`/g;

const files = walk(root, []);
const broken = [];
let checked = 0;

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  let inFence = false;
  lines.forEach((line, i) => {
    // Fenced code blocks hold command output, not links.
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    const check = (raw, base) => {
      if (/^(https?:|mailto:|#|tel:)/.test(raw)) return;
      const t = clean(raw);
      if (!t || unresolvable.test(t)) return;
      checked += 1;
      if (!existsSync(resolve(base, t))) broken.push(`${file.slice(root.length + 1)}:${i + 1}  ${raw}`);
    };
    for (const m of line.matchAll(mdLink)) check(m[1], dirname(file));
    for (const m of line.matchAll(backtickDocs)) check(m[1], root);
  });
}

for (const b of broken) console.log(`broken  ${b}`);
console.log(`${files.length} markdown files, ${checked} targets checked, ${broken.length} broken`);
process.exit(broken.length ? 1 : 0);
