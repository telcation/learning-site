import { GitHubReferenceTransfer } from './GitHubReferenceTransfer';
import { GitHubReferenceEditor } from './GitHubReferenceEditor';
import React, { useEffect, useRef, useState } from 'react';
import type { Assignment, PracticeHistoryPage, PracticeRequest } from './practice';
import type { CourseOutline } from './progress-summary';
import { buildPracticeHistoryRows } from './practice-history';
import type { CourseLabel, PracticeHistoryRow } from './practice-history';

export function PracticeHistory({request,credentialId,temporary}:{request:PracticeRequest;credentialId:string;temporary:boolean}) {
  const [referenceVersion,setReferenceVersion]=useState(0);
  const [recordId,setRecordId]=useState<string>(),[recordError,setRecordError]=useState(false);
  const [rows,setRows]=useState<PracticeHistoryRow[]>(), [page,setPage]=useState<PracticeHistoryPage>();
  const [cursors,setCursors]=useState<(string|undefined)[]>([undefined]), [index,setIndex]=useState(0);
  const [loading,setLoading]=useState(true), [error,setError]=useState('');
  const mounted=useRef(true), assignments=useRef(new Map<string,Assignment>());
  async function load(nextCursors:(string|undefined)[],nextIndex:number){
    setLoading(true);setError('');
    try{
      const cursor=nextCursors[nextIndex];
      const [result,home,catalog]=await Promise.all([
        request<PracticeHistoryPage>('/practice-attempts?limit=10'+(cursor?'&after_id='+encodeURIComponent(cursor):'')),
        request<{enrolled_course_version_ids:string[]}>('/learning-home'),request<CourseLabel[]>('/catalog')
      ]);
      if(result.has_more&&!result.next_after_id)throw new Error('INCOMPLETE_HISTORY');
      const outlines=await Promise.all(home.enrolled_course_version_ids.map(id=>request<CourseOutline>(`/courses/${id}/outline`)));
      const unitCourses=Object.fromEntries(outlines.flatMap(outline=>outline.unit_ids.map(id=>[id,outline.course_version_id])));
      const ids=[...new Set(result.items.map(item=>item.assignment_version_id))];
      await Promise.all(ids.map(async id=>{if(!assignments.current.has(id))assignments.current.set(id,await request<Assignment>(`/assignments/${id}`));}));
      const nextRows=buildPracticeHistoryRows(result.items,ids.map(id=>assignments.current.get(id)!),unitCourses,catalog);
      if(mounted.current){setRows(nextRows);setPage(result);setCursors(nextCursors);setIndex(nextIndex);}
    }catch{if(mounted.current)setError('履歴を取得できませんでした。通信状態や学習キーの有効性を確認し、「最新の履歴を読み込む」を試してください。');}
    finally{if(mounted.current)setLoading(false);}
  }
  async function loadRecord(){
    if(temporary)return;
    setRecordError(false);
    try{
      const record=await request<{record_id:string}>('/records/me');
      if(!record.record_id)throw new Error('MISSING_RECORD');
      if(mounted.current)setRecordId(record.record_id);
    }catch{if(mounted.current){setRecordId(undefined);setRecordError(true);}}
  }
  useEffect(()=>{mounted.current=true;void load([undefined],0);void loadRecord();return()=>{mounted.current=false;};},[]);
  return <section className="panel practice-history" aria-busy={loading}><div className="section-heading"><h2>全コースの実践記録</h2><button className="secondary" disabled={loading} onClick={()=>{void load([undefined],0);void loadRecord();}}>最新の履歴を読み込む</button></div>
    <p>本人が保存した自己確認を、新しい記録から10件ずつ表示します。実行結果の検証や講師評価ではありません。過去のチェック内容を振り返れます。</p>
    {!temporary&&<section aria-label="GitHub参照ファイルの移行"><h3>GitHub参照ファイルで端末間を移行する</h3>
      {recordId?<GitHubReferenceTransfer credentialId={credentialId} recordId={recordId} request={request} onImported={()=>setReferenceVersion(v=>v+1)}/>:
        recordError?<p role="alert">学習記録を確認できないため、移行操作を利用できません。「最新の履歴を読み込む」で再試行してください。</p>:<p role="status">移行先の学習記録を確認しています。</p>}
    </section>}
    {temporary&&<p>一時端末ではGitHub参照の入力・保存・読み込みを行いません。</p>}{loading&&<p role="status">履歴を読み込んでいます。</p>}{error&&<p role="alert">{error}</p>}
    {rows===undefined?!loading&&<p>履歴はまだ取得できていません。</p>:<><p>ページ {index+1} · このページの記録 {rows.length}件</p>{rows.length===0&&<p>{index===0?'実践記録はまだありません。「学習する」の実践課題で確認結果を記録すると、ここに表示されます。':'このページに表示できる実践記録はありません。最新の履歴から確認してください。'}</p>}
    <ol className="practice-history-items">{rows.map(row=><li key={row.id}><h3>{row.course_title}</h3><p>教材 第{row.course_version}版 · <strong>{row.confirmed?'自己確認済み':'確認途中'}</strong> · 確認 {row.checked_count} / {row.item_count}項目</p><details><summary>確認項目の内訳を見る</summary><ul>{row.checks.map((check,i)=><li key={i}><strong>{check.met?'確認済み':'未確認'}</strong>：{check.description}{!check.required?'（任意）':''}</li>)}</ul></details>{!temporary&&recordId&&<GitHubReferenceEditor key={recordId+row.id+referenceVersion} credentialId={credentialId} recordId={recordId} attemptId={row.id}/>}</li>)}</ol></>}
    <div className="history-pagination"><button className="secondary" disabled={loading||index===0} onClick={()=>void load(cursors,index-1)}>新しい記録のページへ</button><button className="secondary" disabled={loading||!page?.has_more} onClick={()=>{if(page?.next_after_id)void load([...cursors.slice(0,index+1),page.next_after_id],index+1);}}>過去の記録のページへ</button></div>
  </section>;
}
