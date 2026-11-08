type QuestionState = {question_version_id:string;latest_correct:boolean|null};

// Continue in published order, wrapping once, without selecting the current
// question again when the learner explicitly asks to move on.
export function nextPendingQuestion(items:QuestionState[], currentId?:string):string|undefined {
  const start=currentId===undefined?-1:items.findIndex(item=>item.question_version_id===currentId);
  for(let offset=1;offset<=items.length;offset++) {
    const item=items[(start+offset)%items.length];
    if(item.question_version_id!==currentId&&item.latest_correct!==true)return item.question_version_id;
  }
  return undefined;
}
