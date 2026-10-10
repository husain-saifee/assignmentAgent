import asyncio
from typing import Any, TypeVar

from google import genai
from google.genai import types
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class GeminiClientError(RuntimeError):
    """Raised when the Gemini API key is missing or structured generation fails."""


class GeminiStructuredClient:
    def __init__(self, api_key: str, model: str = "gemini-2.5-flash") -> None:
        self.api_key = api_key.strip()
        self.model = model.strip() or "gemini-2.5-flash"

    async def generate_structured(
        self,
        *,
        system_instruction: str,
        prompt: str,
        response_schema: type[T],
        pdf_bytes: bytes | None = None,
        temperature: float = 0.1,
    ) -> T:
        if not self.api_key:
            raise GeminiClientError(
                "GEMINI_API_KEY is missing. Please configure it in .env or enter it in the top navigation bar."
            )

        contents: list[Any] = []
        if pdf_bytes:
            contents.append(types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"))
        contents.append(prompt)

        config = types.GenerateContentConfig(
            system_instruction=system_instruction,
            response_mime_type="application/json",
            response_schema=response_schema,
            temperature=temperature,
        )

        client = genai.Client(api_key=self.api_key)
        last_error: Exception | None = None

        for attempt in range(2):
            try:
                response = await client.aio.models.generate_content(
                    model=self.model,
                    contents=contents,
                    config=config,
                )
                parsed = getattr(response, "parsed", None)
                if isinstance(parsed, response_schema):
                    return parsed

                raw_text = getattr(response, "text", None)
                if not raw_text or not raw_text.strip():
                    raise GeminiClientError("Gemini returned an empty response payload.")

                return response_schema.model_validate_json(raw_text)
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                if attempt == 0:
                    await asyncio.sleep(0.5)

        raise GeminiClientError(f"Gemini structured generation failed after 2 attempts: {last_error}") from last_error
