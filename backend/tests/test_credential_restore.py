import shutil
from fastapi.testclient import TestClient
from app.main import create_app
from test_pilot import start, get, send, key, rotation_payload


def test_old_database_restore_keeps_old_key_revoked(tmp_path):
    path=tmp_path/'learning.db';backup=tmp_path/'before-rotation.db'
    url='sqlite:///'+path.as_posix()
    app=create_app(url,b't'*32)
    with TestClient(app) as client:
        old,_=start(client)
        before=get(client,'/records/me',old).json()
        app.state.engine.dispose();shutil.copyfile(path,backup)
        new=key()
        status=send(client,'/credentials/rotate',old,rotation_payload(new,before['revision'])).status_code
        assert status==200
    app.state.engine.dispose();shutil.copyfile(backup,path)
    restored=create_app(url,b't'*32)
    with TestClient(restored) as client:
        old_status=get(client,'/records/me',old).status_code
        assert old_status==401
        current=get(client,'/records/me',new)
        assert current.status_code==200
        assert current.json()['record_id']==before['record_id']
    restored.state.engine.dispose()

import pytest
from sqlalchemy import event, text
from app.content import COURSES, QUESTIONS
from test_retention import run_cli


def bootstrap_body(index=0):
    course=COURSES[index]
    return dict(course_version_id=course['id'],study_route='practice' if course['language'] else 'fe',preferred_language=course['language'])


def test_multiple_rotations_restore_only_latest_key_and_keep_backed_up_progress(tmp_path):
    path=tmp_path/'learning.db';backup=tmp_path/'backup.db';url='sqlite:///'+path.as_posix()
    app=create_app(url,b't'*32)
    with TestClient(app) as client:
        old,unit=start(client)
        qid=unit['question_ids'][0]
        send(client,'/questions/'+qid+'/attempts',old,{'choice_ids':QUESTIONS[qid]['correct_ids']})
        before=get(client,'/records/me',old).json()
        app.state.engine.dispose();shutil.copyfile(path,backup)
        middle,new=key(),key()
        assert send(client,'/credentials/rotate',old,rotation_payload(middle,before['revision'])).status_code==200
        revision=get(client,'/records/me',middle).json()['revision']
        assert send(client,'/credentials/rotate',middle,rotation_payload(new,revision)).status_code==200
        journal=app.state.credential_ledger.path.read_bytes()
        assert old[7:].encode() not in journal and new[7:].split('.')[1].encode() not in journal
    app.state.engine.dispose();shutil.copyfile(backup,path)
    restored=create_app(url,b't'*32)
    with TestClient(restored) as client:
        assert get(client,'/records/me',old).status_code==401
        assert get(client,'/records/me',middle).status_code==401
        after=get(client,'/records/me',new).json()
        assert after['record_id']==before['record_id']
        assert after['last_active_month']==before['last_active_month']
        assert get(client,'/progress',new).json()[0]['correct_count']==1
    restored.state.engine.dispose()


def test_committed_key_ledger_recovers_after_learning_db_write_failure(tmp_path):
    path=tmp_path/'learning.db';url='sqlite:///'+path.as_posix();app=create_app(url,b't'*32)
    with TestClient(app) as client:
        old,_=start(client);new=key()
        before=get(client,'/records/me',old).json()
        def fail_update(conn,cursor,statement,parameters,context,executemany):
            if statement.startswith('UPDATE records SET credential_id='):
                raise RuntimeError('PRIVATE_INJECTED_FAILURE')
        event.listen(app.state.engine,'before_cursor_execute',fail_update)
        result=send(client,'/credentials/rotate',old,rotation_payload(new,before['revision']))
        event.remove(app.state.engine,'before_cursor_execute',fail_update)
        assert result.status_code==503 and 'PRIVATE_INJECTED_FAILURE' not in result.text
        assert get(client,'/records/me',old).status_code==401
        assert send(client,'/records',old,bootstrap_body()).status_code==401
        assert send(client,'/records',new,bootstrap_body()).status_code==401
        with app.state.engine.connect() as c:assert c.execute(text('SELECT count(*) FROM records')).scalar_one()==1
    app.state.engine.dispose()
    repaired=create_app(url,b't'*32)
    with TestClient(repaired) as client:
        assert get(client,'/records/me',old).status_code==401
        after=get(client,'/records/me',new)
        assert after.status_code==200 and after.json()['record_id']==before['record_id']
    repaired.state.engine.dispose()


