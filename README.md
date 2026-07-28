# ParaQL

TBD

## Benchmark

```
# single-writer exec
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    # Inserted 2500 rows in ~01s:780ms (±132ms)
ok 1 - single-writer exec # time = 5707ms

# single-writer prepare
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    # Inserted 2500 rows in ~01s:813ms (±189ms)
ok 2 - single-writer prepare # time = 5773ms

# single-writer compact
    ok 1 - should resolve
    # Compacted 2500 rows in 203ms using 2.8 MB (68.0 MB before compaction)
    ok 2 - should resolve
    # Compacted 2500 rows in 192ms using 2.8 MB (69.0 MB before compaction)
    ok 3 - should resolve
    # Compacted 2500 rows in 188ms using 2.8 MB (69.0 MB before compaction)
ok 3 - single-writer compact # time = 6354ms

# multi-writer concurrent
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    # Inserted 2500 rows from 3 writers in ~05s:820ms (±054ms)
ok 4 - multi-writer concurrent # time = 18486ms

# multi-writer sync
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    # Synced 2500 rows between 3 writers in ~04s:730ms (±332ms)
ok 5 - multi-writer sync # time = 20540ms

# multi-writer fast-forward
    ok 1 - should resolve
    ok 2 - should resolve
    ok 3 - should resolve
    # Synced 2500 rows from 3 writers in ~03s:678ms (±588ms)
ok 6 - multi-writer fast-forward # time = 26859ms
```

## License

Apache-2.0
