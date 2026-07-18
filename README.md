# ParaQL

TBD

## Benchmark

```
# single-writer
    ok 1 - should resolve
    # Used 79.4 MB of storage space
    ok 2 - should resolve
    # Used 79.4 MB of storage space
    ok 3 - should resolve
    # Used 79.4 MB of storage space
    # Inserted 2500 rows in ~02s:191ms (±234ms)
ok 1 - single-writer # time = 6788ms

# multi-writer concurrent
    ok 1 - should resolve
    # Instance 0 used 79.5 MB of storage space
    # Instance 1 used 89.7 MB of storage space
    # Instance 2 used 89.6 MB of storage space
    ok 2 - should resolve
    # Instance 0 used 79.5 MB of storage space
    # Instance 1 used 89.7 MB of storage space
    # Instance 2 used 89.6 MB of storage space
    ok 3 - should resolve
    # Instance 0 used 79.5 MB of storage space
    # Instance 1 used 89.7 MB of storage space
    # Instance 2 used 89.6 MB of storage space
    # Inserted 2500 rows from 3 writers in ~06s:998ms (±080ms)
ok 2 - multi-writer concurrent # time = 21613ms

# multi-writer sync
    ok 1 - should resolve
    # Instance 0 used 79.5 MB of storage space
    # Instance 1 used 124.1 MB of storage space
    # Instance 2 used 134.4 MB of storage space
    ok 2 - should resolve
    # Instance 0 used 89.7 MB of storage space
    # Instance 1 used 124.2 MB of storage space
    # Instance 2 used 134.4 MB of storage space
    ok 3 - should resolve
    # Instance 0 used 79.6 MB of storage space
    # Instance 1 used 124.1 MB of storage space
    # Instance 2 used 134.4 MB of storage space
    # Synced 2500 rows between 3 writers in ~06s:423ms (±390ms)
ok 3 - multi-writer sync # time = 25904ms

# multi-writer fast-forward
    ok 1 - should resolve
    # Instance 0 used 79.5 MB of storage space
    # Instance 1 used 89.7 MB of storage space
    # Instance 2 used 89.6 MB of storage space
    # Instance 3 (reader) used 89.7 MB of storage space
    ok 2 - should resolve
    # Instance 0 used 79.5 MB of storage space
    # Instance 1 used 89.7 MB of storage space
    # Instance 2 used 89.6 MB of storage space
    # Instance 3 (reader) used 89.8 MB of storage space
    ok 3 - should resolve
    # Instance 0 used 79.5 MB of storage space
    # Instance 1 used 89.7 MB of storage space
    # Instance 2 used 89.6 MB of storage space
    # Instance 3 (reader) used 89.8 MB of storage space
    # Synced 2500 rows from 3 writers in ~03s:688ms (±095ms)
ok 4 - multi-writer fast-forward # time = 29500ms
```

## License

Apache-2.0
