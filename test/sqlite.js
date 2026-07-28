const test = require("brittle")
const Buffer = require("bare-buffer")

const { create } = require("./helpers")

test("run DDL statement", async (t) => {
  t.plan(2)

  const [paraql] = await create(1, t)
  const stmt = await paraql.prepare("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)")
  const result = await stmt.run()

  t.is(result.changes, 0)
  t.is(result.lastInsertRowid, 0)
})

test("insert and read back rows", async (t) => {
  t.plan(6)

  const [paraql] = await create(1, t)

  await (await paraql.prepare("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)")).run()

  const insert = await paraql.prepare("INSERT INTO t (name) VALUES (?)")
  const r1 = await insert.run("alice")
  const r2 = await insert.run("bob")

  t.is(r1.changes, 1)
  t.is(r1.lastInsertRowid, 1)
  t.is(r2.lastInsertRowid, 2)

  const rows = await (await paraql.prepare("SELECT id, name FROM t ORDER BY id")).all()
  t.alike(rows, [
    { id: 1, name: "alice" },
    { id: 2, name: "bob" },
  ])

  const first = await (await paraql.prepare("SELECT id, name FROM t ORDER BY id")).get()
  t.alike(first, { id: 1, name: "alice" })

  const none = await (await paraql.prepare("SELECT id FROM t WHERE id = ?")).get(99)
  t.is(none, undefined)
})

test("round trip values of all SQLite types", async (t) => {
  t.plan(6)

  const [paraql] = await create(1, t)

  await (
    await paraql.prepare("CREATE TABLE t (i INTEGER, f REAL, s TEXT, b BLOB, n TEXT)")
  ).run()

  await (
    await paraql.prepare("INSERT INTO t VALUES (?, ?, ?, ?, ?)")
  ).run(42, 3.5, "hello", new Uint8Array([1, 2, 3, 4]), null)

  const row = await (await paraql.prepare("SELECT i, f, s, b, n FROM t")).get()

  t.is(row.i, 42)
  t.is(row.f, 3.5)
  t.is(row.s, "hello")
  t.ok(Buffer.isBuffer(row.b))
  t.alike(row.b, Buffer.from([1, 2, 3, 4]))
  t.is(row.n, null)
})
