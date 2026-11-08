from .content import UNITS, OBJECTIVES, QUESTION_OBJECTIVES


def objective_progress(unit_id, latest, first):
    result = []
    for goal in OBJECTIVES[unit_id]:
        qids = [qid for qid in UNITS[unit_id]['question_ids'] if goal['objective_id'] in QUESTION_OBJECTIVES[qid]]
        answered = sum(qid in latest for qid in qids)
        correct = sum(latest.get(qid) is True for qid in qids)
        wrong = any(latest.get(qid) is False for qid in qids)
        state = ('not_started' if not answered else 'review_required' if wrong else
                 'achieved' if qids and correct == len(qids) else 'learning')
        result.append(dict(objective_id=goal['objective_id'], state=state, answered_count=answered,
                           latest_correct_count=correct, first_correct_count=sum(first.get(qid) is True for qid in qids)))
    return result
