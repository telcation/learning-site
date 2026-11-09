import { rateLimitMessage } from './api-error';
import React, { useEffect, useState } from 'react';
import { latestPractice } from './practice';
import type { Assignment, AssignmentPage, PracticeAttempt, PracticeRequest, SelfCheck } from './practice';

export function PracticePanel({unitId,request,onSave,busy,onOpenHistory}:{unitId:string;request:PracticeRequest;busy:boolean;onOpenHistory:()=>void;
  onSave:(assignmentId:string,checks:SelfCheck[])=>Promise<PracticeAttempt>}) {
  const [assignment,setAssignment]=useState<Assignment>(), [checks,setChecks]=useState<Record<string,boolean>>({});
  const [latest,setLatest]=useState<PracticeAttempt>(), [loading,setLoading]=useState(true), [saving,setSaving]=useState(false), [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    async function read(){
      try{
        const page=await request<AssignmentPage>(`/units/${unitId}/assignments`);
        if(page.has_more||page.items.length!==1)throw new Error('UNSUPPORTED_ASSIGNMENTS');
        const a=await request<Assignment>(`/assignments/${page.items[0].assignment_version_id}`);
        const previous=await latestPractice(request,a.assignment_version_id);
        if(active){setAssignment(a);setLatest(previous);setChecks(Object.fromEntries(a.rubric_items.map(item=>[item.rubric_item_id,previous?.self_checks.find(check=>check.rubric_item_id===item.rubric_item_id)?.met??false])));}
      }catch(error){if(active)setError(rateLimitMessage(error)??'実践課題を読み込めませんでした。いったん学習ホームへ戻り、「学習する」を開き直して確認してください。');}
      finally{if(active)setLoading(false);}
    }
    void read();return()=>{active=false;};
  },[unitId]);
  async function save(){
    if(!assignment)return;
    setSaving(true);setError('');
    try{const result=await onSave(assignment.assignment_version_id,assignment.rubric_items.map(item=>({rubric_item_id:item.rubric_item_id,met:checks[item.rubric_item_id]??false})));setLatest(result);}
    catch(error){setError(rateLimitMessage(error)??'保存の完了を確認できませんでした。通信状態を確認し、いったん学習ホームへ戻って「学習する」を開き直し、前回の自己確認を確かめてください。');}
    finally{setSaving(false);}
  }
  return <section className="panel practice-panel"><h2>実践課題を手元で確かめる（任意）</h2><p>自分のPCや手元のメモで取り組み、確認できた項目にチェックしてください。この課題は単元の修了条件には含みません。</p><p>ソースコード・実行結果・GitHubのURLを送る欄はありません。保存するのは各項目の確認結果だけで、サーバーが実行や正しさを検証した記録ではありません。</p>
    {loading&&<p role="status">実践課題を読み込んでいます。</p>}{error&&<p role="alert">{error}</p>}
    {assignment&&<><p className="practice-requirements">{assignment.requirements}</p><p>手元の保存先の例：<code>{assignment.target_path}</code>（サーバーへは送信しません）</p><fieldset disabled={saving||busy}><legend>自分で確認できた項目</legend>{assignment.rubric_items.map(item=><label key={item.rubric_item_id}><input type="checkbox" checked={checks[item.rubric_item_id]??false} onChange={e=>setChecks({...checks,[item.rubric_item_id]:e.target.checked})}/>{item.description}</label>)}</fieldset>
    <button className="primary" disabled={saving||busy} onClick={()=>void save()}>{saving?'保存中…':'現在の確認結果を記録する'}</button><p>未確認の項目があっても途中の状態を記録できます。</p>{latest&&<p role="status">前回の自己確認：{latest.self_confirmed?'全項目を確認済み':'確認途中'}（{latest.self_checks.filter(check=>check.met).length} / {latest.self_checks.length}項目）。この記録は講師評価や自動採点ではありません。</p>}</>}
    <button className="secondary" disabled={saving||busy} onClick={onOpenHistory}>過去の実践記録を見る</button>
  </section>;
}

