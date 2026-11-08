import React, { useState } from 'react';
import type { Credential } from './credential';
import { encryptRecovery, decryptRecovery, MAX_RECOVERY_BYTES } from './recovery';

type Props = {mode:'export'|'import'; credential?:Credential; onClose:()=>void;
  onRestore:(credential:Credential)=>Promise<void>; onExported:(credential:Credential)=>Promise<void>};

export function RecoveryDialog({mode, credential, onClose, onRestore, onExported}: Props) {
  const [password,setPassword]=useState(''), [confirmation,setConfirmation]=useState('');
  const [file,setFile]=useState<File>(), [busy,setBusy]=useState(false), [message,setMessage]=useState('');
  const exporting=mode==='export';
  async function run() {
    setBusy(true);setMessage('');
    let stage='crypto';
    try {
      if(exporting) {
        if(!credential)throw new Error();
        if([...password].length<12||new TextEncoder().encode(password).length>1024){setMessage('パスワードは12文字以上、UTF-8で1024バイト以内にしてください。');return;}
        if(password!==confirmation){setMessage('2つのパスワードが一致しません。');return;}
        const content=await encryptRecovery(credential,password,window.location.origin);
        const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));
        try {const a=document.createElement('a');a.href=url;a.download='learning-recovery.json';a.click();}
        finally {window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
        stage='storage';await onExported(credential);
        setMessage('ファイルの書き出し操作を行いました。ダウンロード先に実際に保存されたことを確認してください。この画面を閉じ、復旧画面から保存したファイルを取り込んで確認できます。');
      } else {
        if(!file||file.size>MAX_RECOVERY_BYTES){setMessage('16KiB以内の復旧ファイルを選択してください。');return;}
        const restored=await decryptRecovery(await file.text(),password,window.location.origin);
        stage='server';await onRestore(restored);onClose();
      }
    } catch {
      setMessage(stage==='crypto' ? '処理できませんでした。パスワード、ファイルの内容、保存元のサイトを確認してください。' :
        stage==='server' ? '復旧先を確認・保存できませんでした。通信状態や、キーの失効・記録の期限・削除の有無を確認してください。' :
        '書き出し後の端末状態を保存できませんでした。ダウンロード先にファイルがあるか確認してください。');
    } finally {setPassword('');setConfirmation('');setBusy(false);}
  }
  return <div className="overlay"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
    <h2 id="recovery-title">{exporting?'暗号化復旧ファイルを保存する':'暗号化復旧ファイルから再開する'}</h2>
    <p>学習キーだけをパスワードで暗号化したファイルです。学習履歴のコピーやGitHub情報は含みません。同じHTTPSサイトで使用します。キー更新後の旧ファイルや、削除済み記録の復旧には使えません。</p>
    <p>パスワードとファイルはサーバーへ送りません。パスワードを忘れると、このファイルは開けません。ファイルとパスワードは別々に保管してください。</p>
    {!exporting&&<label className="recovery-field">保存した復旧ファイル<input type="file" accept=".json,application/json" disabled={busy} onChange={e=>setFile(e.target.files?.[0])}/></label>}
    <label className="recovery-field">{exporting?'このファイル用のパスワード（12文字以上）':'ファイルを保存したときのパスワード'}<input type="password" autoComplete={exporting?'new-password':'off'} value={password} disabled={busy} onChange={e=>setPassword(e.target.value)}/></label>
    {exporting&&<label className="recovery-field">確認のため同じパスワードをもう一度入力<input type="password" autoComplete="new-password" value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)}/></label>}
    <p>大文字・小文字・空白も区別します。処理後は入力したパスワードを画面から消去します。</p>
    {message&&<p role="status">{message}</p>}{busy&&<p role="status">処理中です…</p>}
    <button className="secondary" disabled={busy} onClick={onClose}>閉じる</button>
    <button className="primary" disabled={busy||!password||(exporting?!confirmation:!file)} onClick={()=>void run()}>{exporting?'暗号化してファイルに保存':'ファイルを復号して同じ学習記録を確認する'}</button>
    {exporting&&<p>実際に保存したファイルを確認するには、一度閉じて「学習記録を復旧する」→「暗号化復旧ファイルを取り込む」から、保存したファイルとパスワードで再開してください。</p>}
  </section></div>;
}
