"""Independent credential state for restoring the local learning DB safely.

Contains credential IDs and HMAC verifiers, never raw learning keys. Keep the
latest file independently of learning DB snapshots, like the deletion ledger.
"""
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool


class CredentialLedger:
    def __init__(self, path, expected_id=None):
        self.path = Path(path)
        existed = self.path.exists()
        if expected_id and not existed:
            raise RuntimeError('CREDENTIAL_LEDGER_REQUIRED')
        self.engine = create_engine('sqlite:///' + self.path.as_posix(), poolclass=NullPool, hide_parameters=True)
        if not existed:
            with self.engine.begin() as c:
                c.exec_driver_sql('PRAGMA synchronous=FULL')
                c.exec_driver_sql('CREATE TABLE metadata (id TEXT PRIMARY KEY, initialized INTEGER NOT NULL)')
                c.exec_driver_sql('CREATE TABLE heads (record_id TEXT PRIMARY KEY,credential_id TEXT UNIQUE NOT NULL,secret_hmac TEXT NOT NULL,revision INTEGER NOT NULL)')
                c.exec_driver_sql('CREATE TABLE revoked_credentials (credential_id TEXT PRIMARY KEY,record_id TEXT NOT NULL)')
                c.execute(text('INSERT INTO metadata VALUES (:id,0)'), {'id': str(uuid4())})
        with self.engine.connect() as c:
            row = c.execute(text('SELECT * FROM metadata')).mappings().one()
            self.id, self.initializing = row['id'], not bool(row['initialized'])
        if expected_id and self.id != expected_id:
            raise RuntimeError('CREDENTIAL_LEDGER_MISMATCH')
        if expected_id and self.initializing:
            raise RuntimeError('CREDENTIAL_LEDGER_NOT_READY')

    def validate(self, c):
        if not self.path.is_file():
            raise RuntimeError('CREDENTIAL_LEDGER_REQUIRED')
        row = c.execute(text('SELECT * FROM metadata')).mappings().one()
        if row['id'] != self.id or not self.initializing and not row['initialized']:
            raise RuntimeError('CREDENTIAL_LEDGER_MISMATCH')

    @contextmanager
    def read(self):
        if not self.path.is_file():
            raise RuntimeError('CREDENTIAL_LEDGER_REQUIRED')
        with self.engine.connect() as c:
            self.validate(c)
            yield c

    @contextmanager
    def write(self):
        if not self.path.is_file():
            raise RuntimeError('CREDENTIAL_LEDGER_REQUIRED')
        with self.engine.connect() as c:
            c.exec_driver_sql('PRAGMA synchronous=FULL')
            c.exec_driver_sql('BEGIN IMMEDIATE')
            try:
                self.validate(c)
                yield c
                c.commit()
            except BaseException:
                c.rollback()
                raise

    def check(self):
        with self.read():
            pass

    def head(self, record_id):
        with self.read() as c:
            row = c.execute(text('SELECT * FROM heads WHERE record_id=:rid'), {'rid': record_id}).mappings().first()
            return dict(row) if row else None

    def is_revoked(self, credential_id):
        with self.read() as c:
            return bool(c.execute(text('SELECT 1 FROM revoked_credentials WHERE credential_id=:cid'), {'cid': credential_id}).first())

    def used(self, credential_id):
        with self.read() as c:
            return bool(c.execute(text('SELECT 1 FROM heads WHERE credential_id=:cid UNION ALL SELECT 1 FROM revoked_credentials WHERE credential_id=:cid'), {'cid': credential_id}).first())

    def revoked_for(self, record_id):
        with self.read() as c:
            return list(c.execute(text('SELECT credential_id FROM revoked_credentials WHERE record_id=:rid'), {'rid': record_id}).scalars())

    def add_revoked(self, c, record_id, credential_ids):
        for cid in credential_ids:
            previous = c.execute(text('SELECT record_id FROM revoked_credentials WHERE credential_id=:cid'), {'cid': cid}).scalar_one_or_none()
            active = c.execute(text('SELECT 1 FROM heads WHERE credential_id=:cid'), {'cid': cid}).first()
            if active or previous is not None and previous != record_id:
                raise RuntimeError('CREDENTIAL_LEDGER_MISMATCH')
            c.execute(text('INSERT OR IGNORE INTO revoked_credentials VALUES (:cid,:rid)'), {'cid': cid, 'rid': record_id})

    def import_legacy(self, record, revoked):
        with self.write() as c:
            c.execute(text('INSERT INTO heads VALUES (:rid,:cid,:digest,:revision)'),
                      {'rid': record['id'], 'cid': record['credential_id'], 'digest': record['secret_hmac'], 'revision': record['revision']})
            self.add_revoked(c, record['id'], revoked)

    def register(self, record):
        head = self.head(record['id'])
        if head:
            if head['credential_id'] != record['credential_id'] or head['secret_hmac'] != record['secret_hmac']:
                raise RuntimeError('CREDENTIAL_LEDGER_MISMATCH')
            return
        self.import_legacy(record, [])

    def remember_revoked(self, record_id, revoked):
        missing = set(revoked) - set(self.revoked_for(record_id))
        if missing:
            with self.write() as c:
                self.add_revoked(c, record_id, missing)

    def mark_ready(self):
        if self.initializing:
            with self.write() as c:
                c.execute(text('UPDATE metadata SET initialized=1'))
            self.initializing = False

    def rotate(self, record_id, old_id, new_id, new_hmac, revision):
        with self.write() as c:
            previous = c.execute(text('SELECT credential_id FROM heads WHERE record_id=:rid'), {'rid': record_id}).scalar_one_or_none()
            if previous is not None and previous != old_id:
                raise RuntimeError('CREDENTIAL_LEDGER_MISMATCH')
            if c.execute(text('SELECT 1 FROM heads WHERE credential_id=:cid UNION ALL SELECT 1 FROM revoked_credentials WHERE credential_id=:cid'), {'cid': new_id}).first():
                raise RuntimeError('CREDENTIAL_ALREADY_USED')
            c.execute(text('INSERT INTO heads VALUES (:rid,:cid,:digest,:revision) ON CONFLICT(record_id) DO UPDATE SET credential_id=excluded.credential_id,secret_hmac=excluded.secret_hmac,revision=excluded.revision'),
                      {'rid': record_id, 'cid': new_id, 'digest': new_hmac, 'revision': revision})
            self.add_revoked(c, record_id, [old_id])

    def forget(self, record_id):
        with self.write() as c:
            c.execute(text('DELETE FROM revoked_credentials WHERE record_id=:rid'), {'rid': record_id})
            c.execute(text('DELETE FROM heads WHERE record_id=:rid'), {'rid': record_id})


