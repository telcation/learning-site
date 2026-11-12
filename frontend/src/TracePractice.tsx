import { useState } from 'react';

const exercises = [
  { label: '1〜3の奇数を足す（教材）', limit: 3, remainder: 1 },
  { label: '1〜5の奇数を足す', limit: 5, remainder: 1 },
  { label: '1〜5の偶数を足す', limit: 5, remainder: 0 },
];

export function TracePractice() {
  const [visibleRows, setVisibleRows] = useState(0);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const exercise = exercises[exerciseIndex];
  let total = 0;
  const rows = Array.from({ length: exercise.limit }, (_, index) => {
    const n = index + 1;
    const before = total;
    const condition = n % 2 === exercise.remainder;
    if (condition) total += n;
    return { n, before, condition, after: total };
  });
  const finished = visibleRows === rows.length;

  return <details>
    <summary>トレース表で一行ずつ確認する</summary>
    <p><label>練習する条件{' '}
      <select value={exerciseIndex} onChange={event => {
        setExerciseIndex(Number(event.target.value));
        setVisibleRows(0);
      }}>
        {exercises.map((item, index) => <option key={item.label} value={index}>{item.label}</option>)}
      </select>
    </label></p>
    <p>判定式は <code>n mod 2 = {exercise.remainder}</code> です。</p>
    <p>最初のtotalは0です。各回の条件と加算後の値を予想してから、次の行を表示してください。</p>
    <table>
      <caption>{exercise.label}ときの変数の変化</caption>
      <thead><tr><th scope="col">n</th><th scope="col">条件</th><th scope="col">加算前</th><th scope="col">加算後</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={row.n}>
        <th scope="row">{row.n}</th>
        {index < visibleRows ? <><td>{row.condition ? '真' : '偽'}</td><td>{row.before}</td><td>{row.after}</td></>
          : <td colSpan={3}>未表示</td>}
      </tr>)}</tbody>
    </table>
    <p role="status">{finished ? `繰り返しが終了しました。最後のtotalは${total}です。` :
      visibleRows > 0 ? `nが${visibleRows}の行を表示しました。` : ''}</p>
    <button className="secondary" disabled={finished} onClick={() => setVisibleRows(visibleRows + 1)}>次の行を表示</button>{' '}
    <button className="secondary" disabled={visibleRows === 0} onClick={() => setVisibleRows(0)}>最初に戻す</button>
  </details>;
}
