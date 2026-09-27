"""Feeder settings from environment variables (or a .env file next to the working directory)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass(frozen=True)
class Config:
    api_url: str
    feeder_id: str
    hmac_secret: str
    broker_symbol: str  # symbol name in the terminal, e.g. "XAUUSD" or "XAUUSD.r"
    service_symbol: str  # symbol name the API expects, e.g. "XAUUSD"
    poll_seconds: float
    heartbeat_seconds: float
    backfill_days: int
    batch_size: int
    state_path: Path
    utc_offset_override_min: int | None
    mt5_path: str | None
    mt5_login: int | None
    mt5_password: str | None
    mt5_server: str | None
    timeout_s: float

    @classmethod
    def from_env(cls, env_file: Path | None = Path(".env")) -> Config:
        if env_file is not None:
            _load_dotenv(env_file)
        e = os.environ

        def req(name: str) -> str:
            value = e.get(name, "").strip()
            if not value:
                raise SystemExit(f"missing required setting {name}")
            return value

        override = e.get("MT5_UTC_OFFSET_MIN", "").strip()
        login = e.get("MT5_LOGIN", "").strip()
        return cls(
            api_url=req("API_URL").rstrip("/"),
            feeder_id=e.get("FEEDER_ID", "mt5-vps-1"),
            hmac_secret=req("FEEDER_HMAC_SECRET"),
            broker_symbol=e.get("BROKER_SYMBOL", "XAUUSD"),
            service_symbol=e.get("SERVICE_SYMBOL", "XAUUSD"),
            poll_seconds=float(e.get("POLL_SECONDS", "1")),
            heartbeat_seconds=float(e.get("HEARTBEAT_SECONDS", "30")),
            backfill_days=int(e.get("BACKFILL_DAYS", "20")),
            batch_size=int(e.get("BATCH_SIZE", "2000")),
            state_path=Path(e.get("STATE_PATH", "feeder_state.sqlite3")),
            utc_offset_override_min=int(override) if override else None,
            mt5_path=e.get("MT5_PATH") or None,
            mt5_login=int(login) if login else None,
            mt5_password=e.get("MT5_PASSWORD") or None,
            mt5_server=e.get("MT5_SERVER") or None,
            timeout_s=float(e.get("HTTP_TIMEOUT_S", "15")),
        )