def test_key_ledger_write_failure_keeps_current_key(tmp_path,monkeypatch):
    app=create_app('sqlite:///'+(tmp_path/'learning.db').as_posix(),b't'*32)
    with TestClient(app) as client:
        old,_=start(client);new=key();before=get(client,'/records/me',old).json()
        def fail(*args):raise OSError('PRIVATE_PATH')
        monkeypatch.setattr(app.state.credential_ledger,'rotate',fail)
        response=send(client,'/credentials/rotate',old,rotation_payload(new,before['revision']))
        assert response.status_code==503 and 'PRIVATE_PATH' not in response.text
        assert get(client,'/records/me',old).json()==before
        assert get(client,'/records/me',new).status_code==401
    app.state.engine.dispose()


def test_missing_key_ledger_is_not_recreated_by_api_or_startup(tmp_path):
    url='sqlite:///'+(tmp_path/'learning.db').as_posix();app=create_app(url,b't'*32)
    with TestClient(app) as client:
        old,_=start(client)
        path=app.state.credential_ledger.path
        path.unlink()
        assert get(client,'/records/me',old).status_code==503
        assert client.get('/api/v1/health').status_code==503
        assert not path.exists()
    app.state.engine.dispose()
    with pytest.raises(RuntimeError,match='CREDENTIAL_LEDGER_REQUIRED'):create_app(url,b't'*32)


def test_wrong_key_ledger_stops_startup(tmp_path):
    first=create_app('sqlite:///'+(tmp_path/'one.db').as_posix(),b't'*32)
    second=create_app('sqlite:///'+(tmp_path/'two.db').as_posix(),b't'*32)
    first.state.engine.dispose();second.state.engine.dispose()
    shutil.copyfile(second.state.credential_ledger.path,first.state.credential_ledger.path)
    with pytest.raises(RuntimeError,match='CREDENTIAL_LEDGER_MISMATCH'):
        create_app('sqlite:///'+(tmp_path/'one.db').as_posix(),b't'*32)


def test_known_stale_key_ledger_never_rolls_back_a_newer_main_db(tmp_path):
    path=tmp_path/'learning.db';stale=tmp_path/'stale.credentials';url='sqlite:///'+path.as_posix();app=create_app(url,b't'*32)
    with TestClient(app) as client:
        old,_=start(client);middle,new=key(),key()
        assert send(client,'/credentials/rotate',old,rotation_payload(middle,0)).status_code==200
        shutil.copyfile(app.state.credential_ledger.path,stale)
        assert send(client,'/credentials/rotate',middle,rotation_payload(new,1)).status_code==200
    app.state.engine.dispose();shutil.copyfile(stale,app.state.credential_ledger.path)
    with pytest.raises(RuntimeError,match='CREDENTIAL_LEDGER_STALE'):create_app(url,b't'*32)


def test_initial_upgrade_imports_existing_rotations_without_key_change(tmp_path):
    path=tmp_path/'learning.db';url='sqlite:///'+path.as_posix();app=create_app(url,b't'*32)
    with TestClient(app) as client:
        old,_=start(client);new=key()
        assert send(client,'/credentials/rotate',old,rotation_payload(new,0)).status_code==200
        before=get(client,'/records/me',new).json()
    with app.state.engine.begin() as c:c.execute(text("DELETE FROM app_metadata WHERE name='credential_ledger_id'"))
    app.state.engine.dispose();app.state.credential_ledger.path.unlink()
    migrated=create_app(url,b't'*32)
    with TestClient(migrated) as client:
        assert get(client,'/records/me',old).status_code==401
        assert get(client,'/records/me',new).json()==before
    migrated.state.engine.dispose()


