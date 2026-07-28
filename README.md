# ParaQL

TBD

## Benchmark

```
# single-writer exec
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    ok 4 - should resolve
    ok 5 - should resolve
    ok 6 - should resolve
    # Inserted 2500 rows in ~02s:012ms (±185ms)
    # Compacted in ~295ms (±036ms) using ~4.6 MB (~70.2 MB before compaction)
ok 1 - single-writer exec # time = 7289ms

# single-writer prepare
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    ok 4 - should resolve
    ok 5 - should resolve
    ok 6 - should resolve
    # Inserted 2500 rows in ~01s:864ms (±015ms)
    # Compacted in ~184ms (±012ms) using ~2.8 MB (~68.5 MB before compaction)
ok 2 - single-writer prepare # time = 6472ms

# single-writer encryption
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    ok 4 - should resolve
    ok 5 - should resolve
    ok 6 - should resolve
    # Inserted 2500 rows in ~02s:368ms (±047ms)
    # Compacted in ~192ms (±005ms) using ~2.8 MB (~68.6 MB before compaction)
ok 3 - single-writer encryption # time = 8021ms

# single-writer compression
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    ok 4 - should resolve
    ok 5 - should resolve
    ok 6 - should resolve
    # Inserted 2500 rows in ~02s:604ms (±075ms)
    # Compacted in ~115ms (±008ms) using ~2.8 MB (~17.3 MB before compaction)
ok 4 - single-writer compression # time = 8495ms

# single-writer max compression
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    ok 4 - should resolve
    ok 5 - should resolve
    ok 6 - should resolve
    # Inserted 2500 rows in ~02s:635ms (±104ms)
    # Compacted in ~112ms (±004ms) using ~2.8 MB (~17.3 MB before compaction)
ok 5 - single-writer max compression # time = 8567ms

# single-writer compression + encryption
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    ok 4 - should resolve
    ok 5 - should resolve
    ok 6 - should resolve
    # Inserted 2500 rows in ~02s:691ms (±056ms)
    # Compacted in ~119ms (±010ms) using ~2.8 MB (~17.3 MB before compaction)
ok 6 - single-writer compression + encryption # time = 8771ms

# multi-writer concurrent
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    # Inserted 2500 rows from 3 writers in ~06s:041ms (±475ms)
ok 7 - multi-writer concurrent # time = 19130ms

# multi-writer sync
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    # Synced 2500 rows between 3 writers in ~05s:288ms (±01s:067ms)
ok 8 - multi-writer sync # time = 22426ms

# multi-writer fast-forward
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    # Synced 2500 rows from 3 writers in ~03s:373ms (±879ms)
ok 9 - multi-writer fast-forward # time = 26997ms
```

## License

Apache-2.0
