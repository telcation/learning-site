import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPracticeHistoryRows } from './practice-history.ts';
import type { Assignment, PracticeAttempt } from './practice.ts';
const assignment=(id:string,unit:string):Assignment=>({assignment_version_id:id,unit_version_id:unit,requirements:'task',target_path:'practice/example',rubric_items:[{rubric_item_id:id+'-one',ordinal:1,required:true,description:'First item'},{rubric_item_id:id+'-two',ordinal:2,required:true,description:'Second item'}]});
const attempt=(a:Assignment,id:string,met:boolean):PracticeAttempt=>({practice_attempt_id:id,assignment_version_id:a.assignment_version_id,sequence_no:1,revision:1,self_confirmed:met,self_checks:a.rubric_items.map(r=>({rubric_item_id:r.rubric_item_id,met}))});
const a=assignment('a','unit-a'),b=assignment('b','unit-b');
const courses=[{id:'old',title:'Python',version:1},{id:'new',title:'Java',version:2}];
const unitCourses={'unit-a':'old','unit-b':'new'};

test('practice history preserves response order and joins course versions by IDs',()=>{
  const rows=buildPracticeHistoryRows([attempt(b,'newest',true),attempt(a,'older',false)],[a,b],unitCourses,courses);
  assert.deepEqual(rows.map(row=>[row.id,row.course_title,row.course_version,row.confirmed]),[['newest','Java',2,true],['older','Python',1,false]]);
  assert.equal(rows[0].checked_count,2);assert.equal(rows[1].checked_count,0);
});
test('historical check details are matched by rubric IDs rather than submitted array order',()=>{
  const saved=attempt(a,'record',false);saved.self_checks=[{rubric_item_id:'a-two',met:false},{rubric_item_id:'a-one',met:true}];
  const row=buildPracticeHistoryRows([saved],[a],unitCourses,courses)[0];
  assert.deepEqual(row.checks.map(check=>[check.description,check.met]),[['First item',true],['Second item',false]]);
  assert.equal(row.checked_count,1);assert.equal(row.item_count,2);
});
test('optional unchecked rubric items do not invalidate required-item self confirmation',()=>{
  const optional=structuredClone(a);optional.rubric_items[1].required=false;
  const saved=attempt(optional,'record',true);saved.self_checks[1].met=false;
  const row=buildPracticeHistoryRows([saved],[optional],unitCourses,courses)[0];
  assert.equal(row.confirmed,true);assert.equal(row.checked_count,1);assert.equal(row.checks[1].required,false);
});
test('missing metadata and duplicate records do not show a misleading course label',()=>{
  const saved=attempt(a,'record',true);
  assert.throws(()=>buildPracticeHistoryRows([saved],[],unitCourses,courses));
  assert.throws(()=>buildPracticeHistoryRows([saved],[a],{},courses));
  assert.throws(()=>buildPracticeHistoryRows([saved,saved],[a],unitCourses,courses));
});
test('missing, duplicate, non-boolean and inconsistent historical checks are rejected',()=>{
  const missing=attempt(a,'record',false);missing.self_checks.pop();
  assert.throws(()=>buildPracticeHistoryRows([missing],[a],unitCourses,courses));
  const duplicate=attempt(a,'record',false);duplicate.self_checks[1]=duplicate.self_checks[0];
  assert.throws(()=>buildPracticeHistoryRows([duplicate],[a],unitCourses,courses));
  const invalid=attempt(a,'record',true);(invalid.self_checks[0] as any).met='true';
  assert.throws(()=>buildPracticeHistoryRows([invalid],[a],unitCourses,courses));
  const inconsistent=attempt(a,'record',true);inconsistent.self_confirmed=false;
  assert.throws(()=>buildPracticeHistoryRows([inconsistent],[a],unitCourses,courses));
});
