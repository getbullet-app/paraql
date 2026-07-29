# Benchmark

The single-writer benchmarks show performance comparable or better to [vanilla SQLite](https://openbenchmarking.org/test/pts/sqlite).
However this most likely due to the fact that our custom VFS performs more operations in memory and flushes to disk less often.

The disk space requirements are also much larger, because deleted or overwritten data is actually kept on disk due to nature of append-only logs.
The `paraql.compact()` method helps reclaim most of this space since most of the time it can be safely removed.

The multi-writer benchmarks are a bit misleading since all instances are running on the same thread sequentially. The actual time taken can be derived by dividing times shown by number of instances (currently 3).

```
# single-writer exec
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    ok 4 - should resolve
    ok 5 - should resolve
    ok 6 - should resolve
    # Inserted 2500 rows in ~01s:892ms (±095ms)
    # Compacted in ~289ms (±030ms) using ~4.6 MB (~70.2 MB before compaction)
ok 1 - single-writer exec # time = 6899ms

# single-writer prepare
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    ok 4 - should resolve
    ok 5 - should resolve
    ok 6 - should resolve
    # Inserted 2500 rows in ~01s:987ms (±224ms)
    # Compacted in ~181ms (±012ms) using ~2.8 MB (~68.7 MB before compaction)
ok 2 - single-writer prepare # time = 6835ms

# single-writer encryption
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    ok 4 - should resolve
    ok 5 - should resolve
    ok 6 - should resolve
    # Inserted 2500 rows in ~02s:386ms (±031ms)
    # Compacted in ~183ms (±004ms) using ~2.8 MB (~68.7 MB before compaction)
ok 3 - single-writer encryption # time = 8039ms

# single-writer compression
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    ok 4 - should resolve
    ok 5 - should resolve
    ok 6 - should resolve
    # Inserted 2500 rows in ~03s:262ms (±098ms)
    # Compacted in ~114ms (±007ms) using ~2.8 MB (~23.6 MB before compaction)
ok 4 - single-writer compression # time = 10477ms

# single-writer max compression
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    ok 4 - should resolve
    ok 5 - should resolve
    ok 6 - should resolve
    # Inserted 2500 rows in ~03s:427ms (±112ms)
    # Compacted in ~113ms (±003ms) using ~2.8 MB (~23.6 MB before compaction)
ok 5 - single-writer max compression # time = 10944ms

# single-writer compression + encryption
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    ok 4 - should resolve
    ok 5 - should resolve
    ok 6 - should resolve
    # Inserted 2500 rows in ~03s:338ms (±028ms)
    # Compacted in ~121ms (±004ms) using ~2.8 MB (~23.7 MB before compaction)
ok 6 - single-writer compression + encryption # time = 10713ms

# multi-writer concurrent
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    # Inserted 2500 rows from 3 writers in ~06s:056ms (±330ms)
ok 7 - multi-writer concurrent # time = 19198ms

# multi-writer sync
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    # Synced 2500 rows between 3 writers in ~05s:236ms (±889ms)
ok 8 - multi-writer sync # time = 22349ms

# multi-writer fast-forward
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    # Synced 2500 rows from 3 writers in ~02s:748ms (±157ms)
ok 9 - multi-writer fast-forward # time = 27830ms
```
