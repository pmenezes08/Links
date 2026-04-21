"""Shared pytest fixtures — MySQL testcontainer + schema bootstrap.

We deliberately run the new entitlements / AI-usage tests against a real
MySQL 8 instance (spun up via ``testcontainers``) rather than SQLite, for
three reasons:

  1.  Production + staging use MySQL; SQLite's type coercion and
      ``ALTER TABLE`` semantics differ enough that SQLite-only tests have
      shipped bugs twice (one around ``DECIMAL(10, 3)`` rounding on
      ``duration_seconds``, another around ``INSERT IGNORE`` vs
      ``INSERT OR IGNORE``).
  2.  The ``_ensure_column`` / ``_ensure_index`` helpers swallow errors —
      SQLite hides schema problems that MySQL would surface loudly.
  3.  We want the same test matrix in CI (GitHub Actions) and locally on
      a dev machine with Docker Desktop running.

Design notes:

  * **Session-scoped container** — one MySQL instance boots for the whole
    pytest session; each test function gets a clean slate via ``TRUNCATE``
    (faster than ``DROP`` + ``CREATE``).
  * **Env-first config** — ``backend.services.database`` reads
    ``DB_BACKEND`` and the MySQL connection env vars **at import time**.
    We set them in ``pytest_configure`` (which runs before any collection
    import) so the service modules pick up MySQL without patching.
  * **Minimal bootstrap** — we don't import ``bodybuilding_app`` (it
    registers 300+ Flask routes on import). Instead we hand-roll a small
    ``users`` table with just the columns the services read, and delegate
    the rest to each service's own ``ensure_tables()``.
  * **Docker required** — if the daemon isn't running, tests are
    **skipped**, not failed, so devs without Docker don't see red CI.
"""

from __future__ import annotations

import os
import time
from typing import Iterator, List

import pytest


# ── Phase 0: Env setup (before any project imports) ─────────────────────
#
# ``backend.services.database`` captures ``DB_BACKEND`` at module import
# time, so we must decide *before* any ``backend.services.*`` import
# whether to run against MySQL (the container) or fall back to the
# project's default SQLite mode.
#
# Legacy tests in ``tests/test_networking_retrieval.py`` etc. don't touch
# the DB and should keep passing even when Docker isn't available, so we
# only flip ``DB_BACKEND=mysql`` if we can actually start the container.

os.environ.setdefault("ENTITLEMENTS_ENFORCEMENT_ENABLED", "false")
os.environ.setdefault("CRON_SHARED_SECRET", "test-secret")


# ── Container lifecycle ─────────────────────────────────────────────────


def _start_mysql_container():
    """Start a MySQL 8 container and return (container, dsn_dict).

    Returns ``None`` when Docker isn't available so tests can be skipped
    cleanly.
    """
    try:
        from testcontainers.mysql import MySqlContainer  # type: ignore
    except ImportError:  # pragma: no cover
        return None

    try:
        container = MySqlContainer("mysql:8.0", username="test",
                                   password="test", dbname="cpoint_test")
        container.start()
    except Exception as err:
        # Docker daemon not running, image pull failed, etc.
        print(f"[conftest] MySQL container could not start: {err}")
        return None

    dsn = {
        "host": container.get_container_host_ip(),
        "port": container.get_exposed_port(3306),
        "user": "test",
        "password": "test",
        "database": "cpoint_test",
    }
    # Flip the project's connection layer to MySQL *now* that we have a
    # working container. ``DB_BACKEND`` is captured at import time inside
    # ``backend.services.database``, so this must happen before any
    # ``backend.services.*`` import — which is exactly why we set it
    # here in ``pytest_configure`` rather than at module top-level.
    os.environ["DB_BACKEND"] = "mysql"
    os.environ["MYSQL_HOST"] = str(dsn["host"])
    os.environ["MYSQL_PORT"] = str(dsn["port"])
    os.environ["MYSQL_USER"] = dsn["user"]
    os.environ["MYSQL_PASSWORD"] = dsn["password"]
    os.environ["MYSQL_DB"] = dsn["database"]

    return container, dsn


_CONTAINER = None
_DSN = None


def pytest_configure(config):  # pragma: no cover - lifecycle hook
    """Start the MySQL container once, before any test collection runs."""
    global _CONTAINER, _DSN
    started = _start_mysql_container()
    if started is None:
        # Leave _CONTAINER None; the ``mysql_dsn`` fixture will skip.
        return
    _CONTAINER, _DSN = started

    # Wait for the port to actually accept connections. testcontainers
    # already blocks until the driver can connect, but occasionally the
    # first ``pymysql.connect`` races the healthcheck; a 1s buffer is
    # cheap insurance.
    time.sleep(1.0)

    # Bootstrap schema once per session.
    _bootstrap_schema()


def pytest_unconfigure(config):  # pragma: no cover - lifecycle hook
    global _CONTAINER
    if _CONTAINER is not None:
        try:
            _CONTAINER.stop()
        except Exception:
            pass
        _CONTAINER = None


# ── Schema bootstrap ────────────────────────────────────────────────────


