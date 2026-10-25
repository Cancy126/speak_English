import os
import sys
import tempfile
from pathlib import Path

# Tests run from src/backend; make `app` importable regardless of the launch directory.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Redirected before `app.config` is imported anywhere: Settings reads the environment
# once at import time, and the defaults point at the developer's real database and
# recordings directory. A test must never be able to write to either.
_tmp = tempfile.mkdtemp(prefix="speak-test-")
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_tmp}/test.db"
os.environ["UPLOAD_DIR"] = f"{_tmp}/audio"
os.environ["PRONUNCIATION_ENGINE"] = "faster-whisper"
