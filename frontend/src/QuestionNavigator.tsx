import React from 'react';
import type { QuestionSummary } from './review';

export function QuestionNavigator({items,current,busy,onSelect}:{items:QuestionSummary[];current?:string;busy:boolean;onSelect:(id:string)=>void}) {
  return <section className="question-navigator" aria-label="この単元の確認問題一覧"><h3>問題を選んで取り組む</h3><p>順番を変えてもかまいません。誤答は残したまま別の問題に進めます。修了確認には全問正解が必要です。</p><div>{items.map((item,index)=><button className={item.question_version_id===current?'secondary active':'secondary'} key={item.question_version_id} disabled={busy||item.question_version_id===current} aria-pressed={item.question_version_id===current} onClick={()=>onSelect(item.question_version_id)}>問題{index+1}<small>{item.latest_correct===null?'未回答':item.latest_correct?'直近は正解':'直近は誤答'}</small></button>)}</div></section>;
}
