"""Signed HTTP client for the signal service ingest API (stdlib only)."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request


def sign(secret: str, timestamp: int, body: str) -> str:
    """HMAC-SHA256 over f"{timestamp}\\n{body}", hex. Mirrors signFeederRequest() in the API."""
    return hmac.new(secret.encode(), f"{timestamp}\n{body}".encode(), hashlib.sha256).hexdigest()


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status


class IngestClient:
    def __init__(self, base_url: str, feeder_id: str, secret: str, timeout_s: float = 15.0, opener=None):
        self.base_url = base_url.rstrip("/")
        self.feeder_id = feeder_id
        self.secret = secret
        self.timeout_s = timeout_s
        self._open = opener or urllib.request.urlopen

    def post(self, path: str, payload: dict) -> dict:
        body = json.dumps(payload, separators=(",", ":"))
        ts = int(time.time())
        req = urllib.request.Request(
            self.base_url + path,
            data=body.encode(),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Feeder-Id": self.feeder_id,
                "X-Timestamp": str(ts),
                "X-Signature": sign(self.secret, ts, body),
                "User-Agent": "mt5feeder/0.1",
            },
        )
        try:
            with self._open(req, timeout=self.timeout_s) as res:
                return json.loads(res.read().decode() or "{}")
        except urllib.error.HTTPError as err:
            detail = err.read().decode(errors="replace")[:300]
            raise ApiError(err.code, detail) from err

    def send_bars(self, symbol: str, bars: list[dict], feeder_info: dict) -> dict:
        return self.post("/api/ingest/bars", {"symbol": symbol, "bars": bars, "feeder": feeder_info})

    def heartbeat(self, feeder_info: dict) -> dict:
        return self.post("/api/ingest/heartbeat", {"feeder": feeder_info})
