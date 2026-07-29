# ParaQL

ParaQL is a mad-science experiment combining [libSQL](https://github.com/tursodatabase/libsql) (an open-contribution [SQLite](https://github.com/sqlite/sqlite) fork with native vector support) with [Autobase](https://github.com/holepunchto/autobase) (or to be more precise, it's next-gen iteration [Autobee](https://github.com/holepunchto/autobee)) for massively-parallel multi-writer access.

It logs every write in a per-instance append-only log (oplog) and applies them in deterministic order to a shared view (the database) ensuring no corruption can occur. This is not very fast, however existing writers typically have limited activity and newcomers can simply fast-forward to the latest view (the database), making overall performance acceptable.

For a better idea of how ParaQL performs and compares to other solutions see [the benchmark](./BENCHMARK.md).

ParaQL is developed on [Bare](https://github.com/holepunchto/bare) but it should also run on Node. Because Bare is multi-platform, ParaQL should run on recent versions of Android, iOS, macOS, Linux, and Windows.

ParaQL supports encrypting the database with a 256-bit key, both on disk and in transport (meaning remote peers need to know the key to read or write into the database). The local-only temporary files are currently encrypted with unique but not random nonces. This is something we're still working on.

ParaQL also supports compression with zlib's deflate algorithm. While this slows down writing considerably, it reduces disk space used by ~3x or more, so depending on your environment it might be worth considering. Do note that compression affects every instance of the same database.

ParaQL has native support for vector data types and vector search functions with optional indexing. This is courtesy of libSQL and one of the primary reasons ParaQL was made: to support vector similarity search in P2P context.

## Install

```shell
npm i paraql
```

## Usage

```javascript
const Corestore = require("corestore")
const ParaQL = require("paraql")

const store = new Corestore("./paraql")
const db = new ParaQL(store)

await db.ready()

await db.exec(`
  CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT);
  INSERT INTO people (name) VALUES ('Alice'), ('Bob');
`)

const select = await db.prepare("SELECT id, name FROM people ORDER BY id")

for await (const row of select.iterate()) {
  console.log(row)
}

await db.close()
```

Prints:

```json
{ id: 1, name: "Alice" }
{ id: 2, name: "Bob" }
```

## API

### `const db = new ParaQL(store[, key][, options])`

Creates a new database or an instance of an existing database if key is provided. `store` is an instance of [Corestore](https://github.com/holepunchto/corestore) used for storage. `key` is either null or 32-byte key of the database.

`options` include:

```javascript
options = {
  cacheSize: 1024,
  name: "paraql.db",
  keyPair: null,
  encrypted: false,
  encryptionKey: null,
  compressed: false,
  compressionLevel: 6,
}
```

`cacheSize` controls how many prepared statements are cached in memory.

The following options should only be used at database creation and set for every instance of the database. Option mismatch will lead to database corruption.

`name` is the name of the database file, also used as a prefix for temporary files.

`keyPair`, if provided, is the signing key pair for the local writer in the form `{ publicKey: <32-byte Buffer>, secretKey: <32-byte Buffer> }` .

If `encrypted` is true and `encryptionKey` is provided as 32-byte buffer, it is used to encrypt the database.

`compressed` enables database compression and `compressionLevel` controls how many resources are used for the compression. It should be between 0 and 9 (inclusive).

### `db.name`

The name of the database file.

### `db.key`

The database key used for replication. `null` before `db.ready()` is called.

### `db.local`

The key of the local writer. Pass this to `db.addWriter()` to grant write access. `null` before `db.ready()` is called.

### `db.discoveryKey`

The discovery key of the database, can be used e.g. as the topic for replicating over [Hyperswarm](https://github.com/holepunchto/hyperswarm). `null` before `db.ready()` is called.

### `encryptionKey`

The key used to encrypt the database or `null`. `null` before `db.ready()` is called.

### `writable`

Whether this instance has write access to the database. `false` if `db.addWriter()` hasn't been called with this instances local key or if `db.ready()` hasn't been called.

### `encrypted`

Whether this database is encrypted.

### `await db.ready()`

Initialized the database. All methods call this implicitly, so unless you need to access some instance property early, there's no need to call this yourself.

### `await db.close()`

Closes the database and cleans up all used resources. Does not close the Corestore instance.

### `await db.addWriter(key)`

Grant another instance of the database write access. `key` should be the local key of the remote instance. `db` needs to be writable.

### `await db.removeWriter(key)`

Revoke write access from another instance of the database. `key` should be the local key of the remote instance. `db` needs to be writable.

### `db.replicate(isInitiatorOrStream)`

Creates a replication stream that can be piped over any streamable transport. `isInitiatorOrStream` can be a boolean indicating whether this instance initiated Noise handshake or another replication stream.

### `await db.compact()`

Compacts database and removes stale data. This operation is local only and can reduce disk space usage by +3x. You should run this periodically when idle.

### `const info = await db.info()`

Get information about disk space usage. Returned object has all properties in bytes and looks like this:

```javascript
{
    database: number,
    temporary: number,
    total: number,
}
```

### `await db.exec(sql)`

Execute given SQL statement(s) without checking return values.

This is a convenience method. Unless you need to load a large SQL dump or similar, this method should be avoided as it bloats the disk space requirements.

### `const stmt = await db.prepare(sql)`

Prepare SQL statement `stmt` from the first statement in `sql`. If `sql` contains more than one statement tailing statements are discarded.

Prepared statements are cached to improve performance, so calling `db.prepare()` twice with the same `sql` will return previously cached `stmt`.

All prepared statements are finalized when calling `db.close()`.

### `stmt.sourceSQL`

The SQL string used to initialize this prepared statement.

### `stmt.batching`

Whether this statement is in batching mode.

### `stmt.batch(on)`

Toggle batching mode, `on` is a boolean.

When in batching mode `stmt.run()` queries are queued up in memory and only executed when calling `stmt.flush()`. This can greatly speed up both write and sync performance. However since they aren't executed immediately, you can't query the data until you flush it.

### `const result = await stmt.flush()`

Flush queued up queries writing them to disk.

Returns an object in the form `{ changes: number, lastInsertRowid: number, errors: number }`.

### `await stmt.finalize()`

Finalize a statement freeing up resources used and clearing batching queue without flushing it.

You should generally not need to call this method in normal usage.

### `const rows = await stmt.all(...params)`

Execute a statement with given positional params. First param may optionally be an object containing named params.

Returns an array of row objects keyed by column name.

### `const row = await stmt.get(...params)`

Same as `stmt.all()` except it only returns the first row.

### `const result = stmt.run(...params)`

Execute a statement with given params and return an object in the form `{ changes: number, lastInsertRowid: number }`.

In batching mode returns `null`.

### `for await (const row of stmt.iterate(...params))`

Execute a statement with given params and return rows one by one.

## License

Apache-2.0
