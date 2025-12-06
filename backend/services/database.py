"""Database connection helpers shared across the backend."""

from __future__ import annotations

import logging
import os
import sqlite3
import time
from pathlib import Path
from typing import Callable, Optional


logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parents[2]
SQLITE_DB_PATH = Path(os.getenv("SQLITE_DB_PATH") or (_REPO_ROOT / "users.db"))
USE_MYSQL = os.getenv("DB_BACKEND", "sqlite").lower() == "mysql"

# Retry configuration for MySQL connections
MYSQL_MAX_RETRIES = int(os.environ.get("MYSQL_MAX_RETRIES", "3"))
MYSQL_RETRY_DELAY = float(os.environ.get("MYSQL_RETRY_DELAY", "0.5"))


def get_sql_placeholder() -> str:
    """Return the correct SQL placeholder for the configured backend."""
    return "%s" if USE_MYSQL else "?"


def _load_sqlite_bootstrap() -> Optional[Callable[[], None]]:
    try:
        from bodybuilding_app import ensure_database_exists  # type: ignore

        return ensure_database_exists
    except Exception:
        return None


def get_db_connection():
    """Return a database connection with light SQL adaptation and retry logic."""
    if USE_MYSQL:
        try:
            import pymysql  # type: ignore
            from pymysql.cursors import DictCursor  # type: ignore
        except Exception as import_err:  # pragma: no cover - defensive
            logger.error("PyMySQL not installed or failed to import: %s", import_err)
            raise

        host = os.environ.get("MYSQL_HOST")
        user = os.environ.get("MYSQL_USER")
        password = os.environ.get("MYSQL_PASSWORD")
        database = os.environ.get("MYSQL_DB")
        if not all([host, user, password, database]):
            raise RuntimeError("Missing MySQL env vars: MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB")

        last_error = None
        for attempt in range(MYSQL_MAX_RETRIES):
            try:
                conn = pymysql.connect(
                    host=host,
                    user=user,
                    password=password,
                    database=database,
                    charset="utf8mb4",
                    autocommit=True,
                    cursorclass=DictCursor,
                    connect_timeout=int(os.environ.get("MYSQL_CONNECT_TIMEOUT", "10")),
                    read_timeout=int(os.environ.get("MYSQL_READ_TIMEOUT", "30")),
                    write_timeout=int(os.environ.get("MYSQL_WRITE_TIMEOUT", "30")),
                )

                try:
                    orig_cursor = conn.cursor

                    def _adapt_sql(sql: str) -> str:
                        s = sql
                        s = s.replace("INSERT IGNORE", "INSERT IGNORE")
                        s = s.replace("NOW()", "NOW()")
                        return s

                    class _ProxyCursor:
                        def __init__(self, real):
                            self._real = real

                        def execute(self, query, params=None):
                            q = _adapt_sql(query)
                            if params is not None:
                                q = q.replace("?", "%s")
                                return self._real.execute(q, params)
                            return self._real.execute(q)

                        def executemany(self, query, param_seq):
                            q = _adapt_sql(query).replace("?", "%s")
                            return self._real.executemany(q, param_seq)

                        def __getattr__(self, name):
                            return getattr(self._real, name)

                    def _patched_cursor(*args, **kwargs):  # type: ignore[override]
                        return _ProxyCursor(orig_cursor(*args, **kwargs))

                    conn.cursor = _patched_cursor  # type: ignore[attr-defined]
                except Exception as wrap_err:  # pragma: no cover - best effort
                    logger.warning("Could not wrap MySQL cursor for SQL adaptation: %s", wrap_err)

                return conn
            except (pymysql.err.OperationalError, pymysql.err.InterfaceError, TimeoutError, OSError) as err:
                last_error = err
                if attempt < MYSQL_MAX_RETRIES - 1:
                    logger.warning("MySQL connection attempt %d/%d failed: %s. Retrying in %.1fs...", 
                                   attempt + 1, MYSQL_MAX_RETRIES, err, MYSQL_RETRY_DELAY)
                    time.sleep(MYSQL_RETRY_DELAY)
                else:
                    logger.error("Failed to connect to MySQL after %d attempts: %s", MYSQL_MAX_RETRIES, err)
            except Exception as err:
                logger.error("Unexpected error connecting to MySQL: %s", err)
                raise
        
        # If we get here, all retries failed
        raise last_error if last_error else RuntimeError("Failed to connect to MySQL")

    # SQLite (default for local dev or scripts)
    db_path = str(SQLITE_DB_PATH)
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row

        try:
            orig_cursor = conn.cursor

            def _adapt_sqlite_sql(sql: str) -> str:
                s = sql
                s = s.replace("INSERT IGNORE", "INSERT OR IGNORE")
                s = s.replace("PRIMARY KEY AUTO_INCREMENT", "PRIMARY KEY AUTOINCREMENT")
                s = s.replace("AUTO_INCREMENT", "AUTOINCREMENT")
                s = s.replace("NOW()", "datetime('now')")
                return s

            class _ProxyCursor:
                def __init__(self, real):
                    self._real = real

                def execute(self, query, params=None):
                    q = _adapt_sqlite_sql(query)
                    if params is not None:
                        return self._real.execute(q, params)
                    return self._real.execute(q)

                def executemany(self, query, param_seq):
                    q = _adapt_sqlite_sql(query)
                    return self._real.executemany(q, param_seq)

                def __getattr__(self, name):
                    return getattr(self._real, name)

            def _patched_cursor(*args, **kwargs):  # type: ignore[override]
                return _ProxyCursor(orig_cursor(*args, **kwargs))

            conn.cursor = _patched_cursor  # type: ignore[attr-defined]
        except Exception as wrap_err:  # pragma: no cover - best effort
            logger.warning("Could not wrap SQLite cursor for SQL adaptation: %s", wrap_err)

        return conn
    except Exception as err:
        logger.error("Failed to connect to database at %s: %s", db_path, err)
        bootstrap = _load_sqlite_bootstrap()
        if bootstrap:
            bootstrap()
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            return conn
        raise
