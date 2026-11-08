from datetime import date
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
from fastapi.testclient import TestClient
from sqlalchemy import text
from app.main import create_app
from app.content import COURSES, UNITS, QUESTIONS
from test_pilot import env, start, send, get, rotation_payload, key


def put_position(client, auth, unit, revision, request_id=None):
    return client.put('/api/v1/learning-position',headers={'Authorization':auth,'Idempotency-Key':request_id or str(uuid4())},json={'unit_version_id':unit['unit_version_id'],'revision':revision})


def enroll(client, auth, index):
    response=send(client,'/enrollments/'+COURSES[index]['id'],auth)
    assert response.status_code==200, response.text
    return next(u for u in UNITS.values() if u['course_version_id']==response.json()['resource_id'])


def switch(client, auth, unit):
    return put_position(client,auth,unit,get(client,'/learning-home',auth).json()['revision'])


def answer_one(client, auth, unit):
    qid=unit['question_ids'][0]
    assert send(client,'/questions/'+qid+'/attempts',auth,{'choice_ids':QUESTIONS[qid]['correct_ids']}).status_code==201


def complete(client, auth, unit):
    for qid in unit['question_ids']:
        assert send(client,'/questions/'+qid+'/attempts',auth,{'choice_ids':QUESTIONS[qid]['correct_ids']}).status_code==201
    assert send(client,f"/units/{unit['unit_version_id']}/assess",auth).status_code==200


def test_multiple_courses_share_record_but_keep_independent_answers(env):
    client,_=env
    auth,first=start(client)
    record_id=get(client,'/records/me',auth).json()['record_id']
    answer_one(client,auth,first)
    second=enroll(client,auth,1)
    assert switch(client,auth,second).status_code==200
    answer_one(client,auth,second)
    assert switch(client,auth,first).status_code==200
    home=get(client,'/learning-home',auth).json()
    assert set(home['enrolled_course_version_ids'])=={first['course_version_id'],second['course_version_id']}
    progress=get(client,'/progress',auth).json()
    assert len(progress)==2 and all(p['correct_count']==1 for p in progress)
    assert get(client,'/records/me',auth).json()['record_id']==record_id
    assert home['next_action']['unit_version_id']==first['unit_version_id']


def test_completion_is_per_course_not_global(env):
    client,_=env
    auth,first=start(client)
    complete(client,auth,first)
    second=enroll(client,auth,1)
    assert switch(client,auth,second).status_code==200
    home=get(client,'/learning-home',auth).json()
    assert home['next_action']['kind']=='learn'
    assert send(client,f"/units/{second['unit_version_id']}/assess",auth).status_code==409
    progress={p['unit_version_id']:p for p in get(client,'/progress',auth).json()}
    assert progress[first['unit_version_id']]['state']=='completed'
    assert progress[second['unit_version_id']]['state']=='not_started'
    complete(client,auth,second)
    assert all(p['state']=='completed' for p in get(client,'/progress',auth).json())


def test_unenrolled_access_rejected_but_registered_inactive_course_is_allowed(env):
    client,_=env
    auth,first=start(client)
    other=next(u for u in UNITS.values() if u['course_version_id']==COURSES[1]['id'])
    assert get(client,'/questions/'+other['question_ids'][0],auth).status_code==404
    assert switch(client,auth,other).status_code==404
    enroll(client,auth,1)
    assert get(client,'/questions/'+other['question_ids'][0],auth).status_code==200
    answer_one(client,auth,other)
    assert get(client,'/learning-home',auth).json()['next_action']['unit_version_id']==first['unit_version_id']


def test_position_revision_conflict_has_one_winner(env):
    client,_=env
    auth,first=start(client)
    second=enroll(client,auth,1)
    third=enroll(client,auth,2)
    revision=get(client,'/learning-home',auth).json()['revision']
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses=list(pool.map(lambda unit:put_position(client,auth,unit,revision).status_code,[second,third]))
    assert sorted(statuses)==[200,409]


def test_enroll_and_position_replays_do_not_extend_retention(env, monkeypatch):
    import app.main as module
    monkeypatch.setattr(module,'today',lambda:date(2026,11,1))
    client,_=env
    auth,_=start(client)
    monkeypatch.setattr(module,'today',lambda:date(2026,11,10))
    request_id=str(uuid4())
    path='/enrollments/'+COURSES[1]['id']
    first=send(client,path,auth,request_id=request_id)
    assert first.status_code==200
    before=get(client,'/records/me',auth).json()
    assert before['empty_expires_on']=='2026-12-10'
    monkeypatch.setattr(module,'today',lambda:date(2026,11,11))
    assert send(client,path,auth,request_id=request_id).json()==first.json()
    assert send(client,path,auth).status_code==200
    assert get(client,'/records/me',auth).json()==before
    unit=next(u for u in UNITS.values() if u['course_version_id']==COURSES[1]['id'])
    position_id=str(uuid4())
    assert put_position(client,auth,unit,before['revision'],position_id).status_code==200
    after=get(client,'/records/me',auth).json()
    monkeypatch.setattr(module,'today',lambda:date(2026,11,12))
    assert put_position(client,auth,unit,before['revision'],position_id).status_code==200
    assert get(client,'/records/me',auth).json()==after
    assert put_position(client,auth,unit,before['revision']).status_code==409


def test_existing_old_version_is_not_replaced_by_enrollment(env):
    client,_=env
    auth,old=start(client,3)
    response=send(client,'/enrollments/'+COURSES[0]['id'],auth)
    assert response.status_code==200 and response.json()['resource_id']==old['course_version_id']
    assert get(client,'/learning-home',auth).json()['enrolled_course_version_ids']==[old['course_version_id']]


def test_legacy_record_completion_is_migrated_without_changing_record(tmp_path):
    url='sqlite:///'+(tmp_path/'legacy.db').as_posix()
    app=create_app(url,b't'*32)
    with TestClient(app) as client:
        auth,unit=start(client,3)
        complete(client,auth,unit)
        before=get(client,'/records/me',auth).json()
    with app.state.engine.begin() as c:
        c.exec_driver_sql('DROP TABLE enrollments')
    app.state.engine.dispose()
    migrated=create_app(url,b't'*32)
    with TestClient(migrated) as client:
        assert get(client,'/records/me',auth).json()==before
        assert get(client,'/progress',auth).json()[0]['state']=='completed'
        assert get(client,'/progress',auth).json()[0]['question_count']==2
    migrated.state.engine.dispose()


def test_rotation_and_deletion_cover_all_enrollments(env):
    client,engine=env
    auth,first=start(client)
    second=enroll(client,auth,1)
    answer_one(client,auth,second)
    new=key()
    revision=get(client,'/records/me',auth).json()['revision']
    assert send(client,'/credentials/rotate',auth,rotation_payload(new,revision)).status_code==200
    assert len(get(client,'/progress',new).json())==2
    revision=get(client,'/records/me',new).json()['revision']
    assert send(client,'/records/me/delete',new,{'confirm':True,'revision':revision}).status_code==204
    with engine.connect() as c:
        assert c.execute(text('SELECT count(*) FROM enrollments')).scalar_one()==0
        assert c.execute(text('SELECT count(*) FROM attempts')).scalar_one()==0
