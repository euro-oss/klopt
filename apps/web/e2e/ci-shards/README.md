# CI Playwright shard lists

GitHub Actions runs the main e2e suite in four parallel jobs using explicit spec
lists here instead of Playwright's default `--shard=i/n` split. Default sharding
balances by test count, which left shard 3 dominated by fast `pr-screenshots-*`
files while heavy wizard specs piled onto shards 2 and 4 (~2.5× imbalance).

Lists were built from merged main CI run
[45434868771](https://github.com/euro-oss/klopt/actions/runs/45434868771)
(2026-11-24): per-spec durations from shard job logs, plus 8 s per-file overhead
and `scripts/prod-pdf-check.ts` on shard 1 only. Regenerate with a bin-packing
script when the suite grows materially; every main-suite spec must appear in
exactly one `shard-*.txt`.