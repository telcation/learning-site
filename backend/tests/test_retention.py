from datetime import date
import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import text
from app.main import create_app
from app.retention import maintain_retention, retention_status
from app.content import QUESTIONS
from test_pilot import env, start, get, send


def set_record(engine, auth, **values):
    cid = auth[7:].split('.')[0]
    with engine.begin() as c:
        for field, value in values.items():
            assert field in {'last_active_month', 'empty_expires_on', 'evidence', 'completed'}
            c.execute(text('UPDATE records SET '+field+'=:value WHERE credential_id=:cid'), {'value': value, 'cid': cid})


def run_cli(*args):
    spec = importlib.util.spec_from_file_location('local_retention_cli', Path(__file__).resolve().parents[1] / 'retention.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.main(list(args))


def test_empty_date_boundary_and_read_only_preview(env):
    client, engine = env
    auth, _ = start(client)
    set_record(engine, auth, empty_expires_on='2026-12-01')
    ledger = client.app.state.ledger
    database = Path(engine.url.database)
    before_db, before_ledger = database.read_bytes(), ledger.path.read_bytes()
    assert maintain_retention(engine, ledger, date(2026, 11, 30))['expired_empty'] == 0
    result = maintain_retention(engine, ledger, date(2026, 12, 1))
    assert result == dict(expired_empty=1, expired_learning=0, pending_deletions=0, deleted=0)
    assert database.read_bytes() == before_db
    assert ledger.path.read_bytes() == before_ledger
    assert ledger.records() == []


def test_learning_24_month_boundary_and_dependencies_are_removed(env):
    client, engine = env
    auth, unit = start(client)
    qid = unit['question_ids'][0]
    send(client, f'/questions/{qid}/attempts', auth, {'choice_ids': QUESTIONS[qid]['correct_ids']})
    set_record(engine, auth, last_active_month='2024-11-01')
    ledger = client.app.state.ledger
    assert maintain_retention(engine, ledger, date(2026, 10, 31))['expired_learning'] == 0
    result = maintain_retention(engine, ledger, date(2026, 11, 1), apply=True)
    assert result['expired_learning'] == result['deleted'] == 1
    assert get(client, '/records/me', auth).status_code == 401
    with engine.connect() as c:
        for table in ['records', 'attempts', 'revoked_credentials', 'idempotency']:
            assert c.execute(text('SELECT count(*) FROM '+table)).scalar_one() == 0
    assert len(ledger.records()) == 1
    assert maintain_retention(engine, ledger, date(2026, 11, 1), apply=True)['deleted'] == 0


def test_expired_learning_api_stops_without_refreshing_month(env, monkeypatch):
    import app.main as module
    client, engine = env
    auth, unit = start(client)
    qid = unit['question_ids'][0]
    send(client, f'/questions/{qid}/attempts', auth, {'choice_ids': QUESTIONS[qid]['correct_ids']})
    set_record(engine, auth, last_active_month='2024-11-01')
    monkeypatch.setattr(module, 'today', lambda: date(2026, 11, 1))
    for path in ['/records/me', '/learning-home', '/progress']:
        response = get(client, path, auth)
        assert response.status_code == 410
        assert response.json()['code'] == 'RECORD_EXPIRED'
    assert send(client, f'/questions/{qid}/attempts', auth, {'choice_ids': QUESTIONS[qid]['correct_ids']}).status_code == 410
    with engine.connect() as c:
        assert c.execute(text('SELECT last_active_month FROM records')).scalar_one() == '2024-11-01'


def test_first_answer_before_deadline_prevents_empty_cleanup(env, monkeypatch):
    import app.main as module
    monkeypatch.setattr(module, 'today', lambda: date(2026, 11, 30))
    client, engine = env
    auth, unit = start(client)
    set_record(engine, auth, empty_expires_on='2026-12-01')
    qid = unit['question_ids'][0]
    assert send(client, f'/questions/{qid}/attempts', auth, {'choice_ids': QUESTIONS[qid]['correct_ids']}).status_code == 201
    assert maintain_retention(engine, client.app.state.ledger, date(2026, 12, 1), apply=True)['deleted'] == 0
    assert get(client, '/progress', auth).json()[0]['correct_count'] == 1


def test_actual_evidence_is_not_deleted_as_empty_even_with_stale_flag(env):
    client, engine = env
    auth, unit = start(client)
    qid = unit['question_ids'][0]
    send(client, f'/questions/{qid}/attempts', auth, {'choice_ids': QUESTIONS[qid]['correct_ids']})
    # Preserve the prototype CHECK constraint while simulating legacy misclassification.
    with engine.begin() as c:
        c.execute(text("UPDATE records SET evidence=0,empty_expires_on='2020-01-01',last_active_month='2026-11-01'"))
    assert maintain_retention(engine, client.app.state.ledger, date(2026, 11, 8), apply=True)['deleted'] == 0


def test_cli_preview_leaves_database_and_ledger_unchanged(env, capsys):
    client, engine = env
    auth, _ = start(client)
    set_record(engine, auth, empty_expires_on='2000-01-01')
    path, ledger = Path(engine.url.database), client.app.state.ledger.path
    before = (path.read_bytes(), ledger.read_bytes())
    assert run_cli('--database', str(path)) == 0
    output = capsys.readouterr()
    assert '"mode": "preview"' in output.out and '"expired_empty": 1' in output.out
    assert 'Bearer' not in output.out
    assert (path.read_bytes(), ledger.read_bytes()) == before
    assert run_cli('--database', str(path), '--apply') == 0
    assert get(client, '/records/me', auth).status_code == 401


def test_cli_does_not_create_missing_database(tmp_path, capsys):
    path = tmp_path / 'missing.db'
    assert run_cli('--database', str(path)) == 1
    assert not path.exists()
    output = capsys.readouterr()
    assert output.err.strip() == '{"code":"RETENTION_FAILED"}'
    assert str(path) not in output.err


def test_invalid_retention_date_does_not_delete(env):
    client, engine = env
    auth, _ = start(client)
    set_record(engine, auth, empty_expires_on='not-a-date')
    with pytest.raises(ValueError):
        maintain_retention(engine, client.app.state.ledger, date(2026, 11, 8), apply=True)
    assert client.app.state.ledger.records() == []
    with engine.connect() as c:
        assert c.execute(text('SELECT count(*) FROM records')).scalar_one() == 1


def test_learning_reads_do_not_extend_month_but_first_completion_does(env, monkeypatch):
    import app.main as module
    monkeypatch.setattr(module, 'today', lambda: date(2026, 11, 8))
    client, engine = env
    auth, unit = start(client)
    for qid in unit['question_ids']:
        assert send(client, f'/questions/{qid}/attempts', auth, {'choice_ids': QUESTIONS[qid]['correct_ids']}).status_code == 201
    set_record(engine, auth, last_active_month='2025-01-01')
    for path in ['/records/me', '/learning-home', '/progress']:
        assert get(client, path, auth).status_code == 200
    assert get(client, '/records/me', auth).json()['last_active_month'] == '2025-01-01'
    request_id = __import__('uuid').uuid4().hex
    # UUID wire format is canonical, as for all other write requests.
    request_id = str(__import__('uuid').UUID(request_id))
    path = f"/units/{unit['unit_version_id']}/assess"
    assert send(client, path, auth, request_id=request_id).status_code == 200
    assert get(client, '/records/me', auth).json()['last_active_month'] == '2026-11-01'
    monkeypatch.setattr(module, 'today', lambda: date(2026, 12, 8))
    assert send(client, path, auth, request_id=request_id).status_code == 200
    assert get(client, '/records/me', auth).json()['last_active_month'] == '2026-11-01'


def test_cli_default_matches_api_project_root_database(tmp_path, capsys):
    project = tmp_path / 'learning-site'
    (project / '.local').mkdir(parents=True)
    (project / 'backend').mkdir()
    database = project / '.local' / 'learning.db'
    app = create_app('sqlite:///' + database.as_posix(), b't'*32)
    app.state.engine.dispose()
    spec = importlib.util.spec_from_file_location('default_path_cli', Path(__file__).resolve().parents[1] / 'retention.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.__file__ = str(project / 'backend' / 'retention.py')
    before = database.read_bytes()
    assert module.main([]) == 0
    assert '"mode": "preview"' in capsys.readouterr().out
    assert database.read_bytes() == before
    assert not (project / 'backend' / '.local').exists()
