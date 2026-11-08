import shutil
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from app.main import create_app
from app.content import QUESTIONS
from test_pilot import env, start, key, get, send, rotation_payload


def test_delete_removes_dependencies_and_isolates_other_records(env):
    client, engine = env
    old, unit = start(client)
    qid = unit['question_ids'][0]
    send(client, f'/questions/{qid}/attempts', old, {'choice_ids': QUESTIONS[qid]['correct_ids']})
    new = key()
    revision = get(client, '/records/me', old).json()['revision']
    assert send(client, '/credentials/rotate', old, rotation_payload(new, revision)).status_code == 200
    other, _ = start(client, 1)
    before = get(client, '/records/me', new).json()
    payload = dict(confirm=True, revision=before['revision'])
    rid = str(uuid4())
    response = send(client, '/records/me/delete', new, payload, rid)
    assert response.status_code == 204 and response.content == b''
    assert get(client, '/records/me', new).status_code == 401
    assert get(client, '/records/me', old).status_code == 401
    assert send(client, '/records/me/delete', new, payload, rid).status_code == 401
    assert get(client, '/records/me', other).status_code == 200
    with engine.connect() as c:
        assert c.execute(text('SELECT count(*) FROM records WHERE id=:id'), {'id': before['record_id']}).scalar_one() == 0
        assert c.execute(text('SELECT count(*) FROM attempts')).scalar_one() == 0
        assert c.execute(text('SELECT count(*) FROM revoked_credentials')).scalar_one() == 0
        for auth in [old, new]:
            assert c.execute(text('SELECT count(*) FROM idempotency WHERE credential_id=:cid'), {'cid': auth[7:].split('.')[0]}).scalar_one() == 0
    ledger = client.app.state.ledger
    assert ledger.records() == [before['record_id']]
    with ledger.engine.connect() as c:
        saved = str(c.execute(text('SELECT * FROM deletion_tombstones')).all())
        assert old[7:] not in saved and new[7:] not in saved


def test_delete_requires_confirmation_revision_and_request_id(env):
    client, _ = env
    auth, _ = start(client)
    before = get(client, '/records/me', auth).json()
    for payload in [dict(confirm=False, revision=0), dict(confirm=1, revision=0), dict(confirm=True, revision=True), dict(confirm=True, revision=0, email='rejected')]:
        assert send(client, '/records/me/delete', auth, payload).status_code == 400
    assert send(client, '/records/me/delete', auth, dict(confirm=True, revision=0), 'bad-id').status_code == 400
    assert send(client, '/records/me/delete', auth, dict(confirm=True, revision=1)).status_code == 409
    assert get(client, '/records/me', auth).json() == before
    assert client.app.state.ledger.records() == []


def test_delete_reapplies_ledger_after_old_database_restore(tmp_path):
    database = tmp_path / 'learning.db'
    backup = tmp_path / 'backup.db'
    url = 'sqlite:///' + database.as_posix()
    app = create_app(url, b't'*32)
    with TestClient(app) as client:
        auth, _ = start(client)
        record = get(client, '/records/me', auth).json()
        app.state.engine.dispose()
        shutil.copyfile(database, backup)
        assert send(client, '/records/me/delete', auth, dict(confirm=True, revision=record['revision'])).status_code == 204
    app.state.engine.dispose()
    shutil.copyfile(backup, database)
    restored = create_app(url, b't'*32)
    with TestClient(restored) as client:
        assert get(client, '/records/me', auth).status_code == 401
        with restored.state.engine.connect() as c:
            assert c.execute(text('SELECT count(*) FROM records')).scalar_one() == 0
            assert c.execute(text('SELECT count(*) FROM idempotency')).scalar_one() == 0
    restored.state.engine.dispose()


def test_missing_deletion_ledger_stops_startup(tmp_path):
    url = 'sqlite:///' + (tmp_path / 'learning.db').as_posix()
    app = create_app(url, b't'*32)
    path = app.state.ledger.path
    app.state.engine.dispose()
    path.unlink()
    with pytest.raises(RuntimeError, match='DELETION_LEDGER_REQUIRED'):
        create_app(url, b't'*32)


def test_ledger_write_failure_does_not_erase_data(env, monkeypatch):
    client, _ = env
    auth, _ = start(client)
    before = get(client, '/records/me', auth).json()
    def fail(_): raise OSError('private-path')
    monkeypatch.setattr(client.app.state.ledger, 'record', fail)
    result = send(client, '/records/me/delete', auth, dict(confirm=True, revision=before['revision']))
    assert result.status_code == 503 and 'private-path' not in result.text
    assert get(client, '/records/me', auth).json() == before
    assert client.app.state.ledger.records() == []


def test_interrupted_delete_denies_access_and_finishes_at_restart(tmp_path, monkeypatch):
    import app.main as module
    url = 'sqlite:///' + (tmp_path / 'learning.db').as_posix()
    app = create_app(url, b't'*32)
    with TestClient(app) as client:
        auth, _ = start(client)
        before = get(client, '/records/me', auth).json()
        original = module.purge_record
        def fail(c, record_id): raise RuntimeError('injected-interruption')
        monkeypatch.setattr(module, 'purge_record', fail)
        result = send(client, '/records/me/delete', auth, dict(confirm=True, revision=before['revision']))
        assert result.status_code == 503
        assert get(client, '/records/me', auth).status_code == 401
        assert app.state.ledger.records() == [before['record_id']]
        monkeypatch.setattr(module, 'purge_record', original)
    app.state.engine.dispose()
    restored = create_app(url, b't'*32)
    with TestClient(restored) as client:
        assert get(client, '/records/me', auth).status_code == 401
        with restored.state.engine.connect() as c:
            assert c.execute(text('SELECT count(*) FROM records')).scalar_one() == 0
    restored.state.engine.dispose()


def test_concurrent_answer_and_delete_preserve_revision_rules(env):
    from concurrent.futures import ThreadPoolExecutor
    client, _ = env
    auth, unit = start(client)
    qid = unit['question_ids'][0]
    def answer():
        return send(client, f'/questions/{qid}/attempts', auth, {'choice_ids': QUESTIONS[qid]['correct_ids']}).status_code
    def delete():
        return send(client, '/records/me/delete', auth, dict(confirm=True, revision=0)).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        a = pool.submit(answer)
        d = pool.submit(delete)
        statuses = (a.result(), d.result())
    assert statuses in [(201, 409), (401, 204)]
    if statuses[1] == 409:
        assert get(client, '/progress', auth).json()[0]['correct_count'] == 1
        assert client.app.state.ledger.records() == []
    else:
        assert get(client, '/records/me', auth).status_code == 401


def test_wrong_deletion_ledger_stops_startup(tmp_path):
    first = create_app('sqlite:///' + (tmp_path / 'one.db').as_posix(), b't'*32)
    second = create_app('sqlite:///' + (tmp_path / 'two.db').as_posix(), b't'*32)
    first.state.engine.dispose()
    second.state.engine.dispose()
    shutil.copyfile(second.state.ledger.path, first.state.ledger.path)
    with pytest.raises(RuntimeError, match='DELETION_LEDGER_MISMATCH'):
        create_app('sqlite:///' + (tmp_path / 'one.db').as_posix(), b't'*32)
