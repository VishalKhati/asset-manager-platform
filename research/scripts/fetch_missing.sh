#!/usr/bin/env bash
# Patient retry for months that failed with HTTP 429. Day files are cached in .dukascopy-cache,
# so each attempt resumes where the last one stopped. Backs off 10 minutes after a failure.
set -u
cd "$(dirname "$0")/../data/raw/monthly"
CACHE="$(cd ../.. && pwd)/.dukascopy-cache"  # research/data/.dukascopy-cache
deadline=$(( $(date +%s) + 6 * 3600 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  missing=0
  for y in 2022 2023 2024 2025 2026; do for m in 01 02 03 04 05 06 07 08 09 10 11 12; do
    [ "$y$m" -gt 202609 ] && continue
    for side in bid ask; do
      f="xauusd_m1_${side}_$y-$m"
      [ -s "$f.csv" ] && continue
      missing=$((missing+1))
      next=$(date -u -d "$y-$m-01 +1 month" +%Y-%m-%d); [ "$y-$m" = 2026-09 ] && next=2026-09-26
      rm -f "$f.part.csv"
      if npx -y dukascopy-node -i xauusd -from "$y-$m-01" -to "$next" -t m1 -p "$side" -v -f csv -dir . -fn "$f.part" \
           -ch -chpath "$CACHE" -r 4 -rp 30000 -bs 1 -bp 2500 -s >/dev/null 2>&1 && [ -s "$f.part.csv" ]; then
        mv "$f.part.csv" "$f.csv"; echo "$(date -u +%H:%M) ok $f"; sleep 20
      else
        rm -f "$f.part.csv"; echo "$(date -u +%H:%M) fail $f, backing off"; sleep 600
      fi
    done
  done; done
  echo "$(date -u +%H:%M) round done, missing=$missing"
  [ "$missing" = 0 ] && break
done
echo ALL_DONE
