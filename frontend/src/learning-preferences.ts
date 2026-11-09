export type LearningPreference={study_route:'practice'|'fe';preferred_language:'java'|'python'|null};

export function prioritizeCourses<T extends {language:'java'|'python'|null}>(courses:T[],preference:LearningPreference):T[]{
  const rank=(course:T)=>preference.study_route==='fe'?(course.language===null?0:course.language===preference.preferred_language?1:2):
    course.language!==null&&course.language===preference.preferred_language?0:course.language!==null?1:2;
  return courses.map((course,index)=>({course,index})).sort((a,b)=>rank(a.course)-rank(b.course)||a.index-b.index).map(item=>item.course);
}
