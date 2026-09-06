---
name: backstagify
description: "Generate and keep up to date Backstage (backstage.io) developer-portal documentation for a software repository: scaffolds or reconciles catalog-info.yaml (Component/API/Resource entities) and TechDocs (mkdocs.yml + docs/) by scanning the codebase for owners, dependencies, APIs, and lifecycle signals. Use when the user asks to add Backstage support, register a service in the software catalog, generate or update catalog-info.yaml, set up TechDocs, or sync developer-portal docs with recent code changes."
license: Apache-2.0
---

# backstagify

Generates or reconciles a repository's Backstage Software Catalog entry
(`catalog-info.yaml`) and TechDocs setup (`mkdocs.yml` + `docs/`) by scanning
the codebase for real signals — manifests, Dockerfiles, CODEOWNERS, API specs,
README content — and applying judgment where a script can't.

## Usage

Invoke this skill by name ("run backstagify on this repo", "generate Backstage
docs for this project", "update our catalog-info.yaml") or let it trigger
automatically when a developer asks to add/update Backstage catalog or
TechDocs support. It targets the current repository unless told otherwise.

This is a **developer-workflow tool**, invoked manually. It never commits,
branches, or pushes — it only writes files to the working tree. Always end by
telling the developer to review the diff and commit it themselves.

## Step 0 — Locate the repo root and scan

1. Find the repo root (nearest ancestor directory containing `.git`).
2. Run the bundled scanner:
   ```
   node <skill-dir>/scripts/scan-repo.mjs <repo-root>
   ```
   This returns one JSON object with every fact needed for the rest of this
   runbook: `hasCatalog`, `hasMkdocs`, `docsFiles`, `readme`, `codeownersPath`,
   `dockerfiles`, `dockerComposePath`, `ciDirs`, `manifests` (per-language raw
   fields), `apiSpecs` (discovered OpenAPI/AsyncAPI/proto files), `gitSlug`,
   `existingCatalog` (raw text + best-effort parsed structure), and
   `existingMkdocs`.

**If `node` is not available on PATH**, don't fail — fall back to gathering
the same facts manually with your own file-reading tools:
   - Check for `catalog-info.yaml`/`.yml`, `mkdocs.yml`/`.yaml`, `docs/`, `README.md`, `CODEOWNERS` (root, `.github/`, `docs/`), `Dockerfile*`, `docker-compose.yml`, `.github/workflows`.
   - Read `package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml` / `pom.xml` if present, for name/version/dependencies.
   - Grep for `^openapi:`, `^swagger:`, `^asyncapi:` in yaml/json files, and any `*.proto` files.
   - Read `.git/config` for the remote URL to derive an `org/repo` slug.
   Proceed with the rest of this runbook using those manually-gathered facts.

## Step 1 — Decide mode, per artifact

Mode is independent for each artifact — a repo can need one and not the other:

- `hasCatalog` is `false` → **CREATE catalog** (Step 2)
- `hasCatalog` is `true` → **UPDATE catalog** (Step 4)
- `hasMkdocs` is `false` → **CREATE TechDocs** (Step 3)
- `hasMkdocs` is `true` → **UPDATE TechDocs** (Step 5)

Announce which mode applies to which artifact before proceeding, so the
developer isn't surprised.

## Step 2 — CREATE catalog

1. Read `references/inference-heuristics.md` and classify, using the scanner's
   facts:
   - `spec.type` (service | website | library | custom)
   - `spec.lifecycle` (experimental | production | deprecated)
   - `spec.owner`
2. **If owner cannot be confidently determined** (no CODEOWNERS, no manifest
   author/maintainer field), do not block — write the file anyway with
   `spec.owner: TODO` and flag it prominently in the Step 6 report. Never
   refuse to create the file over a missing owner.
3. If `apiSpecs` found at least one OpenAPI/AsyncAPI/proto file, propose a
   sibling `API` entity (`spec.type` from the spec kind, `spec.definition`
   pointing at the real spec file via `$text`/inline reference as
   appropriate) and link it via `providesApis` on the Component.
4. If there's one obvious primary datastore (e.g. a single database
   dependency visible in manifests/docker-compose), propose one `Resource`
   entity and link it via `dependsOn`. Don't invent Resources speculatively —
   only when the signal is unambiguous. Cap v1 scope at Component + optional
   API + optional Resource; do not create System/Domain/Template entities.
