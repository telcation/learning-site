from concurrent.futures import ThreadPoolExecutor
from datetime import date
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlalchemy import text
from app.main import create_app
from test_pilot import env, start, get, send, key, rotation_payload
from test_enrollments import enroll, switch, complete
from test_practice import assignment, payload


def save(client,auth,route,language,revision,request_id=None,extra=None):
    body=dict(study_route=route,preferred_language=language,revision=revision)
    if extra:body.update(extra)
    return client.put('/api/v1/learning-preferences',headers={'Authorization':auth,'Idempotency-Key':request_id or str(uuid4())},json=body)


def test_preferences_do_not_switch_course_or_reset_progress(env):
    client,_=env
    auth,first=start(client)
    complete(client,auth,first)
    second=enroll(client,auth,1)
    assert switch(client,auth,second).status_code==200
    before=get(client,'/learning-home',auth).json()
    assert before['study_route']=='practice' and before['preferred_language']=='python'
    assert before['next_action']['unit_version_id']==second['unit_version_id']
    progress=get(client,'/progress',auth).json()
    assert save(client,auth,'fe',None,before['revision']).status_code==200
    after=get(client,'/learning-home',auth).json()
    assert after['study_route']=='fe' and after['preferred_language'] is None
    assert after['next_action']==before['next_action']
    assert after['enrolled_course_version_ids']==before['enrolled_course_version_ids']
    assert get(client,'/progress',auth).json()==progress


def test_invalid_preferences_and_private_fields_are_rejected(env):
    client,_=env
    auth,_=start(client)
    before=get(client,'/learning-home',auth).json()
    for route,language,revision in [('practice',None,0),('unknown','python',0),('practice','unknown',0),('fe',None,True),('fe',None,-1)]:
        assert save(client,auth,route,language,revision).status_code==400
    result=save(client,auth,'fe',None,0,extra={'email':'PRIVATE_CANARY'})
    assert result.status_code==400 and 'PRIVATE_CANARY' not in result.text
    assert get(client,'/learning-home',auth).json()==before


def test_changed_preferences_extend_empty_deadline_but_replay_and_noop_do_not(env,monkeypatch):
    import app.main as module
    monkeypatch.setattr(module,'today',lambda:date(2026,11,1))
    client,_=env
    auth,_=start(client)
    monkeypatch.setattr(module,'today',lambda:date(2026,11,10))
    request_id=str(uuid4())
    first=save(client,auth,'fe',None,0,request_id)
    assert first.status_code==200
    before=get(client,'/records/me',auth).json()
    assert before['empty_expires_on']=='2026-12-10' and before['revision']==1
    monkeypatch.setattr(module,'today',lambda:date(2026,11,11))
    assert save(client,auth,'fe',None,0,request_id).json()==first.json()
    assert save(client,auth,'fe',None,1).status_code==200
    assert get(client,'/records/me',auth).json()==before
    assert save(client,auth,'practice','java',0).status_code==409


def test_simultaneous_preferences_changes_have_one_winner(env):
    client,_=env
    auth,_=start(client)
    choices=[('practice','java'),('fe',None)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda choice:save(client,auth,*choice,0),choices))
    assert sorted(result.status_code for result in results)==[200,409]
    winner=choices[next(i for i,result in enumerate(results) if result.status_code==200)]
    home=get(client,'/learning-home',auth).json()
    assert (home['study_route'],home['preferred_language'])==winner


def test_existing_record_migration_and_saved_preferences_survive_restart(tmp_path):
    url='sqlite:///'+(tmp_path/'learning.db').as_posix()
    app=create_app(url,b't'*32)
    with TestClient(app) as client:
        auth,_=start(client,1)
        before=get(client,'/records/me',auth).json()
    with app.state.engine.begin() as c:c.exec_driver_sql('DROP TABLE learning_preferences')
    app.state.engine.dispose()
    migrated=create_app(url,b't'*32)
    with TestClient(migrated) as client:
        home=get(client,'/learning-home',auth).json()
        assert (home['study_route'],home['preferred_language'])==('practice','java')
        assert get(client,'/records/me',auth).json()==before
        assert save(client,auth,'fe','python',home['revision']).status_code==200
        other=enroll(client,auth,0)
        assert switch(client,auth,other).status_code==200
    migrated.state.engine.dispose()
    restarted=create_app(url,b't'*32)
    with TestClient(restarted) as client:
        home=get(client,'/learning-home',auth).json()
        assert (home['study_route'],home['preferred_language'])==('fe','python')
    restarted.state.engine.dispose()


def test_preferences_follow_key_rotation_and_are_deleted_with_record(env):
    client,engine=env
    auth,_=start(client)
    assert save(client,auth,'practice','java',0).status_code==200
    new=key()
    assert send(client,'/credentials/rotate',auth,rotation_payload(new,1)).status_code==200
    assert save(client,auth,'fe',None,2).status_code==401
    home=get(client,'/learning-home',new).json()
    assert home['preferred_language']=='java'
    assert send(client,'/records/me/delete',new,{'confirm':True,'revision':home['revision']}).status_code==204
    with engine.connect() as c:assert c.execute(text('SELECT count(*) FROM learning_preferences')).scalar_one()==0


def test_learning_preferences_update_activity_month_but_reads_do_not(env,monkeypatch):
    import app.main as module
    monkeypatch.setattr(module,'today',lambda:date(2026,11,1))
    client,_=env
    auth,unit=start(client)
    a=assignment(client,auth,unit)
    assert send(client,'/practice-attempts',auth,payload(a)).status_code==201
    monkeypatch.setattr(module,'today',lambda:date(2026,12,1))
    home=get(client,'/learning-home',auth).json()
    assert save(client,auth,'fe',None,home['revision']).status_code==200
    monkeypatch.setattr(module,'today',lambda:date(2027,1,1))
    assert get(client,'/learning-home',auth).status_code==200
    record=get(client,'/records/me',auth).json()
    assert record['last_active_month']=='2026-12-01' and record['empty_expires_on'] is None


def test_preferences_are_isolated_and_expired_record_cannot_change_them(env):
    client,engine=env
    auth,_=start(client)
    other,_=start(client,1)
    assert save(client,auth,'fe',None,0).status_code==200
    home=get(client,'/learning-home',other).json()
    assert (home['study_route'],home['preferred_language'])==('practice','java')
    with engine.begin() as c:c.execute(text("UPDATE records SET empty_expires_on='2000-01-01' WHERE credential_id=:cid"),{'cid':auth[7:].split('.')[0]})
    assert save(client,auth,'practice','java',1).status_code==410
