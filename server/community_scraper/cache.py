"""In-memory cache with 1-hour TTL for community hot posts."""

import time
import threading
from typing import Any


class CommunityCache:
    def __init__(self, ttl: int = 3600):
        self._data: dict[str, Any] | None = None
        self._updated_at: float = 0
        self._ttl = ttl
        self._lock = threading.Lock()

    def get(self) -> dict[str, Any] | None:
        with self._lock:
            if self._data is None:
                return None
            if time.time() - self._updated_at > self._ttl:
                return None
            return self._data

    def set(self, data: dict[str, Any]) -> None:
        with self._lock:
            self._data = data
            self._updated_at = time.time()

    @property
    def updated_at(self) -> float:
        return self._updated_at


# Global singleton
cache = CommunityCache()
