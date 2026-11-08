import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { bearer, createCredential, exportCode, importCode, readCredential, saveCredential as savePersonalCredential, forgetCredential } from './credential';
import type { Credential } from './credential';
import './style.css';
import { ProgressOverview } from './ProgressOverview';
import { summarizeProgress } from './progress-summary';
import type { CourseOutline, ProgressSummary, UnitProgress } from './progress-summary';
import { AnswerInput } from './AnswerInput';
import { initialAnswer } from './answer';
import type { AnswerQuestion } from './answer';
import { RecoveryDialog } from './RecoveryDialog';
import { recoveryOrigin } from './recovery';
import { TemporarySession } from './temporary-session';
import { notifyDeviceForgotten, watchDeviceForgotten } from './device-sync';

// The fragment contains a mode flag only, never a key. It survives reloads and
// new tabs opened from this URL without persisting the temporary credential.
const temporary = window.location.hash === '#temporary';
const requests = new AbortController();
let ended = false;
function endTemporary() {
  if (ended) return;
  ended = true;
  requests.abort();
  root.unmount();
  window.location.reload();
}
const temporarySession = temporary ? new TemporarySession(endTemporary) : undefined;
function endAllTemporaryTabs() {
  notifyDeviceForgotten('learning-temporary-end-v1');
  temporarySession?.end();
}
async function saveCredential(c: Credential) {
  if (ended || temporarySession && !temporarySession.check()) throw new Error('SESSION_ENDED');
  if (!temporary) await savePersonalCredential(c);
}


type Course = {id:string;course_id:string;title:string;language:'java'|'python'|null;version:number;available:boolean};
type Home = {revision:number;review_pending_count:number;enrolled_course_version_ids:string[];retention_kind:string;empty_expires_on:string|null;next_action:{kind:string;unit_version_id:string;course_version_id:string}};
type Material = {title:string;markdown:string;revision:number};
type Question = AnswerQuestion;
type Progress = UnitProgress;
type Result = {correct:boolean;explanation:string;is_repeat:boolean};
class ApiError extends Error { constructor(public code:string, public status:number) { super(code); } }
async function api<T>(path:string, credential?:Credential, body?:unknown, requestId?:string, method:'POST'|'PUT'='POST'):Promise<T> {
  if (ended || temporarySession && !temporarySession.check()) throw new Error('SESSION_ENDED');
  const headers:Record<string,string> = {};
  if (credential) headers.Authorization = bearer(credential);
  if (body !== undefined) { headers['Content-Type']='application/json'; headers['Idempotency-Key']=requestId ?? (path === '/records' && credential ? credential.bootstrapKey : crypto.randomUUID()); }
  const response = await fetch('/api/v1'+path, {method: body === undefined ? 'GET' : method,headers,body:body === undefined ? undefined : JSON.stringify(body),cache:'no-store',referrerPolicy:'no-referrer',signal:requests.signal});
  const value = response.status === 204 ? undefined : await response.json();
  if (ended || temporarySession && !temporarySession.check()) throw new Error('SESSION_ENDED');
  if (!response.ok) throw new ApiError(value?.code || 'UNAVAILABLE', response.status);
  return value as T;
}
async function learningSnapshot(c:Credential) {
  const h=await api<Home>('/learning-home',c);
  const [m,p,outlines]=await Promise.all([
    api<Material>(`/units/${h.next_action.unit_version_id}/material`),api<Progress[]>('/progress',c),
    Promise.all(h.enrolled_course_version_ids.map(id=>api<CourseOutline>(`/courses/${id}/outline`)))
  ]);
  return {h,m,p,summary:summarizeProgress(outlines,p)};
}
const errorText = (e:unknown) => e instanceof ApiError && [401,410].includes(e.status) ? '学習キーを確認できません。新しい記録は自動作成していません。保存済みの学習コードで復旧してください。' : e instanceof ApiError && e.code === 'REVISION_CONFLICT' ? '別の操作で記録が更新されました。確認画面を閉じて、もう一度やり直してください。' : e instanceof Error && e.message === 'INVALID_CODE' ? '学習コードの文字・長さ・検査値を確認してください。' : e instanceof ApiError && e.code === 'REQUIREMENTS_UNMET' ? 'まだ未達成の確認問題があります。すべての問題に正解してから修了を確認してください。' : e instanceof Error && e.message === 'STORAGE_UNAVAILABLE' ? 'このブラウザーに学習キーを保存できません。保存を許可したブラウザーをご利用ください。' : '処理が完了しませんでした。通信状態を確認して、もう一度お試しください。';

