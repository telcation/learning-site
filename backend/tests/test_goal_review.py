from uuid import uuid4
from sqlalchemy import text
from app.content import OBJECTIVES, QUESTION_OBJECTIVES, COURSES, UNITS, QUESTIONS
from test_pilot import env, start, get, send


def select(client,auth,unit,goal,request_id=None):
    return send(client,f"/units/{unit['unit_version_id']}/review-next",auth,{'objective_id':goal},request_id)


def answer(client,auth,qid,correct=True):
    q=QUESTIONS[qid]
    choices=q['correct_ids'] if correct else [next(c['id'] for c in q['choices'] if c['id'] not in q['correct_ids'])]
    response=send(client,'/questions/'+qid+'/attempts',auth,{'choice_ids':choices})
    assert response.status_code==201
    return response


def test_goal_selection_prioritizes_unanswered_in_same_unit_and_goal(env):
    client,_=env
    auth,unit=start(client)
    goal=OBJECTIVES[unit['unit_version_id']][1]['objective_id']
    response=select(client,auth,unit,goal)
    assert response.status_code==200
    qid=response.json()['question_version_id']
    assert qid==unit['question_ids'][1]
    assert goal in QUESTION_OBJECTIVES[qid]
    assert 'correct_ids' not in response.json() and 'explanation' not in response.json()


def test_wrong_answer_uses_unanswered_alternate_then_returns_to_original(env):
    client,_=env
    auth,unit=start(client)
    goal=OBJECTIVES[unit['unit_version_id']][1]['objective_id']
    original,alternate=unit['question_ids'][1:3]
    answer(client,auth,original,False)
    assert select(client,auth,unit,goal).json()['question_version_id']==alternate
    answer(client,auth,alternate)
    assert select(client,auth,unit,goal).json()['question_version_id']==original


def test_previously_answered_alternate_is_not_selected_endlessly(env):
    client,_=env
    auth,unit=start(client)
    goal=OBJECTIVES[unit['unit_version_id']][1]['objective_id']
    original,alternate=unit['question_ids'][1:3]
    answer(client,auth,alternate)
    answer(client,auth,original,False)
    assert select(client,auth,unit,goal).json()['question_version_id']==alternate
    answer(client,auth,alternate)
    assert select(client,auth,unit,goal).json()['question_version_id']==original
    answer(client,auth,original)
    assert select(client,auth,unit,goal).json()['question_version_id']==alternate


def test_single_question_goal_falls_back_without_using_another_goal(env):
    client,_=env
    for index in [0,3]:
        auth,unit=start(client,index)
        goal=OBJECTIVES[unit['unit_version_id']][0]['objective_id']
        original=unit['question_ids'][0]
        answer(client,auth,original,False)
        assert select(client,auth,unit,goal).json()['question_version_id']==original
        assert answer(client,auth,original).json()['is_repeat'] is True


def test_goal_selection_enforces_enrollment_and_target_scope(env):
    client,_=env
    auth,unit=start(client)
    other=next(u for u in UNITS.values() if u['course_version_id']==COURSES[1]['id'])
    other_goal=OBJECTIVES[other['unit_version_id']][0]['objective_id']
    assert select(client,auth,other,other_goal).status_code==404
    assert select(client,auth,unit,other_goal).status_code==404
    assert select(client,auth,unit,str(uuid4())).status_code==404
    assert select(client,auth,unit,'invalid').status_code==400
    goal=OBJECTIVES[unit['unit_version_id']][1]['objective_id']
    answer(client,auth,unit['question_ids'][1],False)
    second,_=start(client)
    assert select(client,second,unit,goal).json()['question_version_id']==unit['question_ids'][1]


def test_goal_selection_replays_without_attempt_or_retention_mutation(env):
    client,engine=env
    auth,unit=start(client)
    goals=OBJECTIVES[unit['unit_version_id']]
    before=get(client,'/records/me',auth).json()
    request_id=str(uuid4())
    first=select(client,auth,unit,goals[1]['objective_id'],request_id)
    assert first.status_code==200
    assert select(client,auth,unit,goals[1]['objective_id'],request_id).json()==first.json()
    assert select(client,auth,unit,goals[0]['objective_id'],request_id).status_code==409
    invalid=send(client,f"/units/{unit['unit_version_id']}/review-next",auth,{'objective_id':goals[0]['objective_id'],'email':'PRIVATE'})
    assert invalid.status_code==400 and 'PRIVATE' not in invalid.text
    assert get(client,'/records/me',auth).json()==before
    with engine.connect() as c:assert c.execute(text('SELECT count(*) FROM attempts')).scalar_one()==0


def test_goal_without_matching_problem_never_substitutes_an_unrelated_problem(env,monkeypatch):
    client,_=env
    auth,unit=start(client)
    goal=OBJECTIVES[unit['unit_version_id']][1]['objective_id']
    for qid in unit['question_ids']:
        monkeypatch.setitem(QUESTION_OBJECTIVES,qid,[g for g in QUESTION_OBJECTIVES[qid] if g!=goal])
    assert select(client,auth,unit,goal).status_code==404


def test_goal_with_multiple_alternates_returns_to_error_after_each_alternate(env):
    client,_=env
    auth,unit=start(client,2)
    goal=OBJECTIVES[unit['unit_version_id']][2]['objective_id']
    original=unit['question_ids'][1]
    answer(client,auth,original,False)
    assert select(client,auth,unit,goal).json()['question_version_id']==unit['question_ids'][0]
    answer(client,auth,unit['question_ids'][0])
    assert select(client,auth,unit,goal).json()['question_version_id']==unit['question_ids'][3]
    answer(client,auth,unit['question_ids'][3])
    # The unanswered multi-choice item belongs to another goal, so do not use it.
    assert select(client,auth,unit,goal).json()['question_version_id']==original
