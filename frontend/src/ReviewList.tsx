import React from 'react';
import type { ReviewCourse, ReviewItem } from './review';

export function ReviewList({courses,catalog,busy,onSelect,onRefresh}:{courses:ReviewCourse[]|undefined;
  catalog:{id:string;title:string;version:number}[];busy:boolean;onSelect:(item:ReviewItem)=>void;onRefresh:()=>void}) {
  const count=courses?.reduce((sum,course)=>sum+course.items.length,0);
  return <section className="panel review-list"><div className="section-heading"><h2>全コースの復習一覧</h2><button className="secondary" disabled={busy} onClick={onRefresh}>復習一覧を更新する</button></div>
    <p>一度でも誤答した問題を表示します。その後に正解しても一覧に残るので、苦手だった問題を繰り返し復習できます。未回答と一度も誤答していない問題は含みません。修了済みのコースも復習できます。</p>
    {courses===undefined?<p role="status">{busy?'復習一覧を読み込んでいます。':'復習一覧を取得できていません。「復習一覧を更新する」で読み込んでください。'}</p>:<><p role="status">誤答したことがある問題：{count}問</p>{count===0&&<p>これまでに誤答した問題はありません。未回答の問題には「学習する」から取り組めます。</p>}{courses.map(course=>{const info=catalog.find(c=>c.id===course.course_id);return <section className="review-course" key={course.course_id}><h3>{info?.title||'コース情報を確認できません'} <small>教材 第{info?.version}版</small></h3>{course.items.length===0?<p>このコースでは、これまでに誤答した問題はありません。</p>:<ul>{course.items.map(item=><li key={item.question.question_version_id}><div><span className="tag">{item.question.kind==='multi'?'複数選択':item.question.kind==='order'?'並べ替え':'単一選択'}</span><p>{item.question.prompt}</p><p><strong>{item.latest_correct?'直近の回答は正解':'直近の回答は誤答'}</strong></p><small>これまでの誤答：{item.incorrect_count}回 / 回答：{item.attempt_count}回</small></div><button className="secondary" disabled={busy} onClick={()=>onSelect(item)}>この問題を復習する</button></li>)}</ul>}</section>;})}</>}
  </section>;
}


