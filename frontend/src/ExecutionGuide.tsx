import { executableSource } from './execution-guide';
import { TracePractice } from './TracePractice';

export function ExecutionGuide({language,snippet}:{language:'java'|'python'|null;snippet:string}) {
  if(!snippet.trim())return null;
  if(language===null)return <section className="panel execution-guide"><h2>紙や手元のメモでトレースする手順</h2>
    <p>基本情報コースでは、Java・Python・GitHubの準備は不要です。</p>
    <details><summary>変数の値を追う手順を開く</summary><ol>
      <li>紙やメモに「n」「条件は真か」「加算前のtotal」「加算後のtotal」の4列を用意します。</li>
      <li>最初はtotalが0です。教材を上から読み、nが1、2、3のそれぞれについて1行ずつ書きます。</li>
      <li>条件が真の回だけnを加算します。偽の回はtotalをそのまま次の回へ引き継ぎます。</li>
      <li>最後の値を確認したら、下の実践課題の指定どおり範囲や条件を変えて確かめます。</li>
    </ol><p>メモの内容はこのサイトに保存されません。確認できた項目だけを、下の実践課題で自己チェックして記録してください。</p></details>
    <TracePractice />
  </section>;
  const python=language==='python',filename=python?'odd_sum.py':'OddSum.java';
  const source=executableSource(language,snippet);
  return <section className="panel execution-guide"><h2>PCで実行する手順</h2>
    <p>{python?'Python':'Java'}の教材を、手元のPCでファイルに保存して実行します。スマートフォンなどで学習中の場合は、同じ学習コードでPCから再開できます。</p>
    <details><summary>保存するコードと実行手順を開く</summary>
      <p>以下はWindowsのPowerShellでの手順です。IDEを使う場合も、同じファイルを作成して実行できます。コマンドの先頭に「PS … &gt;」などの表示は入力しません。</p>
      <ol>
        <li><strong>実行環境を確認する</strong><p>{python?'Python 3が必要です。':'JDKが必要です。Javaを実行する環境に加えて、コンパイル用のjavacも必要です。'}次のコマンドでバージョンが表示されることを確認します。</p>
          <pre><code>{python?'python --version':'java -version\njavac -version'}</code></pre>
          <p>コマンドが見つからない場合は、インストールやPATH、IDEで選択した実行環境を確認してください。{python?'Windowsでpyが使える環境では、代わりに「py -3 --version」で確認し、以降のpythonを「py -3」に置き換えられます。':''}環境の準備ができていなくても、教材や確認問題には取り組めます。</p>
        </li>
        <li><strong>作業フォルダーとファイルを作る</strong><p>ご自身の作業場所にpracticeフォルダーを作り、エディターでその中に <code>{filename}</code> を作成します。実践課題にある保存先の例と同じ名前です。</p>
          <p>下のコード全体をコピーして貼り付け、保存してください。ファイル名の末尾が <code>{filename}.txt</code> にならないよう確認します。</p>
          {!python&&<p>上の教材はmainメソッド内の処理だけを示しています。下のコードでは、実行に必要なクラスとmainメソッドも含めています。クラス名OddSumとファイル名OddSum.javaの大文字・小文字をそろえてください。</p>}
          <pre><code>{source}</code></pre>
        </li>
        <li><strong>practiceフォルダーでPowerShellを開く</strong><p>エクスプローラーでpracticeフォルダーを開き、アドレス欄に <code>powershell</code> と入力してEnterを押します。開いた画面で次を実行し、ファイル名が表示されることを確認します。</p><pre><code>Get-ChildItem</code></pre></li>
        <li><strong>実行して結果を確認する</strong><pre><code>{python?'python odd_sum.py':'javac OddSum.java\njava OddSum'}</code></pre>
          <p>{python?'':'javacがエラーなく終了してからjavaを実行します。'}教材どおりなら <code>4</code> と表示されます。</p>
        </li>
        <li><strong>下の実践課題に沿って変更する</strong><p>範囲や条件を変更したら、ファイルを保存してからもう一度実行します。{!python&&'Javaでは変更のたびにjavacでコンパイルし直してからjavaで実行してください。'}実際に確かめた項目だけ、自己チェックして記録します。</p></li>
      </ol>
      <p>このサイトがPCのプログラムを実行したり、出力を検証したりする機能ではありません。ファイルや実行結果の送信も行いません。</p>
    </details>
  </section>;
}
