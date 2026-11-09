import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestPractice, readPracticePage } from './practice.ts';
import { ApiError } from './api-error.ts';
import type { PracticeAttempt, PracticeRequest } from './practice.ts';
const attempt=(assignment_version_id:string,id:string):PracticeAttempt=>({assignment_version_id,practice_attempt_id:id,sequence_no:1,revision:1,self_confirmed:false,self_checks:[]});

test('paginated GET pauses on rate limit and retries the same page with a bounded count',async()=>{
  const calls:string[]=[],waits:number[]=[];
  const request:PracticeRequest=async<T>(path:string)=>{
    calls.push(path);
    if(calls.length===1)throw new ApiError('RATE_LIMITED',429,1);
    return {items:[],has_more:false,next_after_id:null} as T;
  };
  const page=await readPracticePage(request,'/practice-attempts?limit=100',async ms=>{waits.push(ms);});
  assert.equal(page.items.length,0);assert.deepEqual(waits,[1000]);
  assert.deepEqual(calls,['/practice-attempts?limit=100','/practice-attempts?limit=100']);
  let attempts=0;
  const blocked:PracticeRequest=async()=>{attempts++;throw new ApiError('RATE_LIMITED',429,1);};
  await assert.rejects(readPracticePage(blocked,'/practice-attempts?limit=100',async()=>{}));
  assert.equal(attempts,3);
});
test('read retry helper never retries writes, authorization failures or unsafe waits',async()=>{
  let calls=0;
  const request:PracticeRequest=async()=>{calls++;throw new ApiError('RATE_LIMITED',429,1);};
  await assert.rejects(readPracticePage(request,'/practice-attempts',async()=>{}));
  assert.equal(calls,0);
  for(const error of [new ApiError('UNAUTHORIZED',401),new ApiError('RATE_LIMITED',429,61),new ApiError('RATE_LIMITED',429)]){
    calls=0;
    const invalid:PracticeRequest=async()=>{calls++;throw error;};
    await assert.rejects(readPracticePage(invalid,'/practice-attempts?limit=100',async()=>{throw new Error('must not wait');}));
    assert.equal(calls,1);
  }
});

test('latest practice follows older pages when newest records belong to another assignment',async()=>{
  const calls:string[]=[];
  const pages=[{items:[attempt('other','newest')],has_more:true,next_after_id:'00000000-0000-4000-8000-000000000001'},
    {items:[attempt('wanted','correct-record'),attempt('wanted','older')],has_more:false,next_after_id:null}];
  const request:PracticeRequest=async<T>(path:string)=>{calls.push(path);return pages.shift() as T;};
  const result=await latestPractice(request,'wanted');
  assert.equal(result?.practice_attempt_id,'correct-record');
  assert.deepEqual(calls,['/practice-attempts?limit=100','/practice-attempts?limit=100&after_id=00000000-0000-4000-8000-000000000001']);
});

test('latest practice stops at first matching result without fetching unnecessary older pages',async()=>{
  let count=0;
  const request:PracticeRequest=async<T>()=>{count++;return {items:[attempt('wanted','latest')],has_more:true,next_after_id:'older'} as T;};
  assert.equal((await latestPractice(request,'wanted'))?.practice_attempt_id,'latest');
  assert.equal(count,1);
});

test('no saved practice returns undefined and broken cursor cycles are rejected',async()=>{
  const empty:PracticeRequest=async<T>()=>({items:[],has_more:false,next_after_id:null}) as T;
  assert.equal(await latestPractice(empty,'wanted'),undefined);
  let calls=0;
  const broken:PracticeRequest=async<T>()=>{calls++;return {items:[],has_more:true,next_after_id:'00000000-0000-4000-8000-000000000001'} as T;};
  await assert.rejects(latestPractice(broken,'wanted'),/PRACTICE_HISTORY_INCOMPLETE/);
  assert.equal(calls,2);
});
