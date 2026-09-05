# Contributing to backstagify

Thanks for considering a contribution. This is a small, focused skill —
please read this before opening a PR so your change fits its design.

## No build step

There's no `package.json`, build tool, or dependency to install. The two
scripts in `backstagify/scripts/` are zero-dependency Node (`.mjs`) files
that run directly:

```bash
node backstagify/scripts/scan-repo.mjs <path-to-a-repo>
node backstagify/scripts/validate-catalog.mjs <path-to-a-catalog-info.yaml>
```

## Testing your change

There's no automated test suite. Verify changes manually:

1. For scanner changes: run `scan-repo.mjs` against a real repo (or a quick
   scratch fixture directory you create) and inspect the JSON output for
   correctness.
2. For validator changes: run `validate-catalog.mjs` against both a
   known-valid `catalog-info.yaml` and a deliberately broken one, and confirm
   the right errors/warnings are (or aren't) reported.
3. For `yaml-lite.mjs` changes: remember it's a *scoped* parser, not a
   general YAML implementation — it only needs to handle what Backstage
   catalog files and `mkdocs.yml` actually use. Test against real
   `catalog-info.yaml`/`mkdocs.yml` examples, not arbitrary YAML.
4. For `SKILL.md` or `references/*.md` changes: there's no automated way to
   test agent behavior — describe in your PR how you verified the new
   instructions produce the intended behavior (e.g. by running the skill
   against a sample repo in a Claude Code or OpenCode session).

## Invariants to preserve

These are deliberate design decisions, not oversights — a PR that changes
them should explain why in its description:

- **Scripts stay side-effect-free.** `scan-repo.mjs` and
  `validate-catalog.mjs` only read and print JSON — they never write files.
  All writes happen via the invoking agent following `SKILL.md`.
- **v1 entity scope is `Component` + optional `API` + optional `Resource`
  only.** `System`/`Domain`/`Group`/`User`/`Template` are intentionally out
  of scope for now.
- **The derived-vs-judgment field split** (see
  `backstagify/references/reconciliation-rules.md`) is what stops update
  mode from clobbering a human's hand-set `owner`, `title`, `description`,
  or `lifecycle`. Any change to the update workflow must preserve this.
- **No git actions.** The skill never commits, branches, or pushes.

See [CLAUDE.md](CLAUDE.md) for the full architecture.

## Pull requests

- Keep PRs focused — one behavioral change at a time.
- Describe how you tested the change (see above).
- If you're changing `SKILL.md`'s instructions, include a short before/after
  of the behavior you're targeting.
