from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.rate_limit import RateLimiter
from test_pilot import env, start, get, send, key


def test_credential_burst_refill_and_isolation():
    now = [0.0]
    limiter = RateLimiter(clock=lambda: now[0])
    subject = [('credential', 'one')]
    assert [limiter.check(subject) for _ in range(20)] == [0] * 20
    assert limiter.check(subject) == 1
    assert limiter.check([('credential', 'two')]) == 0
    now[0] = 0.49
    assert limiter.check(subject) == 1
    now[0] = 0.5
    assert limiter.check(subject) == 0
    assert limiter.check(subject) == 1


def test_bootstrap_ip_and_global_budgets_are_atomic():
    now = [0.0]
    limiter = RateLimiter(clock=lambda: now[0])
    first = [('bootstrap_ip', 'one'), ('bootstrap_global', 'all')]
    assert all(limiter.check(first) == 0 for _ in range(60))
    assert limiter.check(first) == 6
    # Denied requests must not consume the global tokens.
    for _ in range(100):
        assert limiter.check(first) == 6
    second = [('bootstrap_ip', 'two'), ('bootstrap_global', 'all')]
    assert all(limiter.check(second) == 0 for _ in range(60))
    third = [('bootstrap_ip', 'three'), ('bootstrap_global', 'all')]
    assert limiter.check(third) == 2
    now[0] = 2
    assert limiter.check(third) == 0


def test_concurrent_requests_never_exceed_capacity():
    limiter = RateLimiter(clock=lambda: 0)
    with ThreadPoolExecutor(max_workers=20) as pool:
        result = list(pool.map(lambda _: limiter.check([('credential', 'same')]), range(100)))
    assert result.count(0) == 20
    assert result.count(1) == 80


def test_bucket_memory_is_bounded_and_idle_state_is_removed():
    now = [0.0]
    limiter = RateLimiter(clock=lambda: now[0], max_buckets=2)
    assert limiter.check([('credential', 'one')]) == 0
    assert limiter.check([('credential', 'two')]) == 0
    assert limiter.check([('credential', 'three')]) == 60
    assert len(limiter._buckets) == 2
    now[0] = 600
    assert limiter.check([('credential', 'three')]) == 0
    assert len(limiter._buckets) == 1


def test_bucket_keys_do_not_retain_raw_addresses_or_credentials():
    limiter = RateLimiter(clock=lambda: 0)
    marker_ip, marker_key = '203.0.113.42', 'credential-marker'
    limiter.check([('bootstrap_ip', marker_ip), ('credential', marker_key)])
    snapshot = repr(limiter.__dict__)
    assert marker_ip not in snapshot and marker_key not in snapshot
    assert all(isinstance(k[1], bytes) and len(k[1]) == 32 for k in limiter._buckets)
    assert RateLimiter(clock=lambda: 0).key('credential', marker_key) != limiter.key('credential', marker_key)


def frozen_clock(client):
    limiter = client.app.state.rate_limiter
    now = [limiter.clock()]
    limiter.clock = lambda: now[0]
    return now


def test_api_429_has_retry_after_no_writes_and_resumes(env):
    client, engine = env
    now = frozen_clock(client)
    auth, unit = start(client)
    for _ in range(19):
        assert get(client, '/records/me', auth).status_code == 200
    with engine.connect() as c:
        before = dict(c.execute(text('SELECT * FROM records')).mappings().one())
    response = send(client, f"/units/{unit['unit_version_id']}/assess", auth)
    assert response.status_code == 429
    assert response.json()['code'] == 'RATE_LIMITED'
    assert response.headers['Retry-After'] == '1'
    assert response.headers['Cache-Control'] == 'no-store'
    assert auth not in response.text
    with engine.connect() as c:
        assert dict(c.execute(text('SELECT * FROM records')).mappings().one()) == before
        assert c.execute(text('SELECT count(*) FROM attempts')).scalar_one() == 0
    now[0] += 0.5
    assert get(client, '/records/me', auth).status_code == 200


def test_thirty_learners_behind_one_peer_can_start_but_spoofed_forwarding_does_not_bypass_limit(env):
    client, engine = env
    now = frozen_clock(client)
    for _ in range(30):
        start(client)
    for _ in range(30):
        assert send(client, '/records', key()).status_code == 400
    response = client.post('/api/v1/records', headers={'X-Forwarded-For': '198.51.100.55'}, json={})
    assert response.status_code == 429 and response.headers['Retry-After'] == '6'
    with engine.connect() as c:
        assert c.execute(text('SELECT count(*) FROM records')).scalar_one() == 30
    now[0] += 6
    assert send(client, '/records', key()).status_code == 400


def test_global_bootstrap_limit_spans_different_peers(env):
    client, _ = env
    now = frozen_clock(client)
    for ip in ['203.0.113.10', '203.0.113.11']:
        with TestClient(client.app, client=(ip, 50000)) as peer:
            for _ in range(60):
                assert peer.post('/api/v1/records', json={}).status_code == 400
    with TestClient(client.app, client=('203.0.113.12', 50000)) as peer:
        response = peer.post('/api/v1/records', json={})
        assert response.status_code == 429 and response.headers['Retry-After'] == '2'
        now[0] += 2
        assert peer.post('/api/v1/records', json={}).status_code == 400
