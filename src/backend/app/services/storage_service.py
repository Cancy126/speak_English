import json
from pathlib import Path

from app.config import settings


class StorageService:
    """Audio files live on disk; only the relative path goes into the DB."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = root or Path(settings.UPLOAD_DIR)
        self.root.mkdir(parents=True, exist_ok=True)

    def relative_path(self, filename: str) -> str:
        return str(Path("audio") / filename)

    def absolute_path(self, relative: str) -> Path:
        return self.root.parent / relative

    def save_bytes(self, filename: str, payload: bytes) -> str:
        target = self.root / filename
        target.write_bytes(payload)
        return self.relative_path(filename)

    def purge_older_than(self, days: int) -> int:
        """Delete recordings older than N days. Returns count removed."""
        import time

        cutoff = time.time() - days * 86400
        removed = 0
        for f in self.root.glob("*"):
            if f.is_file() and f.stat().st_mtime < cutoff:
                f.unlink(missing_ok=True)
                removed += 1
        return removed

    @staticmethod
    def parse_json_field(raw: str | None) -> dict | list | None:
        if not raw:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None
