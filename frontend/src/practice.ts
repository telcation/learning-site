export type SelfCheck={rubric_item_id:string;met:boolean};
export type Assignment={assignment_version_id:string;unit_version_id:string;requirements:string;target_path:string;
  rubric_items:{rubric_item_id:string;ordinal:number;required:boolean;description:string}[]};
export type AssignmentPage={items:{assignment_version_id:string;unit_version_id:string;required:boolean}[];next_after_id:string|null;has_more:boolean};
export type PracticeAttempt={practice_attempt_id:string;assignment_version_id:string;sequence_no:number;self_confirmed:boolean;self_checks:SelfCheck[];revision:number};
type HistoryPage={items:PracticeAttempt[];has_more:boolean;next_after_id:string|null};
export type PracticeRequest=<T>(path:string)=>Promise<T>;

export async function latestPractice(request:PracticeRequest, assignmentId:string):Promise<PracticeAttempt|undefined> {
  let cursor:string|undefined;
  const seen=new Set<string>();
  while(true){
    const page=await request<HistoryPage>('/practice-attempts?limit=100'+(cursor?'&after_id='+encodeURIComponent(cursor):''));
    const found=page.items.find(item=>item.assignment_version_id===assignmentId);
    if(found)return found;
    if(!page.has_more)return undefined;
    if(!page.next_after_id||seen.has(page.next_after_id))throw new Error('PRACTICE_HISTORY_INCOMPLETE');
    cursor=page.next_after_id;seen.add(cursor);
  }
}
