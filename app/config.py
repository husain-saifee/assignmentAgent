import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass
class Settings:
    gemini_api_key: str
    gemini_model: str
    database_path: str


def get_settings() -> Settings:
    return Settings(
        gemini_api_key=os.getenv("GEMINI_API_KEY", "").strip(),
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip(),
        database_path=os.getenv("DATABASE_PATH", "data/evaluations.db").strip(),
    )
