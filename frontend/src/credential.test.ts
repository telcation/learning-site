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

test('forget notification reaches other tabs without credential data', async () => {
  const { watchDeviceForgotten, notifyDeviceForgotten } = await import('./device-sync.ts');
  let stop = () => {};
  let timer: ReturnType<typeof setTimeout>;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('notification timeout')), 2000);
      stop = watchDeviceForgotten(resolve);
      notifyDeviceForgotten();
    });
  } finally { clearTimeout(timer!); stop(); }
});

test('temporary session expires at 60 minutes, including after sleep', async () => {
  const { TemporarySession, IDLE_LIMIT_MS } = await import('./temporary-session.ts');
  let time = 0, ended = 0;
  const session = new TemporarySession(() => ended++, () => time);
  time = IDLE_LIMIT_MS - 1;
  assert.equal(session.check(), true);
  time = IDLE_LIMIT_MS;
  assert.equal(session.check(), false);
  session.touch(); session.end();
  assert.equal(ended, 1);
  assert.equal(session.check(), false);
});

test('temporary activity renews deadline only before expiry', async () => {
  const { TemporarySession, IDLE_LIMIT_MS } = await import('./temporary-session.ts');
  let time = 0, ended = 0;
  const session = new TemporarySession(() => ended++, () => time);
  time = 40 * 60 * 1000; session.touch();
  time = 80 * 60 * 1000;
  assert.equal(session.check(), true);
  time = 40 * 60 * 1000 + IDLE_LIMIT_MS;
  session.touch();
  assert.equal(ended, 1);
  assert.equal(session.check(), false);
});

test('temporary explicit end rejects further use immediately', async () => {
  const { TemporarySession } = await import('./temporary-session.ts');
  let ended = 0;
  const session = new TemporarySession(() => ended++);
  session.end();
  assert.equal(session.check(), false);
  session.touch(); session.end();
  assert.equal(ended, 1);
});

test('temporary end channel is isolated from personal saved-key notifications', async () => {
  const { watchDeviceForgotten, notifyDeviceForgotten } = await import('./device-sync.ts');
  let personal = 0;
  const stopPersonal = watchDeviceForgotten(() => personal++);
  let stopTemporary = () => {};
  let timer: ReturnType<typeof setTimeout>;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('notification timeout')), 2000);
      stopTemporary = watchDeviceForgotten(resolve, 'learning-temporary-end-v1');
      notifyDeviceForgotten('learning-temporary-end-v1');
    });
    assert.equal(personal, 0);
  } finally { clearTimeout(timer!); stopPersonal(); stopTemporary(); }
});

test('blocked cross-tab messaging does not prevent local end', async () => {
  const { watchDeviceForgotten, notifyDeviceForgotten } = await import('./device-sync.ts');
  const original = globalThis.BroadcastChannel;
  try {
    (globalThis as any).BroadcastChannel = class { constructor() { throw new Error('blocked'); } };
    assert.doesNotThrow(() => notifyDeviceForgotten('learning-temporary-end-v1'));
    assert.doesNotThrow(() => watchDeviceForgotten(() => {}, 'learning-temporary-end-v1')());
  } finally { globalThis.BroadcastChannel = original; }
});