5. Fill in `assets/catalog-info.template.yaml` (title/description from the
   README, `tags` from manifest keywords if present, `backstage.io/
   techdocs-ref: dir:.` annotation, `github.com/project-slug` from
   `gitSlug` if found).
6. **Validate before writing**:
   ```
   node <skill-dir>/scripts/validate-catalog.mjs <path-to-new-file>
   ```
   If `valid: false`, fix the content and re-validate. Never write a file
   that fails validation.
7. Write `catalog-info.yaml` to the repo root.

## Step 3 — CREATE TechDocs

1. Fill `assets/mkdocs.yml.template` — `site_name` from the README title or
   catalog `metadata.title`, a minimal `nav` (just `Home: index.md` to start).
2. Generate `docs/index.md` from `assets/docs-index.template.md`, populated
   with content **restructured** from the README (not a raw copy) — see
   `references/techdocs-setup.md` for what belongs on a good TechDocs landing
   page vs. what stays README-only (badges, contribution/license
   boilerplate).
3. Keep the initial scaffold minimal — just `docs/index.md`. Do not invent a
   multi-folder structure (e.g. `developer/`, `admin/`, `user/`) unless the
   repo already has one; let it grow organically as the developer adds pages.
4. Ensure the Component entity from Step 2 (or the existing one, if catalog
   mode was UPDATE) carries `backstage.io/techdocs-ref: dir:.`.

## Step 4 — UPDATE catalog

1. Parse `existingCatalog.parsed` (already provided by the scanner).
2. Read `references/reconciliation-rules.md` and classify every field as
   **derived** (safe to auto-patch from scanner facts: `dependsOn`,
   `providesApis`/`consumesApis`, `tags`, the `techdocs-ref` path, file-based
   `links`) or **judgment** (never silently overwritten: `owner`, `title`,
   `description`, `lifecycle`, `system`, any annotation/label not in the
   well-known list).
3. Diff scanner facts against the current derived-field values. Auto-apply
   only the derived-field changes.
4. For judgment fields where current signals suggest drift (e.g. the package
   version crossed 1.0 while `lifecycle` still says `experimental`, or an API
   entity's `spec.definition` uses a markdown `$text` reference instead of a
   real discovered OpenAPI file), **do not change them** — add to the
   flagged-for-review list in the Step 6 report with a short rationale.
5. Apply changes as a **whitelist patch** to the existing structure (only
   touch recognized derived keys, or add newly-required missing keys) rather
   than regenerating the whole file — this preserves manual customizations
   and comments you don't have modeled.
6. **Validate the merged result before writing** (same validator command as
   Step 2.6). If invalid, fix and re-validate — never write an invalid file.
7. Write the updated `catalog-info.yaml`.

## Step 5 — UPDATE TechDocs

1. List `docsFiles` from the scanner and diff against `existingMkdocs.parsed.nav`.
2. For markdown files with no corresponding nav entry, propose additions
   (don't add automatically without a moment's judgment about where they fit
   — group logically, e.g. alongside sibling files in the same folder).
3. For nav entries pointing at files that no longer exist, **flag them, don't
   delete** — a developer may be mid-rename.
4. Only regenerate prose where it's **mechanically stale** — e.g. an API
   reference doc enumerating endpoints that no longer match a discovered
   OpenAPI spec. Present this as a diff for the developer to review, never as
   a silent rewrite of hand-written content.

## Step 6 — Report

End every run with a concise summary:

- Mode used per artifact (CREATE/UPDATE, catalog/TechDocs)
- Files written or modified
- Auto-applied factual changes (derived fields)
- Flagged-for-review items, each with a one-line rationale
- Validation result (valid/errors/warnings)
- An explicit reminder: **nothing was committed** — review the working-tree
  diff (`git diff`) and commit when ready.

## Reference material

- `references/catalog-fields.md` — required/optional fields per kind, enums, well-known annotations
- `references/inference-heuristics.md` — signal → type/lifecycle/owner mapping tables, edge cases
- `references/reconciliation-rules.md` — derived vs. judgment field classification for update mode
- `references/techdocs-setup.md` — mkdocs.yml shape, nav conventions, what belongs in docs/index.md
