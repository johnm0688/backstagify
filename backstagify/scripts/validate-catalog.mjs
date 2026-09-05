#!/usr/bin/env node
// Validates a catalog-info.yaml against the required-fields/enum rules the
// backstagify skill supports (Component, API, Resource — v1 scope only).
// Unrecognized kinds (e.g. a hand-authored System/Domain/Template) pass
// through with a warning, never an error — this skill doesn't manage them
// but must not break a repo that already has them.
//
// Usage: node validate-catalog.mjs <path-to-catalog-info.yaml>
// Prints {valid, errors, warnings} as JSON and exits non-zero if invalid.

import fs from 'node:fs';
import path from 'node:path';
import { parseYamlDocuments } from './lib/yaml-lite.mjs';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node validate-catalog.mjs <path-to-catalog-info.yaml>');
  process.exit(2);
}

const errors = [];
const warnings = [];

const text = fs.readFileSync(filePath, 'utf8');
let docs;
try {
  docs = parseYamlDocuments(text).filter((d) => d !== null);
} catch (err) {
  console.log(JSON.stringify({ valid: false, errors: [`YAML parse error: ${err.message}`], warnings: [] }, null, 2));
  process.exit(1);
}

const SUPPORTED_KINDS = new Set(['Component', 'API', 'Resource']);
const NAME_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9_.-]{0,61}[a-zA-Z0-9])?$/;

const COMPONENT_TYPES = new Set(['service', 'website', 'library', 'custom']);
const LIFECYCLES = new Set(['experimental', 'production', 'deprecated']);
const API_TYPES = new Set(['openapi', 'asyncapi', 'graphql', 'grpc']);
const RESOURCE_TYPES = new Set(['database', 's3-bucket', 'cluster', 'custom']);

const entityNames = new Set();
for (const doc of docs) {
  if (doc && doc.metadata && doc.metadata.name) entityNames.add(doc.metadata.name);
}

const baseDir = path.dirname(path.resolve(filePath));

for (const [idx, doc] of docs.entries()) {
  const label = `document #${idx + 1}`;
  if (!doc || typeof doc !== 'object') {
    errors.push(`${label}: empty or unparseable document`);
    continue;
  }

  if (!doc.apiVersion) errors.push(`${label}: missing required field 'apiVersion'`);
  if (!doc.kind) {
    errors.push(`${label}: missing required field 'kind'`);
    continue;
  }

  if (!SUPPORTED_KINDS.has(doc.kind)) {
    warnings.push(`${label}: kind '${doc.kind}' is not managed by this skill (v1 supports Component/API/Resource only) — left untouched`);
    continue;
  }

  if (doc.apiVersion && doc.apiVersion !== 'backstage.io/v1alpha1') {
    warnings.push(`${label} (${doc.kind}): unexpected apiVersion '${doc.apiVersion}', expected 'backstage.io/v1alpha1'`);
  }

  const metadata = doc.metadata || {};
  if (!metadata.name) {
    errors.push(`${label} (${doc.kind}): missing required field 'metadata.name'`);
  } else if (!NAME_PATTERN.test(metadata.name)) {
    errors.push(`${label} (${doc.kind}): metadata.name '${metadata.name}' does not match the required pattern (alphanumeric, '-_.' separators, <=63 chars)`);
  }

  const spec = doc.spec || {};
  if (!spec.owner) errors.push(`${label} (${doc.kind}, ${metadata.name || '?'}): missing required field 'spec.owner'`);
  if (!spec.lifecycle) {
    errors.push(`${label} (${doc.kind}, ${metadata.name || '?'}): missing required field 'spec.lifecycle'`);
  } else if (!LIFECYCLES.has(spec.lifecycle)) {
    errors.push(`${label} (${doc.kind}, ${metadata.name || '?'}): spec.lifecycle '${spec.lifecycle}' is not one of experimental|production|deprecated`);
  }

  if (doc.kind === 'Component') {
    if (!spec.type) {
      errors.push(`${label} (Component, ${metadata.name || '?'}): missing required field 'spec.type'`);
    } else if (!COMPONENT_TYPES.has(spec.type)) {
      warnings.push(`${label} (Component, ${metadata.name || '?'}): spec.type '${spec.type}' is not one of the well-known types (service|website|library|custom)`);
    }
  }

  if (doc.kind === 'API') {
    if (!spec.type) {
      errors.push(`${label} (API, ${metadata.name || '?'}): missing required field 'spec.type'`);
    } else if (!API_TYPES.has(spec.type)) {
      errors.push(`${label} (API, ${metadata.name || '?'}): spec.type '${spec.type}' is not one of openapi|asyncapi|graphql|grpc`);
    }
    if (spec.definition === undefined || spec.definition === null) {
      errors.push(`${label} (API, ${metadata.name || '?'}): missing required field 'spec.definition'`);
    }
  }

  if (doc.kind === 'Resource') {
    if (!spec.type) {
      errors.push(`${label} (Resource, ${metadata.name || '?'}): missing required field 'spec.type'`);
    } else if (!RESOURCE_TYPES.has(spec.type)) {
      warnings.push(`${label} (Resource, ${metadata.name || '?'}): spec.type '${spec.type}' is not one of the well-known types (database|s3-bucket|cluster|custom) — allowed but unrecognized`);
    }
  }

  const annotations = metadata.annotations || {};
  const techdocsRef = annotations['backstage.io/techdocs-ref'];
  if (techdocsRef) {
    const m = String(techdocsRef).match(/^dir:(.+)$/);
    if (m) {
      const dir = path.resolve(baseDir, m[1]);
      if (!fs.existsSync(dir)) {
        errors.push(`${label} (${doc.kind}, ${metadata.name}): backstage.io/techdocs-ref points at '${m[1]}', which does not exist relative to ${baseDir}`);
      }
    } else if (!/^url:/.test(String(techdocsRef))) {
      warnings.push(`${label} (${doc.kind}, ${metadata.name}): backstage.io/techdocs-ref '${techdocsRef}' is neither a 'dir:' nor 'url:' reference`);
    }
  }

  for (const relField of ['providesApis', 'consumesApis', 'dependsOn']) {
    const values = spec[relField];
    if (!Array.isArray(values)) continue;
    for (const ref of values) {
      const bareName = String(ref).replace(/^[a-zA-Z]+:/, '').split('/').pop();
      if (!entityNames.has(bareName) && !entityNames.has(ref)) {
        warnings.push(`${label} (${doc.kind}, ${metadata.name}): ${relField} references '${ref}', which is not defined in this file (may be defined elsewhere in the catalog — not necessarily an error)`);
      }
    }
  }
}

const valid = errors.length === 0;
console.log(JSON.stringify({ valid, errors, warnings }, null, 2));
process.exit(valid ? 0 : 1);
