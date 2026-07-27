# ParaQL

TBD

## Benchmark

```
# single-writer exec
    ok 1 - should resolve
    # Used 69.8 MB of storage space
    ok 2 - should resolve
    # Used 69.8 MB of storage space
    ok 3 - should resolve
    # Used 69.8 MB of storage space
    # Inserted 2500 rows in ~01s:839ms (±298ms)
ok 1 - single-writer exec # time = 5874ms

# single-writer prepare
    ok 1 - should resolve
    # Used 68.1 MB of storage space
    ok 2 - should resolve
    # Used 68.1 MB of storage space
    ok 3 - should resolve
    # Used 68.1 MB of storage space
    # Inserted 2500 rows in ~01s:768ms (±104ms)
ok 2 - single-writer prepare # time = 5632ms

# multi-writer concurrent
    ok 1 - should resolve
    # Instance 0 used 68.8 MB of storage space
    # Instance 1 used 48.6 MB of storage space
    # Instance 2 used 48.5 MB of storage space
    ok 2 - should resolve
    # Instance 0 used 68.8 MB of storage space
    # Instance 1 used 48.6 MB of storage space
    # Instance 2 used 48.5 MB of storage space
    ok 3 - should resolve
    # Instance 0 used 68.8 MB of storage space
    # Instance 1 used 48.6 MB of storage space
    # Instance 2 used 48.5 MB of storage space
    # Inserted 2500 rows from 3 writers in ~05s:867ms (±121ms)
ok 3 - multi-writer concurrent # time = 18590ms

# multi-writer sync
    ok 1 - should resolve
    # Instance 0 used 68.7 MB of storage space
    # Instance 1 used 48.6 MB of storage space
    # Instance 2 used 91.6 MB of storage space
    ok 2 - should resolve
    # Instance 0 used 68.7 MB of storage space
    # Instance 1 used 48.6 MB of storage space
    # Instance 2 used 51.5 MB of storage space
    ok 3 - should resolve
    # Instance 0 used 48.5 MB of storage space
    # Instance 1 used 48.6 MB of storage space
    # Instance 2 used 91.6 MB of storage space
    # Synced 2500 rows between 3 writers in ~05s:097ms (±833ms)
ok 4 - multi-writer sync # time = 21700ms

# multi-writer fast-forward
    ok 1 - should resolve
    # Instance 0 used 68.8 MB of storage space
    # Instance 1 used 48.6 MB of storage space
    # Instance 2 used 48.5 MB of storage space
    # Instance 3 (reader) used 48.7 MB of storage space
    ok 2 - should resolve
    # Instance 0 used 68.9 MB of storage space
    # Instance 1 used 48.6 MB of storage space
    # Instance 2 used 48.5 MB of storage space
    # Instance 3 (reader) used 48.8 MB of storage space
    ok 3 - should resolve
    # Instance 0 used 68.7 MB of storage space
    # Instance 1 used 48.5 MB of storage space
    # Instance 2 used 48.5 MB of storage space
    # Instance 3 (reader) used 48.8 MB of storage space
    # Synced 2500 rows from 3 writers in ~03s:325ms (±01s:054ms)
ok 5 - multi-writer fast-forward # time = 27106ms
```

## License

Apache-2.0
