import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildObjectiveRows } from './objectives.ts';
import type { ObjectiveInfo, ObjectiveProgress } from './objectives.ts';
const info=(id:string):ObjectiveInfo=>({objective_id:id,kind:'concept',description:id});
const state=(id:string,latest:number,first:number,s:ObjectiveProgress['state']='achieved'):ObjectiveProgress=>({objective_id:id,state:s,answered_count:1,latest_correct_count:latest,first_correct_count:first});

test('objective rows join by goal IDs and allow a question to support multiple goals',()=>{
  const rows=buildObjectiveRows([info('a'),info('b')],[state('b',1,1),state('a',1,1)],
    [{question_version_id:'q1',objective_ids:['a','b']},{question_version_id:'q2',objective_ids:['b']}].slice(0,1));
  assert.deepEqual(rows.map(row=>[row.objective_id,row.question_count]),[['a',1],['b',1]]);
});
test('retry success and later wrong answers preserve distinct first and latest correct counts',()=>{
  const questions=[{question_version_id:'q',objective_ids:['a']}];
  const retried=buildObjectiveRows([info('a')],[state('a',1,0)],questions)[0];
  assert.equal(retried.latest_correct_count,1);assert.equal(retried.first_correct_count,0);
  const laterWrong=buildObjectiveRows([info('a')],[state('a',0,1,'review_required')],questions)[0];
  assert.equal(laterWrong.first_correct_count,1);assert.equal(laterWrong.latest_correct_count,0);
});
test('legacy and newer units calculate denominator from their own mapped question IDs',()=>{
  const progress=[state('a',1,1,'learning')];
  const old=buildObjectiveRows([info('a')],progress,[{question_version_id:'q1',objective_ids:['a']}]);
  const newer=buildObjectiveRows([info('a')],progress,[{question_version_id:'q1',objective_ids:['a']},{question_version_id:'q2',objective_ids:['a']}]);
  assert.equal(old[0].question_count,1);assert.equal(newer[0].question_count,2);
});
test('uncovered goals are not falsely marked achieved',()=>{
  const progress:ObjectiveProgress={objective_id:'a',state:'not_started',answered_count:0,latest_correct_count:0,first_correct_count:0};
  assert.equal(buildObjectiveRows([info('a')],[progress],[])[0].question_count,0);
  assert.throws(()=>buildObjectiveRows([info('a')],[{...progress,state:'achieved'}],[]));
});
test('missing or mismatched goal data and impossible counts are rejected',()=>{
  const questions=[{question_version_id:'q',objective_ids:['a']}];
  assert.throws(()=>buildObjectiveRows([info('a')],[],questions));
  assert.throws(()=>buildObjectiveRows([info('a')],[state('other',1,1)],questions));
  assert.throws(()=>buildObjectiveRows([info('a')],[{...state('a',1,1),latest_correct_count:2}],questions));
  assert.throws(()=>buildObjectiveRows([info('a')],[state('a',1,1)],[...questions,...questions]));
});
