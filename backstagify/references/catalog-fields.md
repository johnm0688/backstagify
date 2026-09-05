# Catalog entity fields (v1 scope: Component, API, Resource)

All entities share this envelope:

```yaml
apiVersion: backstage.io/v1alpha1
kind: Component | API | Resource
metadata:
  name: string                # required. Pattern: [a-zA-Z0-9][a-zA-Z0-9_.-]* , <=63 chars
  namespace: string           # optional, default "default"
  title: string                # optional, human-readable display name
  description: string          # optional
  labels: {}                   # optional, key-value strings
  annotations: {}               # optional, see "Well-known annotations" below
  tags: []                      # optional, list of strings
  links:                        # optional
    - url: string
      title: string
      icon: string
spec: { ... }                   # required, shape depends on kind
```

## Component

```yaml
spec:
  type: service | website | library | custom     # required
  lifecycle: experimental | production | deprecated  # required
  owner: string                                    # required, ref to a Group/User
  system: string                                   # optional
  providesApis: [string]                           # optional
  consumesApis: [string]                           # optional
  dependsOn: [string]                              # optional, e.g. "resource:my-db"
```

## API

```yaml
spec:
  type: openapi | asyncapi | graphql | grpc   # required
  lifecycle: experimental | production | deprecated  # required
  owner: string                                # required
  system: string                               # optional
  definition:                                  # required — one of:
    $text: ./path/to/spec-or-doc.md             #   file reference
    $json: ./path/to/spec.json
    $yaml: ./path/to/spec.yaml
    # or an inline string containing the full spec
```

**Caveat**: Backstage does not validate that a `$text`/`$json`/`$yaml` target
is actually a well-formed OpenAPI/AsyncAPI document — it just needs to exist.
If `spec.type: openapi` but the referenced file is prose documentation (not a
real OpenAPI YAML/JSON spec), Backstage's API-docs viewer will render it
incorrectly. Flag this as a judgment call for the developer rather than
silently treating it as legitimate (see `reconciliation-rules.md`).

## Resource

```yaml
spec:
  type: database | s3-bucket | cluster | custom   # required (custom = any other string)
  lifecycle: experimental | production | deprecated  # required
  owner: string                                    # required
  system: string                                   # optional
  dependsOn: [string]                              # optional
```

## Well-known annotations

| Annotation | Meaning |
|---|---|
| `backstage.io/techdocs-ref` | Where TechDocs source lives — almost always `dir:.` (docs alongside code); `url:<...>` for docs hosted elsewhere |
| `backstage.io/source-location` | Explicit source location override, usually unnecessary if `github.com/project-slug` is set |
| `backstage.io/managed-by-location` | Where the catalog-info.yaml itself was registered from — usually set by Backstage's own discovery, not hand-authored |
| `github.com/project-slug` | `org/repo` — enables GitHub-specific Backstage plugins (Actions, PRs, etc.) |
| `github.com/team-slug` | Only relevant on `Group` entities (out of v1 scope) |

## Out of v1 scope

`System`, `Domain`, `Group`, `User`, `Template`, `Location` entity kinds are
not created or modified by this skill. If a repo's catalog-info.yaml already
contains one of these, the validator passes it through with a warning and
this skill never touches it.
