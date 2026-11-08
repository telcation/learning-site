import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestPractice } from './practice.ts';
import type { PracticeAttempt, PracticeRequest } from './practice.ts';
const attempt=(assignment_version_id:string,id:string):PracticeAttempt=>({assignment_version_id,practice_attempt_id:id,sequence_no:1,revision:1,self_confirmed:false,self_checks:[]});

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
  const broken:PracticeRequest=async<T>()=>{calls++;return {items:[],has_more:true,next_after_id:'same-cursor'} as T;};
  await assert.rejects(latestPractice(broken,'wanted'),/PRACTICE_HISTORY_INCOMPLETE/);
  assert.equal(calls,2);
});
