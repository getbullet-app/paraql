# ParaQL

TBD

## Benchmark

```
# single-writer exec
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    # Inserted 2500 rows in ~01s:914ms (±164ms)
ok 1 - single-writer exec # time = 6088ms

# single-writer prepare
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    # Inserted 2500 rows in ~01s:851ms (±011ms)
ok 2 - single-writer prepare # time = 5880ms

# single-writer encryption
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    # Inserted 2500 rows in ~02s:399ms (±085ms)
ok 3 - single-writer encryption # time = 7528ms

# single-writer compact
    ok 1 - should resolve
    # Compacted 2500 rows in 203ms using 2.8 MB (68.0 MB before compaction)
    ok 2 - should resolve
    # Compacted 2500 rows in 189ms using 2.8 MB (68.5 MB before compaction)
    ok 3 - should resolve
    # Compacted 2500 rows in 195ms using 2.8 MB (68.5 MB before compaction)
ok 4 - single-writer compact # time = 6592ms

# multi-writer concurrent
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    # Inserted 2500 rows from 3 writers in ~06s:170ms (±300ms)
ok 5 - multi-writer concurrent # time = 19490ms

# multi-writer sync
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    # Synced 2500 rows between 3 writers in ~05s:517ms (±01s:283ms)
ok 6 - multi-writer sync # time = 23157ms

# multi-writer fast-forward
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    # Synced 2500 rows from 3 writers in ~03s:693ms (±154ms)
ok 7 - multi-writer fast-forward # time = 27168ms
```

## License

Apache-2.0