def test_deletion_erases_key_verifier_rows_and_wins_over_old_backup(tmp_path):
    path=tmp_path/'learning.db';backup=tmp_path/'backup.db';url='sqlite:///'+path.as_posix();app=create_app(url,b't'*32)
    with TestClient(app) as client:
        old,_=start(client);new=key()
        assert send(client,'/credentials/rotate',old,rotation_payload(new,0)).status_code==200
        record=get(client,'/records/me',new).json();rid=record['record_id']
        app.state.engine.dispose();shutil.copyfile(path,backup)
        assert send(client,'/records/me/delete',new,{'confirm':True,'revision':record['revision']}).status_code==204
        assert app.state.credential_ledger.head(rid) is None
        assert app.state.credential_ledger.revoked_for(rid)==[]
    app.state.engine.dispose();shutil.copyfile(backup,path)
    restored=create_app(url,b't'*32)
    with TestClient(restored) as client:
        assert get(client,'/records/me',old).status_code==401
        assert get(client,'/records/me',new).status_code==401
        assert restored.state.credential_ledger.head(rid) is None
    restored.state.engine.dispose()


def test_retention_command_cleans_independent_key_state(tmp_path,capsys):
    path=tmp_path/'learning.db';app=create_app('sqlite:///'+path.as_posix(),b't'*32)
    with TestClient(app) as client:
        old,_=start(client);new=key()
        assert send(client,'/credentials/rotate',old,rotation_payload(new,0)).status_code==200
        rid=get(client,'/records/me',new).json()['record_id']
        with app.state.engine.begin() as c:c.execute(text("UPDATE records SET empty_expires_on='2000-01-01'"))
        assert run_cli('--database',str(path),'--apply')==0
        assert app.state.credential_ledger.head(rid) is None
        assert app.state.ledger.contains(rid)
    app.state.engine.dispose();capsys.readouterr()


@pytest.mark.parametrize('rotate',[False,True])
def test_acknowledged_record_missing_from_backup_is_not_recreated_empty(tmp_path,rotate):
    path=tmp_path/'learning.db';empty=tmp_path/'empty.db';url='sqlite:///'+path.as_posix();app=create_app(url,b't'*32)
    app.state.engine.dispose();shutil.copyfile(path,empty)
    with TestClient(app) as client:
        original,_=start(client);current=original
        if rotate:
            current=key()
            assert send(client,'/credentials/rotate',original,rotation_payload(current,0)).status_code==200
    app.state.engine.dispose();shutil.copyfile(empty,path)
    restored=create_app(url,b't'*32)
    with TestClient(restored) as client:
        assert get(client,'/records/me',current).status_code==401
        assert send(client,'/records',current,bootstrap_body()).status_code==401
        with restored.state.engine.connect() as c:assert c.execute(text('SELECT count(*) FROM records')).scalar_one()==0
    restored.state.engine.dispose()


def test_initial_creation_retry_finishes_ledger_registration_without_duplicate_record(tmp_path,monkeypatch):
    app=create_app('sqlite:///'+(tmp_path/'learning.db').as_posix(),b't'*32)
    with TestClient(app) as client:
        auth=key();request_id=str(__import__('uuid').uuid4())
        original=app.state.credential_ledger.register
        def fail(_):raise OSError('PRIVATE_FAILURE')
        monkeypatch.setattr(app.state.credential_ledger,'register',fail)
        response=send(client,'/records',auth,bootstrap_body(),request_id)
        assert response.status_code==503 and 'PRIVATE_FAILURE' not in response.text
        with app.state.engine.connect() as c:rid=c.execute(text('SELECT id FROM records')).scalar_one()
        monkeypatch.setattr(app.state.credential_ledger,'register',original)
        retried=send(client,'/records',auth,bootstrap_body(),request_id)
        assert retried.status_code==201 and retried.json()['record_id']==rid
        assert get(client,'/records/me',auth).status_code==200
        with app.state.engine.connect() as c:assert c.execute(text('SELECT count(*) FROM records')).scalar_one()==1
    app.state.engine.dispose()
