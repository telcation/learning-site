import { fromSecret, secretBytes } from './credential.ts';
import type { Credential } from './credential.ts';

const encoder = new TextEncoder();
export const MAX_RECOVERY_BYTES = 16384;
const iterations = 600000;
type Envelope = {
  format_version: 1; app_identifier: 'program-learning-site'; origin: string;
  kdf: {algorithm: 'PBKDF2-HMAC-SHA256'; iterations: number; salt_b64: string};
  cipher: {algorithm: 'AES-256-GCM'; iv_b64: string; tag_bits: 128; ciphertext_b64: string};
};
function fail(): never { throw new Error('INVALID_RECOVERY'); }
function fields(value: unknown, names: string[]): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) fail();
}
export function recoveryOrigin(value: string) {
  try {
    const url = new URL(value);
    return value.length <= 255 && url.protocol === 'https:' && url.origin === value;
  } catch { return false; }
}
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
function decode(value: unknown, length?: number) {
  if (typeof value !== 'string' || value.length > 12000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail();
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (b64(bytes) !== value || length !== undefined && bytes.length !== length) fail();
  return bytes;
}
function aad(file: Envelope) {
  return encoder.encode(['learning-recovery-v1', '1', file.app_identifier, file.origin,
    file.kdf.algorithm, String(file.kdf.iterations), file.kdf.salt_b64,
    file.cipher.algorithm, file.cipher.iv_b64, '128'].join('\n'));
}
async function key(password: string, salt: Uint8Array<ArrayBuffer>, count: number) {
  const bytes = encoder.encode(password);
  if (!bytes.length || bytes.length > 1024) fail();
  try {
    const material = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({name:'PBKDF2', hash:'SHA-256', salt, iterations:count},
      material, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
  } finally { bytes.fill(0); }
}
export async function encryptRecovery(credential: Credential, password: string, origin: string) {
  if (!recoveryOrigin(origin)) fail();
  if ([...password].length < 12 || encoder.encode(password).length > 1024) throw new Error('PASSWORD_REQUIREMENTS');
  const secret = secretBytes(credential);
  const derived = await fromSecret(secret);
  if (derived.id !== credential.id || derived.secret !== credential.secret) fail();
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const file: Envelope = {format_version:1, app_identifier:'program-learning-site', origin,
    kdf:{algorithm:'PBKDF2-HMAC-SHA256', iterations, salt_b64:b64(salt)},
    cipher:{algorithm:'AES-256-GCM', iv_b64:b64(iv), tag_bits:128, ciphertext_b64:''}};
  const plain = encoder.encode(JSON.stringify({format_version:1, scope:'owner', credential_id:credential.id, secret_b64url:credential.secret}));
  try {
    const encrypted = await crypto.subtle.encrypt({name:'AES-GCM', iv, tagLength:128, additionalData:aad(file)},
      await key(password, salt, iterations), plain);
    file.cipher.ciphertext_b64 = b64(new Uint8Array(encrypted));
    return JSON.stringify(file);
  } finally { secret.fill(0); plain.fill(0); }
}
export async function decryptRecovery(input: string, password: string, origin: string): Promise<Credential> {
  let plain: Uint8Array | undefined;
  try {
    if (!recoveryOrigin(origin) || encoder.encode(input).length > MAX_RECOVERY_BYTES) fail();
    const file = JSON.parse(input);
    fields(file, ['format_version','app_identifier','origin','kdf','cipher']);
    fields(file.kdf, ['algorithm','iterations','salt_b64']);
    fields(file.cipher, ['algorithm','iv_b64','tag_bits','ciphertext_b64']);
    if (file.format_version !== 1 || file.app_identifier !== 'program-learning-site' || file.origin !== origin ||
        file.kdf.algorithm !== 'PBKDF2-HMAC-SHA256' || !Number.isInteger(file.kdf.iterations) ||
        file.kdf.iterations < 600000 || file.kdf.iterations > 2000000 ||
        file.cipher.algorithm !== 'AES-256-GCM' || file.cipher.tag_bits !== 128) fail();
    const salt = decode(file.kdf.salt_b64, 16), iv = decode(file.cipher.iv_b64, 12);
    const ciphertext = decode(file.cipher.ciphertext_b64);
    if (ciphertext.length < 18) fail();
    plain = new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM', iv, tagLength:128, additionalData:aad(file as Envelope)},
      await key(password, salt, file.kdf.iterations), ciphertext));
    if (plain.length > 4096) fail();
    const payload = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(plain));
    fields(payload, ['format_version','scope','credential_id','secret_b64url']);
    if (payload.format_version !== 1 || payload.scope !== 'owner' || typeof payload.secret_b64url !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(payload.secret_b64url)) fail();
    const bytes = decode(payload.secret_b64url.replace(/-/g,'+').replace(/_/g,'/')+'=', 32);
    try {
      const credential = await fromSecret(bytes);
      if (credential.id !== payload.credential_id || credential.secret !== payload.secret_b64url) fail();
      return credential;
    } finally { bytes.fill(0); }
  } catch { return fail(); }
  finally { plain?.fill(0); }
}