def prepare_credential_ledger(engine, database_path, deleted_ids):
    with engine.connect() as c:
        c.exec_driver_sql('PRAGMA foreign_keys=ON')
        c.exec_driver_sql('BEGIN IMMEDIATE')
        try:
            expected = c.execute(text("SELECT value FROM app_metadata WHERE name='credential_ledger_id'")).scalar_one_or_none()
            ledger = CredentialLedger(str(Path(database_path).resolve()) + '.credentials', expected)
            for record_id in deleted_ids:
                ledger.forget(record_id)
            for record in c.execute(text('SELECT * FROM records')).mappings().all():
                revoked = list(c.execute(text('SELECT credential_id FROM revoked_credentials WHERE record_id=:rid'), {'rid': record['id']}).scalars())
                head = ledger.head(record['id'])
                if head is None:
                    if revoked and (expected is not None or not ledger.initializing):
                        raise RuntimeError('CREDENTIAL_LEDGER_REQUIRED')
                    ledger.import_legacy(record, revoked)
                    head = ledger.head(record['id'])
                if record['credential_id'] != head['credential_id'] and record['revision'] >= head['revision']:
                    raise RuntimeError('CREDENTIAL_LEDGER_STALE')
                if head['credential_id'] in revoked:
                    raise RuntimeError('CREDENTIAL_LEDGER_MISMATCH')
                if record['credential_id'] == head['credential_id']:
                    if record['secret_hmac'] != head['secret_hmac']:
                        raise RuntimeError('CREDENTIAL_LEDGER_MISMATCH')
                    if record['revision'] < head['revision']:
                        c.execute(text('UPDATE records SET revision=:revision WHERE id=:rid'),
                                  {'rid': record['id'], 'revision': head['revision']})
                else:
                    if record['credential_id'] not in ledger.revoked_for(record['id']):
                        raise RuntimeError('CREDENTIAL_LEDGER_MISMATCH')
                    c.execute(text('UPDATE records SET credential_id=:cid,secret_hmac=:digest,revision=:revision WHERE id=:rid'),
                              {'rid': record['id'], 'cid': head['credential_id'], 'digest': head['secret_hmac'], 'revision': head['revision']})
                ledger.remember_revoked(record['id'], revoked)
                for cid in ledger.revoked_for(record['id']):
                    c.execute(text('INSERT OR IGNORE INTO revoked_credentials VALUES (:cid,:rid)'), {'cid': cid, 'rid': record['id']})
                    c.execute(text('DELETE FROM idempotency WHERE credential_id=:cid'), {'cid': cid})
            ledger.mark_ready()
            if expected is None:
                c.execute(text("INSERT INTO app_metadata VALUES ('credential_ledger_id',:id)"), {'id': ledger.id})
            c.commit()
            return ledger
        except BaseException:
            c.rollback()
            raise