function App() {
  // Reload discards displayed secrets and in-flight component state together.
  useEffect(() => temporary ? watchDeviceForgotten(() => temporarySession?.end(), 'learning-temporary-end-v1') : watchDeviceForgotten(() => window.location.reload()), []);
  useEffect(() => {
    if (!temporarySession) return;
    const touch = () => temporarySession.touch();
    const check = () => { temporarySession.check(); };
    const events = ['pointerdown','keydown','input','scroll'] as const;
    for (const event of events) window.addEventListener(event, touch, true);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, 1000);
    return () => {
      for (const event of events) window.removeEventListener(event, touch, true);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(timer);
    };
  }, []);
  const [catalog,setCatalog]=useState<Course[]>([]), [credential,setCredential]=useState<Credential>(), [home,setHome]=useState<Home>(), [material,setMaterial]=useState<Material>(), [progress,setProgress]=useState<Progress>();
  const [summary,setSummary]=useState<ProgressSummary>();
  const [screen,setScreen]=useState<'home'|'learn'|'progress'>('home'), [question,setQuestion]=useState<Question>(), [choice,setChoice]=useState<string[]>([]), [result,setResult]=useState<Result>(), [busy,setBusy]=useState(true), [error,setError]=useState('');
  const [recovery,setRecovery]=useState<'export'|'import'>();
  const [rotation,setRotation]=useState<{candidate:Credential; code:string; revision:number; recordId:string}>();
  const [rotationInput,setRotationInput]=useState('');
  const [rotationSaved,setRotationSaved]=useState(false);
  const [deletion,setDeletion]=useState<{revision:number;requestId:string}>();
  const [deleteConfirmed,setDeleteConfirmed]=useState(false);
  const [notice,setNotice]=useState('');
  const [forget,setForget]=useState(false);
  useEffect(() => {
    if (temporary || !credential) return;
    let disposed = false;
    const check = async () => {
      try {
        const saved = await readCredential();
        if (!disposed && (saved?.id !== credential.id || saved?.secret !== credential.secret)) window.location.reload();
      } catch {
        // Fail closed when a resumed tab cannot verify its saved credential.
        if (!disposed) window.location.reload();
      }
    };
    const visible = () => { if (document.visibilityState === 'visible') void check(); };
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
    document.addEventListener('visibilitychange', visible);
    return () => {
      disposed = true;
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', check);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [credential]);
  const [backup,setBackup]=useState(false),[restore,setRestore]=useState(false),[code,setCode]=useState(''),[restoreInput,setRestoreInput]=useState(''),[storage,setStorage]=useState('確認中'),[storageFailed,setStorageFailed]=useState(false);
  async function load(c:Credential) {
    const {h,m,p,summary:nextSummary}=await learningSnapshot(c);
    if(home&&home.next_action.unit_version_id!==h.next_action.unit_version_id){setQuestion(undefined);setChoice([]);setResult(undefined);}
    setMaterial(m);setProgress(p.find(item=>item.unit_version_id===h.next_action.unit_version_id));setHome(h);setSummary(nextSummary);
  }
  async function perform(fn:()=>Promise<void>) {setBusy(true);setError('');try{await fn();}catch(e){setError(errorText(e));}finally{setBusy(false);}}
  useEffect(()=>{void perform(async()=>{setCatalog(await api<Course[]>('/catalog')); let c:Credential|undefined;try{c=temporary ? undefined : await readCredential();}catch{setStorageFailed(true);throw new Error('STORAGE_UNAVAILABLE');} if(c){setCredential(c);await load(c);} setStorage(temporary ? '一時利用：このタブのメモリーのみ（端末に保存しません）' : navigator.storage?.persisted && await navigator.storage.persisted()?'永続保存が許可済み':'ブラウザーによる通常保存');});},[]);
  useEffect(()=>{if(!code)return;const timer=window.setTimeout(()=>setCode(''),30000);return()=>window.clearTimeout(timer);},[code]);
  async function start(course:Course) {await perform(async()=>{
    if(storageFailed)throw new Error('STORAGE_UNAVAILABLE');
    const c=credential || await createCredential();
    if(c.courseId && c.courseId!==course.id)throw new Error('EXISTING_CREDENTIAL');
    c.courseId=course.id; await saveCredential(c); setCredential(c);
    if(!temporary && navigator.storage?.persist){try{setStorage(await navigator.storage.persist()?'永続保存が許可済み':'ブラウザーによる通常保存');}catch{setStorage('保存の持続性は不明');}}
    await api('/records',c,{course_version_id:course.id,study_route:course.language?'practice':'fe',preferred_language:course.language});await load(c);
  });}
  async function switchCourse(course:Course) {
    if(!credential||!home)return;
    await perform(async()=>{
      setQuestion(undefined);setChoice([]);setResult(undefined);
      let target=course.id;
      if(!home.enrolled_course_version_ids.includes(target)) {
        const ack=await api<{resource_id:string}>(`/enrollments/${target}`,credential,{});target=ack.resource_id;
      }
      const [outline,current]=await Promise.all([api<{unit_ids:string[]}>(`/courses/${target}/outline`),api<Home>('/learning-home',credential)]);
      try { await api('/learning-position',credential,{unit_version_id:outline.unit_ids[0],revision:current.revision},undefined,'PUT'); }
      catch(e){if(e instanceof ApiError&&e.code==='REVISION_CONFLICT'){await load(credential);setError('別の操作で記録が更新されたため、最新状態を読み込みました。切り替え先をもう一度選んでください。');return;}throw e;}
      await load(credential);setScreen('home');
    });
  }
  async function nextQuestion() {if(!credential||!home)return;await perform(async()=>{const q=await api<Question>(`/units/${home.next_action.unit_version_id}/review-next`,credential,{});setQuestion(q);setChoice(initialAnswer(q));setResult(undefined);});}
  const selected=catalog.find(c=>c.id===home?.next_action.course_version_id);
  const courseOptions=home?catalog.filter(course=>home.enrolled_course_version_ids.includes(course.id)||course.available&&!home.enrolled_course_version_ids.some(id=>catalog.find(c=>c.id===id)?.course_id===course.course_id)):[];
  const complete=progress?.state==='completed';
  const percent=progress?Math.round(progress.correct_count/progress.question_count*100):0;
  const text=material?.markdown.split('```') || [];
  return <div className="app"><aside className="sidebar"><a className="brand" href="#" onClick={e=>{e.preventDefault();setScreen('home');}}><span className="brand-icon">m.</span>まなびのコード</a><span className="workspace">PERSONAL LEARNING</span><nav>{([['home','⌂','学習ホーム'],['learn','▤','学習する'],['progress','◴','学習の進捗']] as const).map(([s,icon,label])=><button key={s} className={screen===s?'nav active':'nav'} onClick={()=>{setScreen(s);setError('');}} disabled={!home&&s!=='home'}><span>{icon}</span>{label}{s==='learn'&&home?.review_pending_count? <i>{home.review_pending_count}</i>:null}</button>)}</nav><div className="side-note"><span className="leaf">↗</span><strong>自分のペースで、一歩ずつ。</strong><p>読んで、考えて、確かめる。<br/>小さな理解を積み重ねよう。</p></div><div className="side-bottom"><span className="dot"/> {temporary?'一時端末モード':'個人学習モード'} <small>開発プレビュー · P1</small></div></aside>
    <div className="shell"><header><span>マイラーニング <b>/</b> {screen==='home'?'ホーム':screen==='learn'?'教材と確認問題':'学習の進捗'}</span><button className="text-button" disabled={!temporary&&busy} onClick={()=>{if(temporary)endAllTemporaryTabs();else{window.location.hash='temporary';window.location.reload();}}}>{temporary?'離席・終了する':'教室・共用PCで一時利用'}</button><button className="backup-chip" disabled={busy} onClick={()=>setBackup(true)}>◇ {credential?.backup==='restore_checked'?'復旧確認済み':credential?.backup==='export_action_taken'?'書き出し操作済み':'バックアップ未確認'}</button></header>
    <main><div className="eyebrow">LEARN AT YOUR OWN PACE</div><h1>{screen==='home'?(home?'今日も、ひとつずつ。':'はじめの一歩を、ここから。'):screen==='learn'?'理解を、自分のものに。':'積み重ねが、見える。'}</h1><p className="lead">{screen==='home'?'アカウント登録なしで始められる、プログラミング学習。':screen==='learn'?'教材を読み、確認問題で理解を確かめましょう。':'この学習キーに紐づく学習記録です。'}</p>
      {temporary&&<section className="panel temporary-notice"><h2>一時端末モード</h2><p>学習キーをこのブラウザーに保存しません。再読み込み・タブを閉じる・「離席・終了する」・このサイトでの無操作60分で再入力が必要になります。IDEでの作業はサイトの操作には数えません。再開用の学習コードを紙などで手元に保管してください。サーバーの学習記録は残ります。</p><button className="secondary" disabled={busy} onClick={()=>setRestore(true)}>持っている学習コードで再開する</button><p>共用PCではこのモードのURL（末尾が #temporary）を使用し、利用者交代時は「離席・終了する」を押して、開いた他のタブも閉じてください。</p></section>}
      {notice&&<p role="status">{notice}</p>}
      {error&&<div className="error" role="alert">{error}<button onClick={()=>setRestore(true)}>学習コードで復旧</button></div>}
      {busy&&<p role="status" className="loading">読み込み・保存中…</p>}
      {!home&&screen==='home'&&<><div className="section-heading"><h2>学びたいコースを選ぶ</h2><span>3つの入口からスタート</span></div><div className="course-grid">{catalog.filter(c=>c.available).map((c,i)=><article className="course-card" key={c.id}><div className={'language-icon lang-'+i}>{c.language==='python'?'Py':c.language==='java'?'Jv':'FE'}</div><span className="tag">{c.language?'プログラミング実践':'資格の基礎'}</span><h3>{c.title}</h3><p>{c.language?'条件分岐と繰り返しから、処理の流れを学ぶ。':'疑似言語を読み、変数の変化を追う。言語環境の準備は不要です。'}</p><small>入門 · 教材1単元／確認問題{c.version===2?4:2}問</small><button className="primary" disabled={busy||storageFailed||!!credential&&credential.courseId!==c.id} onClick={()=>void start(c)}>このコースで始める <span>→</span></button></article>)}</div><p className="muted">既に学習コードをお持ちの方は <button className="text-button" onClick={()=>setRestore(true)}>学習記録を復旧する →</button></p></>}
      {home&&screen==='home'&&<><section className="resume"><div><span className="pill">{complete?'入門単元を修了':'学習をつづける'}</span><p className="course-name">{selected?.title}</p><h2>{material?.title}</h2><p>{complete?'この単元は修了しました。下の一覧から別のコースへ進むか、復習できます。':home.review_pending_count?'確認問題を振り返って、理解を深めましょう。':'順次・選択・反復。プログラムの基本を学びましょう。'}</p><button className="primary" onClick={()=>setScreen('learn')}>{complete?'教材を復習する':'前回のつづきから'} <span>→</span></button></div><div className="ring" style={{'--progress':`${percent}%`} as React.CSSProperties}><div><strong>{percent}<small>%</small></strong><span>確認問題の正答</span></div></div></section><div className="stats"><div><span>確認問題</span><strong>{progress?.correct_count}<small> / {progress?.question_count}問 正解</small></strong></div><div><span>復習が必要な問題</span><strong>{home.review_pending_count}<small> 問</small></strong></div><div><span>単元の修了</span><strong>{complete?'1':'0'}<small> / 1単元</small></strong></div></div></>}
      {home&&screen==='learn'&&<div className="learning-grid"><article className="lesson panel"><div className="section-heading"><span className="tag">LESSON 01</span><small>教材 第{material?.revision}版</small></div><h2>{material?.title}</h2><p className="lesson-text">{text[0]}</p><pre><code>{text[1]?.trim()}</code></pre><p>{text[2]}</p><div className="callout"><strong>手元で試してみよう</strong><p>{selected?.language?'コードの値を変えて、実行結果の違いを確かめましょう。プログラムはご自身のPCで実行します。':'紙や手元のメモに変数の変化を書き出しましょう。インストールは不要です。'}</p></div></article><section className="quiz panel"><div className="section-heading"><h2>理解を確かめる</h2><span className="tag">確認問題</span></div>{!question?<><p>{progress?.question_count}問の確認問題で、処理の流れを確かめましょう。</p><button className="primary" disabled={busy} onClick={()=>void nextQuestion()}>確認問題へ →</button></>:<><h3>{question.prompt}</h3><AnswerInput question={question} value={choice} onChange={setChoice} disabled={busy||!!result}/>{!result?<button className="primary" disabled={!choice.length||busy} onClick={()=>void perform(async()=>{setResult(await api<Result>(`/questions/${question.question_version_id}/attempts`,credential,{choice_ids:choice}));await load(credential!);})}>回答して解説を見る</button>:<div className={result.correct?'feedback correct':'feedback'} role="status"><strong>{result.correct?'✓ 正解です':'もう一度、処理を追ってみよう'}</strong><p>{result.explanation}</p>{result.is_repeat&&<small>同じ問題での復習です。</small>}<button className="secondary" disabled={busy} onClick={()=>void nextQuestion()}>次の確認・復習へ →</button></div>}</>}{progress?.correct_count===progress?.question_count&&<button className="secondary full" disabled={busy||complete} onClick={()=>void perform(async()=>{await api(`/units/${home.next_action.unit_version_id}/assess`,credential,{});await load(credential!);})}>{complete?'✓ この単元は修了済みです':'単元の修了を確認する'}</button>}</section></div>}
      {home&&screen==='progress'&&summary&&<ProgressOverview summary={summary} catalog={catalog} current={home.next_action.course_version_id} busy={busy} onRefresh={()=>{if(credential)void perform(()=>load(credential));}} onSelect={id=>{const course=catalog.find(c=>c.id===id);if(course)void switchCourse(course);}}/>}
      {home&&screen==='progress'&&<section className="panel"><div className="section-heading"><h2>{selected?.title}</h2><span className="tag">教材 第{material?.revision}版</span></div><div className="progress-row"><div><strong>{material?.title}</strong><p>{complete?'修了済み':progress?.correct_count?'学習中':'これから学習'} · 確認問題 {progress?.correct_count} / {progress?.question_count} 問正解</p></div><span className={complete?'status done':'status'}>{complete?'✓ 修了':'学習中'}</span></div><div className="track"><div style={{width:`${percent}%`}}/></div><p className="muted">この入門単元は必須の{progress?.question_count}問すべてに正解すると修了できます。修了後の復習で間違えても修了記録は保持されます。</p></section>}
      {home&&screen==='home'&&<section className="panel course-switch"><h2>コースを追加・切り替える</h2><p>同じ学習キーで複数のコースを学べます。切り替えても、各コースの回答・修了記録は残ります。</p><div className="course-grid">{courseOptions.map(course=>{const current=course.id===home.next_action.course_version_id;const enrolled=home.enrolled_course_version_ids.includes(course.id);const courseProgress=summary?.courses.find(item=>item.course_version_id===course.id);return <article key={course.id}><h3>{course.title}</h3><p>教材 第{course.version}版 · {current?'現在のコース':enrolled?'登録済み':'未登録'}</p>{courseProgress&&<p>正答 {courseProgress.correct_count} / {courseProgress.question_count}問 · {courseProgress.completed?'修了済み':courseProgress.started?'学習中':'未着手'}<br/>復習が必要 {courseProgress.review_pending_count}問</p>}<button className="secondary" disabled={busy||current} onClick={()=>void switchCourse(course)}>{current?'このコースを学習中':enrolled?'このコースへ切り替える':'追加してこのコースを学ぶ'}</button></article>;})}</div></section>}
      {screen==='home'&&<section className="roadmap panel"><div className="section-heading"><h2>ここから広がる、学びの道筋</h2><span>プログラミング実践ルート</span></div><div className="milestones">{['制御構造','OOP','デスクトップ','LAN内通信','Webアプリ'].map((s,i)=><div key={s} className={i===0?'current':''}><span>{String(i+1).padStart(2,'0')}</span><strong>{s}</strong><small>{i===0?'入門単元を試せます':'教材は順次開発'}</small></div>)}</div></section>}
      <footer><span>◇ 氏名・メールアドレス・GitHub情報を送信しない設計</span><span>開発版：試験範囲の一部のみ。合格・全範囲の網羅は保証しません。</span></footer>
    </main></div>
    {!temporary&&recovery&&<RecoveryDialog mode={recovery} credential={credential} onClose={()=>setRecovery(undefined)} onExported={async c=>{const saved={...c,backup:c.backup==='restore_checked'?'restore_checked' as const:'export_action_taken' as const};await saveCredential(saved);setCredential(saved);}} onRestore={async c=>{
      const {h,m,p,summary:nextSummary}=await learningSnapshot(c);

      c.courseId=h.next_action.course_version_id;c.backup='restore_checked';await saveCredential(c);
      setCredential(c);setHome(h);setSummary(nextSummary);setMaterial(m);setProgress(p.find(item=>item.unit_version_id===h.next_action.unit_version_id));setQuestion(undefined);setChoice([]);setResult(undefined);setCode('');setRestoreInput('');setRotation(undefined);setRotationInput('');setBackup(false);setRestore(false);setScreen('home');setError('');notifyDeviceForgotten();
    }}/>}
    {deletion&&<div className="overlay"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">サーバーの学習記録を削除する</h2><p>現在の学習キーに結び付く全コースの学習記録・回答・進捗をサーバーから削除します。他の端末からもこの記録は使えなくなり、保存済みのコードでも復旧できません。</p><p>このPCの保存だけを解除したい場合は、キャンセルして「この端末の記憶を解除」を使ってください。</p><p>古いDBバックアップを復元した場合にも再削除するため、学習記録IDだけを含む削除台帳を別途保持します。</p><label><input type="checkbox" checked={deleteConfirmed} onChange={e=>setDeleteConfirmed(e.target.checked)}/>全端末で使っている全コースの学習記録が削除され、コードでも復旧できなくなることを確認しました</label>{error&&<p role="alert">{error}</p>}<button className="secondary" disabled={busy} onClick={()=>{setDeletion(undefined);setDeleteConfirmed(false);setError('');}}>キャンセル</button><button className="primary danger" disabled={busy||!deleteConfirmed} onClick={()=>void perform(async()=>{
      try { await api('/records/me/delete',credential,{confirm:true,revision:deletion.revision},deletion.requestId); }
      catch(e) {
        if(e instanceof ApiError && e.code==='REVISION_CONFLICT')throw e;
        setError('削除の完了を確認できませんでした。通信が途切れた場合でも削除が進んでいることがあります。確認画面を閉じてページを再読み込みし、記録にアクセスできるか確認してください。アクセスできないだけでは削除完了とは断定できません。');return;
      }
      let cleared=true;try{await forgetCredential();}catch{cleared=false;}
      notifyDeviceForgotten();
      setCredential(undefined);setHome(undefined);setMaterial(undefined);setProgress(undefined);setSummary(undefined);setQuestion(undefined);setChoice([]);setResult(undefined);setCode('');setRestoreInput('');setRotation(undefined);setRotationInput('');setRotationSaved(false);setRestore(false);setBackup(false);setForget(false);setScreen('home');setDeletion(undefined);setDeleteConfirmed(false);setStorageFailed(!cleared);
      setNotice(cleared?'サーバーの学習記録と、このブラウザーの保存キーを削除しました。':'サーバーの学習記録は削除しましたが、このブラウザーの保存キーを消せませんでした。ブラウザーの設定からこのサイトのデータを削除してください。');
    })}>学習記録を削除する（取り消せません）</button></section></div>}
    {rotation&&<div className="overlay"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="rotation-title"><h2 id="rotation-title">学習キーを更新する</h2><p>更新すると、他の端末を含むすべての旧キーと旧バックアップが使えなくなります。学習記録は維持されます。次の3つの手順で、新しいコードを保管・確認してから更新してください。</p>
<ol>
  <li><label htmlFor="new-learning-code">新しい学習コードをコピーして保存する</label><p>下のコード全体（LS1-から始まる文字列）をコピーし、メモ帳などに貼り付けてファイルとして保存してください。紙に正確に書き写して保管してもかまいません。コードを知る人は学習記録へアクセスできるため、公開・共有先には保存しないでください。</p><textarea id="new-learning-code" readOnly value={rotation.code} autoComplete="off" spellCheck={false}/><p>この画面を閉じるとコードは再表示できません。コードの表示やコピーだけでは保存は完了していません。</p></li>
  <li><label><input type="checkbox" checked={rotationSaved} onChange={e=>setRotationSaved(e.target.checked)}/>保存したファイルを開くなどして、コードが手元に残っていることを確認しました</label></li>
  <li><label htmlFor="saved-learning-code">保存先からコードをコピーして、下の確認欄に貼り付ける</label><p>手順1で保存したファイルやメモを開き、そこからコード全体をコピーして貼り付けてください。紙で保管した場合は、紙を見ながら入力してください。上の表示欄から直接コピーするのではなく、保存先から取り出せることを確かめます。</p><textarea id="saved-learning-code" value={rotationInput} autoComplete="off" spellCheck={false} placeholder="保存したコード全体（LS1-…）を貼り付ける" onChange={e=>setRotationInput(e.target.value)}/></li>
</ol><p>確認欄のコードが一致したら、下の「新しいキーへ更新し旧キーを失効する」を押してください。それまでは現在のキーが有効です。</p>{error&&<p role="alert">{error}</p>}<button className="secondary" disabled={busy} onClick={()=>{setRotation(undefined);setRotationInput('');setRotationSaved(false);setError('');}}>閉じる</button><button className="primary" disabled={busy||!rotationSaved||!rotationInput} onClick={()=>void perform(async()=>{
      const candidate=await importCode(rotationInput);
      if(candidate.id!==rotation.candidate.id||candidate.secret!==rotation.candidate.secret){setError('保存した新しいコードが一致しません。');return;}
      try {
        await api('/credentials/rotate',credential,{replacement_credential_id:candidate.id,secret_candidate:candidate.secret,revision:rotation.revision},rotation.candidate.bootstrapKey);
      } catch(e) {
        // A lost success response must be resolved with the new key, never old-key cache replay.
        try {const record=await api<{record_id:string}>('/records/me',candidate);if(record.record_id!==rotation.recordId)throw e;} catch {throw e;}
      }
      const record=await api<{record_id:string}>('/records/me',candidate);
      if(record.record_id!==rotation.recordId)throw new Error('RECORD_MISMATCH');
      candidate.courseId=credential?.courseId;candidate.backup='restore_checked';
      await saveCredential(candidate);notifyDeviceForgotten();setCredential(candidate);setQuestion(undefined);setChoice([]);setResult(undefined);setCode('');setRotation(undefined);setRotationInput('');setRotationSaved(false);setBackup(false);setRestoreInput('');await load(candidate);
    })}>新しいキーへ更新し旧キーを失効する</button></section></div>}
    {forget&&<div className="overlay"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="forget-title"><h2 id="forget-title">この端末の記憶を解除しますか</h2><p>このブラウザーに保存した学習キーとバックアップ操作状態を消します。サーバーの学習記録と、他の端末・保存済みコードの有効性は変わりません。</p><p>再開には保存済みの学習コードが必要です。コードがない場合、本人確認による復旧はできません。</p>{error&&<p role="alert">{error}</p>}<button className="secondary" disabled={busy} onClick={()=>{setForget(false);setError('');}}>キャンセル</button><button className="primary" disabled={busy} onClick={()=>void perform(async()=>{await forgetCredential();setCredential(undefined);setHome(undefined);setMaterial(undefined);setProgress(undefined);setSummary(undefined);setQuestion(undefined);setChoice([]);setResult(undefined);setCode('');setRestoreInput('');setRestore(false);setBackup(false);setScreen('home');setForget(false);})}>この端末の記憶を解除する</button></section></div>}
    {(backup||restore)&&<div className="overlay"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="close" aria-label="閉じる" onClick={()=>{setBackup(false);setRestore(false);setCode('');setRestoreInput('');}}>×</button><h2 id="modal-title">{restore?'学習記録を復旧する':'学習キーを手元に保管する'}</h2>{restore?<><p>学習コードはこのブラウザーで検証します。現在のキーは、復旧先を確認した後で置き換えます。{temporary?'このタブ内だけで利用し、ブラウザーには保存しません。':''}</p><label>学習コード<textarea autoComplete="off" spellCheck={false} value={restoreInput} onChange={e=>setRestoreInput(e.target.value)} placeholder="LS1-…"/></label><button className="primary" disabled={busy||!restoreInput} onClick={()=>void perform(async()=>{let c;try{c=await importCode(restoreInput);}catch{setError('学習コードを確認してください。文字・長さ・検査値が一致しません。');return;}const h=await api<Home>('/learning-home',c);c.courseId=h.next_action.course_version_id;c.backup='restore_checked';await saveCredential(c);setCredential(c);await load(c);setRestore(false);setBackup(false);setRestoreInput('');setScreen('home');})}>復旧先を確認して{temporary?'一時利用を開始':'この端末に保存'}</button>{!temporary&&<><p>暗号化復旧ファイルをお持ちの場合はこちらを使えます。</p><button className="secondary full" disabled={busy||!recoveryOrigin(window.location.origin)} onClick={()=>{setRestore(false);setBackup(false);setRestoreInput('');setRecovery('import');}}>暗号化復旧ファイルを取り込む</button>{!recoveryOrigin(window.location.origin)&&<p>暗号化復旧ファイルはHTTPSのサイトで利用できます。現在のHTTP環境では上のLS1コードをご利用ください。</p>}</>}</>:<><p>保存は任意です。ブラウザーのデータを失うと、学習コードがない記録には戻れません。コードを知る人は学習記録にアクセスできます。共有フォルダーやGitHubには置かないでください。</p><dl><dt>この端末の保存状態</dt><dd>{storage}</dd><dt>学習していない記録の期限</dt><dd>{home?.retention_kind==='empty'?home.empty_expires_on:'最終活動月から24か月。期限後は利用停止し、整理処理で削除します'}</dd></dl>{!temporary&&credential&&<><button className="secondary full" disabled={busy||!recoveryOrigin(window.location.origin)} onClick={()=>{setBackup(false);setCode('');setRecovery('export');}}>パスワード付きの暗号化復旧ファイルを保存する</button>{!recoveryOrigin(window.location.origin)&&<p>暗号化復旧ファイルはHTTPSのサイトで利用できます。現在のHTTP環境ではLS1コードの表示・書き出しをご利用ください。</p>}</>}{credential?<><button className="secondary" disabled={busy} onClick={()=>void perform(async()=>{setCode(await exportCode(credential));})}>学習コードを30秒間表示</button>{code&&<div><pre className="secret">{code}</pre>{!temporary&&<button className="primary" onClick={()=>void perform(async()=>{const blob=new Blob([code+'\n'],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='learning-code.txt';a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);const c={...credential,backup:'export_action_taken' as const};await saveCredential(c);setCredential(c);})}>コードをファイルに書き出す</button>}<p className="muted">{temporary?'紙などにコードを控えて保管してください。共用PCへのファイル書き出しは提供しません。':'書き出し操作は保存成功の証明ではありません。実際にファイルがあるかご自身で確認してください。'}</p></div>}</>:<p>コースを始めると学習キーが作成されます。</p>}<button className="text-button" disabled={busy} onClick={()=>setRestore(true)}>既存の学習コードから復旧する →</button>{!temporary&&credential&&<button className="secondary full danger" disabled={busy} onClick={()=>void perform(async()=>{const record=await api<{revision:number}>('/records/me',credential);setDeletion({revision:record.revision,requestId:crypto.randomUUID()});setDeleteConfirmed(false);setNotice('');setCode('');setBackup(false);})}>サーバーの学習記録を削除する</button>}{!temporary&&credential&&<button className="secondary full" disabled={busy} onClick={()=>void perform(async()=>{const record=await api<{record_id:string;revision:number}>('/records/me',credential);const candidate=await createCredential();setRotation({candidate,code:await exportCode(candidate),revision:record.revision,recordId:record.record_id});setRotationInput('');setRotationSaved(false);setCode('');setBackup(false);})}>学習キーを更新する</button>}{credential&&<button className="secondary full" disabled={busy} onClick={()=>{if(temporary){endAllTemporaryTabs();return;}setCode('');setBackup(false);setForget(true);}}>{temporary?'離席・終了する':'この端末の記憶を解除'}</button>}</>}</section></div>}
  </div>;
}
const root = createRoot(document.getElementById('root')!);
if (temporary) {
  window.addEventListener('pagehide', () => { ended = true; requests.abort(); root.unmount(); });
  window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
}
root.render(<App/>);


















