# ParaQL

TBD

## Benchmark

```
# single-writer
    ok 1 - should resolve
    # Used 69.8 MB of storage space
    ok 2 - should resolve
    # Used 69.8 MB of storage space
    ok 3 - should resolve
    # Used 69.8 MB of storage space
    # Inserted 2500 rows in ~01s:854ms (±297ms)
ok 1 - single-writer # time = 5929ms

# multi-writer concurrent
    ok 1 - should resolve
    # Instance 0 used 69.8 MB of storage space
    # Instance 1 used 49.7 MB of storage space
    # Instance 2 used 50.0 MB of storage space
    ok 2 - should resolve
    # Instance 0 used 69.8 MB of storage space
    # Instance 1 used 49.7 MB of storage space
    # Instance 2 used 50.0 MB of storage space
    ok 3 - should resolve
    # Instance 0 used 69.8 MB of storage space
    # Instance 1 used 49.7 MB of storage space
    # Instance 2 used 50.0 MB of storage space
    # Inserted 2500 rows from 3 writers in ~05s:893ms (±156ms)
ok 2 - multi-writer concurrent # time = 18671ms

# multi-writer sync
    ok 1 - should resolve
    # Instance 0 used 69.8 MB of storage space
    # Instance 1 used 49.8 MB of storage space
    # Instance 2 used 53.9 MB of storage space
    ok 2 - should resolve
    # Instance 0 used 69.8 MB of storage space
    # Instance 1 used 93.2 MB of storage space
    # Instance 2 used 53.9 MB of storage space
    ok 3 - should resolve
    # Instance 0 used 69.8 MB of storage space
    # Instance 1 used 93.2 MB of storage space
    # Instance 2 used 53.9 MB of storage space
    # Synced 2500 rows between 3 writers in ~05s:028ms (±467ms)
ok 3 - multi-writer sync # time = 21126ms

# multi-writer fast-forward
    ok 1 - should resolve
    # Instance 0 used 69.9 MB of storage space
    # Instance 1 used 49.7 MB of storage space
    # Instance 2 used 50.0 MB of storage space
    # Instance 3 (reader) used 49.9 MB of storage space
    ok 2 - should resolve
    # Instance 0 used 69.9 MB of storage space
    # Instance 1 used 49.7 MB of storage space
    # Instance 2 used 50.0 MB of storage space
    # Instance 3 (reader) used 50.0 MB of storage space
    ok 3 - should resolve
    # Instance 0 used 69.9 MB of storage space
    # Instance 1 used 49.7 MB of storage space
    # Instance 2 used 50.0 MB of storage space
    # Instance 3 (reader) used 49.9 MB of storage space
    # Synced 2500 rows from 3 writers in ~03s:196ms (±101ms)
ok 4 - multi-writer fast-forward # time = 25259ms
```

## License

Apache-2.0
