import { deviceDatabase } from './credential.ts';

export type GitHubReference = {repository:string;sha:string};
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
