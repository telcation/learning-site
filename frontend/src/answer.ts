export type AnswerQuestion = {question_version_id:string; kind:'single'|'multi'|'order';
  prompt:string; choices:{id:string;text:string}[]};
export const initialAnswer = (q:AnswerQuestion) => q.kind==='order' ? q.choices.map(c=>c.id) : [];
export function toggleAnswer(selected:string[], id:string) {
  return selected.includes(id) ? selected.filter(value=>value!==id) : [...selected,id];
}
export function moveAnswer(selected:string[], index:number, offset:-1|1) {
  const next=index+offset;
  if(index<0||index>=selected.length||next<0||next>=selected.length)return selected;
  const result=[...selected];[result[index],result[next]]=[result[next],result[index]];return result;
}
