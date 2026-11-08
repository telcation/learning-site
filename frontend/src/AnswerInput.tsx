import React from 'react';
import { moveAnswer, toggleAnswer } from './answer';
import type { AnswerQuestion } from './answer';

export function AnswerInput({question,value,onChange,disabled}:{question:AnswerQuestion;value:string[];onChange:(value:string[])=>void;disabled:boolean}) {
  if(question.kind==='order')return <fieldset disabled={disabled}><legend>上から実行順になるよう「上へ」「下へ」で並べ替えてください。</legend><ol className="answer-order">{value.map((id,index)=><li key={id}><span>{question.choices.find(c=>c.id===id)?.text}</span><div><button className="secondary" disabled={disabled||index===0} aria-label={`${index+1}番の手順を上へ`} onClick={()=>onChange(moveAnswer(value,index,-1))}>上へ</button><button className="secondary" disabled={disabled||index===value.length-1} aria-label={`${index+1}番の手順を下へ`} onClick={()=>onChange(moveAnswer(value,index,1))}>下へ</button></div></li>)}</ol></fieldset>;
  const multiple=question.kind==='multi';
  return <fieldset disabled={disabled}><legend>{multiple?'正しいものをすべて選んでください。過不足なく選ぶと正解です。':'答えを1つ選んでください。'}</legend>{question.choices.map((choice,index)=><label key={choice.id} className={value.includes(choice.id)?'choice checked':'choice'}><input type={multiple?'checkbox':'radio'} name="answer" value={choice.id} checked={value.includes(choice.id)} onChange={()=>onChange(multiple?toggleAnswer(value,choice.id):[choice.id])}/><span className="choice-letter">{String.fromCharCode(65+index)}</span>{choice.text}</label>)}</fieldset>;
}
