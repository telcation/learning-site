from uuid import uuid4
from sqlalchemy import text
from app.content import COURSES, UNITS, QUESTIONS
from test_pilot import env, start, send, get, key, rotation_payload


def page(client,auth,unit):
    return get(client,f"/units/{unit['unit_version_id']}/questions",auth)


def test_question_page_initial_state_and_no_answers(env):
    client,_=env
    auth,unit=start(client)
    response=page(client,auth,unit)
    assert response.status_code==200
    data=response.json()
    assert set(data)=={'items','next_after_id','has_more'}
    assert data['next_after_id'] is None and data['has_more'] is False
    assert len(data['items'])==4
    assert [x['question_version_id'] for x in data['items']]==unit['question_ids']
    for item in data['items']:
        assert set(item)=={'question_version_id','kind','required','objective_ids','attempt_count','incorrect_count','latest_correct'}
        assert item['attempt_count']==0 and item['incorrect_count']==0 and item['latest_correct'] is None
        assert item['required'] is True
        assert 'correct_ids' not in item and 'explanation' not in item and 'choice_ids' not in item


def test_latest_result_and_counts_follow_wrong_correct_wrong_for_all_kinds(env):
    client,_=env
    auth,unit=start(client)
    for kind in ['single','multi','order']:
        q=next(QUESTIONS[qid] for qid in unit['question_ids'] if QUESTIONS[qid]['kind']==kind)
        wrong=(list(reversed(q['correct_ids'])) if kind=='order' else q['correct_ids'][:1] if kind=='multi' else
               [next(choice['id'] for choice in q['choices'] if choice['id'] not in q['correct_ids'])])
        path='/questions/'+q['question_version_id']+'/attempts'
        for number,(choices,expected) in enumerate([(wrong,False),(q['correct_ids'],True),(wrong,False)],1):
            result=send(client,path,auth,{'choice_ids':choices})
            assert result.status_code==201 and result.json()['correct'] is expected
            item=next(item for item in page(client,auth,unit).json()['items'] if item['question_version_id']==q['question_version_id'])
            assert item['latest_correct'] is expected and item['attempt_count']==number
            assert item['incorrect_count']==(2 if number==3 else 1)
    assert get(client,'/learning-home',auth).json()['review_pending_count']==3


def test_question_pages_are_owner_and_enrollment_scoped(env):
    client,_=env
    first,unit=start(client)
    second,_=start(client)
    qid=unit['question_ids'][0]
    wrong=next(c['id'] for c in QUESTIONS[qid]['choices'] if c['id'] not in QUESTIONS[qid]['correct_ids'])
    send(client,'/questions/'+qid+'/attempts',first,{'choice_ids':[wrong]})
    assert page(client,first,unit).json()['items'][0]['latest_correct'] is False
    assert page(client,second,unit).json()['items'][0]['latest_correct'] is None
    other=next(u for u in UNITS.values() if u['course_version_id']==COURSES[1]['id'])
    assert page(client,first,other).status_code==404
    assert send(client,'/enrollments/'+COURSES[1]['id'],first).status_code==200
    assert page(client,first,other).status_code==200
    assert all(item['latest_correct'] is None for item in page(client,first,other).json()['items'])


def test_question_page_get_does_not_change_revision_or_retention(env):
    client,engine=env
    auth,unit=start(client)
    before=get(client,'/records/me',auth).json()
    with engine.connect() as c:
        attempts=c.execute(text('SELECT count(*) FROM attempts')).scalar_one()
        caches=c.execute(text('SELECT count(*) FROM idempotency')).scalar_one()
    for _ in range(3): assert page(client,auth,unit).status_code==200
    assert get(client,'/records/me',auth).json()==before
    with engine.connect() as c:
        assert c.execute(text('SELECT count(*) FROM attempts')).scalar_one()==attempts
        assert c.execute(text('SELECT count(*) FROM idempotency')).scalar_one()==caches


def test_expired_and_revoked_keys_cannot_get_question_page(env):
    client,engine=env
    auth,unit=start(client)
    newer=key()
    assert send(client,'/credentials/rotate',auth,rotation_payload(newer,0)).status_code==200
    assert page(client,auth,unit).status_code==401
    with engine.begin() as c:
        c.execute(text("UPDATE records SET empty_expires_on='2000-01-01'"))
    assert page(client,newer,unit).status_code==410
    assert get(client,'/units/'+unit['unit_version_id']+'/questions',key()).status_code==401


def test_legacy_completed_course_can_review_wrong_answer_without_losing_completion(env):
    client,_=env
    auth,unit=start(client,3)
    for qid in unit['question_ids']:
        send(client,'/questions/'+qid+'/attempts',auth,{'choice_ids':QUESTIONS[qid]['correct_ids']})
    assert send(client,f"/units/{unit['unit_version_id']}/assess",auth).status_code==200
    qid=unit['question_ids'][0]
    wrong=next(c['id'] for c in QUESTIONS[qid]['choices'] if c['id'] not in QUESTIONS[qid]['correct_ids'])
    send(client,'/questions/'+qid+'/attempts',auth,{'choice_ids':[wrong]})
    data=page(client,auth,unit).json()
    assert len(data['items'])==2 and data['items'][0]['latest_correct'] is False
    assert data['items'][0]['attempt_count']==2
    assert get(client,'/progress',auth).json()[0]['state']=='completed'


def test_correct_after_wrong_preserves_history_but_clears_latest_wrong_count(env):
    client,_=env
    auth,unit=start(client,2)
    qid=unit['question_ids'][0]
    q=QUESTIONS[qid]
    wrong=next(choice['id'] for choice in q['choices'] if choice['id'] not in q['correct_ids'])
    path='/questions/'+qid+'/attempts'
    assert send(client,path,auth,{'choice_ids':[wrong]}).json()['correct'] is False
    assert send(client,path,auth,{'choice_ids':q['correct_ids']}).json()['correct'] is True
    history=[item for item in page(client,auth,unit).json()['items'] if item['incorrect_count']>0]
    assert len(history)==1 and history[0]['question_version_id']==qid
    assert history[0]['latest_correct'] is True and history[0]['incorrect_count']==1
    assert history[0]['attempt_count']==2
    assert get(client,'/learning-home',auth).json()['review_pending_count']==0
