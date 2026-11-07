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

// Exercise the transaction boundary: memory must only be cleared after commit.
test('forget clears device data after commit and verifies absence', async () => {
  const { forgetCredential } = await import('./credential.ts');
  let stored: unknown = { secret: 'local-only', backup: 'unconfirmed' };
  let closed = 0;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
    open() {
      const request: any = {};
      request.result = {
        close() { closed++; },
        transaction(_store: string, mode: string) {
          const tx: any = {};
          tx.objectStore = () => ({
            clear() { queueMicrotask(() => { stored = undefined; tx.oncomplete(); }); },
            get() { const req: any = {}; queueMicrotask(() => { req.result = stored; req.onsuccess(); }); return req; }
          });
          return tx;
        }
      };
      queueMicrotask(() => request.onsuccess());
      return request;
    }
  }});
  try { await forgetCredential(); assert.equal(stored, undefined); assert.equal(closed, 2); }
  finally { if (original) Object.defineProperty(globalThis, 'indexedDB', original); else delete (globalThis as any).indexedDB; }
});