# The service modules under test create most of their own tables via
# idempotent ``ensure_tables()`` calls. We only need to hand-roll the
# handful of tables they *read* but don't own — principally ``users``.
_USERS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(191) UNIQUE NOT NULL,
    email VARCHAR(255),
    canonical_email VARCHAR(255),
    subscription VARCHAR(32) DEFAULT 'free',
    password TEXT,
    first_name TEXT,
    last_name TEXT,
    is_special TINYINT(1) DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    is_admin TINYINT(1) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_users_canonical_email (canonical_email)
)
"""

_COMMUNITIES_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS communities (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(191) UNIQUE NOT NULL,
    tier VARCHAR(32) DEFAULT 'free',
    creator_username VARCHAR(191),
    parent_community_id INT NULL,
    archived_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
"""

# Minimal posts shape — the lifecycle dispatcher only reads MAX(timestamp)
# by community_id, and a handful of existing suites touch posts for smoke
# tests. We deliberately keep this thin so adding a column to the real
# ``posts`` table in the monolith doesn't force a test-schema edit.
_POSTS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS posts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    community_id INT,
    username VARCHAR(191),
    content TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_posts_community_ts (community_id, timestamp)
)
"""

_USER_COMMUNITIES_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS user_communities (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    community_id INT NOT NULL,
    role VARCHAR(32) DEFAULT 'member',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user_community (user_id, community_id)
)
"""

_NOTIFICATIONS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS notifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(191) NOT NULL,
    from_user VARCHAR(191),
    type VARCHAR(64) NOT NULL,
    post_id INT NULL,
    community_id INT NULL,
    message TEXT,
    link VARCHAR(512),
    preview_text VARCHAR(191),
    is_read TINYINT(1) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_notif_user_created (user_id, created_at)
)
"""


def _bootstrap_schema() -> None:
    """Create the tables the services depend on.

    Kept in this file (not imported from the monolith) so the bootstrap
    stays fast and legible. If a new service grows a dependency on
    another ``users`` column, add it here — loudly.
    """
    # Import lazily — env vars must be set first.
    from backend.services.database import get_db_connection
    from backend.services import ai_usage, knowledge_base, special_access
    try:
        from backend.services import enterprise_membership, subscription_audit, \
            enterprise_iap_nag, winback_promo
    except ImportError:
        enterprise_membership = subscription_audit = None
        enterprise_iap_nag = winback_promo = None

    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(_USERS_TABLE_SQL)
        c.execute(_COMMUNITIES_TABLE_SQL)
        c.execute(_USER_COMMUNITIES_TABLE_SQL)
        c.execute(_POSTS_TABLE_SQL)
        c.execute(_NOTIFICATIONS_TABLE_SQL)
        try:
            conn.commit()
        except Exception:
            pass

    # Delegate the rest to each service's own DDL.
    ai_usage.ensure_tables()
    knowledge_base.ensure_tables()
    special_access.ensure_tables()
    if enterprise_membership is not None:
        enterprise_membership.ensure_tables()
    if subscription_audit is not None:
        subscription_audit.ensure_tables()
    if enterprise_iap_nag is not None:
        enterprise_iap_nag.ensure_tables()
    if winback_promo is not None:
        winback_promo.ensure_tables()


# ── Per-test cleanup ────────────────────────────────────────────────────


# Tables we want emptied between tests. Order doesn't matter for TRUNCATE
# in MySQL (no FK cascades in our schema). We skip the KB tables — tests
# that need KB content will seed it explicitly via the ``seed_kb``
# fixture.
_TRUNCATE_TABLES: List[str] = [
    "users",
    "communities",
    "user_communities",
    "posts",
    "notifications",
    "ai_usage_log",
    "special_access_log",
    "kb_pages",
    "kb_changelog",
    "user_enterprise_seats",
    "enterprise_iap_nag",
    "winback_tokens",
    "subscription_audit_log",
    "community_lifecycle_notifications",
]


@pytest.fixture(autouse=True)
def _clean_db():
    """Truncate all test tables after every test.

    We do this *after* the test rather than *before* so a failing test
    leaves the DB in its final state for interactive inspection (just run
    ``docker ps`` while the test is paused in ``pdb`` and connect with
    the credentials printed at start-up).
    """
    yield
    if _CONTAINER is None:
        # Legacy tests run without the container; nothing to truncate.
        return
    from backend.services.database import get_db_connection
    with get_db_connection() as conn:
        c = conn.cursor()
        # SET FOREIGN_KEY_CHECKS=0 — we don't have FKs yet but cheap
        # insurance for when we do.
        try:
            c.execute("SET FOREIGN_KEY_CHECKS = 0")
        except Exception:
            pass
        for table in _TRUNCATE_TABLES:
            try:
                c.execute(f"TRUNCATE TABLE {table}")
            except Exception:
                # Table may not exist on this test run (e.g. winback_tokens
                # if the module failed to import). Ignore.
                pass
        try:
            c.execute("SET FOREIGN_KEY_CHECKS = 1")
        except Exception:
            pass
        try:
            conn.commit()
        except Exception:
            pass

    # Note: we deliberately do *not* reset ``ai_usage._SCHEMA_READY``.
    # ``TRUNCATE`` preserves the schema; re-running ``ensure_tables()``
    # between tests would just pay the ALTER-TABLE roundtrip cost for no
    # benefit. The guard is reset only if a test explicitly needs to
    # simulate a fresh-install schema.


# ── Public fixtures ─────────────────────────────────────────────────────


@pytest.fixture(scope="session")
def mysql_dsn() -> Iterator[dict]:
    """Yield the DSN dict or skip when Docker isn't available."""
    if _CONTAINER is None or _DSN is None:
        pytest.skip("Docker not available — skipping MySQL-backed tests.")
    yield _CONTAINER  # container has .get_connection_url() if needed later
