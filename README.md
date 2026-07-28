# ParaQL

TBD

## Benchmark

```
# single-writer exec
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    # Inserted 2500 rows in ~01s:868ms (±289ms)
ok 1 - single-writer exec # time = 5971ms

# single-writer prepare
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    # Inserted 2500 rows in ~01s:792ms (±015ms)
ok 2 - single-writer prepare # time = 5717ms

# single-writer compact
    ok 1 - should resolve
    # Compacted 2500 rows in 208ms using 3.0 MB (68.1 MB before compaction)
    ok 2 - should resolve
    # Compacted 2500 rows in 199ms using 3.0 MB (69.1 MB before compaction)
    ok 3 - should resolve
    # Compacted 2500 rows in 189ms using 3.0 MB (69.1 MB before compaction)
ok 3 - single-writer compact # time = 6275ms

# multi-writer concurrent
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    # Inserted 2500 rows from 3 writers in ~05s:826ms (±431ms)
ok 4 - multi-writer concurrent # time = 18500ms

# multi-writer sync
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    # Synced 2500 rows between 3 writers in ~05s:110ms (±644ms)
ok 5 - multi-writer sync # time = 21665ms

# multi-writer fast-forward
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    # Synced 2500 rows from 3 writers in ~03s:519ms (±058ms)
ok 6 - multi-writer fast-forward # time = 26245ms
```

## License

Apache-2.0
