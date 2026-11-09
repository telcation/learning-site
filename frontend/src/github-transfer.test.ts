import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeReferenceFile, MAX_REFERENCE_BYTES, parseReferenceFile, practiceIdsForTransfer, requireOwnedAttempts } from './github-transfer.ts';
import type { PracticeRequest } from './practice.ts';

const record='11111111-1111-4111-8111-111111111111',attempt='22222222-2222-4222-8222-222222222222';
const entry={practice_attempt_id:attempt,repository:'https://github.com/o/r',sha:'a'.repeat(40)};
const valid={format:'learning-github-references',version:1,record_id:record,entries:[entry]};
const raw=JSON.stringify(valid);

test('reference file round trip includes only approved fields and no incidental credentials',()=>{
  const encoded=encodeReferenceFile(record,[{...entry,secret:'do-not-export',bootstrapKey:'no',backup:'no'} as any]);
  assert.deepEqual(JSON.parse(encoded),valid);
  assert.deepEqual(parseReferenceFile(encoded,record),valid);
  assert.ok(!encoded.includes('do-not-export'));
});
test('wrong owner, format, version, extra fields and duplicate IDs reject the entire file',()=>{
  for(const file of [{...valid,record_id:attempt},{...valid,format:'LS1'}, {...valid,version:2},{...valid,secret:'hidden'},
    {...valid,entries:[entry,entry]}, {...valid,entries:[{...entry,extra:'text'}]},
    {...valid,entries:[{...entry,practice_attempt_id:'invalid'}]}, {...valid,entries:null},null,[]]){
    assert.throws(()=>parseReferenceFile(JSON.stringify(file),record));
  }
  assert.throws(()=>parseReferenceFile('broken JSON',record));
});
test('untrusted repository URLs and non-string fields never become imported links',()=>{
  for(const bad of [{...entry,repository:'javascript:alert(1)'},{...entry,repository:'https://github.com/o/r?token=x'},
    {...entry,sha:'short'},{...entry,repository:null},{...entry,sha:123}]){
    assert.throws(()=>parseReferenceFile(JSON.stringify({...valid,entries:[bad]}),record));
  }
});
test('file byte and entry limits reject oversized input before import',()=>{
  assert.throws(()=>parseReferenceFile(' '.repeat(MAX_REFERENCE_BYTES+1)+raw,record));
  assert.throws(()=>parseReferenceFile(JSON.stringify({...valid,entries:Array(1001).fill(entry)}),record));
  assert.deepEqual(parseReferenceFile(JSON.stringify({...valid,entries:[]}),record).entries,[]);
});
test('only IDs returned by the authenticated practice history may be imported',()=>{
  const file=parseReferenceFile(raw,record);
  assert.doesNotThrow(()=>requireOwnedAttempts(file,[attempt]));
  assert.throws(()=>requireOwnedAttempts(file,[]));
  assert.throws(()=>requireOwnedAttempts(file,[record]));
});
test('owned practice IDs span all pages through read-only paths without repository data',async()=>{
  const paths:string[]=[];
  const request:PracticeRequest=async <T,>(path:string)=>{
    paths.push(path);
    return (paths.length===1?{items:[{practice_attempt_id:attempt}],has_more:true,next_after_id:attempt}:
      {items:[{practice_attempt_id:record}],has_more:false,next_after_id:null}) as T;
  };
  assert.deepEqual(await practiceIdsForTransfer(request),[attempt,record]);
  assert.deepEqual(paths,['/practice-attempts?limit=100','/practice-attempts?limit=100&after_id='+attempt]);
});
test('incomplete pages, duplicate IDs and cursor cycles fail instead of exporting a partial history',async()=>{
  for(const page of [{items:[],has_more:true,next_after_id:attempt},{items:[{practice_attempt_id:attempt}],has_more:true,next_after_id:null},
    {items:[{practice_attempt_id:'invalid'}],has_more:false,next_after_id:null},
    {items:[{practice_attempt_id:attempt},{practice_attempt_id:attempt}],has_more:false,next_after_id:null},
    {items:[],has_more:false,next_after_id:attempt}]){
    const request:PracticeRequest=async <T,>()=>page as T;
    await assert.rejects(practiceIdsForTransfer(request));
  }
  const cycling:PracticeRequest=async <T,>()=>({items:[{practice_attempt_id:attempt}],has_more:true,next_after_id:attempt}) as T;
  await assert.rejects(practiceIdsForTransfer(cycling));
  const offline:PracticeRequest=async()=>{throw new Error('offline');};
  await assert.rejects(practiceIdsForTransfer(offline));
});
