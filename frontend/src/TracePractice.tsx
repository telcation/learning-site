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
const bounds = Array.from({ length: 10 }, (_, index) => index + 1);

export function TracePractice() {
  const [visibleRows, setVisibleRows] = useState(0);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [customLimit, setCustomLimit] = useState(5);
  const [customStart, setCustomStart] = useState(1);
  const [customStep, setCustomStep] = useState(1);
  const [customConditionIndex, setCustomConditionIndex] = useState(0);
  const [prediction, setPrediction] = useState('');
  const [feedback, setFeedback] = useState('');
  const custom = exerciseIndex === customIndex;
  const start = custom ? customStart : 1;
  const step = custom ? customStep : 1;
  const exercise = custom ? {
    limit: customLimit,
    conditionIndex: customConditionIndex,
  } : exercises[exerciseIndex];
  const { divisor, remainder } = conditions[exercise.conditionIndex];
  const conditionLine = `    if (n mod ${divisor} = ${remainder})`;
  let total = 0;
  const iterations = Math.floor((exercise.limit - start) / step) + 1;
  const rows = Array.from({ length: iterations }, (_, index) => {
    const n = start + index * step;
    const before = total;
    const condition = n % divisor === remainder;
    if (condition) total += n;
    return { n, before, condition, after: total };
  });
  const finished = visibleRows === rows.length;
  const skippedValues = rows.filter(row => !row.condition).map(row => row.n).join('、');
  const revealedRow = visibleRows > 0 ? rows[visibleRows - 1] : undefined;
  const invalidPrediction = prediction.trim() !== '' && !/^[0-9]+$/.test(prediction.trim());

  function resetTrace() {
    setVisibleRows(0);
    setPrediction('');
    setFeedback('');
  }

  function goBack() {
    setVisibleRows(count => Math.max(0, count - 1));
    setPrediction('');
    setFeedback('');
  }

  function revealRow() {
    const answer = rows[visibleRows].after;
    const value = prediction.trim();
    const result = value === '' ? '' :
      Number(value) === answer ? '予想どおりです。' : `加算後のtotalは${answer}です。`;
    setFeedback(result);
    setPrediction('');
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
      <label>繰り返しの始点{' '}
        <select value={customStart} onChange={event => {
          const nextStart = Number(event.target.value);
          setCustomStart(nextStart);
          setCustomLimit(limit => Math.max(limit, nextStart));
          resetTrace();
        }}>
          {bounds.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>{' '}
      <label>繰り返しの終点{' '}
        <select value={customLimit} onChange={event => {
          setCustomLimit(Number(event.target.value));
          resetTrace();
        }}>
          {bounds.filter(value => value >= start)
            .map(limit => <option key={limit} value={limit}>{limit}</option>)}
        </select>
      </label>{' '}
      <label>増やす幅{' '}
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
      {`for (n を ${start} から ${exercise.limit} まで ${step} ずつ増やす)\n`}
      {revealedRow ? <mark>{conditionLine}</mark> : conditionLine}
      {'\n'}
      {revealedRow?.condition
        ? <mark>{'        total ← total + n'}</mark>
        : '        total ← total + n'}
      {'\n    endif\nendfor'}
    </code></pre>
    <p>最初のtotalは0です。各回の条件と加算後の値を予想してから、次の行を表示してください。</p>
    <table>
      <caption>変数の変化（nを{step}ずつ増やす）</caption>
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
      <p>{total > 0
        ? <>足した値の合計は <code>{rows.filter(row => row.condition).map(row => row.n).join(' + ')} = {total}</code> です。</>
        : '条件を満たす値がないため、totalは初期値の0のままです。'}</p>
      <p>{skippedValues ? `条件が偽で足さなかった値は ${skippedValues} です。` : 'すべての値が条件を満たしました。'}</p>
    </div>}
    {revealedRow && <p>
      <strong>nが{revealedRow.n}の回</strong>{' '}
      <code>{revealedRow.n} mod {divisor} = {revealedRow.n % divisor}</code> なので、
      {revealedRow.condition
        ? `条件は真です。totalに${revealedRow.n}を足し、${revealedRow.before} + ${revealedRow.n} = ${revealedRow.after}になります。`
        : `条件は偽です。加算を飛ばすため、totalは${revealedRow.before}のままです。`}
    </p>}
    {!finished && <p><label>nが{rows[visibleRows].n}のときの加算後のtotal（任意）{' '}
      <input type="text" inputMode="numeric" size={5} maxLength={8} value={prediction}
        aria-invalid={invalidPrediction} onChange={event => setPrediction(event.target.value)} />
    </label></p>}
    {invalidPrediction && <p role="alert">予想は半角数字で入力してください。</p>}
    <button className="secondary" disabled={finished || invalidPrediction} onClick={revealRow}>次の行を表示</button>{' '}
    <button className="secondary" disabled={visibleRows === 0} onClick={goBack}>前の行に戻る</button>{' '}
    <button className="secondary" disabled={visibleRows === 0 && prediction === ''} onClick={resetTrace}>最初に戻す</button>
  </details>;
}
