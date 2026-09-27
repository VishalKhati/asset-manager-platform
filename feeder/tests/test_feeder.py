import json
from pathlib import Path

import pytest

from mt5feeder.api import ApiError, IngestClient, sign
from mt5feeder.config import Config
from mt5feeder.main import Feeder, to_service_bar
from mt5feeder.outbox import Outbox
from mt5feeder.terminal import FakeTerminal, Rate, server_offset_seconds

NOW = 1_700_000_000 - 1_700_000_000 % 60 + 30  # 30 s into a minute


def cfg(tmp_path: Path, **kw) -> Config:
    base = dict(
        api_url="http://api", feeder_id="t", hmac_secret="s", broker_symbol="XAUUSD.r", service_symbol="XAUUSD",
        poll_seconds=1, heartbeat_seconds=30, backfill_days=1, batch_size=2, state_path=tmp_path / "s.db",
        utc_offset_override_min=None, mt5_path=None, mt5_login=None, mt5_password=None, mt5_server=None,
        timeout_s=5,
    )
    base.update(kw)
    return Config(**base)


class FakeClient:
    def __init__(self, fail_times: int = 0):
        self.batches: list[list[dict]] = []
        self.heartbeats = 0
        self.fail_times = fail_times

    def send_bars(self, symbol, bars, info):
        if self.fail_times:
            self.fail_times -= 1
            raise ApiError(503, "down")
        assert symbol == "XAUUSD"
        self.batches.append(bars)
        return {"ok": True, "inserted": len(bars)}

    def heartbeat(self, info):
        self.heartbeats += 1
        return {"ok": True}


def test_signature_matches_the_api_scheme():
    # Same vector is asserted in the API's TypeScript tests (signFeederRequest).
    body = '{"symbol":"XAUUSD","bars":[]}'
    assert sign("feeder-test-secret", 1_700_000_000, body) == (
        "b1e516448aa5aa01cc145f928d99b71c127b3c024e5fb424a7126853d9d5a954"
    )


@pytest.mark.parametrize("raw,expected", [(7200 + 4, 7200), (10800 - 20, 10800), (-5, 0), (19800 + 11, 19800)])
def test_offset_detection_rounds_to_half_hours(raw, expected):
    assert server_offset_seconds(1_000_000 + raw, 1_000_000) == expected


def test_bar_conversion_to_utc_and_price_spread():
    bar = to_service_bar(Rate(1_000_000 + 7200, 1, 2, 0.5, 1.5, 12, 35), 7200, 0.01)
    assert bar == {"t": 1_000_000, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "spread": 0.35, "volume": 12}


def test_backfills_then_sends_only_new_closed_bars(tmp_path):
    term = FakeTerminal(offset_s=7200, clock=lambda: NOW)
    first = NOW - NOW % 60 - 5 * 60
    for i in range(5):
        term.add_utc_bar(first + 60 * i, 2000, 2001, 1999, 2000.5)
    client = FakeClient()
    f = Feeder(cfg(tmp_path), term, client, Outbox(tmp_path / "s.db"), clock=lambda: NOW)
    f.tick()
    sent = [b for batch in client.batches for b in batch]
    assert [b["t"] for b in sent] == [first + 60 * i for i in range(5)]
    assert sent[0]["spread"] == pytest.approx(0.30)
    assert f.info()["serverUtcOffsetMin"] == 120
    assert client.heartbeats == 1

    # A new bar closes; only it is sent.
    term.add_utc_bar(first + 300, 2000, 2002, 1999, 2001)
    f.clock = lambda: NOW + 60
    f.tick()
    assert [b["t"] for b in client.batches[-1]] == [first + 300]


def test_queue_survives_api_outage_and_restart(tmp_path):
    term = FakeTerminal(offset_s=10800, clock=lambda: NOW)
    first = NOW - NOW % 60 - 3 * 60
    for i in range(3):
        term.add_utc_bar(first + 60 * i, 2000, 2001, 1999, 2000.5)
    down = FakeClient(fail_times=10)
    f = Feeder(cfg(tmp_path), term, down, Outbox(tmp_path / "s.db"), clock=lambda: NOW)
    with pytest.raises(ApiError):
        f.tick()
    assert f.outbox.pending() == 3
    f.outbox.close()

    # Restarted process with the API back: queued bars go out, nothing is re-read twice.
    up = FakeClient()
    g = Feeder(cfg(tmp_path), term, up, Outbox(tmp_path / "s.db"), clock=lambda: NOW)
    g.tick()
    assert sorted(b["t"] for batch in up.batches for b in batch) == [first, first + 60, first + 120]
    assert g.outbox.pending() == 0


def test_never_sends_a_bar_that_has_not_closed(tmp_path):
    term = FakeTerminal(offset_s=0, clock=lambda: NOW)
    minute = NOW - NOW % 60
    term.add_utc_bar(minute, 2000, 2001, 1999, 2000.5)  # still forming at NOW
    client = FakeClient()
    Feeder(cfg(tmp_path), term, client, Outbox(tmp_path / "s.db"), clock=lambda: NOW).tick()
    assert client.batches == []


def test_http_client_signs_requests():
    captured = {}

    class Res:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b'{"ok": true}'

    def opener(req, timeout):
        captured["headers"] = dict(req.header_items())
        captured["body"] = req.data.decode()
        return Res()

    client = IngestClient("http://x", "vps-1", "secret", opener=opener)
    assert client.heartbeat({"terminalConnected": True}) == {"ok": True}
    h = {k.lower(): v for k, v in captured["headers"].items()}
    assert h["x-feeder-id"] == "vps-1"
    assert h["x-signature"] == sign("secret", int(h["x-timestamp"]), captured["body"])
    assert json.loads(captured["body"]) == {"feeder": {"terminalConnected": True}}
