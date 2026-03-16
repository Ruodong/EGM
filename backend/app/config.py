"""Application settings."""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5433/egm_local"
    DB_SCHEMA: str = "egm"
    PORT: int = 4001
    HOST: str = "0.0.0.0"

    # EAM integration
    EAM_BASE_URL: str = "http://localhost:4000/api"
    EAM_API_KEY: str = ""

    # Auth configuration
    AUTH_DISABLED: bool = False
    AUTH_DEV_USER: str = "dev_admin"
    AUTH_DEV_ROLE: str = "admin"

    # Keycloak configuration (used when AUTH_DISABLED=False)
    KEYCLOAK_SERVER_URL: str = ""
    KEYCLOAK_REALM: str = "myapp"
    KEYCLOAK_CLIENT_ID: str = ""
    KEYCLOAK_CLIENT_SECRET: str = ""
    KEYCLOAK_ALGORITHMS: str = "RS256"

    # LLM (OpenAI-compatible endpoint)
    LLM_BASE_URL: str = ""
    LLM_API_KEY: str = ""
    LLM_MODEL: str = "gpt-4.1-dev"
    LLM_TEMPERATURE: float = 0.7
    LLM_TOP_P: float = 0.8

    # Embedding (for Ask EGM RAG — similar case retrieval)
    EMBEDDING_BASE_URL: str = ""
    EMBEDDING_API_KEY: str = ""
    EMBEDDING_MODEL: str = "text-embedding-3-small"
    EMBEDDING_DIMENSIONS: int = 256

    class Config:
        env_file = ".env"


settings = Settings()
