import pytest
from sqlalchemy import text
from app.content import QUESTIONS, COURSES
from test_pilot import env, start, send, get


def question_for(unit, kind):
    return next(QUESTIONS[qid] for qid in unit['question_ids'] if QUESTIONS[qid]['kind'] == kind)


@pytest.mark.parametrize('course_index',[0,1,2])
def test_multi_choice_is_order_independent_and_exact(env, course_index):
    client, _ = env
    auth, unit = start(client, course_index)
    q = question_for(unit, 'multi')
    path = '/questions/'+q['question_version_id']+'/attempts'
    assert send(client, path, auth, {'choice_ids':list(reversed(q['correct_ids']))}).json()['correct'] is True
    assert send(client, path, auth, {'choice_ids':q['correct_ids'][:1]}).json()['correct'] is False
    assert send(client, path, auth, {'choice_ids':[c['id'] for c in q['choices']]}).json()['correct'] is False
    assert get(client,'/learning-home',auth).json()['review_pending_count']==1
    response=send(client,path,auth,{'choice_ids':q['correct_ids']})
    assert response.json()['correct'] and response.json()['is_repeat']
    assert get(client,'/learning-home',auth).json()['review_pending_count']==0


@pytest.mark.parametrize('course_index',[0,1,2])
def test_order_question_requires_exact_order(env, course_index):
    client, _ = env
    auth, unit = start(client, course_index)
    q = question_for(unit, 'order')
    path = '/questions/'+q['question_version_id']+'/attempts'
    wrong = list(reversed(q['correct_ids']))
    assert send(client,path,auth,{'choice_ids':wrong}).json()['correct'] is False
    assert send(client,path,auth,{'choice_ids':q['correct_ids']}).json()['correct'] is True
    public=get(client,'/questions/'+q['question_version_id'],auth).json()
    assert public['kind']=='order' and 'correct_ids' not in public and 'explanation' not in public


def test_invalid_answer_shapes_never_add_attempts(env):
    client, engine = env
    auth, unit = start(client)
    single = question_for(unit,'single')
    multi = question_for(unit,'multi')
    order = question_for(unit,'order')
    cases=[(single,[c['id'] for c in single['choices'][:2]]),
           (multi,[]),(multi,[multi['correct_ids'][0]]*2),
           (multi,[order['choices'][0]['id']]),(multi,[None]),(multi,[{}]),
           (order,order['correct_ids'][:-1]),(order,[order['correct_ids'][0]]*len(order['choices'])),
           (multi,[multi['correct_ids'][0]]*11)]
    for q, choices in cases:
        assert send(client,'/questions/'+q['question_version_id']+'/attempts',auth,{'choice_ids':choices}).status_code==400
    with engine.connect() as c:
        assert c.execute(text('SELECT count(*) FROM attempts')).scalar_one()==0


def test_new_version_has_four_questions_old_version_keeps_two_and_completion(env):
    client, _ = env
    assert [c['version'] for c in COURSES[:3]]==[2,2,2]
    assert len([c for c in COURSES if c['available']])==3
    old, old_unit = start(client,3)
    assert len(old_unit['question_ids'])==2
    for qid in old_unit['question_ids']:
        assert QUESTIONS[qid]['kind']=='single'
        assert send(client,'/questions/'+qid+'/attempts',old,{'choice_ids':QUESTIONS[qid]['correct_ids']}).status_code==201
    assert send(client,f"/units/{old_unit['unit_version_id']}/assess",old).status_code==200
    progress=get(client,'/progress',old).json()[0]
    assert progress['question_count']==2 and progress['state']=='completed'
    assert get(client,'/learning-home',old).json()['next_action']['unit_version_id']==old_unit['unit_version_id']
    new, new_unit=start(client)
    assert len(new_unit['question_ids'])==4
    for qid in new_unit['question_ids'][:2]:
        send(client,'/questions/'+qid+'/attempts',new,{'choice_ids':QUESTIONS[qid]['correct_ids']})
    assert send(client,f"/units/{new_unit['unit_version_id']}/assess",new).status_code==409
    assert get(client,'/questions/'+new_unit['question_ids'][2],old).status_code==404
