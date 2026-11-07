import base64
import json
import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from app.main import create_app
from app.content import COURSES, UNITS, QUESTIONS
from app.security import credential_id

def key():
    secret = os.urandom(32)
    return 'Bearer '+credential_id(secret)+'.'+base64.urlsafe_b64encode(secret).decode().rstrip('=')

@pytest.fixture
def env(tmp_path):
    app = create_app('sqlite:///'+(tmp_path/'test.db').as_posix(), b't'*32)
    with TestClient(app) as client:
        yield client, app.state.engine
    app.state.engine.dispose()

def send(client, path, auth, value=None, request_id=None):
    return client.post('/api/v1'+path, headers={'Authorization':auth,'Idempotency-Key':request_id or str(uuid4())}, json={} if value is None else value)

def start(client, index=0):
    course = COURSES[index]
    auth=key()
    response=send(client,'/records',auth,dict(course_version_id=course['id'],study_route='practice' if course['language'] else 'fe',preferred_language=course['language']))
    assert response.status_code==201, response.text
    return auth, next(u for u in UNITS.values() if u['course_version_id']==course['id'])

def get(client,path,auth):
    return client.get('/api/v1'+path,headers={'Authorization':auth})

@pytest.mark.parametrize('course_index',[0,1,2])
def test_full_learning_flow_and_resume(env, course_index):
    client, engine=env
    auth,unit=start(client,course_index)
    assert get(client,'/learning-home',auth).json()['retention_kind']=='empty'
    assert send(client,f"/units/{unit['unit_version_id']}/assess",auth).status_code==409
    for qid in unit['question_ids']:
        public=get(client,'/questions/'+qid,auth).json()
        assert 'correct_ids' not in public and 'explanation' not in public
        response=send(client,f'/questions/{qid}/attempts',auth,{'choice_ids':QUESTIONS[qid]['correct_ids']})
        assert response.status_code==201 and response.json()['correct']
    assert send(client,f"/units/{unit['unit_version_id']}/assess",auth).status_code==200
    assert get(client,'/progress',auth).json()[0]['state']=='completed'
    assert get(client,'/learning-home',auth).json()['next_action']['kind']=='course_complete'
    assert get(client,'/records/me',auth).json()['empty_expires_on'] is None
    with TestClient(client.app) as second_device:
        assert get(second_device,'/progress',auth).json()[0]['state']=='completed'

def test_wrong_answer_review_and_immutable_completion(env):
    client,_=env
    auth,unit=start(client)
    qid=unit['question_ids'][0]
    wrong=next(x['id'] for x in QUESTIONS[qid]['choices'] if x['id'] not in QUESTIONS[qid]['correct_ids'])
    assert not send(client,f'/questions/{qid}/attempts',auth,{'choice_ids':[wrong]}).json()['correct']
    assert get(client,'/learning-home',auth).json()['next_action']['kind']=='review'
    assert send(client,f"/units/{unit['unit_version_id']}/review-next",auth).json()['question_version_id']==qid
    for q in unit['question_ids']:
        send(client,f'/questions/{q}/attempts',auth,{'choice_ids':QUESTIONS[q]['correct_ids']})
    send(client,f"/units/{unit['unit_version_id']}/assess",auth)
    response=send(client,f'/questions/{qid}/attempts',auth,{'choice_ids':[wrong]})
    assert response.json()['is_repeat']
    assert get(client,'/progress',auth).json()[0]['state']=='completed'

def test_idempotency_and_conflict_and_concurrency(env):
    client,engine=env
    auth,unit=start(client)
    qid=unit['question_ids'][0]
    request_id=str(uuid4())
    payload={'choice_ids':QUESTIONS[qid]['correct_ids']}
    with ThreadPoolExecutor(max_workers=4) as pool:
        results=list(pool.map(lambda _:send(client,f'/questions/{qid}/attempts',auth,payload,request_id),range(4)))
    assert all(r.status_code==201 for r in results)
    assert len({r.json()['attempt_id'] for r in results})==1
    different={'choice_ids':[QUESTIONS[qid]['choices'][-1]['id']]}
    assert send(client,f'/questions/{qid}/attempts',auth,different,request_id).status_code==409
    with engine.connect() as c:
        assert c.execute(text('SELECT count(*) FROM attempts')).scalar_one()==1

def test_credentials_do_not_cross_records(env):
    client,_=env
    auth,unit=start(client)
    other,other_unit=start(client,1)
    assert get(client,'/records/me',key()).status_code==401
    assert get(client,'/records/me',auth).json()['record_id']!=get(client,'/records/me',other).json()['record_id']
    assert get(client,'/questions/'+unit['question_ids'][0],other).status_code==404
    assert send(client,'/questions/'+unit['question_ids'][0]+'/attempts',other,{'choice_ids':QUESTIONS[unit['question_ids'][0]]['correct_ids']}).status_code==404

def test_expiry_reads_do_not_extend_or_renew(env):
    client,engine=env
    auth,_=start(client)
    before=get(client,'/records/me',auth).json()
    for _ in range(3):get(client,'/learning-home',auth)
    assert get(client,'/records/me',auth).json()==before
    with engine.begin() as c:c.execute(text("UPDATE records SET empty_expires_on='2000-01-01'"))
    assert get(client,'/records/me',auth).status_code==410

def test_pii_rejection_never_echoes_or_persists(env,capsys,caplog):
    client,engine=env
    auth,unit=start(client)
    canary='CANARY_person@example.invalid'
    response=send(client,'/records',auth,{'email':canary})
    assert response.status_code==400 and set(response.json())=={'code','request_id'}
    assert canary not in response.text
    dup=client.post('/api/v1/records',content='{"email":"'+canary+'","email":"x"}',headers={'Content-Type':'application/json'})
    assert dup.status_code==400 and canary not in dup.text
    too_big=client.post('/api/v1/records',content=canary*1000)
    assert too_big.status_code==413
    assert canary not in capsys.readouterr().out+caplog.text
    with engine.connect() as c:
        for table in ['records','attempts','idempotency']:
            assert canary not in str(c.execute(text('SELECT * FROM '+table)).all())

def test_classroom_and_query_credentials_disabled(env):
    client,_=env
    auth,_=start(client)
    assert client.get('/api/v1/classes').status_code==404
    assert client.get('/api/v1/records/me?key='+auth).status_code==400
    response=client.post('/api/v1/records',content='{}',headers={'Content-Type':'text/plain'})
    assert response.status_code==400

def test_bootstrap_replay_and_bad_token(env):
    client,engine=env
    auth=key();request_id=str(uuid4());course=COURSES[2]
    payload=dict(course_version_id=course['id'],study_route='fe',preferred_language=None)
    one=send(client,'/records',auth,payload,request_id)
    two=send(client,'/records',auth,payload,request_id)
    assert one.json()==two.json() and two.status_code==201
    assert send(client,'/records',auth,payload).status_code==409
    assert get(client,'/records/me',auth[:-1]+'!').status_code==401

def test_no_private_values_in_server_exception(env, monkeypatch):
    client,_=env
    import app.main as module
    monkeypatch.setattr(module,'COURSES',[{'broken':'secret-value'}])
    response=send(client,'/records',key(),dict(course_version_id='x',study_route='fe',preferred_language=None))
    assert response.status_code==503 and 'secret-value' not in response.text
