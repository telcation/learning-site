import { useEffect, useState } from 'react';
import { localReference, parseGitHubReference } from './github-reference';
import type { GitHubReference } from './github-reference';

export function GitHubReferenceEditor({credentialId,recordId,attemptId}:{credentialId:string;recordId:string;attemptId:string}) {
  const [repository,setRepository]=useState(''),[sha,setSha]=useState('');
  const [saved,setSaved]=useState<GitHubReference>(),[busy,setBusy]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{let active=true;
    void localReference(credentialId,recordId,attemptId,'read').then(value=>{if(active){setSaved(value);setRepository(value?.repository??'');setSha(value?.sha??'');}})
      .catch(()=>{if(active)setError('端末内の参照を読み込めませんでした。保存領域と現在の学習キーを確認してください。');})
      .finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[credentialId,recordId,attemptId]);
  async function change(remove=false){
    setError('');setNotice('');
    let value:GitHubReference|undefined;
    if(!remove){try{value=parseGitHubReference(repository,sha);}catch{setError('https://github.com/所有者/リポジトリ の形式で入力してください。コミットSHAは空欄または40桁の16進数です。クエリ・認証情報・ファイルのパスは含められません。');return;}}
    setBusy(true);
    try{
      await localReference(credentialId,recordId,attemptId,remove?'delete':'save',value);
      const readback=await localReference(credentialId,recordId,attemptId,'read');
      if(readback?.repository!==value?.repository||readback?.sha!==value?.sha)throw new Error('STORAGE_UNAVAILABLE');
      setSaved(readback);setRepository(readback?.repository??'');setSha(readback?.sha??'');setNotice(remove?'この端末の参照を削除しました。':'この端末に参照を保存しました。');
    }catch{setError('保存・削除の完了を確認できませんでした。履歴を開き直して確認してください。');}
    finally{setBusy(false);}
  }
  return <details className="github-reference"><summary>この端末のGitHub参照（任意）</summary>
    <p>この実践記録に対応する参照を、このブラウザー内だけに保存します。サーバーへ送らず、別端末には同期しません。学習コード・復旧ファイルには含まれず、端末の記憶解除で消えます。実行結果の検証や作者の証明にはなりません。</p>
    <fieldset disabled={busy}><legend>GitHub参照</legend>
      <label>リポジトリURL<input type="text" autoComplete="off" spellCheck={false} maxLength={160} value={repository} onChange={e=>setRepository(e.target.value)} placeholder="https://github.com/owner/repository"/></label>
      <label>コミットSHA（任意・40桁）<input type="text" autoComplete="off" spellCheck={false} maxLength={40} value={sha} onChange={e=>setSha(e.target.value)}/></label>
      <button className="secondary" onClick={()=>void change()}>参照をこの端末に保存</button>
      <button className="text-button" disabled={!saved} onClick={()=>void change(true)}>この端末の参照を削除</button>
    </fieldset>
    {saved&&<p><a href={saved.repository+(saved.sha?'/commit/'+saved.sha:'')} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">保存した参照をGitHubで開く（外部サイト）</a></p>}
    <p>入力・保存時にGitHubへ接続しません。リンクを開くとGitHubへ移動します。学習キーや秘密情報を入力しないでください。</p>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </details>;
}
