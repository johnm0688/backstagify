# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This repo contains the source for **`backstagify`**, a portable Agent Skill (a
`SKILL.md`-format package) that generates and reconciles Backstage
(backstage.io) developer-portal documentation — `catalog-info.yaml` and
TechDocs (`mkdocs.yml` + `docs/`) — for a *target* repository the skill is
run against. This repo is the skill's source; it is not itself a Backstage
deployment or the target of the skill's own output.

The skill is installed at `~/.claude/skills/backstagify/` (a copy, not a
symlink) for use in Claude Code. OpenCode discovers `.claude/skills/*/SKILL.md`
natively with the identical format, so the same package works unmodified in
both tools — there is deliberately no separate OpenCode variant.

## Commands

There is no package.json, build step, linter, or test suite in this repo.
The only runnable code is the two scanner/validator scripts, invoked
directly with Node (no install step required — zero dependencies):

```bash
# Scan a target repo for Backstage-relevant signals (manifests, Dockerfiles,
# CODEOWNERS, API specs, existing catalog-info.yaml/mkdocs.yml, git remote).
# Prints one JSON object to stdout.
node backstagify/scripts/scan-repo.mjs <path-to-target-repo>

# Validate a catalog-info.yaml against the required-fields/enum rules for
# Component/API/Resource kinds. Prints {valid, errors, warnings} and exits
# non-zero when invalid.
node backstagify/scripts/validate-catalog.mjs <path-to-catalog-info.yaml>
```

There's no automated test harness — verify changes to the scripts by running
them against a real or scratch fixture repo and inspecting the JSON output
(this is how they were built and checked originally).

## Architecture

The skill package (`backstagify/`) follows the standard Agent Skill layout,
with a deliberate division of labor between deterministic code and the
invoking LLM's judgment:

- **`SKILL.md`** — the runbook. Defines the create-vs-update decision
  procedure *per artifact* (a repo can need catalog UPDATE + TechDocs CREATE
  simultaneously), and is the only place that decides what to actually do.
  It never commits/branches/pushes — it only writes files to the working
  tree and tells the developer to review and commit.
- **`scripts/scan-repo.mjs`** — walks a target repo and emits pure facts as
  JSON (file existence, manifest contents, discovered API specs, git remote,
  existing catalog/docs). It makes zero interpretive judgments — no
  classifying a component's type or lifecycle. That split is intentional and
  documented in `SKILL.md`'s Step 0/1.
- **`scripts/validate-catalog.mjs`** — checks a `catalog-info.yaml` against
  required fields and enums for `Component`/`API`/`Resource` (the only kinds
  this skill manages in v1). Unrecognized kinds (e.g. a hand-authored
  `System`) pass through with a warning, never an error. `SKILL.md` treats a
  `valid: false` result as a hard stop: the invoking agent must never write a
  file that fails this check.
- **`scripts/lib/yaml-lite.mjs`** — a small, *scoped* YAML parser/serializer
  shared by both scripts. It is **not** a general YAML implementation: it
  only understands the grammar subset Backstage catalog files and
  `mkdocs.yml` actually use (flat/nested block maps, block and flow
  sequences, quoted/plain scalars, `|` literal block scalars, `---`
  multi-document separators). It does **not** support anchors, aliases,
  tags, or folded (`>`) scalars — a file using those will throw, and
  `SKILL.md` instructs falling back to manual inspection in that case. Keep
  this scope in mind before extending it; it was intentionally kept small
  rather than pulling in an external YAML dependency (see rationale in
  `SKILL.md`'s Step 0 fallback note).
- **`references/*.md`** — progressive-disclosure lookup material the
  invoking agent reads only when needed: `catalog-fields.md` (required
  fields/enums/annotations per kind), `inference-heuristics.md` (signal →
  type/lifecycle/owner mapping), `reconciliation-rules.md` (which fields are
  safe to auto-patch in update mode vs. must never be silently overwritten),
  `techdocs-setup.md` (mkdocs.yml/docs/ conventions).
- **`assets/*.template.*`** — copy-and-fill boilerplate (catalog-info.yaml,
  mkdocs.yml, docs/index.md skeletons) that the agent fills in rather than
  generating from scratch.

### Key invariants to preserve when editing this skill

- **Scripts stay side-effect-free.** Neither `scan-repo.mjs` nor
  `validate-catalog.mjs` writes any files — they only read and print JSON to
  stdout. All file writes happen via the invoking agent following
  `SKILL.md`'s instructions. Don't add file-writing to the scripts without
  updating `SKILL.md` to match.
- **v1 entity scope is Component + optional API + optional Resource only.**
  `System`/`Domain`/`Group`/`User`/`Template` are explicitly out of scope —
  `validate-catalog.mjs` passes them through with a warning rather than
  managing them. Don't add generation logic for those kinds without revising
  this scope decision deliberately.
- **Derived vs. judgment field split** (documented in
  `references/reconciliation-rules.md`) is the core safety mechanism for
  update mode — it's what stops the skill from clobbering a developer's
  hand-set `owner`, `title`, `description`, or `lifecycle`. Any change to the
  update workflow should preserve this distinction.
- **No git actions.** The skill must never commit, branch, or push on its
  own — this is a hard constraint from the original design, not an
  oversight.
