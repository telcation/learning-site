import { rateLimitMessage } from './api-error';
import { useState } from 'react';
import { referenceBatch } from './github-reference';
import type { MergeResult } from './github-reference';
import { encodeReferenceFile, MAX_REFERENCE_BYTES, parseReferenceFile, practiceIdsForTransfer, requireOwnedAttempts } from './github-transfer';
import type { ReferenceFile } from './github-transfer';
import type { PracticeRequest } from './practice';

export function GitHubReferenceTransfer({credentialId,recordId,request,onImported}:{credentialId:string;recordId:string;request:PracticeRequest;onImported:()=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [pending,setPending]=useState<{file:ReferenceFile;counts:MergeResult}>();
  async function verifyRecord(){
    const current=await request<{record_id:string}>('/records/me');
    if(current.record_id!==recordId)throw new Error('OWNER_CHANGED');
  }
  async function exportFile(){
    setBusy(true);setError('');setNotice('');setPending(undefined);
    try{
      await verifyRecord();
      const ids=await practiceIdsForTransfer(request);
      const {entries}=await referenceBatch(credentialId,recordId,ids);
      if(!entries.length){setNotice('この端末に書き出せる保存済み参照はありません。');return;}
      const raw=encodeReferenceFile(recordId,entries);
      const url=URL.createObjectURL(new Blob([raw],{type:'application/json;charset=utf-8'}));
      try{const a=document.createElement('a');a.href=url;a.download='learning-github-references.json';a.click();}
      finally{window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
      setNotice(`${entries.length}件の参照の書出し操作を行いました。実際にファイルが保存されたことをご自身で確認してください。`);
    }catch(error){setError(rateLimitMessage(error)??'書き出せませんでした。通信・端末の保存領域・現在の学習キーを確認してください。対応上限は参照1,000件、実践履歴10,000件です。');}
    finally{setBusy(false);}
  }
  async function inspect(file:File){
    setBusy(true);setError('');setNotice('');setPending(undefined);
    try{
      if(file.size>MAX_REFERENCE_BYTES)throw new Error('REFERENCE_FILE_TOO_LARGE');
      const parsed=parseReferenceFile(await file.text(),recordId);
      await verifyRecord();
      requireOwnedAttempts(parsed,await practiceIdsForTransfer(request));
      const {entries}=await referenceBatch(credentialId,recordId,parsed.entries.map(e=>e.practice_attempt_id));
      const existing=new Map(entries.map(e=>[e.practice_attempt_id,e]));
      const counts:MergeResult={added:0,identical:0,conflicts:0};
      for(const entry of parsed.entries){
        const saved=existing.get(entry.practice_attempt_id);
        if(!saved)counts.added++;
        else if(saved.repository===entry.repository&&saved.sha===entry.sha)counts.identical++;
        else counts.conflicts++;
      }
      setPending({file:parsed,counts});
    }catch(error){setError(rateLimitMessage(error)??'取り込めるファイルではありません。同じ学習コードで再開した記録用の参照ファイルか確認してください。別記録・不明な実践・不正形式は取り込まず、上限は512KiB・参照1,000件です。通信や保存領域の問題でも確認を中止します。');}
    finally{setBusy(false);}
  }
  async function importFile(){
    if(!pending)return;
    setBusy(true);setError('');setNotice('');
    try{
      await verifyRecord();
      requireOwnedAttempts(pending.file,await practiceIdsForTransfer(request));
      const {merge}=await referenceBatch(credentialId,recordId,pending.file.entries.map(e=>e.practice_attempt_id),pending.file.entries);
      setNotice(`取込み完了：追加 ${merge.added}件、同一 ${merge.identical}件、競合のため端末側を維持 ${merge.conflicts}件。`);
      setPending(undefined);onImported();
    }catch(error){setError(rateLimitMessage(error)??'取込みの完了を確認できませんでした。履歴を開き直して確認してください。再取込みしても既存の参照は上書きしません。');}
    finally{setBusy(false);}
  }
  return <details className="github-reference"><summary>書出し・取込みの操作を開く</summary>
    <p>保存済み参照をJSONファイルに書き出し、別の個人端末で同じ学習コードによる再開後に取り込めます。自動同期は行いません。</p>
    <p>このファイルは暗号化されず、リポジトリURL・SHA・記録IDを含みます。学習キーや回答履歴は含みません。ご自身で保管し、共有フォルダーや公開リポジトリには置かないでください。学習コードは別に保管してください。</p>
    <fieldset disabled={busy}><legend>参照ファイル</legend>
      <button className="secondary" onClick={()=>void exportFile()}>保存済み参照をファイルに書き出す</button>
      <label>この端末に取り込むファイル<input type="file" accept=".json,application/json" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void inspect(file);}}/></label>
    </fieldset>
    {pending&&<section aria-label="GitHub参照の取込み確認"><p>ファイル内 {pending.file.entries.length}件：追加予定 {pending.counts.added}件、同一 {pending.counts.identical}件、競合 {pending.counts.conflicts}件。</p>
      <p>既存の参照は上書きしません。競合する参照は、取込み後に各記録で確認・編集できます。実行時に件数を再判定します。各欄の未保存の入力は表示し直すため、先に保存してください。</p>
      <button className="primary" disabled={busy||!pending.file.entries.length} onClick={()=>void importFile()}>確認した参照をこの端末に取り込む</button>
      <button className="text-button" disabled={busy} onClick={()=>setPending(undefined)}>取込みをキャンセル</button>
    </section>}
    {busy&&<p role="status">参照を確認・処理しています。履歴が多い場合は、アクセス制限の待ち時間を挟んで確認します。</p>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </details>;
}
