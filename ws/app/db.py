import asyncpg

from . import config

_pool: asyncpg.Pool | None = None


async def connect() -> None:
    global _pool
    _pool = await asyncpg.create_pool(
        host=config.DB_HOST,
        port=config.DB_PORT,
        database=config.DB_NAME,
        user=config.DB_USER,
        password=config.DB_PASSWORD,
        min_size=config.DB_POOL_MIN,
        max_size=config.DB_POOL_MAX,
        command_timeout=10,
    )


async def disconnect() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    """Shared connection pool to the same Postgres database the Django server uses.

    Always use parameterised queries ($1, $2, ...), never string formatting.
    """
    if _pool is None:
        raise RuntimeError("Database pool is not initialised")
    return _pool
