"""Retention decisions for the local P1 schema; no classroom dependency."""
from datetime import date

from sqlalchemy import text

from .deletions import purge_record


def canonical_date(value):
    parsed = date.fromisoformat(value)
    if parsed.isoformat() != value:
        raise ValueError('INVALID_RETENTION_DATE')
    return parsed


def retention_status(c, record, as_of):
    has_attempts = bool(c.execute(text('SELECT 1 FROM attempts WHERE record_id=:id LIMIT 1'),
                                  {'id': record['id']}).first())
    has_practice = bool(c.execute(text('SELECT 1 FROM practice_attempts WHERE record_id=:id LIMIT 1'),
                                  {'id': record['id']}).first())
    # Never treat evidence-bearing data as an empty record, even if a legacy
    # flag is inconsistent. Evidence is rechecked under the same write lock.
    learning = bool(record['evidence'] or record['completed'] or has_attempts or has_practice)
    if learning:
        month = canonical_date(record['last_active_month'])
        if month.day != 1:
            raise ValueError('INVALID_RETENTION_MONTH')
        deadline = date(month.year + 2, month.month, 1)
    else:
        deadline = canonical_date(record['empty_expires_on'])
    return ('learning' if learning else 'empty'), deadline, as_of >= deadline


def maintain_retention(engine, ledger, as_of, apply=False):
    counts = dict(expired_empty=0, expired_learning=0, pending_deletions=0, deleted=0)
    ledger.check()
    with engine.connect() as c:
        ids = list(c.execute(text('SELECT id FROM records ORDER BY id')).scalars())
    for record_id in ids:
        with engine.connect() as c:
            if apply:
                c.exec_driver_sql('PRAGMA foreign_keys=ON')
                c.exec_driver_sql('BEGIN IMMEDIATE')
            try:
                record = c.execute(text('SELECT * FROM records WHERE id=:id'), {'id': record_id}).mappings().first()
                if not record:
                    continue
                pending = ledger.contains(record_id)
                if pending:
                    counts['pending_deletions'] += 1
                else:
                    kind, _, expired = retention_status(c, record, as_of)
                    if not expired:
                        continue
                    counts['expired_' + kind] += 1
                if apply:
                    ledger.record(record_id)
                    purge_record(c, record_id)
                    c.commit()
                    counts['deleted'] += 1
            finally:
                # Includes skipped rows and failures; never commit partial SQL.
                c.rollback()
    return counts
