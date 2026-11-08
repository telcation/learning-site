import type { QuestionSummary } from './review';
export type ObjectiveInfo={objective_id:string;kind:'concept'|'java'|'python';description:string};
export type ObjectiveProgress={objective_id:string;state:'not_started'|'learning'|'review_required'|'achieved';
  answered_count:number;latest_correct_count:number;first_correct_count:number};
export type UnitInfo={unit_version_id:string;title:string;pass_percent:number;objectives:ObjectiveInfo[]};
export type ObjectiveRow=ObjectiveInfo&ObjectiveProgress&{question_count:number};

export function buildObjectiveRows(info:ObjectiveInfo[], progress:ObjectiveProgress[], questions:Pick<QuestionSummary,'question_version_id'|'objective_ids'>[]):ObjectiveRow[]{
  const ids=new Set(info.map(goal=>goal.objective_id));
  const byId=new Map(progress.map(goal=>[goal.objective_id,goal]));
  if(ids.size!==info.length||byId.size!==progress.length||[...byId.keys()].some(id=>!ids.has(id))||
      new Set(questions.map(q=>q.question_version_id)).size!==questions.length||questions.some(q=>q.objective_ids.some(id=>!ids.has(id))))throw new Error('INVALID_OBJECTIVES');
  return info.map(goal=>{
    const p=byId.get(goal.objective_id), total=questions.filter(q=>q.objective_ids.includes(goal.objective_id)).length;
    if(!p||!['not_started','learning','review_required','achieved'].includes(p.state)||[p.answered_count,p.latest_correct_count,p.first_correct_count].some(n=>!Number.isInteger(n)||n<0||n>total)||
        p.latest_correct_count>p.answered_count||p.first_correct_count>p.answered_count||
        p.state==='achieved'&&(!total||p.latest_correct_count!==total))throw new Error('INVALID_OBJECTIVES');
    return {...goal,...p,question_count:total};
  });
}
