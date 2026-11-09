import React, { useEffect, useState } from 'react';
import type { LearningPreference } from './learning-preferences';

export function LearningPreferences({value,busy,onSave}:{value:LearningPreference;busy:boolean;onSave:(value:LearningPreference)=>void}) {
  const [route,setRoute]=useState(value.study_route),[language,setLanguage]=useState<LearningPreference['preferred_language']>(value.preferred_language);
  useEffect(()=>{setRoute(value.study_route);setLanguage(value.preferred_language);},[value.study_route,value.preferred_language]);
  const preference:LearningPreference={study_route:route,preferred_language:language};
  const changed=preference.study_route!==value.study_route||preference.preferred_language!==value.preferred_language;
  return <section className="panel learning-preferences"><h2>学習の好み</h2><p>優先する学習ルートと言語を選べます。下のコース一覧の表示順に反映します。保存しても、現在のコース・学習位置・回答・修了記録は変わりません。</p>
    <div><label>優先する学習ルート<select disabled={busy} value={route} onChange={e=>{const next=e.target.value as LearningPreference['study_route'];setRoute(next);if(next==='practice'&&language===null)setLanguage('python');}}><option value="practice">プログラミング実践を優先</option><option value="fe">基本情報の学習を優先</option></select></label>
    <label>優先する言語<select disabled={busy} value={language??''} onChange={e=>setLanguage(e.target.value?(e.target.value as 'java'|'python'):null)}>{route==='fe'&&<option value="">指定しない（基本情報）</option>}<option value="python">Python</option><option value="java">Java</option></select></label></div>
    <button className="primary" disabled={busy||!changed} onClick={()=>onSave(preference)}>学習の好みを保存する</button><p>この学習キーに保存され、別端末でも同じ設定を使えます。受講コースの追加・切り替えは下の一覧から行ってください。</p>
  </section>;
}
