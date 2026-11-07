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
from fastapi.responses import JSONResponse
from sqlalchemy import create_engine, text

from .content import COURSES, UNITS, QUESTIONS, public_question
from .security import parse_token, digest, UUID_PATTERN
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
        ]:
            c.exec_driver_sql(statement)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.engine = engine

    def error(status, code):
        return JSONResponse({'code': code, 'request_id': str(uuid4())}, status_code=status)

    @app.middleware('http')
    async def boundary(request: Request, call_next):
        try:
            if request.url.query:
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
        if record['empty_expires_on'] and record['empty_expires_on'] <= today().isoformat():
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

    def latest(c, rid):
        rows = c.execute(text('SELECT question_id,correct FROM attempts WHERE record_id=:id ORDER BY sequence'), {'id': rid})
        return {row[0]: bool(row[1]) for row in rows}

    @app.get('/api/v1/health')
    def health():
        with engine.connect() as c:
            c.exec_driver_sql('SELECT 1')
        return {'status': 'ok'}

    @app.get('/api/v1/catalog')
    def catalog():
        return COURSES

    @app.get('/api/v1/units/{unit_id}/material')
    def material(unit_id: str):
        if unit_id not in UNITS:
            raise Failure(404, 'NOT_FOUND')
        return {k: UNITS[unit_id][k] for k in ('unit_version_id', 'revision', 'title', 'markdown')}

    @app.post('/api/v1/records')
    def bootstrap(request: Request):
        b = body(request, ['course_version_id', 'study_route', 'preferred_language'])
        course = next((x for x in COURSES if x['id'] == b['course_version_id']), None)
        if not course or b['study_route'] != ('practice' if course['language'] else 'fe') or b['preferred_language'] != course['language']:
            raise Failure(400, 'INVALID_REQUEST')
        cid, secret = token(request)
        with transaction() as c:
            def action():
                if c.execute(text('SELECT 1 FROM records WHERE credential_id=:cid'), {'cid': cid}).first():
                    raise Failure(409, 'CREDENTIAL_EXISTS')
                values = dict(id=str(uuid4()), cid=cid, digest=digest(pepper, cid, secret), course=course['id'],
                              month=today().replace(day=1).isoformat(), expires=(today()+timedelta(days=30)).isoformat())
                c.execute(text('INSERT INTO records (id,credential_id,secret_hmac,course_id,last_active_month,empty_expires_on) VALUES (:id,:cid,:digest,:course,:month,:expires)'), values)
                return me(c.execute(text('SELECT * FROM records WHERE id=:id'), values).mappings().one())
            return idempotent(c, request, action, 201)

    @app.get('/api/v1/records/me')
    def get_me(request: Request):
        with engine.connect() as c:
            return me(owner(c, request))

    @app.get('/api/v1/learning-home')
    def home(request: Request):
        with engine.connect() as c:
            r = owner(c, request)
            unit = unit_for(r)
            answers = latest(c, r['id'])
            course = next(x for x in COURSES if x['id'] == r['course_id'])
            pending = sum(answers.get(q) is False for q in unit['question_ids'])
            return dict(revision=r['revision'], study_route='practice' if course['language'] else 'fe',
                        preferred_language=course['language'], enrolled_course_version_ids=[r['course_id']],
                        review_pending_count=pending, retention_kind='learning' if r['evidence'] else 'empty',
                        empty_expires_on=r['empty_expires_on'], next_action=dict(
                            kind='course_complete' if r['completed'] else ('review' if pending else 'learn'),
                            unit_version_id=unit['unit_version_id'], assignment_version_id=None, course_version_id=r['course_id'],
                            reason='COURSE_FINISHED' if r['completed'] else ('REVIEW_NEEDED' if pending else 'RESUME')))

    @app.get('/api/v1/questions/{question_id}')
    def question(question_id: str, request: Request):
        with engine.connect() as c:
            r = owner(c, request)
            if question_id not in unit_for(r)['question_ids']:
                raise Failure(404, 'NOT_FOUND')
            return public_question(question_id)

    @app.post('/api/v1/units/{unit_id}/review-next')
    def review(unit_id: str, request: Request):
        body(request, [])
        with transaction() as c:
            r = owner(c, request)
            unit = unit_for(r)
            if unit_id != unit['unit_version_id']:
                raise Failure(404, 'NOT_FOUND')
            def action():
                answers = latest(c, r['id'])
                # This pilot has one question per mandatory objective; never switch objectives.
                q = next((q for q in unit['question_ids'] if not answers.get(q)), unit['question_ids'][0])
                return public_question(q)
            return idempotent(c, request, action)

    @app.post('/api/v1/questions/{question_id}/attempts')
    def answer(question_id: str, request: Request):
        b = body(request, ['choice_ids'])
        choices = b['choice_ids']
        if not isinstance(choices, list) or len(choices) != 1:
            raise Failure(400, 'INVALID_REQUEST')
        uuid(choices[0])
        with transaction() as c:
            r = owner(c, request)
            if question_id not in unit_for(r)['question_ids']:
                raise Failure(404, 'NOT_FOUND')
            q = QUESTIONS[question_id]
            if choices[0] not in [x['id'] for x in q['choices']]:
                raise Failure(400, 'INVALID_REQUEST')
            def action():
                correct = choices == q['correct_ids']
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
            unit = unit_for(r)
            if unit_id != unit['unit_version_id']:
                raise Failure(404, 'NOT_FOUND')
            def action():
                answers = latest(c, r['id'])
                if not all(answers.get(q) for q in unit['question_ids']):
                    raise Failure(409, 'REQUIREMENTS_UNMET')
                if not r['completed']:
                    c.execute(text('UPDATE records SET completed=1,revision=revision+1 WHERE id=:id'), {'id': r['id']})
                revision = c.execute(text('SELECT revision FROM records WHERE id=:id'), {'id': r['id']}).scalar_one()
                return dict(resource_id=unit_id, revision=revision)
            return idempotent(c, request, action)

    @app.get('/api/v1/progress')
    def progress(request: Request):
        with engine.connect() as c:
            r = owner(c, request)
            u, answers = unit_for(r), latest(c, r['id'])
            n = sum(bool(answers.get(q)) for q in u['question_ids'])
            return [dict(unit_version_id=u['unit_version_id'], state='completed' if r['completed'] else ('requirements_unmet' if answers else 'not_started'),
                         correct_count=n, question_count=len(u['question_ids']), completion_basis='self_confirmed' if r['completed'] else 'none',
                         objectives=[], review_pending_count=sum(answers.get(q) is False for q in u['question_ids']))]

    return app
