import { useState } from 'react';

const rows = [1, 2, 3].map((n, index) => {
  const before = index === 0 ? 0 : 1;
  const condition = n % 2 === 1;
  return { n, before, condition, after: condition ? before + n : before };
});

export function TracePractice() {
  const [visibleRows, setVisibleRows] = useState(0);
  const finished = visibleRows === rows.length;

  return <details>
    <summary>トレース表で一行ずつ確認する</summary>
    <p>最初のtotalは0です。各回の条件と加算後の値を予想してから、次の行を表示してください。</p>
    <table>
      <caption>教材の疑似言語をnが1から3まで実行した場合</caption>
      <thead><tr><th scope="col">n</th><th scope="col">条件</th><th scope="col">加算前</th><th scope="col">加算後</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={row.n}>
        <th scope="row">{row.n}</th>
        {index < visibleRows ? <><td>{row.condition ? '真' : '偽'}</td><td>{row.before}</td><td>{row.after}</td></>
          : <td colSpan={3}>未表示</td>}
      </tr>)}</tbody>
    </table>
    <p role="status">{finished ? '繰り返しが終了しました。最後のtotalは4です。' :
      visibleRows > 0 ? `nが${visibleRows}の行を表示しました。` : ''}</p>
    <button className="secondary" disabled={finished} onClick={() => setVisibleRows(visibleRows + 1)}>次の行を表示</button>{' '}
    <button className="secondary" disabled={visibleRows === 0} onClick={() => setVisibleRows(0)}>最初に戻す</button>
  </details>;
}
