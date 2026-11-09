"""Local prototype deletion ledger, stored independently of learning DB backups."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool


class DeletionLedger:
    def __init__(self, path, expected_id=None):
        self.path = Path(path)
        existed = self.path.exists()
        if expected_id and not existed:
            raise RuntimeError('DELETION_LEDGER_REQUIRED')
        self.engine = create_engine('sqlite:///' + self.path.as_posix(), poolclass=NullPool,
                                    hide_parameters=True)
        if not existed:
            with self.engine.begin() as c:
                c.exec_driver_sql('PRAGMA synchronous=FULL')
                c.exec_driver_sql('CREATE TABLE metadata (id TEXT PRIMARY KEY)')
                c.exec_driver_sql('CREATE TABLE deletion_tombstones (record_id TEXT PRIMARY KEY, expires_at TEXT NOT NULL)')
                c.execute(text('INSERT INTO metadata VALUES (:id)'), {'id': str(uuid4())})
        with self.engine.connect() as c:
            self.id = c.execute(text('SELECT id FROM metadata')).scalar_one()
        if expected_id and self.id != expected_id:
            raise RuntimeError('DELETION_LEDGER_MISMATCH')

    def validate(self, c):
        if not self.path.is_file() or c.execute(text('SELECT id FROM metadata')).scalar_one() != self.id:
            raise RuntimeError('DELETION_LEDGER_REQUIRED')

    def contains(self, record_id):
        with self.engine.connect() as c:
            self.validate(c)
            return bool(c.execute(text('SELECT 1 FROM deletion_tombstones WHERE record_id=:id'), {'id': record_id}).first())

    def check(self):
        with self.engine.connect() as c:
            self.validate(c)

    def record(self, record_id):
        # Commit and fsync the independent ledger BEFORE learning data is erased.
        with self.engine.begin() as c:
            self.validate(c)
            c.exec_driver_sql('PRAGMA synchronous=FULL')
            c.execute(text('INSERT OR IGNORE INTO deletion_tombstones VALUES (:id,:expiry)'),
                      {'id': record_id, 'expiry': (datetime.now(timezone.utc)+timedelta(days=35)).isoformat()})

    def records(self):
        with self.engine.connect() as c:
            self.validate(c)
            return list(c.execute(text('SELECT record_id FROM deletion_tombstones')).scalars())


def purge_record(c, record_id):
    c.execute(text('DELETE FROM idempotency WHERE credential_id IN '
                   '(SELECT credential_id FROM records WHERE id=:id UNION '
                   'SELECT credential_id FROM revoked_credentials WHERE record_id=:id)'), {'id': record_id})
    c.execute(text('DELETE FROM attempts WHERE record_id=:id'), {'id': record_id})
    c.execute(text('DELETE FROM practice_attempts WHERE record_id=:id'), {'id': record_id})
    c.execute(text('DELETE FROM revoked_credentials WHERE record_id=:id'), {'id': record_id})
    c.execute(text('DELETE FROM enrollments WHERE record_id=:id'), {'id': record_id})
    c.execute(text('DELETE FROM learning_preferences WHERE record_id=:id'), {'id': record_id})
    c.execute(text('DELETE FROM records WHERE id=:id'), {'id': record_id})
