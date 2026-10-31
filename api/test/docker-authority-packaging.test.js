import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const apiRoot = new URL('../', import.meta.url);
const apiDocker = fs.readFileSync(new URL('Dockerfile', apiRoot), 'utf8');
const webDocker = fs.readFileSync(new URL('../web/Dockerfile', apiRoot), 'utf8');
const copySources = [...apiDocker.matchAll(/^COPY\s+(?!--from=)(.+)$/gm)]
  .flatMap(match => match[1].split(/\s+/).filter(token => !token.startsWith('--')).slice(0, -1));
const packaged = name => copySources.some(source => source === name || name.startsWith(source.replace(/\/$/, '') + '/'));

test('all local authority runtime dependencies and snapshot entrypoint are packaged', () => {
  const pending = ['server.js', 'authority-service.js', 'authority-store.js', 'identity-authority.js', 'exercise-catalogue.js', 'exercise-catalogue.json', 'scripts/snapshot-authority.mjs'];
  const checked = new Set();
  while (pending.length) {
    const name = pending.pop();
    if (checked.has(name)) continue;
    checked.add(name);
    assert.ok(packaged(name), `runtime module absent from Docker COPY: ${name}`);
    const sourceUrl = new URL(name, apiRoot);
    const text = fs.readFileSync(sourceUrl, 'utf8');
    for (const match of text.matchAll(/\bfrom\s+['"](\.\.?\/[^'"]+)['"]/g)) {
      const dependency = new URL(match[1], sourceUrl);
      assert.ok(dependency.href.startsWith(apiRoot.href), 'authority dependency must remain in API build context');
      pending.push(dependency.href.slice(apiRoot.href.length));
    }
  }
  assert.match(apiDocker, /FROM node:22\.23\.4-alpine AS base/);
});

test('modified API and web images identify the public fork source', () => {
  for (const dockerfile of [apiDocker, webDocker]) {
    assert.match(dockerfile, /org\.opencontainers\.image\.source="https:\/\/github\.com\/jhonsnake\/openGym"/);
    assert.match(dockerfile, /org\.opencontainers\.image\.licenses="AGPL-3\.0-or-later"/);
  }
});
