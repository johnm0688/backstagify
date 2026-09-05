#!/usr/bin/env node
// Deterministic repo-signal scanner for the backstagify skill.
//
// Walks a target repo and emits a single JSON blob of raw facts: what files
// exist, what manifests declare, what API specs are present, etc. It makes
// NO judgment calls (no classifying type/lifecycle/owner) — that's left to
// the invoking LLM, which reads this JSON and reasons over it per
// references/inference-heuristics.md.
//
// Usage: node scan-repo.mjs [repoRoot]   (defaults to cwd)

import fs from 'node:fs';
import path from 'node:path';
import { parseYamlDocuments } from './lib/yaml-lite.mjs';

const repoRoot = path.resolve(process.argv[2] || process.cwd());

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function readJson(p) {
  const text = readText(p);
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return { __parseError: true }; }
}

function walk(dir, opts, out, depth = 0) {
  const { ignore, maxDepth, extensions } = opts;
  if (depth > maxDepth) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (ignore.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, opts, out, depth + 1);
    } else if (!extensions || extensions.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.venv', 'venv',
  '__pycache__', 'target', 'vendor', '.turbo', 'coverage',
]);

function relative(p) {
  return path.relative(repoRoot, p) || '.';
}

// --- Catalog / TechDocs presence ---------------------------------------

function findFirst(candidates) {
  for (const c of candidates) {
    const full = path.join(repoRoot, c);
    if (exists(full)) return c;
  }
  return null;
}

const catalogPath = findFirst(['catalog-info.yaml', 'catalog-info.yml']);
const mkdocsPath = findFirst(['mkdocs.yml', 'mkdocs.yaml']);
const readmePath = findFirst(['README.md', 'Readme.md', 'readme.md']);
const codeownersPath = findFirst(['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS']);

const dockerfiles = [];
walk(repoRoot, { ignore: IGNORE_DIRS, maxDepth: 3 }, dockerfiles);
const dockerfileMatches = dockerfiles
  .filter((f) => path.basename(f) === 'Dockerfile' || path.basename(f).startsWith('Dockerfile.'))
  .map(relative);
const dockerComposePath = findFirst(['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']);

const ciDirs = ['.github/workflows', '.gitlab-ci.yml', '.circleci/config.yml', 'Jenkinsfile']
  .filter((c) => exists(path.join(repoRoot, c)));

// --- docs/ tree ----------------------------------------------------------

let docsFiles = [];
if (exists(path.join(repoRoot, 'docs'))) {
  const collected = [];
  walk(path.join(repoRoot, 'docs'), { ignore: IGNORE_DIRS, maxDepth: 6, extensions: ['.md'] }, collected);
  docsFiles = collected.map(relative).sort();
}

// --- Manifests -----------------------------------------------------------

const manifests = {};

const pkgJson = readJson(path.join(repoRoot, 'package.json'));
if (pkgJson && !pkgJson.__parseError) {
  manifests.node = {
    path: 'package.json',
    name: pkgJson.name ?? null,
    version: pkgJson.version ?? null,
    description: pkgJson.description ?? null,
    main: pkgJson.main ?? null,
    exports: pkgJson.exports ? true : false,
    bin: pkgJson.bin ? true : false,
    scripts: pkgJson.scripts ?? {},
    dependencies: Object.keys(pkgJson.dependencies ?? {}),
    devDependencies: Object.keys(pkgJson.devDependencies ?? {}),
    author: pkgJson.author ?? null,
    maintainers: pkgJson.maintainers ?? null,
  };
}

if (exists(path.join(repoRoot, 'pyproject.toml'))) {
  const text = readText(path.join(repoRoot, 'pyproject.toml')) ?? '';
  const nameMatch = text.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
  const versionMatch = text.match(/^\s*version\s*=\s*["']([^"']+)["']/m);
  manifests.python = { path: 'pyproject.toml', name: nameMatch?.[1] ?? null, version: versionMatch?.[1] ?? null };
} else if (exists(path.join(repoRoot, 'setup.py'))) {
  manifests.python = { path: 'setup.py', name: null, version: null };
}

if (exists(path.join(repoRoot, 'go.mod'))) {
  const text = readText(path.join(repoRoot, 'go.mod')) ?? '';
  const moduleMatch = text.match(/^module\s+(\S+)/m);
  manifests.go = { path: 'go.mod', module: moduleMatch?.[1] ?? null };
}

if (exists(path.join(repoRoot, 'Cargo.toml'))) {
  const text = readText(path.join(repoRoot, 'Cargo.toml')) ?? '';
  const nameMatch = text.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
  const versionMatch = text.match(/^\s*version\s*=\s*["']([^"']+)["']/m);
  manifests.rust = { path: 'Cargo.toml', name: nameMatch?.[1] ?? null, version: versionMatch?.[1] ?? null };
}

