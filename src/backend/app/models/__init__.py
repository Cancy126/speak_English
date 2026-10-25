from app.models.user import User
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.audio_asset import AudioAsset
from app.models.pronunciation_score import PronunciationScore
from app.models.curriculum import Textbook, Unit, UnitProgress, UnitWord

# Every model must be imported here: `Base.metadata` only knows about classes that
# have been loaded, so a missing entry means `create_all` skips the table and
# `alembic --autogenerate` proposes dropping it out of nowhere.
__all__ = [
    "User",
    "Conversation",
    "Message",
    "AudioAsset",
    "PronunciationScore",
    "Textbook",
    "Unit",
    "UnitWord",
    "UnitProgress",
]
