import json
from collections.abc import AsyncGenerator

import httpx

from app.config import settings

# Interest bubbles shown on the landing page (产品规划 3.1.2)
TOPICS: list[dict] = [
    {"key": "travel", "label": "Travel", "emoji": "✈️",
     "opener": "You just landed in a new city. Ask me about what to do there."},
    {"key": "food", "label": "Ordering food", "emoji": "🍜",
     "opener": "I am a waiter at a busy restaurant. Take your order."},
    {"key": "interview", "label": "Job interview", "emoji": "💼",
     "opener": "I am interviewing you for a developer role. Start with the first question."},
    {"key": "movies", "label": "Movies", "emoji": "🎬",
     "opener": "Let's talk about films we watched recently."},
    {"key": "sports", "label": "Sports", "emoji": "⚽",
     "opener": "Ask me about my weekend football match."},
    {"key": "shopping", "label": "Shopping", "emoji": "🛍️",
     "opener": "I am helping you find a gift in a shop."},
    {"key": "weather", "label": "Small talk", "emoji": "🌤️",
     "opener": "Make small talk with me about the weather and your week."},
    {"key": "tech", "label": "Tech", "emoji": "🤖",
     "opener": "Let's chat about AI tools you have tried lately."},
]

SYSTEM_PROMPT = (
    "You are a friendly native English speaker practicing conversation with a learner.\n"
    "Rules:\n"
    "1. Always reply in English only, and keep replies under 60 words so the learner can speak more.\n"
    "2. Sound like a real person: contractions, natural rhythm, no bullet points, no teacher tone.\n"
    "3. End most turns with a short follow-up question to keep the conversation going.\n"
    "4. Never lecture. If the learner makes a mistake, do not correct it inside this reply.\n"
)

FEEDBACK_PROMPT = (
    "You are an English tutor. Analyse ONLY the learner's message between the <<< markers.\n"
    "Return strict JSON with these keys:\n"
    '  "corrections": [{"original": str, "fixed": str, "reason": str}]  (grammar/word choice; empty if none)\n'
    '  "natural": {"original": str, "better": str} | null  (a more native phrasing, only if clearly better)\n'
    '  "vocab": {"from": str, "to": str, "why": str} | null  (one upgrade to a more precise word)\n'
    "No markdown, no commentary, JSON only.\n"
    # Concatenated, never .format(): the JSON examples above contain braces that
    # str.format would try to interpret as replacement fields.
    "Learner message: <<<"
)

# keep only the last N turns to bound token spend
HISTORY_WINDOW = 12


class AIServiceError(RuntimeError):
    pass


class AIService:
    def __init__(self) -> None:
        self.api_key = settings.LLM_API_KEY
        self.base_url = settings.LLM_BASE_URL.rstrip("/")
        self.model = settings.LLM_MODEL

    @property
    def configured(self) -> bool:
        # Placeholder keys are non-empty, so bool(api_key) alone let /health claim
        # llm_configured=true while every upstream call came back 401.
        return settings.llm_ready

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    def build_messages(
        self, history: list[dict], user_content: str, topic: str | None, scene: str | None
    ) -> list[dict]:
        system = SYSTEM_PROMPT
        role_hint = topic or scene
        if role_hint:
            system += f"\nScenario: you are role-playing around '{role_hint}'. Stay in character.\n"
        recent = history[-HISTORY_WINDOW:]
        return [{"role": "system", "content": system}, *recent,
                {"role": "user", "content": user_content}]

    async def stream_chat(
        self, history: list[dict], user_content: str,
        topic: str | None = None, scene: str | None = None,
    ) -> AsyncGenerator[str, None]:
        """Yield assistant text deltas (SSE-friendly)."""
        if not self.configured:
            raise AIServiceError("LLM_API_KEY is not configured")

        payload = {
            "model": self.model,
            "messages": self.build_messages(history, user_content, topic, scene),
            "stream": True,
            "temperature": 0.9,
            "max_tokens": 200,
        }
        # httpx raises ConnectError/TimeoutError (httpx.HTTPError), which callers
        # do not expect; normalise so the SSE route can fail soft on one event.
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                async with client.stream(
                    "POST", f"{self.base_url}/chat/completions", json=payload, headers=self._headers()
                ) as resp:
                    if resp.status_code != 200:
                        body = (await resp.aread()).decode(errors="replace")
                        raise AIServiceError(f"LLM upstream {resp.status_code}: {body[:300]}")
                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        chunk = line[5:].strip()
                        if chunk == "[DONE]":
                            break
                        try:
                            delta = json.loads(chunk)["choices"][0]["delta"].get("content")
                        except (json.JSONDecodeError, KeyError, IndexError):
                            continue
                        if delta:
                            yield delta
        except httpx.HTTPError as exc:
            raise AIServiceError(f"LLM transport error: {exc}") from exc

    async def complete(self, messages: list[dict], max_tokens: int = 300) -> str:
        payload = {
            "model": self.model, "messages": messages, "stream": False,
            "temperature": 0.2, "max_tokens": max_tokens,
        }
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"{self.base_url}/chat/completions", json=payload, headers=self._headers()
                )
        except httpx.HTTPError as exc:
            raise AIServiceError(f"LLM transport error: {exc}") from exc
        if resp.status_code != 200:
            raise AIServiceError(f"LLM upstream {resp.status_code}: {resp.text[:300]}")
        return resp.json()["choices"][0]["message"]["content"]

    async def feedback(self, learner_message: str) -> dict:
        """Grammar / expression feedback for one learner turn. Fails soft to {}."""
        if not self.configured:
            return {}
        try:
            raw = await self.complete(
                [{"role": "user", "content": f"{FEEDBACK_PROMPT}{learner_message}>>>"}],
                max_tokens=300,
            )
        except AIServiceError:
            return {}
        start, end = raw.find("{"), raw.rfind("}")
        if start == -1 or end == -1:
            return {}
        try:
            return json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            return {}


ai_service = AIService()
