import { deviceDatabase } from './credential.ts';

export type GitHubReference = {repository:string;sha:string};
export type ReferenceEntry = GitHubReference & {practice_attempt_id:string};
export function parseGitHubReference(repository:string, sha:string):GitHubReference {
  const raw=repository.trim(), commit=sha.trim().toLowerCase();
  // Repository pages only. No tokens, credentials, query, fragment or code paths.
  const match=/^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9_.-]{1,100})\/?$/.exec(raw);
  if(!match||['.','..'].includes(match[2])||commit&&!/^[0-9a-f]{40}$/.test(commit))throw new Error('INVALID_REFERENCE');
  return {repository:`https://github.com/${match[1]}/${match[2]}`,sha:commit};
}
function referenceKey(recordId:string,attemptId:string) {
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(!uuid.test(recordId)||!uuid.test(attemptId))throw new Error('INVALID_REFERENCE');
  return `github:${recordId}:${attemptId}`;
}

export type MergeResult={added:number;identical:number;conflicts:number};
// A single transaction gives export a consistent view and makes import all-or-nothing.
// Existing local entries always win; importing a file never overwrites an edit.
export async function referenceBatch(credentialId:string,recordId:string,attemptIds:string[],
  incoming?:ReferenceEntry[]):Promise<{entries:ReferenceEntry[];merge:MergeResult}> {
  if(new Set(attemptIds).size!==attemptIds.length||attemptIds.length>10000)throw new Error('INVALID_REFERENCE');
  const keys=attemptIds.map(id=>referenceKey(recordId,id));
  const wanted=new Map<string,GitHubReference>();
  for(const entry of incoming??[]){
    if(!attemptIds.includes(entry.practice_attempt_id)||wanted.has(entry.practice_attempt_id))throw new Error('INVALID_REFERENCE');
    wanted.set(entry.practice_attempt_id,parseGitHubReference(entry.repository,entry.sha));
  }
  const db=await deviceDatabase();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('device',incoming?'readwrite':'readonly'),store=tx.objectStore('device');
    const entries:ReferenceEntry[]=[],merge:MergeResult={added:0,identical:0,conflicts:0};
    let failure=new Error('STORAGE_UNAVAILABLE');
    tx.onerror=tx.onabort=()=>reject(failure);
    tx.oncomplete=()=>resolve({entries,merge});
    const owner=store.get('owner');
    owner.onsuccess=()=>{
      if(owner.result?.id!==credentialId){failure=new Error('OWNER_CHANGED');tx.abort();return;}
      keys.forEach((key,i)=>{
        const req=store.get(key),id=attemptIds[i];
        req.onsuccess=()=>{
          try{
            const existing=req.result===undefined?undefined:parseGitHubReference(req.result.repository,req.result.sha);
            const proposed=wanted.get(id);
            if(proposed){
              if(existing){
                if(existing.repository===proposed.repository&&existing.sha===proposed.sha)merge.identical++;
                else merge.conflicts++;
              }else{store.put(proposed,key);merge.added++;}
            }
            const value=existing??proposed;
            if(value)entries.push({practice_attempt_id:id,...value});
          }catch{failure=new Error('INVALID_REFERENCE');tx.abort();}
        };
      });
    };
  });}finally{db.close();}
}

// The owner check and local write share a transaction with credential removal.
// A pending editor cannot recreate a reference after the device was forgotten.
export async function localReference(credentialId:string,recordId:string,attemptId:string,
  operation:'read'|'save'|'delete',value?:GitHubReference):Promise<GitHubReference|undefined> {
  const key=referenceKey(recordId,attemptId);
  const checked=operation==='save'?parseGitHubReference(value!.repository,value!.sha):undefined;
  const db=await deviceDatabase();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('device',operation==='read'?'readonly':'readwrite');
    const store=tx.objectStore('device');
    let result:GitHubReference|undefined, failure=new Error('STORAGE_UNAVAILABLE');
    tx.onerror=tx.onabort=()=>reject(failure);
    tx.oncomplete=()=>resolve(result);
    const owner=store.get('owner');
    owner.onsuccess=()=>{
      if(owner.result?.id!==credentialId){failure=new Error('OWNER_CHANGED');tx.abort();return;}
      if(operation==='save'){store.put(checked,key);result=checked;}
      else if(operation==='delete')store.delete(key);
      else {
        const req=store.get(key);
        req.onsuccess=()=>{
          if(req.result!==undefined){
            try{result=parseGitHubReference(req.result.repository,req.result.sha);}
            catch{failure=new Error('INVALID_REFERENCE');tx.abort();}
          }
        };
      }
    };
  });}finally{db.close();}
}
