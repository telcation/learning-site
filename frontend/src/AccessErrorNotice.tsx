export function AccessErrorNotice({message,kind,temporary,onRestore,onBackup,onEnd}:{message:string;
  kind:'expired'|'unauthorized'|'none';temporary:boolean;onRestore:()=>void;onBackup:()=>void;onEnd:()=>void}) {
  return <div className="error" role="alert"><p>{message}</p>
    {kind!=='none'&&<>
      <p>{temporary?'別の記録を使う場合は、その学習コードを取り込んでください。一時利用を終える場合は「離席・終了する」を押してください。':
        '別の有効な学習コードがあれば取り込めます。新しい記録を始める場合は、バックアップ画面の「この端末の記憶を解除」で現在の端末保存を解除してからコースを選び直してください。端末内のGitHub参照も消えるため、解除してよいか確認してください。'}
      </p>
      <button onClick={onRestore}>{kind==='unauthorized'?'更新後・別の学習コードを使う':'別の学習コードを使う'}</button>
      <button onClick={temporary?onEnd:onBackup}>{temporary?'離席・終了する':'バックアップ画面を開く'}</button>
    </>}
  </div>;
}
