"""Original, versioned pilot content. Not official examination questions."""
from uuid import UUID

def uid(n):
    return str(UUID(f'{n:032x}', version=4))

COURSES = []
UNITS = {}
QUESTIONS = {}

DATA = [
    ('python', 'Pythonではじめるプログラミング', '条件分岐と繰り返し',
     'プログラムは、順次・選択・反復という制御構造を組み合わせて作ります。Pythonの条件分岐は if、反復は for を使います。インデントは処理のまとまりを表します。',
     'total = 0\nfor n in range(1, 4):\n    if n % 2 == 1:\n        total += n\nprint(total)',
     [('range(1, 4) が順に生成する値は？', ['1, 2, 3', '1, 2, 3, 4', '0, 1, 2, 3'], 0, 'range の終端 4 は含まれません。1、2、3の3回です。'),
      ('このコードの最後に表示される値は？', ['3', '4', '6'], 1, '奇数の 1 と 3 だけを加算するので、total は 4 です。')]),
    ('java', 'Javaではじめるプログラミング', '条件分岐と繰り返し',
     'Javaでは波括弧で処理のまとまりを表します。for は初期化・継続条件・更新の順で記述します。if の条件が真の場合だけ、そのブロックを実行します。',
     'int total = 0;\nfor (int n = 1; n < 4; n++) {\n    if (n % 2 == 1) {\n        total += n;\n    }\n}\nSystem.out.println(total);',
     [('n < 4 を満たしてループ本体が実行される回数は？', ['2回', '3回', '4回'], 1, 'n は 1、2、3 のときに条件を満たし、3回実行します。'),
      ('このコードで total に加算される値の組は？', ['1 と 3', '1 と 2 と 3', '2 だけ'], 0, '剰余 n % 2 が 1 である奇数だけを加算します。結果は 4 です。')]),
    (None, '基本情報技術者・アルゴリズム入門', '疑似言語を一行ずつ読む',
     '疑似言語は処理の手順を表すための表現です。この教材では ← を代入、mod を剰余として使います。繰り返しの各回で、変数の値を追いましょう。JavaやPythonのインストールは不要です。',
     'total ← 0\nfor (n を 1 から 3 まで 1 ずつ増やす)\n    if (n mod 2 = 1)\n        total ← total + n\n    endif\nendfor',
     [('n = 2 の回の終了時、total の値は？', ['0', '1', '3'], 1, 'n = 1 で total は 1。n = 2 では条件が偽なので、そのまま 1 です。'),
      ('繰り返し終了後の total の値は？', ['3', '4', '6'], 1, 'n = 3 の回に 3 を加え、1 + 3 = 4 になります。')])
]

for index, (language, title, unit_title, text, code, questions) in enumerate(DATA, 1):
    cid, unit_id = uid(index), uid(index * 100)
    COURSES.append(dict(id=cid, course_id=uid(index + 10000), language=language,
                        version=1, title=title, available=True,
                        course_kind='practice' if language else 'exam_common', exam_version_id=None))
    qids = []
    for j, (prompt, choices, answer, explanation) in enumerate(questions, 1):
        qid = uid(index * 100 + j)
        opts = [dict(id=uid(index * 1000 + j * 10 + k), text=t) for k, t in enumerate(choices)]
        QUESTIONS[qid] = dict(question_version_id=qid, unit_version_id=unit_id, kind='single',
                              prompt=prompt, choices=opts, correct_ids=[opts[answer]['id']], explanation=explanation)
        qids.append(qid)
    UNITS[unit_id] = dict(unit_version_id=unit_id, course_version_id=cid, revision=1,
                          title=unit_title, markdown=text + '\n\n```\n' + code + '\n```\n\n各回の n と total を手元で追ってから、確認問題に進みましょう。', question_ids=qids)

# Publish a separate immutable version rather than altering old completion rules.
new_courses = []
for index, old_course in enumerate(COURSES, 1):
    old_course['available'] = False
    old_unit = UNITS[uid(index * 100)]
    version_index = index + 10
    cid, unit_id = uid(version_index), uid(version_index * 100)
    new_courses.append({**old_course, 'id': cid, 'version': 2, 'available': True})
    qids = []
    for j, old_qid in enumerate(old_unit['question_ids'], 1):
        old_q = QUESTIONS[old_qid]
        opts = [dict(id=uid(version_index * 10000 + j * 10 + k), text=opt['text']) for k, opt in enumerate(old_q['choices'])]
        correct_index = next(k for k, opt in enumerate(old_q['choices']) if opt['id'] in old_q['correct_ids'])
        qid = uid(version_index * 100 + j)
        QUESTIONS[qid] = {**old_q, 'question_version_id': qid, 'unit_version_id': unit_id,
                          'choices': opts, 'correct_ids': [opts[correct_index]['id']]}
        qids.append(qid)
    for j, kind, prompt, labels, correct, explanation in [
        (3, 'multi', '教材の処理について、正しい説明をすべて選んでください。',
         ['n が 1 のとき total に加算する', 'n が 2 のとき total に加算する',
          'n が 3 のとき total に加算する', '最後の total は 6 になる'], [0, 2],
         '奇数の 1 と 3 だけを加算します。2 は加算せず、最後の total は 4 です。正しい選択肢を過不足なく選ぶと正解です。'),
        (4, 'order', '教材の処理を大まかな3段階に分けました。実行する順番に並べてください。',
         ['繰り返し終了後の total を確認する', 'total を 0 に初期化する',
          'n を 1 から 3 まで順に取り出し、奇数のときだけ total に加算する'], [1, 2, 0],
         '最初に total を 0 にし、次に繰り返しで加算し、最後に結果を確認します。すべての手順の順序が一致すると正解です。'),
    ]:
        qid = uid(version_index * 100 + j)
        opts = [dict(id=uid(version_index * 10000 + j * 10 + k), text=label) for k, label in enumerate(labels)]
        QUESTIONS[qid] = dict(question_version_id=qid, unit_version_id=unit_id, kind=kind,
                              prompt=prompt, choices=opts, correct_ids=[opts[k]['id'] for k in correct], explanation=explanation)
        qids.append(qid)
    UNITS[unit_id] = {**old_unit, 'unit_version_id': unit_id, 'course_version_id': cid,
                      'revision': 2, 'question_ids': qids}
COURSES = new_courses + COURSES


def public_question(qid):
    return {k: v for k, v in QUESTIONS[qid].items() if k not in ('correct_ids', 'explanation')}
