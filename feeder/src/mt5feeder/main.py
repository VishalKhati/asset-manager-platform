"""Feeder loop.

Every POLL_SECONDS:
  1. read closed M1 bars newer than the cursor from the terminal (first run: BACKFILL_DAYS);
  2. convert broker time to UTC and spread points to price units; queue them in SQLite;
  3. send queued bars to the API in batches, deleting each batch only after the API accepts it.
Every HEARTBEAT_SECONDS it reports terminal status and the detected broker UTC offset.
"""

from __future__ import annotations

import logging
import signal
import time

from . import __version__
from .api import ApiError, IngestClient
from .config import Config
from .outbox import Outbox
from .terminal import Rate, Terminal, server_offset_seconds

log = logging.getLogger("mt5feeder")


def to_service_bar(r: Rate, offset_s: int, point: float) -> dict:
    return {
        "t": r.time - offset_s,
        "o": r.open,
        "h": r.high,
        "l": r.low,
        "c": r.close,
        "spread": round(r.spread * point, 10),
        "volume": r.tick_volume,
    }


class Feeder:
    def __init__(self, cfg: Config, terminal: Terminal, client: IngestClient, outbox: Outbox, clock=time.time):
        self.cfg = cfg
        self.terminal = terminal
        self.client = client
        self.outbox = outbox
        self.clock = clock
        self.offset_s: int | None = None
        self.point: float | None = None
        self.last_heartbeat = 0.0
        self.stopping = False

    def info(self) -> dict:
        return {
            "serverUtcOffsetMin": None if self.offset_s is None else self.offset_s // 60,
            "terminalConnected": bool(self.terminal.connected()),
            "version": f"mt5feeder/{__version__}",
        }

    def detect_offset(self) -> int:
        if self.cfg.utc_offset_override_min is not None:
            return self.cfg.utc_offset_override_min * 60
        tick = self.terminal.last_tick_time(self.cfg.broker_symbol)
        if tick is None:
            raise RuntimeError("no tick yet: cannot detect the broker UTC offset")
        return server_offset_seconds(tick, self.clock())

    def collect(self) -> int:
        """Queue closed bars newer than the cursor. Returns the number queued."""
        if self.point is None:
            self.point = self.terminal.point(self.cfg.broker_symbol)
        offset = self.detect_offset()
        if self.offset_s is not None and offset != self.offset_s:
            log.warning("broker UTC offset changed from %s to %s minutes", self.offset_s // 60, offset // 60)
        self.offset_s = offset
        last = self.outbox.last_queued_t()
        utc_from = (last + 60) if last else int(self.clock()) - self.cfg.backfill_days * 86_400
        rates = self.terminal.closed_rates_since(self.cfg.broker_symbol, utc_from + offset, 100_000)
        bars = [to_service_bar(r, offset, self.point) for r in rates]
        # Never send a bar that has not closed yet (guards against clock skew).
        now = self.clock()
        bars = [b for b in bars if b["t"] + 60 <= now + 2 and b["t"] >= utc_from]
        return self.outbox.enqueue(bars)

    def flush(self) -> int:
        sent = 0
        while not self.stopping:
            batch = self.outbox.peek(self.cfg.batch_size)
            if not batch:
                break
            res = self.client.send_bars(self.cfg.service_symbol, batch, self.info())
            if res.get("rejected"):
                log.warning("API rejected %d bars: %s", len(res["rejected"]), res["rejected"][:5])
            self.outbox.ack(batch)
            sent += len(batch)
        return sent

    def tick(self) -> None:
        if not self.terminal.connected():
            log.warning("terminal disconnected; reconnecting")
            self.terminal.connect()
        queued = self.collect()
        sent = self.flush()
        if queued or sent:
            log.info("queued %d, sent %d, pending %d", queued, sent, self.outbox.pending())
        if self.clock() - self.last_heartbeat >= self.cfg.heartbeat_seconds:
            self.client.heartbeat(self.info())
            self.last_heartbeat = self.clock()

    def run(self) -> None:
        backoff = self.cfg.poll_seconds
        while not self.stopping:
            try:
                self.tick()
                backoff = self.cfg.poll_seconds
            except ApiError as err:
                log.error("API error: %s", err)
                backoff = min(backoff * 2, 60)
            except Exception:  # keep the service alive; the watchdog on the server alerts if data stops
                log.exception("feeder tick failed")
                backoff = min(backoff * 2, 60)
            time.sleep(backoff)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = Config.from_env()
    from .terminal import MT5Terminal

    terminal = MT5Terminal(cfg.mt5_path, cfg.mt5_login, cfg.mt5_password, cfg.mt5_server)
    if not terminal.connect():
        raise SystemExit(f"could not connect to the MT5 terminal: {terminal.last_error()}")
    feeder = Feeder(cfg, terminal, IngestClient(cfg.api_url, cfg.feeder_id, cfg.hmac_secret, cfg.timeout_s),
                    Outbox(cfg.state_path))

    def stop(*_):
        feeder.stopping = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    log.info("feeder %s started for %s -> %s", __version__, cfg.broker_symbol, cfg.api_url)
    try:
        feeder.run()
    finally:
        terminal.shutdown()
        feeder.outbox.close()


if __name__ == "__main__":
    main()
