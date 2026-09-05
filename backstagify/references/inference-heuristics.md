# Inference heuristics (scanner facts → catalog fields)

These are heuristics, not hard rules — use judgment when signals conflict,
and prefer a defensible guess over refusing to proceed (except `owner`, which
gets an explicit TODO rather than a fabricated guess — see SKILL.md Step 2.2).

## `spec.type` (Component)

| Signal | Suggests |
|---|---|
| Dockerfile present + a server entrypoint (`scripts.start` runs a long-lived process, `CMD`/`ENTRYPOINT` in Dockerfile starts a server, framework like Express/Fastify/Flask/Django/Gin present) | `service` |
| Frontend framework in dependencies (React, Vue, Next.js, Angular, Svelte) with no server entrypoint, or a static-site generator | `website` |
| `package.json.main`/`exports` set, no server code, meant to be imported/installed (published to a registry, has a version but no long-running process) | `library` |
| `pyproject.toml`/`setup.py` defining a distributable package with no WSGI/ASGI app | `library` |
| Nothing matches clearly | `custom`, or ask the developer rather than guessing |

A repo can look like more than one thing (e.g. a monorepo with both a backend
service and a frontend website) — in that case, prefer classifying the
*primary* artifact at the repo root, and mention in the Step 6 report that a
more granular multi-Component catalog might make sense (but don't build one
automatically — that's a bigger structural decision for the developer).

## `spec.lifecycle`

| Signal | Suggests |
|---|---|
| Manifest version `0.x.x` | `experimental` |
| Manifest version `>=1.0.0` + CI/CD present + tagged releases | `production` |
| README badge/banner containing "deprecated", "archived", "sunset", "no longer maintained" | `deprecated` |
| No version info at all, but active CI and recent-looking structure | `production` is a reasonable default over leaving it unset — never omit `lifecycle`, it's required |

## `spec.owner`

Priority order:
1. `CODEOWNERS` file — take the owner(s) for the root path (`*` pattern, or
   the most specific rule matching the repo root). Strip the `@` prefix from
   GitHub team/user handles when using as a Backstage owner ref (e.g.
   `@my-org/platform-team` → `platform-team`, matching Backstage's `Group`
   naming convention) unless the catalog already uses the `@`-prefixed form
   elsewhere in the repo.
2. `package.json.author` or the first entry in `maintainers`.
3. Nothing found → write `TODO` (see SKILL.md Step 2.2). Do not guess an
   owner from git commit history alone — that identifies a contributor, not
   necessarily a responsible team.

## API entities

- One `apiSpecs` entry with `kind: openapi` → `spec.type: openapi`,
  `spec.definition: { $yaml: <path> }` or `{ $json: <path> }` matching the
  actual file extension.
- `kind: asyncapi` → `spec.type: asyncapi`.
- `kind: grpc` (a `.proto` file) → `spec.type: grpc`, `spec.definition` can
  reference the `.proto` file directly.
- Multiple unrelated spec files → consider multiple API entities rather than
  merging them into one; use judgment based on whether they represent one
  logical API surface or several.

## Resource entities

Only propose one when there's an unambiguous single primary datastore, e.g.:
- A single database driver dependency (e.g. `pg`, `mysql2`, `sqlite3`,
  `mongodb`) with no ambiguity about which service owns it, or
- A `docker-compose.yml` service clearly acting as the app's own datastore
  (not a shared/external one).

If there are multiple candidate resources or the relationship is unclear,
skip Resource creation entirely rather than guessing — this is optional
enrichment, not a required field.

## Title / description

- `title`: README H1, if present and reasonably short; otherwise the
  manifest name.
- `description`: README's first paragraph after the H1, trimmed of markup
  (badges, images, HTML) — see `techdocs-setup.md` for what to strip. If the
  first paragraph is just a badge row or an image, look at the next
  paragraph instead.
