export class ApiError extends Error {
  code:string;
  status:number;
  constructor(code:string,status:number){super(code);this.code=code;this.status=status;}
}
export function accessFailure(e:unknown):'expired'|'unauthorized'|'none' {
  return e instanceof ApiError ? e.status===410?'expired':e.status===401?'unauthorized':'none' : 'none';
}
export function errorText(e:unknown):string {
  if(accessFailure(e)==='expired')return 'この学習記録は保存期限を過ぎたため利用できません。同じ学習コードや暗号化復旧ファイルでは再開できません。新しい学習記録は自動作成していません。';
  if(accessFailure(e)==='unauthorized')return 'この学習キーでは記録にアクセスできません。キー更新後は新しいコードを使ってください。記録の削除や期限後の消去でも同じ応答になります。削除・消去済みの記録はコードでも復旧できません。新しい記録は自動作成していません。';
  if(e instanceof ApiError&&e.code==='REVISION_CONFLICT')return '別の操作で記録が更新されました。確認画面を閉じて、もう一度やり直してください。';
  if(e instanceof Error&&e.message==='INVALID_CODE')return '学習コードの文字・長さ・検査値を確認してください。';
  if(e instanceof ApiError&&e.code==='REQUIREMENTS_UNMET')return 'まだ未達成の確認問題があります。すべての問題に正解してから修了を確認してください。';
  if(e instanceof Error&&e.message==='STORAGE_UNAVAILABLE')return 'このブラウザーに学習キーを保存できません。保存を許可したブラウザーをご利用ください。';
  return '処理が完了しませんでした。通信状態を確認して、もう一度お試しください。';
}
