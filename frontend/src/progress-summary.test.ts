import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeProgress } from './progress-summary.ts';
import type { UnitProgress } from './progress-summary.ts';
const unit=(id:string,correct:number,questions:number,state='requirements_unmet',review=0):UnitProgress=>({unit_version_id:id,correct_count:correct,question_count:questions,state,review_pending_count:review});

test('course totals match unit IDs rather than response order, preserving legacy 2-question content',()=>{
  const summary=summarizeProgress([{course_version_id:'old',unit_ids:['u1']},{course_version_id:'new',unit_ids:['u2']}],
    [unit('u2',1,4,'requirements_unmet',1),unit('u1',2,2,'completed')]);
  assert.equal(summary.course_count,2);
  assert.equal(summary.completed_courses,1);
  assert.equal(summary.correct_count,3);
  assert.equal(summary.question_count,6);
  assert.equal(summary.review_pending_count,1);
  assert.equal(summary.courses[0].percent,100);
  assert.equal(summary.courses[1].percent,25);
});

test('completion is retained after a wrong review answer while review counts remain visible',()=>{
  const summary=summarizeProgress([{course_version_id:'course',unit_ids:['u']}],[unit('u',3,4,'completed',1)]);
  assert.equal(summary.completed_courses,1);
  assert.equal(summary.courses[0].completed,true);
  assert.equal(summary.courses[0].percent,75);
  assert.equal(summary.review_pending_count,1);
});

test('100 percent correct does not imply explicit completion',()=>{
  const summary=summarizeProgress([{course_version_id:'course',unit_ids:['u']}],[unit('u',4,4)]);
  assert.equal(summary.courses[0].percent,100);
  assert.equal(summary.courses[0].completed,false);
  assert.equal(summary.completed_courses,0);
});

test('multi-unit totals require every unit completed and exclude unreferenced progress',()=>{
  const summary=summarizeProgress([{course_version_id:'course',unit_ids:['u1','u2']}],
    [unit('u1',2,2,'completed'),unit('u2',0,3,'not_started'),unit('extra',8,8,'completed')]);
  assert.equal(summary.question_count,5);
  assert.equal(summary.correct_count,2);
  assert.equal(summary.courses[0].completed_units,1);
  assert.equal(summary.courses[0].unit_count,2);
  assert.equal(summary.courses[0].completed,false);
});

test('zero questions has a finite percentage and untouched course stays not started',()=>{
  const summary=summarizeProgress([{course_version_id:'course',unit_ids:['u']}],[unit('u',0,0,'not_started')]);
  assert.equal(summary.courses[0].percent,0);
  assert.equal(summary.courses[0].started,false);
});

test('missing, duplicate and invalid counts fail rather than silently showing zero progress',()=>{
  const outlines=[{course_version_id:'course',unit_ids:['u']}];
  assert.throws(()=>summarizeProgress(outlines,[]));
  assert.throws(()=>summarizeProgress(outlines,[unit('u',0,4),unit('u',0,4)]));
  assert.throws(()=>summarizeProgress([...outlines,...outlines],[unit('u',0,4)]));
  assert.throws(()=>summarizeProgress(outlines,[unit('u',5,4)]));
  assert.throws(()=>summarizeProgress(outlines,[unit('u',0,-1)]));
  assert.throws(()=>summarizeProgress(outlines,[unit('u',1.5,4)]));
});

test('no enrollments produces empty, finite totals',()=>{
  assert.deepEqual(summarizeProgress([],[]),{courses:[],course_count:0,completed_courses:0,correct_count:0,question_count:0,review_pending_count:0});
});
