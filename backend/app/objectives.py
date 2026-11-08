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


def select_goal_question(unit_id, goal_id, history):
    related = [qid for qid in UNITS[unit_id]['question_ids'] if goal_id in QUESTION_OBJECTIVES[qid]]
    if not related:
        return None
    latest, last_sequence = {}, {}
    for qid, correct, sequence in history:
        if qid in related:
            latest[qid], last_sequence[qid] = bool(correct), sequence
    unanswered = next((qid for qid in related if qid not in latest), None)
    if unanswered:
        return unanswered
    wrong = [qid for qid in related if latest[qid] is False]
    if wrong:
        origin = max(wrong, key=lambda qid: last_sequence[qid])
        # Try another same-goal item not attempted since this error, then return
        # to the original. This avoids endlessly repeating a solved alternate.
        alternatives = [qid for qid in related if qid != origin and last_sequence[qid] < last_sequence[origin]]
        return min(alternatives, key=lambda qid: last_sequence[qid]) if alternatives else origin
    return min(related, key=lambda qid: last_sequence[qid])
