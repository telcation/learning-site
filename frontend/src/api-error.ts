export class ApiError extends Error {
  code:string;
  status:number;
  retryAfter:number|undefined;
  constructor(code:string,status:number,retryAfter?:number){super(code);this.code=code;this.status=status;this.retryAfter=retryAfter;}
}
export function parseRetryAfter(value:string|null):number|undefined {
  if(!value||!/^[1-9][0-9]{0,4}$/.test(value))return undefined;
  const seconds=Number(value);
  return seconds<=86400?seconds:undefined;
}
export function rateLimitMessage(e:unknown):string|undefined {
  if(!(e instanceof ApiError)||e.status!==429)return undefined;
  const seconds=e.retryAfter;
  const wait=typeof seconds==='number'&&Number.isInteger(seconds)&&seconds>=1&&seconds<=86400?`${seconds}秒以上`:'少し';
  return `短時間に操作が続いたため、アクセスを一時制限しています。${wait}待ってから画面を再読み込みし、保存済みの結果を確認してください。学習キーを消したり、同じ保存操作を連打したりする必要はありません。`;
}
export function accessFailure(e:unknown):'expired'|'unauthorized'|'none' {
  return e instanceof ApiError ? e.status===410?'expired':e.status===401?'unauthorized':'none' : 'none';
}
export function errorText(e:unknown):string {
  const limited=rateLimitMessage(e);
  if(limited)return limited;
  if(accessFailure(e)==='expired')return 'この学習記録は保存期限を過ぎたため利用できません。同じ学習コードや暗号化復旧ファイルでは再開できません。新しい学習記録は自動作成していません。';
  if(accessFailure(e)==='unauthorized')return 'この学習キーでは記録にアクセスできません。キー更新後は新しいコードを使ってください。記録の削除や期限後の消去でも同じ応答になります。削除・消去済みの記録はコードでも復旧できません。新しい記録は自動作成していません。';
  if(e instanceof ApiError&&e.code==='REVISION_CONFLICT')return '別の操作で記録が更新されました。確認画面を閉じて、もう一度やり直してください。';
  if(e instanceof Error&&e.message==='INVALID_CODE')return '学習コードの文字・長さ・検査値を確認してください。';
  if(e instanceof ApiError&&e.code==='REQUIREMENTS_UNMET')return 'まだ未達成の確認問題があります。すべての問題に正解してから修了を確認してください。';
  if(e instanceof Error&&e.message==='STORAGE_UNAVAILABLE')return 'このブラウザーに学習キーを保存できません。保存を許可したブラウザーをご利用ください。';
  return '処理が完了しませんでした。通信状態を確認して、もう一度お試しください。';
}
