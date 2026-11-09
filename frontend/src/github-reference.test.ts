import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localReference, parseGitHubReference, referenceBatch } from './github-reference.ts';
import { forgetCredential } from './credential.ts';

const record='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const attempt='33333333-3333-4333-8333-333333333333';
const sha='a'.repeat(40);

test('repository-only references normalize without contacting GitHub',()=>{
  assert.deepEqual(parseGitHubReference(' https://github.com/owner/repo/ ', ' '+ 'A'.repeat(40)+' '),{repository:'https://github.com/owner/repo',sha});
  assert.deepEqual(parseGitHubReference('https://github.com/owner/repo',''),{repository:'https://github.com/owner/repo',sha:''});
});
test('unsafe and unrelated URLs, embedded secrets and code paths are rejected',()=>{
  for(const url of ['http://github.com/o/r','javascript:alert(1)','https://github.com.evil.test/o/r','https://token@github.com/o/r',
    'https://github.com/o/r?token=secret','https://github.com/o/r#secret','https://github.com/o/r/tree/main',
    'https://github.com/o/..','https://github.com/o/%2e%2e','https://github.com/o/r\n/extra','https://example.com/o/r']){
    assert.throws(()=>parseGitHubReference(url,''));
  }
});
test('commit requires a full hexadecimal SHA rather than arbitrary text',()=>{
  for(const value of ['abcd123','z'.repeat(40),'a'.repeat(41),'LS1-secret','a'.repeat(20)+' '+ 'a'.repeat(19)])
    assert.throws(()=>parseGitHubReference('https://github.com/o/r',value));
});

// Isolated IndexedDB contract double: changes are visible only at commit,
// abort rolls them back, and request callbacks run before transaction completion.
function storageDouble(){
  let data=new Map<string,unknown>([['owner',{id:'key-1'}]]);
  const options={abortWrites:false,opens:0};
  const api={open(){
    options.opens++;
    const req:any={result:{close(){},transaction(_name:string,mode:string){
      const staged=new Map(data);let aborted=false;
      const tx:any={abort(){aborted=true;},objectStore(){return {
        get(key:string){const r:any={};queueMicrotask(()=>{if(!aborted){r.result=staged.get(key);r.onsuccess?.();}});return r;},
        put(value:unknown,key:string){staged.set(key,value);},delete(key:string){staged.delete(key);},clear(){staged.clear();}
      };}};
      setTimeout(()=>{if(aborted||mode==='readwrite'&&options.abortWrites)tx.onabort?.();else{if(mode==='readwrite')data=staged;tx.oncomplete?.();}},0);
      return tx;
    }}};
    queueMicrotask(()=>req.onsuccess());return req;
  }};
  return {api,options,setOwner(id:string){data.set('owner',{id});},entries(){return data;}};
}

test('references remain separated by record and attempt, survive key rotation, and clear with device data',async()=>{
  const mock=storageDouble();
  const original=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
  const fetchBefore=globalThis.fetch;
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:mock.api});
  globalThis.fetch=()=>{throw new Error('No network is allowed for local references');};
  try{
    const value={repository:'https://github.com/owner/repo',sha};
    assert.equal(await localReference('key-1',record,attempt,'read'),undefined);
    await localReference('key-1',record,attempt,'save',value);
    assert.deepEqual(await localReference('key-1',record,attempt,'read'),value);
    assert.equal(await localReference('key-1',other,attempt,'read'),undefined);
    assert.equal(await localReference('key-1',record,other,'read'),undefined);
    mock.setOwner('key-2');
    await assert.rejects(localReference('key-1',record,attempt,'read'));
    assert.deepEqual(await localReference('key-2',record,attempt,'read'),value);
    await localReference('key-2',record,attempt,'delete');
    assert.equal(await localReference('key-2',record,attempt,'read'),undefined);
    await localReference('key-2',record,attempt,'save',value);
    await forgetCredential();
    assert.equal(mock.entries().size,0);
    // Stale editors cannot recreate refs after forget.
    await assert.rejects(localReference('key-2',record,attempt,'save',value));
    assert.equal(mock.entries().size,0);
  }finally{globalThis.fetch=fetchBefore;if(original)Object.defineProperty(globalThis,'indexedDB',original);else delete (globalThis as any).indexedDB;}
});
test('failed transaction is not acknowledged and cannot change stored reference',async()=>{
  const mock=storageDouble();const original=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:mock.api});
  try{
    const value={repository:'https://github.com/owner/repo',sha};
    mock.options.abortWrites=true;
    await assert.rejects(localReference('key-1',record,attempt,'save',value));
    assert.equal(await localReference('key-1',record,attempt,'read'),undefined);
    const opens=mock.options.opens;
    await assert.rejects(localReference('key-1','bad-id',attempt,'save',value));
    await assert.rejects(localReference('key-1',record,attempt,'save',{repository:'https://example.com/o/r',sha}));
    assert.equal(mock.options.opens,opens);
  }finally{if(original)Object.defineProperty(globalThis,'indexedDB',original);else delete (globalThis as any).indexedDB;}
});

test('batch import adds missing entries and preserves identical and conflicting local values',async()=>{
  const mock=storageDouble();const original=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:mock.api});
  try{
    const value={repository:'https://github.com/o/local',sha};
    await localReference('key-1',record,attempt,'save',value);
    const proposed=[{practice_attempt_id:attempt,repository:'https://github.com/o/imported',sha:''},
      {practice_attempt_id:other,repository:'https://github.com/o/new',sha:''}];
    const first=await referenceBatch('key-1',record,[attempt,other],proposed);
    assert.deepEqual(first.merge,{added:1,identical:0,conflicts:1});
    assert.deepEqual(await localReference('key-1',record,attempt,'read'),value);
    const again=await referenceBatch('key-1',record,[attempt,other],proposed);
    assert.deepEqual(again.merge,{added:0,identical:1,conflicts:1});
    const snapshot=await referenceBatch('key-1',record,[attempt,other]);
    assert.equal(snapshot.entries.length,2);
    assert.equal((await referenceBatch('key-1',other,[attempt,other])).entries.length,0);
    // Current state, rather than the preview, decides conflicts at commit.
    await localReference('key-1',record,other,'save',value);
    assert.equal((await referenceBatch('key-1',record,[attempt,other],proposed)).merge.conflicts,2);
  }finally{if(original)Object.defineProperty(globalThis,'indexedDB',original);else delete (globalThis as any).indexedDB;}
});
test('batch write abort rolls back every entry and forgotten or changed owners cannot import',async()=>{
  const mock=storageDouble();const original=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
  Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:mock.api});
  try{
    const entries=[attempt,other].map(practice_attempt_id=>({practice_attempt_id,repository:'https://github.com/o/r',sha:''}));
    mock.options.abortWrites=true;
    await assert.rejects(referenceBatch('key-1',record,[attempt,other],entries));
    assert.equal((await referenceBatch('key-1',record,[attempt,other])).entries.length,0);
    mock.options.abortWrites=false;mock.setOwner('key-2');
    await assert.rejects(referenceBatch('key-1',record,[attempt,other],entries));
    await forgetCredential();
    await assert.rejects(referenceBatch('key-2',record,[attempt,other],entries));
    assert.equal(mock.entries().size,0);
  }finally{if(original)Object.defineProperty(globalThis,'indexedDB',original);else delete (globalThis as any).indexedDB;}
});
