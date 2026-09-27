"""Thin wrapper over the MetaTrader5 package, plus a fake terminal for tests.

MT5 bar and tick times are *broker server time* written as if it were UTC epoch seconds.
Most brokers run GMT+2 in winter and GMT+3 in summer (following US daylight saving).
``server_offset_seconds`` detects that offset from the last tick so bars can be stored in true UTC.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Protocol

TIMEFRAME_M1 = 1  # MetaTrader5.TIMEFRAME_M1


@dataclass(frozen=True)
class Rate:
    time: int  # broker server time, bar open
    open: float
    high: float
    low: float
    close: float
    tick_volume: int
    spread: int  # points


class Terminal(Protocol):
    def connect(self) -> bool: ...
    def connected(self) -> bool: ...
    def point(self, symbol: str) -> float: ...
    def last_tick_time(self, symbol: str) -> int | None: ...
    def closed_rates_since(self, symbol: str, server_from: int, max_bars: int) -> list[Rate]: ...
    def last_error(self) -> str: ...
    def shutdown(self) -> None: ...


def server_offset_seconds(tick_server_time: int, utc_now: float) -> int:
    """Broker offset rounded to the nearest 30 minutes (ticks can be a few seconds stale)."""
    raw = tick_server_time - utc_now
    return int(round(raw / 1800.0)) * 1800


class MT5Terminal:
    """Real terminal. Import is deferred so the package installs on Linux for tests."""

    def __init__(self, path: str | None = None, login: int | None = None, password: str | None = None,
                 server: str | None = None):
        import MetaTrader5 as mt5  # type: ignore[import-not-found]

        self.mt5: Any = mt5
        self.kw = {k: v for k, v in {"path": path, "login": login, "password": password, "server": server}.items() if v}

    def connect(self) -> bool:
        ok = bool(self.mt5.initialize(**self.kw))
        return ok

    def connected(self) -> bool:
        info = self.mt5.terminal_info()
        return bool(info and info.connected)

    def point(self, symbol: str) -> float:
        self.mt5.symbol_select(symbol, True)
        info = self.mt5.symbol_info(symbol)
        if info is None:
            raise RuntimeError(f"symbol {symbol} not found: {self.last_error()}")
        return float(info.point)

    def last_tick_time(self, symbol: str) -> int | None:
        tick = self.mt5.symbol_info_tick(symbol)
        return int(tick.time) if tick else None

    def closed_rates_since(self, symbol: str, server_from: int, max_bars: int) -> list[Rate]:
        # Position 0 is the bar still forming; start at 1 so only closed bars are returned.
        rates = self.mt5.copy_rates_from_pos(symbol, self.mt5.TIMEFRAME_M1, 1, max_bars)
        if rates is None:
            return []
        out = [
            Rate(int(r["time"]), float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"]),
                 int(r["tick_volume"]), int(r["spread"]))
            for r in rates
            if int(r["time"]) >= server_from
        ]
        return out

    def last_error(self) -> str:
        return str(self.mt5.last_error())

    def shutdown(self) -> None:
        self.mt5.shutdown()


class FakeTerminal:
    """Scriptable terminal for tests: ``rates`` are appended as bars close."""

    def __init__(self, offset_s: int = 7200, point: float = 0.01, clock=time.time):
        self.offset_s = offset_s
        self.clock = clock
        self._point = point
        self.rates: list[Rate] = []  # closed bars, server time
        self.is_connected = True
        self.connect_calls = 0

    def add_utc_bar(self, utc_t: int, o: float, h: float, low: float, c: float, spread_points: int = 30) -> None:
        self.rates.append(Rate(utc_t + self.offset_s, o, h, low, c, 10, spread_points))

    def connect(self) -> bool:
        self.connect_calls += 1
        return self.is_connected

    def connected(self) -> bool:
        return self.is_connected

    def point(self, symbol: str) -> float:
        return self._point

    def last_tick_time(self, symbol: str) -> int | None:
        return int(self.clock()) + self.offset_s + 3

    def closed_rates_since(self, symbol: str, server_from: int, max_bars: int) -> list[Rate]:
        return [r for r in self.rates if r.time >= server_from][-max_bars:]

    def last_error(self) -> str:
        return "(0, 'fake')"

    def shutdown(self) -> None:
        pass
