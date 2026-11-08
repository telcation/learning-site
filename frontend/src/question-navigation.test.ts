import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextPendingQuestion } from './question-navigation.ts';
const q=(id:string,latest_correct:boolean|null)=>({question_version_id:id,latest_correct});

test('moving on skips current wrong answer and reaches the next unanswered question',()=>{
  assert.equal(nextPendingQuestion([q('first',false),q('second',null),q('third',null)],'first'),'second');
});
test('after the last question navigation wraps to an earlier unresolved answer',()=>{
  assert.equal(nextPendingQuestion([q('first',false),q('second',true),q('third',true)],'third'),'first');
});
test('no pending question returns no candidate, including an empty unit',()=>{
  assert.equal(nextPendingQuestion([q('first',true),q('second',true)],'first'),undefined);
  assert.equal(nextPendingQuestion([]),undefined);
});
test('only the current wrong answer remaining does not force an immediate retry',()=>{
  assert.equal(nextPendingQuestion([q('first',false),q('second',true)],'first'),undefined);
});
test('legacy two-question unit supports deferring first answer and returning after second',()=>{
  assert.equal(nextPendingQuestion([q('first',false),q('second',null)],'first'),'second');
  assert.equal(nextPendingQuestion([q('first',false),q('second',true)],'second'),'first');
});
test('initial selection follows publication order, skipping solved questions',()=>{
  const items=[q('z',true),q('y',false),q('a',null)];
  assert.equal(nextPendingQuestion(items),'y');
  assert.equal(nextPendingQuestion(items,'unknown'),'y');
  assert.deepEqual(items.map(item=>item.question_version_id),['z','y','a']);
});
