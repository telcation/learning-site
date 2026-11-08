"""Local development maintenance. Preview by default; not the production learnctl."""
import argparse
import json
import logging
import os
from pathlib import Path
import sqlite3
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from app.deletions import DeletionLedger
from app.main import today
from app.retention import maintain_retention


def main(argv=None):
    logging.disable(logging.CRITICAL)
    parser = argparse.ArgumentParser(description='Local P1 retention preview/apply; requires an initialized DB and current deletion ledger.')
    parser.add_argument('--apply', action='store_true', help='Erase expired records after recording tombstones. Default is read-only preview.')
    parser.add_argument('--database', type=Path, default=Path(__file__).resolve().parents[1] / '.local' / 'learning.db')
    args = parser.parse_args(argv)
    engine = None
    try:
        if os.environ.get('LEARNING_ENV', 'development') != 'development':
            raise RuntimeError('LOCAL_ONLY')
        path = args.database.resolve()
        # No schema creation, migration, startup replay or empty DB creation.
        uri = path.as_uri() + ('?mode=rw' if args.apply else '?mode=ro')
        engine = create_engine('sqlite://', creator=lambda: sqlite3.connect(uri, uri=True),
                               poolclass=NullPool, hide_parameters=True)
        with engine.connect() as c:
            expected_id = c.execute(text("SELECT value FROM app_metadata WHERE name='deletion_ledger_id'")).scalar_one()
        ledger = DeletionLedger(str(path) + '.deletions', expected_id)
        counts = maintain_retention(engine, ledger, today(), args.apply)
        print(json.dumps(dict(mode='apply' if args.apply else 'preview', **counts)))
        return 0
    except Exception:
        # Do not echo paths, DB contents, credentials or exception parameters.
        print('{"code":"RETENTION_FAILED"}', file=sys.stderr)
        return 1
    finally:
        if engine is not None:
            engine.dispose()


if __name__ == '__main__':
    raise SystemExit(main())
