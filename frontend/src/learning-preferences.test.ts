import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prioritizeCourses } from './learning-preferences.ts';
const courses=[{id:'python',language:'python' as const},{id:'java',language:'java' as const},{id:'fe',language:null}];

test('practice language preference changes display order without mutating catalog',()=>{
  const ranked=prioritizeCourses(courses,{study_route:'practice',preferred_language:'java'});
  assert.deepEqual(ranked.map(c=>c.id),['java','python','fe']);
  assert.deepEqual(courses.map(c=>c.id),['python','java','fe']);
  assert.equal(ranked[0],courses[1]);
});
test('FE priority remains first with optional secondary language preference',()=>{
  assert.deepEqual(prioritizeCourses(courses,{study_route:'fe',preferred_language:null}).map(c=>c.id),['fe','python','java']);
  assert.deepEqual(prioritizeCourses(courses,{study_route:'fe',preferred_language:'java'}).map(c=>c.id),['fe','java','python']);
});
test('equally preferred course versions preserve publication order',()=>{
  const versions=[courses[1],{id:'python-old',language:'python' as const},{id:'python-new',language:'python' as const},courses[2]];
  assert.deepEqual(prioritizeCourses(versions,{study_route:'practice',preferred_language:'python'}).map(c=>c.id),['python-old','python-new','java','fe']);
});
test('absent language never puts FE first for practice route',()=>{
  assert.deepEqual(prioritizeCourses([courses[2],courses[1],courses[0]],{study_route:'practice',preferred_language:null}).map(c=>c.id),['java','python','fe']);
});
