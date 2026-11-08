import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync, createCipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fromSecret } from './credential.ts';
import { encryptRecovery, decryptRecovery } from './recovery.ts';

const origin = 'https://learn.example';
const password = 'local backup password 123';
const vector = JSON.parse(readFileSync(new URL('./paper-code.test-vectors.json', import.meta.url), 'utf8')).vectors[1];
const secret = Uint8Array.from(Buffer.from(vector.secret_hex, 'hex'));

// Independent Node crypto construction checks the specified AAD serialization,
// base64 alphabet, tag placement and payload contract, rather than only round trips.
function independentFile(payload = {format_version:1, scope:'owner', credential_id:vector.credential_id, secret_b64url:vector.secret_b64url}) {
  const salt = Buffer.alloc(16, 1), iv = Buffer.alloc(12, 2);
  const file = {format_version:1, app_identifier:'program-learning-site', origin,
    kdf:{algorithm:'PBKDF2-HMAC-SHA256', iterations:600000, salt_b64:salt.toString('base64')},
    cipher:{algorithm:'AES-256-GCM', iv_b64:iv.toString('base64'), tag_bits:128, ciphertext_b64:''}};
  const aad = ['learning-recovery-v1','1','program-learning-site',origin,'PBKDF2-HMAC-SHA256','600000',salt.toString('base64'),'AES-256-GCM',iv.toString('base64'),'128'].join('\n');
  const cipher = createCipheriv('aes-256-gcm',pbkdf2Sync(password,salt,600000,32,'sha256'),iv);
  cipher.setAAD(Buffer.from(aad));
  file.cipher.ciphertext_b64 = Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64');
  return file;
}
const fixture = independentFile();

test('recovery decrypts independent approved-payload fixture', async () => {
  const c = await decryptRecovery(JSON.stringify(fixture),password,origin);
  assert.equal(c.id,vector.credential_id);
  assert.equal(c.secret,vector.secret_b64url);
});

test('recovery export round trip is randomized and contains no cleartext credential', async () => {
  const c = await fromSecret(secret);
  const first = await encryptRecovery(c,password,origin);
  const second = await encryptRecovery(c,password,origin);
  assert.notEqual(first,second);
  assert.ok(!first.includes(c.secret) && !first.includes(c.id) && !first.includes(password));
  assert.equal((await decryptRecovery(first,password,origin)).id,c.id);
});

test('wrong password and damaged ciphertext do not decrypt', async () => {
  await assert.rejects(decryptRecovery(JSON.stringify(fixture),'incorrect password',origin), /INVALID_RECOVERY/);
  const altered = structuredClone(fixture);
  altered.cipher.ciphertext_b64 = 'A'+altered.cipher.ciphertext_b64.slice(1);
  await assert.rejects(decryptRecovery(JSON.stringify(altered),password,origin), /INVALID_RECOVERY/);
});

test('origin is both checked against current HTTPS site and authenticated', async () => {
  await assert.rejects(decryptRecovery(JSON.stringify(fixture),password,'https://other.example'));
  const altered = structuredClone(fixture);altered.origin='https://other.example';
  await assert.rejects(decryptRecovery(JSON.stringify(altered),password,altered.origin));
  await assert.rejects(encryptRecovery(await fromSecret(secret),password,'http://127.0.0.1:5173'));
  await assert.rejects(decryptRecovery(JSON.stringify(fixture),password,'http://127.0.0.1:5173'));
});

for (const [name, change] of [
  ['format version', (f:any)=>{f.format_version=2;}],
  ['app identifier', (f:any)=>{f.app_identifier='other';}],
  ['excess work', (f:any)=>{f.kdf.iterations=2000001;}],
  ['insufficient work', (f:any)=>{f.kdf.iterations=599999;}],
  ['fractional work', (f:any)=>{f.kdf.iterations=600000.5;}],
  ['wrong salt length', (f:any)=>{f.kdf.salt_b64='AQ==';}],
  ['wrong IV length', (f:any)=>{f.cipher.iv_b64='AQ==';}],
  ['tag length', (f:any)=>{f.cipher.tag_bits=96;}],
  ['unknown field', (f:any)=>{f.email='rejected';}]
] as const) {
  test('recovery rejects metadata: '+name, async () => {
    const f=structuredClone(fixture);change(f);
    await assert.rejects(decryptRecovery(JSON.stringify(f),password,origin),/INVALID_RECOVERY/);
  });
}

test('recovery rejects oversized input and password without performing requested work', async () => {
  await assert.rejects(decryptRecovery(' '.repeat(16385),password,origin));
  await assert.rejects(decryptRecovery(JSON.stringify(fixture),'a'.repeat(1025),origin));
  await assert.rejects(encryptRecovery(await fromSecret(secret),'short',origin),/PASSWORD_REQUIREMENTS/);
});

test('recovery verifies credential ID inside an otherwise authentic encrypted payload', async () => {
  const file=independentFile({format_version:1,scope:'owner',credential_id:'00000000-0000-4000-8000-000000000000',secret_b64url:vector.secret_b64url});
  await assert.rejects(decryptRecovery(JSON.stringify(file),password,origin),/INVALID_RECOVERY/);
});
