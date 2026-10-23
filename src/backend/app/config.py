from pydantic_settings import BaseSettings

# Values shipped in .env.example. An unset key still reads as "non-empty", so a
# plain bool(LLM_API_KEY) check reported llm_configured=true while every call 401'd.
LLM_PLACEHOLDER_PREFIXES = ("your-", "sk-your", "changeme", "replace-me", "xxx")


class Settings(BaseSettings):
    # Database — async driver required by SQLAlchemy 2.0 + aiosqlite
    DATABASE_URL: str = "sqlite+aiosqlite:///./speak_english.db"

    # JWT
    JWT_SECRET_KEY: str = "change-this-to-a-random-secret-key"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_DAYS: int = 7
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # LLM API
    LLM_API_KEY: str = ""
    LLM_BASE_URL: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    LLM_MODEL: str = "qwen-turbo"

    # TTS
    TTS_VOICE: str = "en-US-GuyNeural"

    # Pronunciation scoring: none | faster-whisper (word-level)
    PRONUNCIATION_ENGINE: str = "faster-whisper"

    # Weights are vendored by hand into third-party/ (huggingface.co is
    # unreachable here). Relative values resolve against the project root, so the
    # launch directory does not silently change where the model is looked for.
    WHISPER_MODEL_DIR: str = "third-party/faster-whisper"
    WHISPER_DEVICE: str = "cpu"
    # int8 keeps peak RSS ~380MB measured on a 4-core dev box; int8_float16 needs a GPU.
    WHISPER_COMPUTE_TYPE: str = "int8"

    # Upload — relative so local dev works without /app
    UPLOAD_DIR: str = "./uploads/audio"
    MAX_UPLOAD_SIZE_MB: int = 10
    AUDIO_RETENTION_DAYS: int = 30
    # Deleted conversations are restorable for this long before being purged for
    # real (rows + audio files on disk).
    TRASH_RETENTION_DAYS: int = 7

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # Admin default account — change ADMIN_PASSWORD before any real deploy.
    # Must be a globally-valid address: schemas use EmailStr, which rejects
    # reserved domains such as .local / .test (an invalid seed email makes the
    # admin unable to log in, and EmailStr then fails to serialize it back out).
    ADMIN_EMAIL: str = "admin@example.com"
    ADMIN_PASSWORD: str = "Admin@123456"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @property
    def llm_ready(self) -> bool:
        """True only when a real key is present, not a .env.example placeholder."""
        key = self.LLM_API_KEY.strip()
        return bool(key) and not key.lower().startswith(LLM_PLACEHOLDER_PREFIXES)

    @property
    def jwt_secret_is_placeholder(self) -> bool:
        return not self.JWT_SECRET_KEY or self.JWT_SECRET_KEY.startswith("change-this")


settings = Settings()
