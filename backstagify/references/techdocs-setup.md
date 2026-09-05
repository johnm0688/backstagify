# TechDocs setup conventions

TechDocs is Backstage's docs-as-code feature: it builds a static site from a
repo's `docs/` folder using MkDocs, and serves it inside the Backstage
catalog entity's page.

## Minimum viable setup

```
repo-root/
├── mkdocs.yml
└── docs/
    └── index.md
```

`mkdocs.yml`:

```yaml
site_name: <Component title>
nav:
  - Home: index.md
```

Backstage auto-injects the `techdocs-core` mkdocs plugin at build time if
it's missing from `plugins:`, so declaring it explicitly is optional. Don't
add a `plugins:` block unless there's a real reason to (e.g. the repo already
uses MkDocs for something else and has its own plugin list — in that case,
merge in `techdocs-core` rather than overwriting).

The catalog entity needs:

```yaml
metadata:
  annotations:
    backstage.io/techdocs-ref: dir:.
```

`dir:.` is almost always correct (docs live alongside code in the same repo).
Only use `url:<...>` if docs are intentionally hosted in a different
repository.

## What belongs in `docs/index.md` vs. stays README-only

`docs/index.md` is the landing page developers see *inside Backstage*, not a
copy of the GitHub README. When generating it from README content:

**Keep / adapt:**
- The one- or two-sentence description of what the project does
- Getting-started / setup steps relevant to a developer working on the repo
- Architecture overview, if the README has one
- Links to deeper docs pages (once they exist)

**Strip / leave in the README instead:**
- Badges (CI status, npm version, license badges) — meaningless inside a
  Backstage-rendered page
- Contribution guidelines / license text — these belong in
  `CONTRIBUTING.md`/`LICENSE`, not the catalog docs landing page
- Marketing-style hero images/logos sized for GitHub's rendering

## Growing beyond the minimal scaffold

Do not pre-create a `developer/`, `admin/`, `user/` folder split on first
run — start with just `docs/index.md` and let structure emerge as the
developer adds pages (see SKILL.md Step 3.3). In **update mode**, once such a
structure already exists, respect it: new pages should be diffed against the
existing `nav` and slotted in alongside their logical siblings, not dumped
flat at the top level.

## Nav diffing (update mode)

- New markdown file with no `nav` entry → propose an addition, grouped near
  files in the same folder if a folder convention already exists.
- `nav` entry pointing at a file that no longer exists → flag it, don't
  delete it. The file may have been renamed and the developer just hasn't
  updated the reference yet — deleting the nav entry could silently hide
  content they still intend to have.
