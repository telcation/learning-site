import type { Assignment, PracticeAttempt } from './practice';
export type PracticeHistoryRow={id:string;course_title:string;course_version:number;confirmed:boolean;
  checked_count:number;item_count:number;checks:{description:string;met:boolean;required:boolean}[]};
export type CourseLabel={id:string;title:string;version:number};

export function buildPracticeHistoryRows(items:PracticeAttempt[],assignments:Assignment[],unitCourses:Record<string,string>,catalog:CourseLabel[]):PracticeHistoryRow[]{
  const byAssignment=new Map(assignments.map(a=>[a.assignment_version_id,a]));
  if(byAssignment.size!==assignments.length||new Set(items.map(item=>item.practice_attempt_id)).size!==items.length)throw new Error('INVALID_PRACTICE_HISTORY');
  return items.map(item=>{
    const assignment=byAssignment.get(item.assignment_version_id);
    if(!assignment)throw new Error('INCOMPLETE_PRACTICE_HISTORY');
    const course=catalog.find(c=>c.id===unitCourses[assignment.unit_version_id]);
    const checks=new Map(item.self_checks.map(check=>[check.rubric_item_id,check.met]));
    const rubric=assignment.rubric_items;
    if(!course||checks.size!==item.self_checks.length||checks.size!==rubric.length||
        new Set(rubric.map(r=>r.rubric_item_id)).size!==rubric.length||rubric.some(r=>typeof checks.get(r.rubric_item_id)!=='boolean'))throw new Error('INVALID_PRACTICE_HISTORY');
    const confirmed=rubric.filter(r=>r.required).every(r=>checks.get(r.rubric_item_id)===true);
    if(item.self_confirmed!==confirmed)throw new Error('INVALID_PRACTICE_HISTORY');
    const detail=rubric.map(r=>({description:r.description,met:checks.get(r.rubric_item_id)!,required:r.required}));
    return {id:item.practice_attempt_id,course_title:course.title,course_version:course.version,confirmed,
      checked_count:detail.filter(check=>check.met).length,item_count:detail.length,checks:detail};
  });
}
