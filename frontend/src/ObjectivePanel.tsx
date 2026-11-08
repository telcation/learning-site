import React from 'react';
import type { ObjectiveRow } from './objectives';
const labels={not_started:'未回答',learning:'確認途中',review_required:'直近の誤答あり',achieved:'この教材の問題で確認済み'};
export function ObjectivePanel({rows,busy,onReview}:{rows:ObjectiveRow[];busy:boolean;onReview:(goal:ObjectiveRow)=>void}) {
  return <section className="panel objective-panel"><h2>この単元の学習目標の確認状況</h2><p>対応する確認問題の結果を目標別に表示します。試験全範囲の到達度や合格可能性を示すものではありません。実践課題の自己確認は、この判定には含めません。</p>
    {!rows.length?<p>学習目標の情報はまだありません。</p>:<div className="objective-grid">{rows.map(goal=><article key={goal.objective_id}><h3>{goal.description}</h3><p className={goal.state==='achieved'?'objective-status achieved':'objective-status'}>{goal.question_count?labels[goal.state]:'対象問題は未収録'}</p><p>回答済み {goal.answered_count} / {goal.question_count}問<br/>直近の正答 {goal.latest_correct_count} / {goal.question_count}問<br/>初回回答の正答 {goal.first_correct_count} / {goal.question_count}問</p><button className="secondary" disabled={busy||!goal.question_count} onClick={()=>onReview(goal)}>この目標の問題に取り組む</button></article>)}</div>}
    <p>対応問題がすべて直近正解なら「この教材の問題で確認済み」です。後で誤答すると状態は変わりますが、すでに修了した単元の記録は消えません。「初回回答の正答」は各問題の最初の回答だけを数えます。1つの問題が複数の目標に対応するため、目標ごとの問題数の合計は単元の問題数とは一致しない場合があります。</p>
  </section>;
}
