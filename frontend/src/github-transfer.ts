import { parseGitHubReference } from './github-reference.ts';
import type { ReferenceEntry } from './github-reference.ts';
import type { PracticeRequest } from './practice.ts';
import { readPracticePage } from './practice.ts';

export const MAX_REFERENCE_BYTES=512*1024;
export const MAX_REFERENCE_ENTRIES=1000;
export type ReferenceFile={format:'learning-github-references';version:1;record_id:string;entries:ReferenceEntry[]};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function fields(value:unknown,keys:string[]):value is Record<string,unknown> {
  return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).sort().join(',')===[...keys].sort().join(',');
}
export function parseReferenceFile(raw:string,recordId:string):ReferenceFile {
  if(new TextEncoder().encode(raw).length>MAX_REFERENCE_BYTES)throw new Error('REFERENCE_FILE_TOO_LARGE');
  const file:unknown=JSON.parse(raw);
  if(!fields(file,['format','version','record_id','entries'])||file.format!=='learning-github-references'||file.version!==1||
    typeof file.record_id!=='string'||!uuid.test(file.record_id)||file.record_id!==recordId||
    !Array.isArray(file.entries)||file.entries.length>MAX_REFERENCE_ENTRIES)throw new Error('INVALID_REFERENCE_FILE');
  const seen=new Set<string>();
  const entries=file.entries.map((item:unknown)=>{
    if(!fields(item,['practice_attempt_id','repository','sha'])||typeof item.practice_attempt_id!=='string'||!uuid.test(item.practice_attempt_id)||
      seen.has(item.practice_attempt_id)||typeof item.repository!=='string'||typeof item.sha!=='string')throw new Error('INVALID_REFERENCE_FILE');
    seen.add(item.practice_attempt_id);
    return {practice_attempt_id:item.practice_attempt_id,...parseGitHubReference(item.repository,item.sha)};
  });
  return {format:'learning-github-references',version:1,record_id:recordId,entries};
}
export function encodeReferenceFile(recordId:string,entries:ReferenceEntry[]):string {
  // Construct allowed fields explicitly; incidental object properties and keys never get exported.
  const raw=JSON.stringify({format:'learning-github-references',version:1,record_id:recordId,
    entries:entries.map(e=>({practice_attempt_id:e.practice_attempt_id,repository:e.repository,sha:e.sha}))},null,2);
  return JSON.stringify(parseReferenceFile(raw,recordId),null,2)+'\n';
}

export async function practiceIdsForTransfer(request:PracticeRequest):Promise<string[]> {
  const ids=new Set<string>(),cursors=new Set<string>();let cursor:string|undefined;
  for(let pageNo=0;pageNo<100;pageNo++){
    const page=await readPracticePage(request,'/practice-attempts?limit=100'+(cursor?'&after_id='+encodeURIComponent(cursor):''));
    if(!Array.isArray(page.items)||page.items.length>100||typeof page.has_more!=='boolean')throw new Error('INCOMPLETE_HISTORY');
    for(const item of page.items){
      if(!uuid.test(item.practice_attempt_id)||ids.has(item.practice_attempt_id))throw new Error('INCOMPLETE_HISTORY');
      ids.add(item.practice_attempt_id);
    }
    if(!page.has_more){if(page.next_after_id!==null)throw new Error('INCOMPLETE_HISTORY');return [...ids];}
    if(!page.items.length||!page.next_after_id||!uuid.test(page.next_after_id)||cursors.has(page.next_after_id))throw new Error('INCOMPLETE_HISTORY');
    cursor=page.next_after_id;cursors.add(cursor);
  }
  throw new Error('HISTORY_TOO_LARGE');
}

export function requireOwnedAttempts(file:ReferenceFile,ownedIds:string[]){
  const owned=new Set(ownedIds);
  if(file.entries.some(e=>!owned.has(e.practice_attempt_id)))throw new Error('UNKNOWN_PRACTICE_ATTEMPT');
}
