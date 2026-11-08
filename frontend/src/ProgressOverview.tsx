import React from 'react';
import type { ProgressSummary } from './progress-summary';

export function ProgressOverview({summary,catalog,current,onSelect,onRefresh,busy}:{summary:ProgressSummary;
  catalog:{id:string;title:string;version:number}[];current:string;onSelect:(id:string)=>void;onRefresh:()=>void;busy:boolean}) {
  return <section className="panel progress-overview"><div className="section-heading"><h2>全コースの進捗</h2><button className="secondary" disabled={busy} onClick={onRefresh}>最新の進捗を読み込む</button></div>
    <p>この学習キーで登録したコースの一覧です。別端末での学習結果は、最新の進捗を読み込むと反映されます。</p>
    <div className="stats"><div><span>登録コース</span><strong>{summary.course_count}<small> / 修了 {summary.completed_courses}コース</small></strong></div><div><span>確認問題の正答数</span><strong>{summary.correct_count}<small> / {summary.question_count}問</small></strong></div><div><span>直近が誤答の問題</span><strong>{summary.review_pending_count}<small>問</small></strong></div></div>
    <div className="course-grid">{summary.courses.map(course=>{const info=catalog.find(c=>c.id===course.course_version_id);return <article className="course-progress-item" key={course.course_version_id}><h3>{info?.title||'コース情報を確認できません'}</h3><p>教材 第{info?.version}版 · {course.completed?'修了済み':course.started?'学習中':'未着手'}</p><p>正答 {course.correct_count} / {course.question_count}問（{course.percent}%）<br/>修了 {course.completed_units} / {course.unit_count}単元<br/>直近が誤答 {course.review_pending_count}問</p><div className="track" aria-hidden="true"><div style={{width:`${course.percent}%`}}/></div><button className="secondary" disabled={busy||course.course_version_id===current} onClick={()=>onSelect(course.course_version_id)}>{course.course_version_id===current?'選択中のコース':'このコースへ切り替える'}</button></article>;})}</div>
    <p>全問正解と単元の修了確認は別です。修了後の復習で誤答しても、修了記録は保持されます。</p>
  </section>;
}

