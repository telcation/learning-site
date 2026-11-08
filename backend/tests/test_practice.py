from concurrent.futures import ThreadPoolExecutor
from datetime import date
from uuid import uuid4
import shutil
from fastapi.testclient import TestClient
from sqlalchemy import text
from app.main import create_app
from app.content import COURSES, UNITS, ASSIGNMENTS
from app.retention import maintain_retention
from test_pilot import env, start, send, get, key, rotation_payload


def assignment(client,auth,unit):
    page=get(client,f"/units/{unit['unit_version_id']}/assignments",auth)
    assert page.status_code==200
    data=page.json()
    assert len(data['items'])==1 and data['items'][0]['required'] is False
    response=get(client,'/assignments/'+data['items'][0]['assignment_version_id'],auth)
    assert response.status_code==200
    return response.json()


def payload(a,met=True):
    return dict(assignment_version_id=a['assignment_version_id'],self_checks=[dict(rubric_item_id=item['rubric_item_id'],met=met) for item in a['rubric_items']])


def test_optional_assignments_available_for_all_three_courses(env):
    client,_=env
    for index in range(3):
        auth,unit=start(client,index)
        a=assignment(client,auth,unit)
        assert a['unit_version_id']==unit['unit_version_id']
        assert len(a['rubric_items'])==3
        assert set(a)=={'assignment_version_id','unit_version_id','requirements','target_path','rubric_items'}
        if index==2:assert 'IDEの準備は不要' in a['requirements']


def test_partial_and_full_self_checks_promote_learning_but_do_not_complete_unit(env):
    client,_=env
    auth,unit=start(client)
    a=assignment(client,auth,unit)
    partial=payload(a,False);partial['self_checks'][0]['met']=True
    first=send(client,'/practice-attempts',auth,partial)
    assert first.status_code==201 and first.json()['self_confirmed'] is False
    record=get(client,'/records/me',auth).json()
    assert record['retention_kind']=='learning' and record['empty_expires_on'] is None
    second=send(client,'/practice-attempts',auth,payload(a))
    assert second.status_code==201 and second.json()['self_confirmed'] is True
    assert second.json()['sequence_no']==2
    history=get(client,'/practice-attempts',auth).json()
    assert [item['self_confirmed'] for item in history['items']]==[True,False]
    assert get(client,'/progress',auth).json()[0]['state']=='requirements_unmet'
    assert send(client,f"/units/{unit['unit_version_id']}/assess",auth).status_code==409


def test_practice_resends_and_concurrent_sequences(env):
    client,engine=env
    auth,unit=start(client)
    a=assignment(client,auth,unit)
    request_id=str(uuid4())
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses=list(pool.map(lambda _:send(client,'/practice-attempts',auth,payload(a),request_id),range(4)))
    assert all(response.status_code==201 for response in responses)
    assert len({response.json()['practice_attempt_id'] for response in responses})==1
    assert send(client,'/practice-attempts',auth,payload(a,False),request_id).status_code==409
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses=list(pool.map(lambda _:send(client,'/practice-attempts',auth,payload(a)),range(2)))
    assert sorted(response.json()['sequence_no'] for response in responses)==[2,3]
    with engine.connect() as c:
        assert c.execute(text('SELECT count(*) FROM practice_attempts')).scalar_one()==3


def test_practice_rejects_unknown_fields_invalid_checks_and_private_content(env):
    client,engine=env
    auth,unit=start(client)
    a=assignment(client,auth,unit)
    canary='PRIVATE_SOURCE_person@example.invalid'
    cases=[]
    b=payload(a);b['source_code']=canary;cases.append(b)
    b=payload(a);b['self_checks'][0]['comment']=canary;cases.append(b)
    b=payload(a);b['self_checks'][0]['met']='true';cases.append(b)
    b=payload(a);b['self_checks']=b['self_checks'][:-1];cases.append(b)
    b=payload(a);b['self_checks'][1]=b['self_checks'][0];cases.append(b)
    b=payload(a);b['self_checks'][0]['rubric_item_id']=str(uuid4());cases.append(b)
    for b in cases:
        response=send(client,'/practice-attempts',auth,b)
        assert response.status_code==400 and canary not in response.text
    with engine.connect() as c:
        assert c.execute(text('SELECT count(*) FROM practice_attempts')).scalar_one()==0
        assert canary not in str(c.execute(text('SELECT * FROM idempotency')).all())


