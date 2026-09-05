# backstagify

**Keep a repository's Backstage catalog-info.yaml and TechDocs in sync with
the code — automatically.**

`backstagify` is an [Agent Skill](https://www.skills.sh/) — a portable
`SKILL.md` package — that scans a codebase and generates or reconciles the
files a [Backstage](https://backstage.io) developer portal needs:
`catalog-info.yaml` (Software Catalog registration) and TechDocs
(`mkdocs.yml` + `docs/`). Run it and it will scaffold both from scratch if
they don't exist, or bring them up to date with the current codebase if they
do — without clobbering the judgment calls a human already made.

## Why

Registering a service in Backstage and keeping its catalog entry accurate is
almost always a manual, easy-to-forget chore: `owner` goes stale when a team
is renamed, `dependsOn` misses a new datastore, TechDocs pages pile up
without ever being added to the nav. There isn't a dominant open-source tool
that solves this by actually reading the codebase — most existing tooling
either scaffolds a one-time template or requires the catalog data to already
exist elsewhere. `backstagify` treats the codebase itself — manifests,
Dockerfiles, CODEOWNERS, API specs, the README — as the source of truth, and
reconciles the catalog against it every time you run it.

## Works with Claude Code and OpenCode, unmodified

This is a single skill package with no fork or translation layer needed:
[OpenCode natively discovers `.claude/skills/*/SKILL.md`](https://opencode.ai/docs/skills/)
using the identical frontmatter format Claude Code uses. Install it once and
both tools pick it up the same way.

## Installation

**Option A — copy into a skills directory:**

```bash
# Available to you in every project (Claude Code):
cp -r backstagify ~/.claude/skills/backstagify

# Or scoped to one repo (Claude Code or OpenCode):
cp -r backstagify /path/to/your/repo/.claude/skills/backstagify
```

**Option B — via the [skills.sh](https://www.skills.sh/) ecosystem:**

```bash
npx skills add johnm0688/backstagify@backstagify
```

## Usage

Once installed, just ask for it in plain language during a normal coding
session:

> "Run backstagify on this repo"
> "Generate Backstage docs for this project"
> "Update our catalog-info.yaml"

It targets the current repository, reports what it's about to do, and never
touches git — it only writes files to the working tree. Review the diff and
commit when you're happy with it.

## What it generates

**`catalog-info.yaml`** — a `Component` entity (plus an `API` entity if it
finds an OpenAPI/AsyncAPI/proto spec, and a `Resource` entity if there's one
unambiguous primary datastore):

```yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: widget-service
  title: Widget Service
  description: Handles widget CRUD and dispatches widget-updated events.
  annotations:
    backstage.io/techdocs-ref: dir:.
    github.com/project-slug: my-org/widget-service
spec:
  type: service
  lifecycle: production
  owner: widgets-team
  dependsOn:
    - resource:widget-db
```

**TechDocs** — a minimal `mkdocs.yml` plus `docs/index.md`, ready to grow as
you add pages.

## Design guarantees

- **Never touches git.** Only the working tree is modified — no commits,
  branches, or pushes.
- **Never writes an invalid file.** Every generated or updated
  `catalog-info.yaml` is checked against Backstage's required fields and
  enums before it's written; a failed check blocks the write.
- **Never silently overwrites a judgment call.** Fields like `owner`,
  `title`, `description`, `lifecycle`, and `system` are only ever flagged for
  your review, not auto-changed — only clearly code-derived facts
  (dependencies, provided/consumed APIs, tags, the TechDocs path) are
  patched automatically. See `backstagify/references/reconciliation-rules.md`
  for the full breakdown.

## Scope

- v1 is invoked manually, as part of normal dev work — there's no CI or git
  hook integration yet (the design keeps that door open without building it
  prematurely).
- Supports `Component`, `API`, and `Resource` entity kinds. `System`,
  `Domain`, `Group`, `User`, and `Template` are out of scope; if a repo's
  catalog already has one, it's left untouched.

## Repository layout

```
backstagify/
├── SKILL.md          # the runbook an agent follows
├── scripts/           # zero-dependency Node scanner + validator
├── references/        # field tables, heuristics, reconciliation rules
└── assets/             # catalog-info.yaml / mkdocs.yml / docs templates
```

See [CLAUDE.md](CLAUDE.md) for the full architecture writeup, including the
scripts-vs-judgment split and the invariants any change should preserve.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache License 2.0](LICENSE)