if (exists(path.join(repoRoot, 'pom.xml'))) {
  manifests.java = { path: 'pom.xml' };
} else if (findFirst(['build.gradle', 'build.gradle.kts'])) {
  manifests.java = { path: findFirst(['build.gradle', 'build.gradle.kts']) };
}

// --- API specs -------------------------------------------------------------

const apiSpecCandidates = [];
walk(repoRoot, { ignore: IGNORE_DIRS, maxDepth: 5, extensions: ['.yaml', '.yml', '.json', '.proto'] }, apiSpecCandidates);

const apiSpecs = [];
for (const file of apiSpecCandidates) {
  const base = path.basename(file);
  if (base === path.basename(catalogPath || '') || base === path.basename(mkdocsPath || '')) continue;
  if (file.endsWith('.proto')) {
    apiSpecs.push({ path: relative(file), kind: 'grpc' });
    continue;
  }
  const text = readText(file);
  if (!text) continue;
  const head = text.slice(0, 2000);
  if (/^\s*openapi:\s*['"]?[23]/m.test(head) || /^\s*swagger:\s*['"]?2/m.test(head)) {
    const versionMatch = head.match(/^\s*(?:openapi|swagger):\s*['"]?([\d.]+)/m);
    apiSpecs.push({ path: relative(file), kind: 'openapi', version: versionMatch?.[1] ?? null });
  } else if (/^\s*asyncapi:\s*['"]?\d/m.test(head)) {
    const versionMatch = head.match(/^\s*asyncapi:\s*['"]?([\d.]+)/m);
    apiSpecs.push({ path: relative(file), kind: 'asyncapi', version: versionMatch?.[1] ?? null });
  }
}

// --- git remote ------------------------------------------------------------

let gitSlug = null;
const gitConfigPath = path.join(repoRoot, '.git', 'config');
const gitConfigText = readText(gitConfigPath);
if (gitConfigText) {
  const urlMatch = gitConfigText.match(/url\s*=\s*(\S+)/);
  if (urlMatch) {
    const url = urlMatch[1];
    const m = url.match(/[:/]([^/:]+\/[^/]+?)(\.git)?$/);
    if (m) gitSlug = m[1];
  }
}

// --- README ------------------------------------------------------------

let readmeTitle = null;
let readmeFirstParagraph = null;
if (readmePath) {
  const text = readText(path.join(repoRoot, readmePath)) ?? '';
  const lines = text.split('\n');
  const h1 = lines.find((l) => /^#\s+/.test(l));
  readmeTitle = h1 ? h1.replace(/^#\s+/, '').trim() : null;
  const h1Index = h1 ? lines.indexOf(h1) : -1;
  const rest = lines.slice(h1Index + 1);
  const paraLines = [];
  for (const line of rest) {
    if (line.trim() === '' && paraLines.length) break;
    if (line.trim() === '' && !paraLines.length) continue;
    if (/^#/.test(line.trim())) break;
    paraLines.push(line);
  }
  readmeFirstParagraph = paraLines.join(' ').trim() || null;
}

// --- Existing catalog / mkdocs (raw + best-effort parsed) ------------------

let existingCatalog = null;
if (catalogPath) {
  const text = readText(path.join(repoRoot, catalogPath));
  existingCatalog = { path: catalogPath, raw: text };
  try {
    existingCatalog.parsed = parseYamlDocuments(text);
  } catch (err) {
    existingCatalog.parseError = String(err?.message ?? err);
  }
}

let existingMkdocs = null;
if (mkdocsPath) {
  const text = readText(path.join(repoRoot, mkdocsPath));
  existingMkdocs = { path: mkdocsPath, raw: text };
  try {
    existingMkdocs.parsed = parseYamlDocuments(text)[0];
  } catch (err) {
    existingMkdocs.parseError = String(err?.message ?? err);
  }
}

// --- Output ------------------------------------------------------------

const result = {
  repoRoot,
  hasCatalog: !!catalogPath,
  hasMkdocs: !!mkdocsPath,
  docsFiles,
  readme: readmePath ? { path: readmePath, title: readmeTitle, firstParagraph: readmeFirstParagraph } : null,
  codeownersPath,
  dockerfiles: dockerfileMatches,
  dockerComposePath,
  ciDirs,
  manifests,
  apiSpecs,
  gitSlug,
  existingCatalog,
  existingMkdocs,
};

process.stdout.write(JSON.stringify(result, null, 2) + '\n');
