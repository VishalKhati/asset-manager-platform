#!/usr/bin/env bash
# Monthly XAUUSD M1 bid+ask downloads with slow pacing (Dukascopy rate-limits with HTTP 429).
# Each file is written under a temporary name and renamed only when the download succeeds.
set -u
cd "$(dirname "$0")/../data/raw/monthly"
months() { local y m; for y in $(seq 2022 2026); do for m in $(seq -w 1 12); do
  [ "$y$m" -gt 202609 ] && return; echo "$y-$m"; done; done; }
for pass in 1 2 3; do
  missing=0
  for ym in $(months); do
    y=${ym%-*}; m=${ym#*-}
    next=$(date -u -d "$ym-01 +1 month" +%Y-%m-%d); [ "$ym" = 2026-09 ] && next=2026-09-26
    for side in bid ask; do
      f="xauusd_m1_${side}_${ym}"
      [ -s "$f.csv" ] && continue
      rm -f "$f.part.csv"
      if npx -y dukascopy-node -i xauusd -from "$ym-01" -to "$next" -t m1 -p "$side" -v -f csv -dir . -fn "$f.part" -r 6 -rp 20000 -bs 4 -bp 1500 -s >/dev/null 2>&1 && [ -s "$f.part.csv" ]; then
        mv "$f.part.csv" "$f.csv"; echo "ok $f"
      else
        rm -f "$f.part.csv"; echo "fail $f (pass $pass)"; missing=$((missing+1)); sleep 60
      fi
      sleep 4
    done
  done
  echo "pass $pass missing=$missing"
  [ "$missing" = 0 ] && break
  sleep 300
done
echo ALL_DONE
