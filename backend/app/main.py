"""P1 local development server. Public deployment intentionally prohibited."""
import hashlib
import hmac
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4
from contextlib import contextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from .content import COURSES, UNITS, QUESTIONS, ASSIGNMENTS, OBJECTIVES, QUESTION_OBJECTIVES, public_question
from .objectives import objective_progress, select_goal_question
from .security import parse_token, digest, UUID_PATTERN
from .deletions import DeletionLedger, purge_record
from .retention import retention_status
import re

JST = timezone(timedelta(hours=9))
def today():
    return datetime.now(JST).date()

class Failure(Exception):
    def __init__(self, status, code):
        self.status, self.code = status, code

def create_app(database_url=None, pepper=None):
    # This milestone has no public deployment path. Production hardening is a later gate.
    if os.environ.get('LEARNING_ENV', 'development') != 'development':
        raise RuntimeError('P1_LOCAL_DEVELOPMENT_ONLY')
    local = Path(__file__).resolve().parents[2] / '.local'
    local.mkdir(exist_ok=True)
    if pepper is None:
        secret_path = local / 'pepper.bin'
        if not secret_path.exists():
            try:
                with secret_path.open('xb') as out:
                    out.write(os.urandom(32))
                secret_path.chmod(0o600)
            except FileExistsError:
                pass
        pepper = secret_path.read_bytes()
    if len(pepper) < 32:
        raise RuntimeError('INVALID_LOCAL_CONFIGURATION')
    url = database_url or f'sqlite:///{(local / "learning.db").as_posix()}'
    if not url.startswith('sqlite:'):
        raise RuntimeError('P1_SQLITE_ONLY')
    engine = create_engine(url, connect_args={'check_same_thread': False}, hide_parameters=True)
    with engine.begin() as c:
        for statement in [
            'CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, credential_id TEXT UNIQUE NOT NULL, secret_hmac TEXT NOT NULL, course_id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, last_active_month TEXT NOT NULL, empty_expires_on TEXT, evidence INTEGER NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0, CHECK ((evidence=0 AND empty_expires_on IS NOT NULL) OR (evidence=1 AND empty_expires_on IS NULL)))',
            'CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES records(id), question_id TEXT NOT NULL, sequence INTEGER NOT NULL, choice_ids TEXT NOT NULL, correct INTEGER NOT NULL, UNIQUE(record_id, sequence))',
            'CREATE TABLE IF NOT EXISTS idempotency (credential_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, response TEXT NOT NULL, status INTEGER NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(credential_id,request_id))',
            'CREATE TABLE IF NOT EXISTS revoked_credentials (credential_id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES records(id))',
            'CREATE TABLE IF NOT EXISTS app_metadata (name TEXT PRIMARY KEY, value TEXT NOT NULL)',
            'CREATE TABLE IF NOT EXISTS enrollments (record_id TEXT NOT NULL REFERENCES records(id), course_version_id TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(record_id,course_version_id))',
            'CREATE TABLE IF NOT EXISTS practice_attempts (id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES records(id), assignment_version_id TEXT NOT NULL, sequence INTEGER NOT NULL, self_confirmed INTEGER NOT NULL, self_checks TEXT NOT NULL, revision INTEGER NOT NULL, UNIQUE(record_id,sequence))',
        ]:
            c.exec_driver_sql(statement)
        c.exec_driver_sql('INSERT OR IGNORE INTO enrollments (record_id,course_version_id,completed) SELECT id,course_id,completed FROM records')
    db_path = make_url(url).database
    if not db_path or db_path == ':memory:':
        raise RuntimeError('P1_FILE_DATABASE_REQUIRED')
    with engine.begin() as c:
        expected_id = c.execute(text("SELECT value FROM app_metadata WHERE name='deletion_ledger_id'")).scalar_one_or_none()
        ledger = DeletionLedger(str(Path(db_path).resolve()) + '.deletions', expected_id)
        if expected_id is None:
            c.execute(text("INSERT INTO app_metadata VALUES ('deletion_ledger_id',:id)"), {'id': ledger.id})
    # Reapply current tombstones before serving a restored/previously interrupted DB.
    with engine.connect() as c:
        c.exec_driver_sql('PRAGMA foreign_keys=ON')
        c.exec_driver_sql('BEGIN IMMEDIATE')
        for record_id in ledger.records():
            purge_record(c, record_id)
        c.commit()
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.engine = engine
    app.state.ledger = ledger

    def error(status, code):
        return JSONResponse({'code': code, 'request_id': str(uuid4())}, status_code=status)

    @app.middleware('http')
    async def boundary(request: Request, call_next):
        try:
            if request.url.query:
                if request.method != 'GET' or request.url.path != '/api/v1/practice-attempts':
                    raise Failure(400, 'INVALID_REQUEST')
                params = list(request.query_params.multi_items())
                if len({key for key, _ in params}) != len(params) or any(key not in ('limit', 'after_id') for key, _ in params):
                    raise Failure(400, 'INVALID_REQUEST')
                for key, value in params:
                    if key == 'after_id' and not re.fullmatch(UUID_PATTERN, value):
                        raise Failure(400, 'INVALID_REQUEST')
                    if key == 'limit' and (not re.fullmatch(r'[1-9][0-9]{0,2}', value) or not 1 <= int(value) <= 100):
                        raise Failure(400, 'INVALID_REQUEST')
            if request.method in ('POST', 'PUT', 'PATCH'):
                data = bytearray()
                async for chunk in request.stream():
                    data.extend(chunk)
                    if len(data) > 16384:
                        raise Failure(413, 'REQUEST_TOO_LARGE')
                request._body = bytes(data)
                def pairs(items):
                    obj = {}
                    for key, value in items:
                        if key in obj:
                            raise ValueError()
                        obj[key] = value
                    return obj
                if data:
                    if request.headers.get('content-type', '').split(';')[0] != 'application/json':
                        raise Failure(400, 'INVALID_REQUEST')
                    try:
                        request.state.body = json.loads(data, object_pairs_hook=pairs)
                    except (ValueError, UnicodeError):
                        raise Failure(400, 'INVALID_REQUEST')
                else:
                    request.state.body = {}
            response = await call_next(request)
        except Failure as exc:
            response = error(exc.status, exc.code)
        except Exception:
            # Never serialize or log exceptions, URLs, headers, submitted values or validation input.
            response = error(503, 'TEMPORARILY_UNAVAILABLE')
        response.headers.update({'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
                                 'X-Content-Type-Options': 'nosniff'})
        return response

    @app.exception_handler(Failure)
    async def fail(request, exc):
        return error(exc.status, exc.code)

    @app.exception_handler(404)
    async def missing(request, exc):
        return error(404, 'NOT_FOUND')

    @app.exception_handler(405)
    async def method(request, exc):
        return error(405, 'METHOD_NOT_ALLOWED')

    def body(request, fields):
        value = request.state.body
        if not isinstance(value, dict) or set(value) != set(fields):
            raise Failure(400, 'INVALID_REQUEST')
        return value

    def uuid(value):
        if not isinstance(value, str) or not re.fullmatch(UUID_PATTERN, value):
            raise Failure(400, 'INVALID_REQUEST')
        return value

    def token(request):
        try:
            return parse_token(request.headers.get('authorization'))
        except ValueError:
            raise Failure(401, 'UNAUTHORIZED')

    def owner(c, request):
        cid, secret = token(request)
        record = c.execute(text('SELECT * FROM records WHERE credential_id=:cid'), {'cid': cid}).mappings().first()
        if not record or not hmac.compare_digest(record['secret_hmac'], digest(pepper, cid, secret)):
            raise Failure(401, 'UNAUTHORIZED')
        if ledger.contains(record['id']):
            raise Failure(401, 'UNAUTHORIZED')
        if retention_status(c, record, today())[2]:
            raise Failure(410, 'RECORD_EXPIRED')
        return record

    @contextmanager
    def transaction():
        with engine.connect() as c:
            c.exec_driver_sql('PRAGMA foreign_keys=ON')
            c.exec_driver_sql('BEGIN IMMEDIATE')
            try:
                yield c
                c.commit()
            except BaseException:
                c.rollback()
                raise

    def idempotent(c, request, action, success=200):
        cid, _ = token(request)
        key = uuid(request.headers.get('idempotency-key'))
        raw = json.dumps([request.method, request.url.path, request.state.body], sort_keys=True, separators=(',', ':')).encode()
        fingerprint = hmac.new(pepper, raw, hashlib.sha256).hexdigest()
        now = int(datetime.now(timezone.utc).timestamp())
        c.execute(text('DELETE FROM idempotency WHERE expires_at <= :now'), {'now': now})
        previous = c.execute(text('SELECT * FROM idempotency WHERE credential_id=:cid AND request_id=:key'), {'cid': cid, 'key': key}).mappings().first()
        if previous:
            if not hmac.compare_digest(previous['fingerprint'], fingerprint):
                raise Failure(409, 'IDEMPOTENCY_CONFLICT')
            return JSONResponse(json.loads(previous['response']), status_code=previous['status'])
        result = action()
        c.execute(text('INSERT INTO idempotency VALUES (:cid,:key,:fp,:response,:status,:expiry)'),
                  dict(cid=cid, key=key, fp=fingerprint, response=json.dumps(result), status=success, expiry=now+86400))
        return JSONResponse(result, status_code=success)

    def me(r):
        return dict(record_id=r['id'], revision=r['revision'], last_active_month=r['last_active_month'],
                    retention_kind='learning' if r['evidence'] else 'empty', empty_expires_on=r['empty_expires_on'])

    def unit_for(record):
        return next(u for u in UNITS.values() if u['course_version_id'] == record['course_id'])

    def enrolled_unit(c, record, unit_id):
        unit = UNITS.get(unit_id)
        if not unit or not c.execute(text('SELECT 1 FROM enrollments WHERE record_id=:rid AND course_version_id=:cid'),
                                     {'rid': record['id'], 'cid': unit['course_version_id']}).first():
            raise Failure(404, 'NOT_FOUND')
        return unit

    def completed(c, record, course_id):
        return bool(c.execute(text('SELECT completed FROM enrollments WHERE record_id=:rid AND course_version_id=:cid'),
                              {'rid': record['id'], 'cid': course_id}).scalar_one())

    def latest(c, rid):
        rows = c.execute(text('SELECT question_id,correct FROM attempts WHERE record_id=:id ORDER BY sequence'), {'id': rid})
        return {row[0]: bool(row[1]) for row in rows}

    @app.get('/api/v1/health')
    def health():
        ledger.check()
        with engine.connect() as c:
            c.exec_driver_sql('SELECT 1')
        return {'status': 'ok'}

    @app.get('/api/v1/catalog')
    def catalog():
        return COURSES

    @app.get('/api/v1/courses/{course_id}/outline')
    def outline(course_id: str):
        if not any(course['id'] == course_id for course in COURSES):
            raise Failure(404, 'NOT_FOUND')
        return dict(course_version_id=course_id, unit_ids=[u['unit_version_id'] for u in UNITS.values()
                    if u['course_version_id'] == course_id], prerequisites=[], milestones=[])

    @app.get('/api/v1/units/{unit_id}/material')
    def material(unit_id: str):
        if unit_id not in UNITS:
            raise Failure(404, 'NOT_FOUND')
        return {k: UNITS[unit_id][k] for k in ('unit_version_id', 'revision', 'title', 'markdown')}

    @app.get('/api/v1/units/{unit_id}')
    def unit_info(unit_id: str):
        if unit_id not in UNITS:
            raise Failure(404, 'NOT_FOUND')
        return dict(unit_version_id=unit_id, title=UNITS[unit_id]['title'], pass_percent=100, objectives=OBJECTIVES[unit_id])

    @app.post('/api/v1/records')
    def bootstrap(request: Request):
        ledger.check()
        b = body(request, ['course_version_id', 'study_route', 'preferred_language'])
        course = next((x for x in COURSES if x['id'] == b['course_version_id']), None)
        if not course or b['study_route'] != ('practice' if course['language'] else 'fe') or b['preferred_language'] != course['language']:
            raise Failure(400, 'INVALID_REQUEST')
        cid, secret = token(request)
        with transaction() as c:
            if c.execute(text('SELECT 1 FROM revoked_credentials WHERE credential_id=:cid'), {'cid': cid}).first():
                raise Failure(401, 'UNAUTHORIZED')
            existing_id = c.execute(text('SELECT id FROM records WHERE credential_id=:cid'), {'cid': cid}).scalar_one_or_none()
            if existing_id and ledger.contains(existing_id):
                raise Failure(401, 'UNAUTHORIZED')
            def action():
                if c.execute(text('SELECT 1 FROM records WHERE credential_id=:cid'), {'cid': cid}).first():
                    raise Failure(409, 'CREDENTIAL_EXISTS')
                values = dict(id=str(uuid4()), cid=cid, digest=digest(pepper, cid, secret), course=course['id'],
                              month=today().replace(day=1).isoformat(), expires=(today()+timedelta(days=30)).isoformat())
                c.execute(text('INSERT INTO records (id,credential_id,secret_hmac,course_id,last_active_month,empty_expires_on) VALUES (:id,:cid,:digest,:course,:month,:expires)'), values)
                c.execute(text('INSERT INTO enrollments (record_id,course_version_id) VALUES (:id,:course)'), values)
                return me(c.execute(text('SELECT * FROM records WHERE id=:id'), values).mappings().one())
            return idempotent(c, request, action, 201)

    @app.get('/api/v1/records/me')
    def get_me(request: Request):
        with engine.connect() as c:
            return me(owner(c, request))

    @app.post('/api/v1/enrollments/{course_id}')
    def enroll(course_id: str, request: Request):
        body(request, [])
        course = next((course for course in COURSES if course['id'] == course_id and course['available']), None)
        if not course:
            raise Failure(404, 'NOT_FOUND')
        with transaction() as c:
            r = owner(c, request)
            def action():
                existing = set(c.execute(text('SELECT course_version_id FROM enrollments WHERE record_id=:rid'), {'rid': r['id']}).scalars())
                # Keep an existing published version of this logical course. An
                # enrollment request is not permission to replace its progress.
                same_course = next((x for x in COURSES if x['id'] in existing and x['course_id'] == course['course_id']), None)
                if same_course:
                    return dict(resource_id=same_course['id'], revision=r['revision'])
                c.execute(text('INSERT INTO enrollments (record_id,course_version_id) VALUES (:rid,:cid)'),
                          {'rid': r['id'], 'cid': course['id']})
                c.execute(text('UPDATE records SET revision=revision+1,last_active_month=:month,empty_expires_on=CASE WHEN evidence=0 THEN :expiry ELSE NULL END WHERE id=:rid'),
                          {'rid': r['id'], 'month': today().replace(day=1).isoformat(), 'expiry': (today()+timedelta(days=30)).isoformat()})
                return dict(resource_id=course['id'], revision=r['revision']+1)
            return idempotent(c, request, action)

    @app.put('/api/v1/learning-position')
    def position(request: Request):
        b = body(request, ['unit_version_id', 'revision'])
        uuid(b['unit_version_id'])
        if type(b['revision']) is not int or not 0 <= b['revision'] <= 2147483647:
            raise Failure(400, 'INVALID_REQUEST')
        with transaction() as c:
            r = owner(c, request)
            unit = enrolled_unit(c, r, b['unit_version_id'])
            def action():
                if r['revision'] != b['revision']:
                    raise Failure(409, 'REVISION_CONFLICT')
                c.execute(text('UPDATE records SET course_id=:cid,revision=revision+1,last_active_month=:month,empty_expires_on=CASE WHEN evidence=0 THEN :expiry ELSE NULL END WHERE id=:rid'),
                          {'rid': r['id'], 'cid': unit['course_version_id'], 'month': today().replace(day=1).isoformat(),
                           'expiry': (today()+timedelta(days=30)).isoformat()})
                return dict(resource_id=unit['unit_version_id'], revision=r['revision']+1)
            return idempotent(c, request, action)

    @app.post('/api/v1/credentials/rotate')
    def rotate(request: Request):
        b = body(request, ['replacement_credential_id', 'secret_candidate', 'revision'])
        if type(b['revision']) is not int or not 0 <= b['revision'] <= 2147483647:
            raise Failure(400, 'INVALID_REQUEST')
        if not isinstance(b['replacement_credential_id'], str) or not isinstance(b['secret_candidate'], str):
            raise Failure(400, 'INVALID_REQUEST')
        try:
            cid, secret = parse_token('Bearer ' + b['replacement_credential_id'] + '.' + b['secret_candidate'])
        except ValueError:
            raise Failure(400, 'INVALID_REQUEST')
        with transaction() as c:
            r = owner(c, request)  # Authorize before any cached response, including retries.
            def action():
                if r['revision'] != b['revision']:
                    raise Failure(409, 'REVISION_CONFLICT')
                if (c.execute(text('SELECT 1 FROM records WHERE credential_id=:cid'), {'cid': cid}).first()
                        or c.execute(text('SELECT 1 FROM revoked_credentials WHERE credential_id=:cid'), {'cid': cid}).first()):
                    raise Failure(409, 'REVISION_CONFLICT')
                c.execute(text('INSERT INTO revoked_credentials VALUES (:cid,:rid)'), {'cid': r['credential_id'], 'rid': r['id']})
                c.execute(text('UPDATE records SET credential_id=:cid,secret_hmac=:digest,revision=revision+1 WHERE id=:rid'),
                          {'cid': cid, 'digest': digest(pepper, cid, secret), 'rid': r['id']})
                # Remove old response caches so old bootstrap requests cannot recover record data.
                c.execute(text('DELETE FROM idempotency WHERE credential_id=:cid'), {'cid': r['credential_id']})
                return dict(resource_id=r['id'], revision=r['revision']+1)
            return idempotent(c, request, action)

    @app.post('/api/v1/records/me/delete')
    def delete_record(request: Request):
        b = body(request, ['confirm', 'revision'])
        if b['confirm'] is not True or type(b['revision']) is not int or not 0 <= b['revision'] <= 2147483647:
            raise Failure(400, 'INVALID_REQUEST')
        uuid(request.headers.get('idempotency-key'))
        with transaction() as c:
            r = owner(c, request)
            if r['revision'] != b['revision']:
                raise Failure(409, 'REVISION_CONFLICT')
            ledger.record(r['id'])
            purge_record(c, r['id'])
        # Replays use normal authorization and return 401 after successful deletion.
        # Do not retain a credential or response cache just to authorize a retry.
        return Response(status_code=204)

    @app.get('/api/v1/learning-home')
    def home(request: Request):
        with engine.connect() as c:
            r = owner(c, request)
            unit = unit_for(r)
            answers = latest(c, r['id'])
            course = next(x for x in COURSES if x['id'] == r['course_id'])
            pending = sum(answers.get(q) is False for q in unit['question_ids'])
            done = completed(c, r, r['course_id'])
            enrolled = list(c.execute(text('SELECT course_version_id FROM enrollments WHERE record_id=:rid ORDER BY course_version_id'), {'rid': r['id']}).scalars())
            return dict(revision=r['revision'], study_route='practice' if course['language'] else 'fe',
                        preferred_language=course['language'], enrolled_course_version_ids=enrolled,
                        review_pending_count=pending, retention_kind='learning' if r['evidence'] else 'empty',
                        empty_expires_on=r['empty_expires_on'], next_action=dict(
                            kind='course_complete' if done else ('review' if pending else 'learn'),
                            unit_version_id=unit['unit_version_id'], assignment_version_id=None, course_version_id=r['course_id'],
                            reason='COURSE_FINISHED' if done else ('REVIEW_NEEDED' if pending else 'RESUME')))

    @app.get('/api/v1/questions/{question_id}')
    def question(question_id: str, request: Request):
        with engine.connect() as c:
            r = owner(c, request)
            if question_id not in QUESTIONS:
                raise Failure(404, 'NOT_FOUND')
            enrolled_unit(c, r, QUESTIONS[question_id]['unit_version_id'])
            return public_question(question_id)

    @app.get('/api/v1/units/{unit_id}/questions')
    def unit_questions(unit_id: str, request: Request):
        with engine.connect() as c:
            r = owner(c, request)
            unit = enrolled_unit(c, r, unit_id)
            answers, counts, incorrect = {}, {}, {}
            for qid, correct in c.execute(text('SELECT question_id,correct FROM attempts WHERE record_id=:rid ORDER BY sequence'), {'rid': r['id']}):
                answers[qid] = bool(correct)
                counts[qid] = counts.get(qid, 0) + 1
                if not correct:
                    incorrect[qid] = incorrect.get(qid, 0) + 1
            items = [dict(question_version_id=qid, kind=QUESTIONS[qid]['kind'], required=True,
                          objective_ids=QUESTION_OBJECTIVES[qid], attempt_count=counts.get(qid, 0), incorrect_count=incorrect.get(qid, 0), latest_correct=answers.get(qid))
                     for qid in unit['question_ids']]
            return dict(items=items, next_after_id=None, has_more=False)

    @app.get('/api/v1/units/{unit_id}/assignments')
    def assignments(unit_id: str, request: Request):
        with engine.connect() as c:
            r = owner(c, request)
            enrolled_unit(c, r, unit_id)
            return dict(items=[dict(assignment_version_id=a['assignment_version_id'], unit_version_id=unit_id, required=False)
                              for a in ASSIGNMENTS.values() if a['unit_version_id'] == unit_id], next_after_id=None, has_more=False)

    @app.get('/api/v1/assignments/{assignment_id}')
    def assignment(assignment_id: str, request: Request):
        with engine.connect() as c:
            r = owner(c, request)
            a = ASSIGNMENTS.get(assignment_id)
            if not a:
                raise Failure(404, 'NOT_FOUND')
            enrolled_unit(c, r, a['unit_version_id'])
            return a

    def practice_result(row):
        return dict(practice_attempt_id=row['id'], assignment_version_id=row['assignment_version_id'],
                    sequence_no=row['sequence'], self_confirmed=bool(row['self_confirmed']),
                    self_checks=json.loads(row['self_checks']), revision=row['revision'])

    @app.post('/api/v1/practice-attempts')
    def record_practice(request: Request):
        b = body(request, ['assignment_version_id', 'self_checks'])
        uuid(b['assignment_version_id'])
        checks = b['self_checks']
        if not isinstance(checks, list) or not 1 <= len(checks) <= 30:
            raise Failure(400, 'INVALID_REQUEST')
        values = {}
        for check in checks:
            if not isinstance(check, dict) or set(check) != {'rubric_item_id', 'met'} or type(check['met']) is not bool:
                raise Failure(400, 'INVALID_REQUEST')
            item_id = uuid(check['rubric_item_id'])
            if item_id in values:
                raise Failure(400, 'INVALID_REQUEST')
            values[item_id] = check['met']
        with transaction() as c:
            r = owner(c, request)
            a = ASSIGNMENTS.get(b['assignment_version_id'])
            if not a:
                raise Failure(404, 'NOT_FOUND')
            enrolled_unit(c, r, a['unit_version_id'])
            if set(values) != {item['rubric_item_id'] for item in a['rubric_items']}:
                raise Failure(400, 'INVALID_REQUEST')
            def action():
                normalized = [dict(rubric_item_id=item['rubric_item_id'], met=values[item['rubric_item_id']]) for item in a['rubric_items']]
                confirmed = all(values[item['rubric_item_id']] for item in a['rubric_items'] if item['required'])
                sequence = c.execute(text('SELECT coalesce(max(sequence),0)+1 FROM practice_attempts WHERE record_id=:rid'), {'rid': r['id']}).scalar_one()
                attempt_id = str(uuid4())
                c.execute(text('INSERT INTO practice_attempts VALUES (:id,:rid,:aid,:seq,:confirmed,:checks,:revision)'),
                          {'id': attempt_id, 'rid': r['id'], 'aid': a['assignment_version_id'], 'seq': sequence,
                           'confirmed': int(confirmed), 'checks': json.dumps(normalized), 'revision': r['revision']+1})
                c.execute(text('UPDATE records SET evidence=1,empty_expires_on=NULL,last_active_month=:month,revision=revision+1 WHERE id=:rid'),
                          {'rid': r['id'], 'month': today().replace(day=1).isoformat()})
                return practice_result(c.execute(text('SELECT * FROM practice_attempts WHERE id=:id'), {'id': attempt_id}).mappings().one())
            return idempotent(c, request, action, 201)

    @app.get('/api/v1/practice-attempts')
    def practice_history(request: Request):
        with engine.connect() as c:
            r = owner(c, request)
            limit = int(request.query_params.get('limit', '50'))
            after_id = request.query_params.get('after_id')
            cursor = None
            if after_id is not None:
                cursor = c.execute(text('SELECT sequence FROM practice_attempts WHERE id=:id AND record_id=:rid'),
                                   {'id': after_id, 'rid': r['id']}).scalar_one_or_none()
                if cursor is None:
                    raise Failure(404, 'NOT_FOUND')
            rows = list(c.execute(text('SELECT * FROM practice_attempts WHERE record_id=:rid' +
                        (' AND sequence < :cursor' if cursor is not None else '') + ' ORDER BY sequence DESC LIMIT :limit'),
                        {'rid': r['id'], 'cursor': cursor, 'limit': limit+1}).mappings())
            more = len(rows) > limit
            rows = rows[:limit]
            return dict(items=[practice_result(row) for row in rows], has_more=more,
                        next_after_id=rows[-1]['id'] if more else None)

    @app.post('/api/v1/units/{unit_id}/review-next')
    def review(unit_id: str, request: Request):
        value = request.state.body
        goal_id = None
        if isinstance(value, dict) and set(value) == {'objective_id'}:
            goal_id = uuid(body(request, ['objective_id'])['objective_id'])
        else:
            body(request, [])
        with transaction() as c:
            r = owner(c, request)
            unit = enrolled_unit(c, r, unit_id)
            if goal_id is not None and goal_id not in {goal['objective_id'] for goal in OBJECTIVES[unit_id]}:
                raise Failure(404, 'NOT_FOUND')
            def action():
                if goal_id is not None:
                    history = c.execute(text('SELECT question_id,correct,sequence FROM attempts WHERE record_id=:rid ORDER BY sequence'), {'rid': r['id']})
                    qid = select_goal_question(unit_id, goal_id, history)
                    if qid is None:
                        raise Failure(404, 'NOT_FOUND')
                    return public_question(qid)
                answers = latest(c, r['id'])
                # Retain unit-wide selection for older clients sending {}.
                q = next((q for q in unit['question_ids'] if not answers.get(q)), unit['question_ids'][0])
                return public_question(q)
            return idempotent(c, request, action)

    @app.post('/api/v1/questions/{question_id}/attempts')
    def answer(question_id: str, request: Request):
        b = body(request, ['choice_ids'])
        choices = b['choice_ids']
        if not isinstance(choices, list) or not 1 <= len(choices) <= 10:
            raise Failure(400, 'INVALID_REQUEST')
        for choice in choices:
            uuid(choice)
        with transaction() as c:
            r = owner(c, request)
            if question_id not in QUESTIONS:
                raise Failure(404, 'NOT_FOUND')
            enrolled_unit(c, r, QUESTIONS[question_id]['unit_version_id'])
            q = QUESTIONS[question_id]
            allowed = {x['id'] for x in q['choices']}
            if (len(set(choices)) != len(choices) or not set(choices) <= allowed
                    or q['kind'] == 'single' and len(choices) != 1
                    or q['kind'] == 'order' and len(choices) != len(allowed)):
                raise Failure(400, 'INVALID_REQUEST')
            def action():
                correct = set(choices) == set(q['correct_ids']) if q['kind'] == 'multi' else choices == q['correct_ids']
                repeat = question_id in latest(c, r['id'])
                seq = c.execute(text('SELECT coalesce(max(sequence),0)+1 FROM attempts WHERE record_id=:id'), {'id': r['id']}).scalar_one()
                aid = str(uuid4())
                c.execute(text('INSERT INTO attempts VALUES (:aid,:rid,:qid,:seq,:choices,:correct)'),
                          dict(aid=aid, rid=r['id'], qid=question_id, seq=seq, choices=json.dumps(choices), correct=int(correct)))
                c.execute(text('UPDATE records SET evidence=1, empty_expires_on=NULL, revision=revision+1, last_active_month=:month WHERE id=:id'), {'month': today().replace(day=1).isoformat(), 'id': r['id']})
                return dict(attempt_id=aid, correct=correct, explanation=q['explanation'], is_repeat=repeat)
            return idempotent(c, request, action, 201)

    @app.post('/api/v1/units/{unit_id}/assess')
    def assess(unit_id: str, request: Request):
        body(request, [])
        with transaction() as c:
            r = owner(c, request)
            unit = enrolled_unit(c, r, unit_id)
            def action():
                answers = latest(c, r['id'])
                if not all(answers.get(q) for q in unit['question_ids']):
                    raise Failure(409, 'REQUIREMENTS_UNMET')
                if not completed(c, r, unit['course_version_id']):
                    c.execute(text('UPDATE enrollments SET completed=1 WHERE record_id=:rid AND course_version_id=:cid'),
                              {'rid': r['id'], 'cid': unit['course_version_id']})
                    c.execute(text('UPDATE records SET completed=1,revision=revision+1,last_active_month=:month WHERE id=:id'),
                              {'id': r['id'], 'month': today().replace(day=1).isoformat()})
                revision = c.execute(text('SELECT revision FROM records WHERE id=:id'), {'id': r['id']}).scalar_one()
                return dict(resource_id=unit_id, revision=revision)
            return idempotent(c, request, action)

    @app.get('/api/v1/progress')
    def progress(request: Request):
        with engine.connect() as c:
            r = owner(c, request)
            answers, first = {}, {}
            for qid, correct in c.execute(text('SELECT question_id,correct FROM attempts WHERE record_id=:rid ORDER BY sequence'), {'rid': r['id']}):
                answers[qid] = bool(correct)
                first.setdefault(qid, bool(correct))
            practice_units = {ASSIGNMENTS[aid]['unit_version_id'] for aid in c.execute(text('SELECT DISTINCT assignment_version_id FROM practice_attempts WHERE record_id=:rid'), {'rid': r['id']}).scalars() if aid in ASSIGNMENTS}
            result = []
            for cid, done in c.execute(text('SELECT course_version_id,completed FROM enrollments WHERE record_id=:rid ORDER BY course_version_id'), {'rid': r['id']}):
                u = next(u for u in UNITS.values() if u['course_version_id'] == cid)
                n = sum(bool(answers.get(q)) for q in u['question_ids'])
                started = any(q in answers for q in u['question_ids']) or u['unit_version_id'] in practice_units
                result.append(dict(unit_version_id=u['unit_version_id'], state='completed' if done else ('requirements_unmet' if started else 'not_started'),
                         correct_count=n, question_count=len(u['question_ids']), completion_basis='self_confirmed' if done else 'none',
                         objectives=objective_progress(u['unit_version_id'], answers, first), review_pending_count=sum(answers.get(q) is False for q in u['question_ids'])))
            return result

    return app
