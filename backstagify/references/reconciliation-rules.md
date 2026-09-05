# Reconciliation rules (update mode)

When `catalog-info.yaml` already exists, the goal is to bring it in line with
the current codebase **without destroying human judgment calls** a developer
already made. Every field falls into exactly one of two buckets.

## Derived fields — safe to auto-patch

These come directly and unambiguously from scanner facts. If the scanner's
current facts disagree with what's in the file, update the file:

- `spec.dependsOn` — reconcile against detected Resources/manifests, but only
  ever *add* newly-discovered dependencies or note (don't remove) ones the
  scanner can no longer confirm — a dependency scoped outside what the
  scanner can see (e.g. an external managed service) is still real.
- `spec.providesApis` / `spec.consumesApis` — add entries for newly
  discovered API specs; flag (don't remove) entries that no longer match a
  discovered spec, since the API may still exist but the spec file moved.
- `metadata.tags` — may auto-append clearly-derived tags (e.g. a detected
  language/framework) but never remove existing tags a human added.
- `backstage.io/techdocs-ref` — keep pointed at the correct docs directory;
  only change if the `docs/` location actually moved.
- File-based `metadata.links` that point at generated artifacts (e.g. an API
  reference doc link) — update the path if the file moved, based on scanner
  facts.

## Judgment fields — never silently overwritten

Surface a **flagged-for-review** note in the Step 6 report instead of
changing these automatically, even when a scanner fact suggests they might be
stale:

- `spec.owner` — ownership changes are an organizational decision, not a
  code-derived fact.
- `metadata.title` / `metadata.description` — hand-tuned prose; a developer
  may have deliberately diverged from the README.
- `spec.lifecycle` — flag drift (e.g. version crossed 1.0 while lifecycle
  still says `experimental`) but let the developer decide when a service is
  officially "production."
- `spec.system` — system/domain groupings are an architectural decision.
- Any annotation or label not in the well-known list (`catalog-fields.md`) —
  treat as intentional custom metadata, never touched.
- An API entity whose `spec.definition` is a `$text` reference to a markdown
  file rather than a real OpenAPI/AsyncAPI spec, when the scanner *has*
  found a real spec file elsewhere in the repo — flag this mismatch
  explicitly (see the caveat in `catalog-fields.md`) rather than assuming
  the existing setup is correct or silently swapping the reference.

## Merge mechanism

Apply changes as a **whitelist patch**: parse the existing file, only touch
the specific derived keys listed above (adding them if newly required and
absent), and re-serialize. Do not regenerate the whole document from
scratch — that risks losing manually-added keys/structure this skill doesn't
model. Always re-validate the merged result before writing (see SKILL.md
Step 4.6) — a valid file that preserves untouched judgment fields is the bar,
not a "complete" regeneration.
