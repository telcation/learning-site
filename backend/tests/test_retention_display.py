from datetime import date

import pytest
from sqlalchemy import text

from app.content import QUESTIONS
from test_pilot import env, start, get, send
from test_retention import set_record


@pytest.mark.parametrize('learning,month,empty_deadline,expected', [
    (False, '2026-11-01', '2026-12-01', '2026-12-01'),
    (False, '2026-11-01', '2028-02-29', '2028-02-29'),
    (True, '2026-11-01', None, '2028-11-01'),
    (True, '2026-12-01', None, '2028-12-01'),
])
def test_home_reports_actual_retention_deadline_without_renewal(env, monkeypatch, learning, month, empty_deadline, expected):
    import app.main as module
    monkeypatch.setattr(module, 'today', lambda: date(2026, 11, 9))
    client, engine = env
    auth, unit = start(client)
    if learning:
        qid = unit['question_ids'][0]
        send(client, f'/questions/{qid}/attempts', auth, {'choice_ids': QUESTIONS[qid]['correct_ids']})
    set_record(engine, auth, last_active_month=month, empty_expires_on=empty_deadline)
    with engine.connect() as c:
        before = dict(c.execute(text('SELECT * FROM records')).mappings().one())
    for _ in range(2):
        response = get(client, '/learning-home', auth)
        assert response.status_code == 200
        home = response.json()
        assert home['retention_kind'] == ('learning' if learning else 'empty')
        assert home['retention_expires_on'] == expected
        assert home['last_active_month'] == (month if learning else None)
    with engine.connect() as c:
        assert dict(c.execute(text('SELECT * FROM records')).mappings().one()) == before
    monkeypatch.setattr(module, 'today', lambda: date.fromisoformat(expected))
    assert get(client, '/learning-home', auth).status_code == 410
