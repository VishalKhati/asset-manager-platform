#!/usr/bin/env bash
# Free gold order-flow history: Binance XAUUSDT perp trades/depth/metrics and Bybit XAUTUSDT perp trades.
set -u
cd "$(dirname "$0")/../data/orderflow"
get() { # url dest
  [ -s "$2" ] && return 0
  for i in 1 2 3 4; do curl -sSf --max-time 600 -o "$2.part" "$1" && mv "$2.part" "$2" && return 0; rm -f "$2.part"; sleep 15; done
  echo "FAIL $1"
}
B=https://data.binance.vision/data/futures/um
for m in 2025-12 2026-01 2026-02 2026-03 2026-04 2026-05 2026-06 2026-07 2026-08 2026-09; do
  get "$B/monthly/aggTrades/XAUUSDT/XAUUSDT-aggTrades-$m.zip" "binance/XAUUSDT-aggTrades-$m.zip"
done
d=2026-10-01
while [ "$d" != 2026-10-16 ]; do
  get "$B/daily/aggTrades/XAUUSDT/XAUUSDT-aggTrades-$d.zip" "binance/XAUUSDT-aggTrades-$d.zip"
  d=$(date -u -d "$d +1 day" +%F)
done
d=2026-01-15
while [ "$d" != 2026-10-16 ]; do
  get "$B/daily/bookDepth/XAUUSDT/XAUUSDT-bookDepth-$d.zip" "binance/XAUUSDT-bookDepth-$d.zip"
  get "$B/daily/metrics/XAUUSDT/XAUUSDT-metrics-$d.zip" "binance/XAUUSDT-metrics-$d.zip"
  d=$(date -u -d "$d +1 day" +%F)
done
d=2025-04-03
while [ "$d" != 2025-12-01 ]; do
  get "https://public.bybit.com/trading/XAUTUSDT/XAUTUSDT$d.csv.gz" "bybit/XAUTUSDT$d.csv.gz"
  d=$(date -u -d "$d +1 day" +%F)
done
echo ALL_DONE
