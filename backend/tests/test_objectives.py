from sqlalchemy import text
from app.content import QUESTIONS, COURSES, UNITS
from test_pilot import env, start, send, get
from test_practice import assignment, payload


def unit_goals(client,auth,unit):
    info=client.get('/api/v1/units/'+unit['unit_version_id']).json()
    row=next(row for row in get(client,'/progress',auth).json() if row['unit_version_id']==unit['unit_version_id'])
    return info['objectives'],row


def answer(client,auth,qid,correct=True):
    q=QUESTIONS[qid]
    choices=q['correct_ids'] if correct else [next(choice['id'] for choice in q['choices'] if choice['id'] not in q['correct_ids'])]
    response=send(client,'/questions/'+qid+'/attempts',auth,{'choice_ids':choices})
    assert response.status_code==201
    return response


def test_public_goal_metadata_and_question_links_for_all_versions(env):
    client,_=env
    all_ids=set()
    for index in range(len(COURSES)):
        auth,unit=start(client,index)
        goals,row=unit_goals(client,auth,unit)
        ids={goal['objective_id'] for goal in goals}
        assert len(ids)==3 and not ids & all_ids
        all_ids.update(ids)
        page=get(client,f"/units/{unit['unit_version_id']}/questions",auth).json()['items']
        assert all(item['objective_ids'] and set(item['objective_ids'])<=ids for item in page)
        assert set().union(*(set(item['objective_ids']) for item in page))==ids
        assert all(goal['state']=='not_started' and goal['answered_count']==0 for goal in row['objectives'])
        public=get(client,'/questions/'+unit['question_ids'][0],auth).json()
        assert 'correct_ids' not in public and 'explanation' not in public


def test_goals_progress_from_partial_answers_to_confirmed_without_auto_completion(env):
    client,_=env
    auth,unit=start(client)
    answer(client,auth,unit['question_ids'][0])
    _,row=unit_goals(client,auth,unit)
    assert [goal['state'] for goal in row['objectives']]==['achieved','not_started','not_started']
    answer(client,auth,unit['question_ids'][1])
    _,row=unit_goals(client,auth,unit)
    assert [goal['state'] for goal in row['objectives']]==['achieved','learning','learning']
    for qid in unit['question_ids'][2:]:answer(client,auth,qid)
    _,row=unit_goals(client,auth,unit)
    assert all(goal['state']=='achieved' for goal in row['objectives'])
    assert row['state']!='completed'
    assert send(client,f"/units/{unit['unit_version_id']}/assess",auth).status_code==200


def test_first_answer_counts_stay_distinct_from_retry_success(env):
    client,_=env
    auth,unit=start(client)
    qid=unit['question_ids'][0]
    answer(client,auth,qid,False)
    answer(client,auth,qid,True)
    _,row=unit_goals(client,auth,unit)
    goal=row['objectives'][0]
    assert goal['state']=='achieved' and goal['answered_count']==1
    assert goal['latest_correct_count']==1 and goal['first_correct_count']==0
    answer(client,auth,qid,False)
    _,row=unit_goals(client,auth,unit)
    goal=row['objectives'][0]
    assert goal['state']=='review_required' and goal['latest_correct_count']==0 and goal['first_correct_count']==0


def test_legacy_completion_remains_after_goal_requires_review(env):
    client,_=env
    auth,unit=start(client,3)
    for qid in unit['question_ids']:answer(client,auth,qid)
    assert send(client,f"/units/{unit['unit_version_id']}/assess",auth).status_code==200
    _,row=unit_goals(client,auth,unit)
    assert all(goal['state']=='achieved' for goal in row['objectives'])
    answer(client,auth,unit['question_ids'][0],False)
    _,row=unit_goals(client,auth,unit)
    assert row['state']=='completed' and row['question_count']==2
    assert row['objectives'][0]['state']=='review_required'
    assert row['objectives'][0]['first_correct_count']==1


def test_goal_reads_do_not_extend_retention_and_other_records_stay_unstarted(env):
    client,engine=env
    auth,unit=start(client)
    answer(client,auth,unit['question_ids'][0])
    with engine.begin() as c:c.execute(text("UPDATE records SET last_active_month='2025-01-01'"))
    before=get(client,'/records/me',auth).json()
    unit_goals(client,auth,unit)
    assert get(client,'/records/me',auth).json()==before
    other,other_unit=start(client)
    _,row=unit_goals(client,other,other_unit)
    assert all(goal['state']=='not_started' for goal in row['objectives'])
    second=next(u for u in UNITS.values() if u['course_version_id']==COURSES[1]['id'])
    assert send(client,'/enrollments/'+COURSES[1]['id'],auth).status_code==200
    _,row=unit_goals(client,auth,second)
    assert all(goal['state']=='not_started' for goal in row['objectives'])


def test_self_reported_practice_does_not_automatically_confirm_quiz_goals(env):
    client,_=env
    auth,unit=start(client)
    a=assignment(client,auth,unit)
    assert send(client,'/practice-attempts',auth,payload(a)).status_code==201
    _,row=unit_goals(client,auth,unit)
    assert all(goal['state']=='not_started' and goal['answered_count']==0 for goal in row['objectives'])
