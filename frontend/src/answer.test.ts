import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialAnswer, toggleAnswer, moveAnswer } from './answer.ts';
import type { AnswerQuestion } from './answer.ts';
const base={question_version_id:'question',prompt:'prompt',choices:[{id:'a',text:'A'},{id:'b',text:'B'},{id:'c',text:'C'}]};

test('single and multi answers start unselected, order starts in supplied display order',()=>{
  assert.deepEqual(initialAnswer({...base,kind:'single'}),[]);
  assert.deepEqual(initialAnswer({...base,kind:'multi'}),[]);
  assert.deepEqual(initialAnswer({...base,kind:'order'}),['a','b','c']);
});
test('multi toggles without duplicates or mutation',()=>{
  const original=['a'];
  assert.deepEqual(toggleAnswer(original,'b'),['a','b']);
  assert.deepEqual(toggleAnswer(original,'a'),[]);
  assert.deepEqual(original,['a']);
});
test('order moves adjacent items and preserves every item',()=>{
  const original=['a','b','c'];
  const moved=moveAnswer(original,1,-1);
  assert.deepEqual(moved,['b','a','c']);
  assert.deepEqual(moveAnswer(moved,0,1),original);
  assert.deepEqual(original,['a','b','c']);
});
test('order boundary moves cannot drop or duplicate items',()=>{
  const original=['a','b','c'];
  assert.deepEqual(moveAnswer(original,0,-1),original);
  assert.deepEqual(moveAnswer(original,2,1),original);
});
