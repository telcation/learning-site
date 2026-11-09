import { ApiError } from './api-error.ts';
export type SelfCheck={rubric_item_id:string;met:boolean};
export type Assignment={assignment_version_id:string;unit_version_id:string;requirements:string;target_path:string;
  rubric_items:{rubric_item_id:string;ordinal:number;required:boolean;description:string}[]};
export type AssignmentPage={items:{assignment_version_id:string;unit_version_id:string;required:boolean}[];next_after_id:string|null;has_more:boolean};
export type PracticeAttempt={practice_attempt_id:string;assignment_version_id:string;sequence_no:number;self_confirmed:boolean;self_checks:SelfCheck[];revision:number};
export type PracticeHistoryPage={items:PracticeAttempt[];has_more:boolean;next_after_id:string|null};
export type PracticeRequest=<T>(path:string)=>Promise<T>;

// Only paginated GET reads may retry. Never use this for answer/save requests.
export async function readPracticePage(request:PracticeRequest,path:string,
  pause:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))):Promise<PracticeHistoryPage> {
  if(!/^\/practice-attempts\?limit=100(?:&after_id=[0-9a-f-]+)?$/.test(path))throw new Error('INVALID_PRACTICE_READ');
  for(let attempt=0;;attempt++){
    try{return await request<PracticeHistoryPage>(path);}
    catch(error){
      if(!(error instanceof ApiError)||error.status!==429||attempt>=2||
        typeof error.retryAfter!=='number'||!Number.isInteger(error.retryAfter)||error.retryAfter<1||error.retryAfter>60)throw error;
      await pause(error.retryAfter*1000);
    }
  }
}

export async function latestPractice(request:PracticeRequest, assignmentId:string):Promise<PracticeAttempt|undefined> {
  let cursor:string|undefined;
  const seen=new Set<string>();
  while(true){
    const page=await readPracticePage(request,'/practice-attempts?limit=100'+(cursor?'&after_id='+encodeURIComponent(cursor):''));
    const found=page.items.find(item=>item.assignment_version_id===assignmentId);
    if(found)return found;
    if(!page.has_more)return undefined;
    if(!page.next_after_id||seen.has(page.next_after_id))throw new Error('PRACTICE_HISTORY_INCOMPLETE');
    cursor=page.next_after_id;seen.add(cursor);
  }
}
