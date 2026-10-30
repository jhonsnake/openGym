#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_OUTPUT = path.join(ROOT, 'api/exercise-catalogue.json');

function literalId(value, label) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) {
    throw new TypeError(`${label} must be a literal ID string`);
  }
  return value;
}

export function authorityManifestIds({ exdb, exalias }) {
  if (!Array.isArray(exdb)) throw new TypeError('exdb must be an array');
  if (!exalias || typeof exalias !== 'object' || Array.isArray(exalias)) {
    throw new TypeError('exalias must be an object');
  }
  return [...new Set([
    ...exdb.map((row, index) => literalId(row?.id, `exdb[${index}].id`)),
    ...Object.keys(exalias).map((id, index) => literalId(id, `exalias key ${index}`)),
  ])].sort();
}

export function authorityManifestJson({ exdb, exalias }) {
  return JSON.stringify(authorityManifestIds({ exdb, exalias })) + '\n';
}

export function buildAuthorityManifest({ exdb, exalias, outputPath = DEFAULT_OUTPUT, check = false }) {
  if (typeof outputPath !== 'string' || outputPath.length === 0) throw new TypeError('outputPath is required');
  const body = authorityManifestJson({ exdb, exalias });
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : null;
  if (check) {
    if (current !== body) throw new Error(`authority manifest is out of date: ${outputPath}`);
    return body;
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (current !== body) fs.writeFileSync(outputPath, body);
  return body;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { EXDB, EXALIAS } = await import(pathToFileURL(path.join(ROOT, 'frontend/src/lib/exercises-data.js')).href);
  const check = process.argv.includes('--check');
  const outputArg = process.argv.find(arg => arg.startsWith('--output='));
  const outputPath = outputArg ? path.resolve(outputArg.slice('--output='.length)) : DEFAULT_OUTPUT;
  buildAuthorityManifest({ exdb: EXDB, exalias: EXALIAS, outputPath, check });
  console.log(`authority exercise manifest: ${authorityManifestIds({ exdb: EXDB, exalias: EXALIAS }).length} IDs`);
}