def test_practice_scopes_and_rotation(env):
    client,_=env
    auth,unit=start(client)
    a=assignment(client,auth,unit)
    send(client,'/practice-attempts',auth,payload(a))
    other,_=start(client,1)
    assert get(client,'/assignments/'+a['assignment_version_id'],other).status_code==404
    assert send(client,'/practice-attempts',other,payload(a)).status_code==404
    assert get(client,'/practice-attempts',other).json()['items']==[]
    new=key();revision=get(client,'/records/me',auth).json()['revision']
    assert send(client,'/credentials/rotate',auth,rotation_payload(new,revision)).status_code==200
    assert get(client,'/practice-attempts',auth).status_code==401
    assert len(get(client,'/practice-attempts',new).json()['items'])==1


def test_practice_pagination_and_read_only_queries(env):
    client,engine=env
    auth,unit=start(client)
    a=assignment(client,auth,unit)
    for _ in range(3):assert send(client,'/practice-attempts',auth,payload(a)).status_code==201
    with engine.begin() as c:c.execute(text("UPDATE records SET last_active_month='2025-01-01'"))
    before=get(client,'/records/me',auth).json()
    first=get(client,'/practice-attempts?limit=2',auth).json()
    assert first['has_more'] and [item['sequence_no'] for item in first['items']]==[3,2]
    cursor=first['next_after_id']
    second=get(client,'/practice-attempts?limit=2&after_id='+cursor,auth).json()
    assert not second['has_more'] and second['next_after_id'] is None
    assert [item['sequence_no'] for item in second['items']]==[1]
    assert get(client,'/records/me',auth).json()==before
    for query in ['limit=0','limit=101','limit=1&limit=2','after_id=bad','key=PRIVATE','limit=01']:
        response=get(client,'/practice-attempts?'+query,auth)
        assert response.status_code==400 and 'PRIVATE' not in response.text
    other,_=start(client)
    assert get(client,'/practice-attempts?after_id='+cursor,other).status_code==404


def test_practice_counts_as_actual_evidence_for_retention(env):
    client,engine=env
    auth,unit=start(client)
    a=assignment(client,auth,unit)
    assert send(client,'/practice-attempts',auth,payload(a,False)).status_code==201
    with engine.begin() as c:c.execute(text("UPDATE records SET evidence=0,empty_expires_on='2000-01-01',last_active_month='2026-11-01'"))
    assert maintain_retention(engine,client.app.state.ledger,date(2026,11,8),apply=True)['deleted']==0
    with engine.begin() as c:c.execute(text("UPDATE records SET evidence=1,empty_expires_on=NULL,last_active_month='2024-11-01'"))
    assert maintain_retention(engine,client.app.state.ledger,date(2026,11,1),apply=True)['deleted']==1
    with engine.connect() as c:assert c.execute(text('SELECT count(*) FROM practice_attempts')).scalar_one()==0


def test_deleted_practice_not_restored_from_old_learning_database(tmp_path):
    path=tmp_path/'learning.db';backup=tmp_path/'backup.db'
    url='sqlite:///'+path.as_posix();app=create_app(url,b't'*32)
    with TestClient(app) as client:
        auth,unit=start(client)
        a=assignment(client,auth,unit)
        assert send(client,'/practice-attempts',auth,payload(a)).status_code==201
        app.state.engine.dispose();shutil.copyfile(path,backup)
        revision=get(client,'/records/me',auth).json()['revision']
        assert send(client,'/records/me/delete',auth,dict(confirm=True,revision=revision)).status_code==204
        with app.state.engine.connect() as c:assert c.execute(text('SELECT count(*) FROM practice_attempts')).scalar_one()==0
    app.state.engine.dispose();shutil.copyfile(backup,path)
    restored=create_app(url,b't'*32)
    with TestClient(restored) as client:
        assert get(client,'/practice-attempts',auth).status_code==401
        with restored.state.engine.connect() as c:assert c.execute(text('SELECT count(*) FROM practice_attempts')).scalar_one()==0
    restored.state.engine.dispose()
