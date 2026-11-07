import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromSecret, exportCode, importCode, bearer } from './credential.ts';

const vectors = JSON.parse(readFileSync(new URL('./paper-code.test-vectors.json', import.meta.url), 'utf8')).vectors;
for (const vector of vectors) {
  test('approved credential fixture: '+vector.fixture, async()=>{
    const c = await fromSecret(Uint8Array.from(Buffer.from(vector.secret_hex,'hex')));
    assert.equal(c.id,vector.credential_id);
    assert.equal(c.secret,vector.secret_b64url);
    assert.equal(await exportCode(c),vector.paper_code);
    assert.equal((await importCode(vector.paper_code)).id,vector.credential_id);
    assert.equal(bearer(c),`Bearer ${vector.credential_id}.${vector.secret_b64url}`);
  });
}
const negatives = JSON.parse(readFileSync(new URL('./negative-code-vectors.json', import.meta.url), 'utf8')).cases;
for (const vector of negatives) {
  test('approved code input: '+vector.name, async()=>{
    if (vector.accepted) assert.ok((await importCode(vector.input)).id);
    else await assert.rejects(importCode(vector.input));
  });
}
