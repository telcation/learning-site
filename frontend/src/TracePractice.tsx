import { useState } from 'react';

const conditions = [
  { label: '奇数', divisor: 2, remainder: 1 },
  { label: '偶数', divisor: 2, remainder: 0 },
  { label: '3の倍数', divisor: 3, remainder: 0 },
];
const exercises = [
  { label: '1〜3の奇数を足す（教材）', limit: 3, conditionIndex: 0 },
  { label: '1〜5の奇数を足す', limit: 5, conditionIndex: 0 },
  { label: '1〜5の偶数を足す', limit: 5, conditionIndex: 1 },
];
const customIndex = exercises.length;

function TraceExplanation({ row, divisor }: {
  row: { n: number; condition: boolean; before: number; after: number };
  divisor: number;
}) {
  return <p>
    <code>{row.n} mod {divisor} = {row.n % divisor}</code> なので、
    {row.condition
      ? `条件は真です。totalに${row.n}を足し、${row.before} + ${row.n} = ${row.after}になります。`
      : `条件は偽です。加算を飛ばすため、totalは${row.before}のままです。`}
  </p>;
}
const bounds = Array.from({ length: 10 }, (_, index) => index + 1);

export function TracePractice() {
  const [visibleRows, setVisibleRows] = useState(0);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [customLimit, setCustomLimit] = useState(5);
  const [customStart, setCustomStart] = useState(1);
  const [customStep, setCustomStep] = useState(1);
  const [customDescending, setCustomDescending] = useState(false);
  const [customConditionIndex, setCustomConditionIndex] = useState(0);
  const [prediction, setPrediction] = useState('');
  const [finalPrediction, setFinalPrediction] = useState('');
  const [conditionPrediction, setConditionPrediction] = useState('');
  const [feedback, setFeedback] = useState('');
  const [showIncorrectOnly, setShowIncorrectOnly] = useState(false);
  const [answers, setAnswers] = useState<{
    text: string;
    conditionCorrect: boolean | null;
    totalCorrect: boolean | null;
  }[]>([]);
  const custom = exerciseIndex === customIndex;
  const start = custom ? customStart : 1;
  const step = custom ? customStep : 1;
  const descending = custom && customDescending;
  const exercise = custom ? {
    limit: customLimit,
    conditionIndex: customConditionIndex,
  } : exercises[exerciseIndex];
  const { divisor, remainder } = conditions[exercise.conditionIndex];
  const conditionLine = `    if (n mod ${divisor} = ${remainder})`;
  let total = 0;
  const iterations = Math.floor((exercise.limit - start) / step) + 1;
  const first = descending ? exercise.limit : start;
  const last = descending ? start : exercise.limit;
  const direction = descending ? '減らす' : '増やす';
  const rows = Array.from({ length: iterations }, (_, index) => {
    const n = first + index * (descending ? -step : step);
    const before = total;
    const condition = n % divisor === remainder;
    if (condition) total += n;
    return { n, before, condition, after: total };
  });
  const finished = visibleRows === rows.length;
  const firstIncorrect = answers.findIndex(answer => answer.conditionCorrect === false || answer.totalCorrect === false);
  const conditionAttempts = answers.filter(answer => answer.conditionCorrect !== null).length;
  const totalAttempts = answers.filter(answer => answer.totalCorrect !== null).length;
  const conditionCorrectCount = answers.filter(answer => answer.conditionCorrect === true).length;
  const totalCorrectCount = answers.filter(answer => answer.totalCorrect === true).length;
  const attemptedCount = conditionAttempts + totalAttempts;
  const correctCount = conditionCorrectCount + totalCorrectCount;
  const skippedValues = rows.filter(row => !row.condition).map(row => row.n).join('、');
  const revealedRow = visibleRows > 0 ? rows[visibleRows - 1] : undefined;
  const invalidPrediction = prediction.trim() !== '' && !/^[0-9]+$/.test(prediction.trim());
  const finalGuess = finalPrediction.trim();
  const invalidFinalGuess = finalGuess !== '' && !/^[0-9]+$/.test(finalGuess);

  function resetTrace() {
    setFinalPrediction('');
    setShowIncorrectOnly(false);
    setAnswers([]);
    setVisibleRows(0);
    setPrediction('');
    setConditionPrediction('');
    setFeedback('');
  }

  function rewindTo(count: number) {
    setAnswers(previous => previous.slice(0, count));
    setVisibleRows(count);
    setPrediction('');
    setConditionPrediction('');
    setFeedback('');
  }

  function revealRow() {
    const row = rows[visibleRows];
    const answer = row.after;
    const value = prediction.trim();
    const result = value === '' ? '' :
      Number(value) === answer ? '予想どおりです。' : `加算後のtotalは${answer}です。`;
    const conditionAnswer = row.condition ? '真' : '偽';
    const conditionFeedback = conditionPrediction === '' ? '' :
      conditionPrediction === conditionAnswer ? '条件の予想は正解です。' : `条件は${conditionAnswer}です。`;
    setFeedback(conditionFeedback + result);
    const conditionText = conditionPrediction === '' ? '入力なし' :
      `${conditionPrediction}（${conditionPrediction === conditionAnswer ? '正解' : '誤り'}）`;
    const totalText = value === '' ? '入力なし' :
      `${value}（${Number(value) === answer ? '正解' : '誤り'}）`;
    setAnswers(previous => [...previous, {
      text: conditionPrediction === '' && value === '' ? '' : `条件 ${conditionText}、total ${totalText}`,
      conditionCorrect: conditionPrediction === '' ? null : conditionPrediction === conditionAnswer,
      totalCorrect: value === '' ? null : Number(value) === answer,
    }]);
    setPrediction('');
    setConditionPrediction('');
    setVisibleRows(visibleRows + 1);
  }

  return <details>
    <summary>トレース表で一行ずつ確認する</summary>
    <p><label>練習する条件{' '}
      <select value={exerciseIndex} onChange={event => {
        setExerciseIndex(Number(event.target.value));
        resetTrace();
      }}>
        {exercises.map((item, index) => <option key={item.label} value={index}>{item.label}</option>)}
        <option value={customIndex}>自分で条件を選ぶ</option>
      </select>
    </label></p>
    {custom && <fieldset>
      <legend>繰り返しと加算の条件</legend>
      <label>範囲の下限{' '}
        <select value={customStart} onChange={event => {
          const nextStart = Number(event.target.value);
          setCustomStart(nextStart);
          setCustomLimit(limit => Math.max(limit, nextStart));
          resetTrace();
        }}>
          {bounds.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>{' '}
      <label>範囲の上限{' '}
        <select value={customLimit} onChange={event => {
          setCustomLimit(Number(event.target.value));
          resetTrace();
        }}>
          {bounds.filter(value => value >= start)
            .map(limit => <option key={limit} value={limit}>{limit}</option>)}
        </select>
      </label>{' '}
      <label>進む向き{' '}
        <select value={customDescending ? 'descending' : 'ascending'} onChange={event => {
          setCustomDescending(event.target.value === 'descending');
          resetTrace();
        }}>
          <option value="ascending">小さい方から大きい方へ</option>
          <option value="descending">大きい方から小さい方へ</option>
        </select>
      </label>{' '}
      <label>進む幅{' '}
        <select value={customStep} onChange={event => {
          setCustomStep(Number(event.target.value));
          resetTrace();
        }}>
          {[1, 2, 3].map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>{' '}
      <label>足す値{' '}
        <select value={customConditionIndex} onChange={event => {
          setCustomConditionIndex(Number(event.target.value));
          resetTrace();
        }}>
          {conditions.map((condition, index) => <option key={condition.label} value={index}>{condition.label}</option>)}
        </select>
      </label>
    </fieldset>}
    <p>選択した条件の疑似言語</p>
    <pre><code>{'total ← 0\n'}
      {`for (n を ${first} から ${last} まで ${step} ずつ${direction})\n`}
      {revealedRow ? <mark>{conditionLine}</mark> : conditionLine}
      {'\n'}
      {revealedRow?.condition
        ? <mark>{'        total ← total + n'}</mark>
        : '        total ← total + n'}
      {'\n    endif\nendfor'}
    </code></pre>
    <p>最初のtotalは0です。各回の条件と加算後の値を予想してから、次の行を表示してください。</p>
    {visibleRows === 0 && <p><label>最後のtotalの予想（任意）{' '}
      <input type="text" inputMode="numeric" size={5} maxLength={8} value={finalPrediction}
        aria-invalid={invalidFinalGuess} onChange={event => setFinalPrediction(event.target.value)} />
    </label></p>}
    {invalidFinalGuess && <p role="alert">最後のtotalの予想は半角数字で入力してください。</p>}
    <table>
      <caption>変数の変化（nを{step}ずつ{direction}）</caption>
      <thead><tr><th scope="col">n</th><th scope="col">条件</th><th scope="col">加算前</th><th scope="col">加算後</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={row.n}>
        <th scope="row">{row.n}</th>
        {index < visibleRows ? <><td>{row.condition ? '真' : '偽'}</td><td>{row.before}</td><td>{row.after}</td></>
          : <td colSpan={3}>未表示</td>}
      </tr>)}</tbody>
    </table>
    <p role="status">{feedback}{finished ? `繰り返しが終了しました。最後のtotalは${total}です。` :
      revealedRow ? `nが${revealedRow.n}の行を表示しました。` : ''}</p>
    {finished && <div className="callout">
      <strong>繰り返しの振り返り</strong>
      {finalGuess !== '' && <p>最後のtotalの予想は <code>{finalGuess}</code>、実際は <code>{total}</code> でした。
        {Number(finalGuess) === total ? '予想どおりです。' : '各行を見直して、足した値を確かめましょう。'}
      </p>}
      <p>{attemptedCount > 0
        ? `入力した予想 ${attemptedCount}件のうち、正解は ${correctCount}件です。`
        : '予想の入力はありませんでした。'}</p>
      {attemptedCount > 0 && <ul>
        <li>条件の真偽：{conditionAttempts > 0 ? `${conditionAttempts}件中${conditionCorrectCount}件正解` : '入力なし'}</li>
        <li>加算後のtotal：{totalAttempts > 0 ? `${totalAttempts}件中${totalCorrectCount}件正解` : '入力なし'}</li>
      </ul>}
      <p>{total > 0
        ? <>足した値の合計は <code>{rows.filter(row => row.condition).map(row => row.n).join(' + ')} = {total}</code> です。</>
        : '条件を満たす値がないため、totalは初期値の0のままです。'}</p>
      <p>{skippedValues ? `条件が偽で足さなかった値は ${skippedValues} です。` : 'すべての値が条件を満たしました。'}</p>
    </div>}
    {answers.some(answer => answer.text) && <details>
      <summary>入力した予想を振り返る</summary>
      <label><input type="checkbox" checked={showIncorrectOnly}
        onChange={event => setShowIncorrectOnly(event.target.checked)} /> 誤りがあった回だけ表示</label>
      {showIncorrectOnly && firstIncorrect < 0 ? <p>誤りがあった回はありません。</p> :
        <ul>{answers.map((entry, index) => {
          const incorrect = entry.conditionCorrect === false || entry.totalCorrect === false;
          if (!entry.text || (showIncorrectOnly && !incorrect)) return null;
          const row = rows[index];
          return <li key={row.n}>
            <details>
              <summary>n = {row.n}：{entry.text}</summary>
              <TraceExplanation row={row} divisor={divisor} />
            </details>
          </li>;
        })}</ul>}
    </details>}
    {finished && firstIncorrect >= 0 && <p>
      <button className="secondary" onClick={() => rewindTo(firstIncorrect)}>
        n = {rows[firstIncorrect].n} からやり直す
      </button>{' '}
      この回以降の行と予想をリセットします。
    </p>}
    {revealedRow && <div>
      <strong>nが{revealedRow.n}の回</strong>
      <TraceExplanation row={revealedRow} divisor={divisor} />
    </div>}
    {!finished && <p><label>条件の真偽（任意）{' '}
      <select value={conditionPrediction} onChange={event => setConditionPrediction(event.target.value)}>
        <option value="">選択しない</option>
        <option value="真">真</option>
        <option value="偽">偽</option>
      </select>
    </label></p>}
    {!finished && <p><label>nが{rows[visibleRows].n}のときの加算後のtotal（任意）{' '}
      <input type="text" inputMode="numeric" size={5} maxLength={8} value={prediction}
        aria-invalid={invalidPrediction} onChange={event => setPrediction(event.target.value)} />
    </label></p>}
    {invalidPrediction && <p role="alert">予想は半角数字で入力してください。</p>}
    <button className="secondary" disabled={finished || invalidPrediction || invalidFinalGuess} onClick={revealRow}>次の行を表示</button>{' '}
    <button className="secondary" disabled={visibleRows === 0} onClick={() => rewindTo(visibleRows - 1)}>前の行に戻る</button>{' '}
    <button className="secondary" disabled={visibleRows === 0 && prediction === '' && conditionPrediction === '' && finalPrediction === ''} onClick={resetTrace}>最初に戻す</button>
  </details>;
}
