export type UnitProgress = {unit_version_id:string;state:string;correct_count:number;question_count:number;review_pending_count:number};
export type CourseOutline = {course_version_id:string;unit_ids:string[]};
export type CourseProgress = {course_version_id:string;correct_count:number;question_count:number;
  review_pending_count:number;unit_count:number;completed_units:number;completed:boolean;started:boolean;percent:number};
export type ProgressSummary = {courses:CourseProgress[];course_count:number;completed_courses:number;
  correct_count:number;question_count:number;review_pending_count:number};

export function summarizeProgress(outlines:CourseOutline[], progress:UnitProgress[]):ProgressSummary {
  const units=new Map(progress.map(unit=>[unit.unit_version_id,unit]));
  if(units.size!==progress.length)throw new Error('INVALID_PROGRESS');
  const seenCourses=new Set<string>(), seenUnits=new Set<string>();
  const courses=outlines.map(outline=>{
    if(seenCourses.has(outline.course_version_id)||!outline.unit_ids.length)throw new Error('INVALID_PROGRESS');
    seenCourses.add(outline.course_version_id);
    let correct=0, questions=0, review=0, completed=0, started=false;
    for(const id of outline.unit_ids){
      const unit=units.get(id);
      if(!unit||seenUnits.has(id))throw new Error('INCOMPLETE_PROGRESS');
      seenUnits.add(id);
      for(const n of [unit.correct_count,unit.question_count,unit.review_pending_count]){
        if(!Number.isInteger(n)||n<0)throw new Error('INVALID_PROGRESS');
      }
      if(unit.correct_count>unit.question_count||unit.review_pending_count>unit.question_count)throw new Error('INVALID_PROGRESS');
      correct+=unit.correct_count;questions+=unit.question_count;review+=unit.review_pending_count;
      if(unit.state==='completed')completed++;
      if(unit.state!=='not_started'||unit.correct_count>0||unit.review_pending_count>0)started=true;
    }
    return {course_version_id:outline.course_version_id,correct_count:correct,question_count:questions,
      review_pending_count:review,unit_count:outline.unit_ids.length,completed_units:completed,
      completed:completed===outline.unit_ids.length,started,percent:questions?Math.round(correct/questions*100):0};
  });
  return {courses,course_count:courses.length,completed_courses:courses.filter(c=>c.completed).length,
    correct_count:courses.reduce((sum,c)=>sum+c.correct_count,0),question_count:courses.reduce((sum,c)=>sum+c.question_count,0),
    review_pending_count:courses.reduce((sum,c)=>sum+c.review_pending_count,0)};
}
