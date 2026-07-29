const test = require("brittle")
const { Buffer } = require("buffer")

const { create } = require("./helpers")
const ParaQLError = require("../lib/errors")

test("prepare statement", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  await t.execution(paraql.prepare("SELECT 1"))
})

test("prepare throws on invalid SQL", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  await t.exception(paraql.prepare("NOT VALID SQL"), /syntax error/)
})

test("ParaQL errors are ParaQLError with SQLite code as .code", async (t) => {
  t.plan(2)

  const [paraql] = await create(1, t)

  try {
    await paraql.prepare("NOT VALID SQL")
    t.fail("should have thrown")
  } catch (err) {
    t.ok(err instanceof ParaQLError)
    t.is(err.code, "ERROR")
  }
})

test("statements are cached", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  const stmt1 = await paraql.prepare("SELECT 1")
  const stmt2 = await paraql.prepare("SELECT 1")

  t.is(stmt1, stmt2)
})

test("closing ParaQL finalizes open statements", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  const stmt = await paraql.prepare("SELECT 1")

  await paraql.close()

  t.ok(stmt.closed)
})

test("statement is reusable with different params", async (t) => {
  t.plan(3)

  const [paraql] = await create(1, t)

  await (await paraql.prepare("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)")).run()

  const insert = await paraql.prepare("INSERT INTO t (name) VALUES (?)")

  for (let i = 0; i < 5; i++) {
    await insert.run(`row-${i}`)
  }

  const rows = await (await paraql.prepare("SELECT name FROM t ORDER BY id")).all()

  t.is(rows.length, 5)
  t.is(rows[0].name, "row-0")
  t.is(rows[4].name, "row-4")
})

test("runtime error during step is propagated", async (t) => {
  t.plan(2)

  const [paraql] = await create(1, t)

  await (await paraql.prepare("CREATE TABLE t (id INTEGER PRIMARY KEY)")).run()
  const insert = await paraql.prepare("INSERT INTO t VALUES (1)")

  await t.execution(insert.run())
  await t.exception(insert.run(), /CONSTRAINT/)
})

test("named params via :name with sigil", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  const row = await (await paraql.prepare("SELECT :a + :b AS r")).get({ ":a": 2, ":b": 3 })

  t.is(row.r, 5)
})

test("named params via :name without sigil", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  const row = await (await paraql.prepare("SELECT :a + :b AS r")).get({ a: 2, b: 3 })

  t.is(row.r, 5)
})

test("named params via :name with(out) sigil", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  const row = await (await paraql.prepare("SELECT :a + :b AS r")).get({ a: 2, ":b": 3 })

  t.is(row.r, 5)
})

test("named params via @name", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  const row = await (await paraql.prepare("SELECT @a + @b AS r")).get({ a: 4, b: 5 })

  t.is(row.r, 9)
})

test("named params via $name", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  const row = await (await paraql.prepare("SELECT $a + $b AS r")).get({ a: 7, b: 8 })

  t.is(row.r, 15)
})

test("mix of named and anonymous params", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  const row = await (await paraql.prepare("SELECT :a AS a, ? AS b")).get({ a: 1 }, 2)

  t.alike(row, { a: 1, b: 2 })
})

test("iterate yields rows one at a time", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  await paraql.exec(`
    CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO t (name) VALUES ('a'), ('b'), ('c');
  `)

  const select = await paraql.prepare("SELECT id, name FROM t ORDER BY id")
  const rows = []

  for await (const row of select.iterate()) {
    rows.push(row)
  }

  t.alike(rows, [
    { id: 1, name: "a" },
    { id: 2, name: "b" },
    { id: 3, name: "c" },
  ])
})

test("iterate accepts named params", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  await paraql.exec(`
    CREATE TABLE t (id INTEGER PRIMARY KEY, group_id INTEGER);
    INSERT INTO t (group_id) VALUES (1), (2), (1), (2), (1);
  `)

  const select = await paraql.prepare("SELECT id FROM t WHERE group_id = :g ORDER BY id")
  const rows = []

  for await (const row of select.iterate({ g: 1 })) {
    rows.push(row.id)
  }

  t.alike(rows, [1, 3, 5])
})

test("iterate accepts positional params", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  await paraql.exec(`
    CREATE TABLE t (id INTEGER PRIMARY KEY, group_id INTEGER);
    INSERT INTO t (group_id) VALUES (1), (2), (1), (2), (1);
  `)

  const select = await paraql.prepare("SELECT id FROM t WHERE group_id = ? ORDER BY id")
  const rows = []

  for await (const row of select.iterate(2)) {
    rows.push(row.id)
  }

  t.alike(rows, [2, 4])
})

test("iterate yields nothing for empty result set", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  await paraql.exec("CREATE TABLE t (id INTEGER)")

  const select = await paraql.prepare("SELECT id FROM t")
  let count = 0

  for await (const _ of select.iterate()) count++

  t.is(count, 0)
})

test("iterate cleans up the statement on early break", async (t) => {
  t.plan(2)

  const [paraql] = await create(1, t)

  await paraql.exec(`
    CREATE TABLE t (id INTEGER PRIMARY KEY);
    INSERT INTO t VALUES (1), (2), (3), (4), (5);
  `)

  const stmt = await paraql.prepare("SELECT id FROM t ORDER BY id")
  let first

  for await (const row of stmt.iterate()) {
    first = row.id
    break
  }

  t.is(first, 1)

  const rows = []

  for await (const row of stmt.iterate()) {
    rows.push(row.id)
  }

  t.alike(rows, [1, 2, 3, 4, 5])
})

test("iterate propagates runtime errors mid-iteration", async (t) => {
  t.plan(2)

  const [paraql] = await create(1, t)

  await paraql.exec(`
    CREATE TABLE t (id INTEGER, src TEXT);
    INSERT INTO t VALUES (1, '{}'), (2, 'not json'), (3, '{}');
  `)

  const stmt = await paraql.prepare("SELECT id, json(src) AS j from t")

  await t.exception(async () => {
    for await (const row of stmt.iterate());
  }, /ERROR/)

  await paraql.exec("DELETE FROM t WHERE id = 2")

  const ids = []

  for await (const row of stmt.iterate()) ids.push(row.id)

  t.alike(ids, [1, 3])
})

test("Uint8Array as first arg treated as positional, not named", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  await (await paraql.prepare("CREATE TABLE t (b BLOB)")).run()

  const blob = new Uint8Array([1, 2, 3])

  await (await paraql.prepare("INSERT INTO t VALUES (?)")).run(blob)

  const row = await (await paraql.prepare("SELECT b FROM t")).get()

  t.alike(row.b, Buffer.from(blob))
})

test("too many positional params throws", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  await t.exception((await paraql.prepare("SELECT ? AS a")).get(1, 2), /INVALID_ARGUMENT/)
})

test("positional params with no placeholder throws", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  await t.exception((await paraql.prepare("SELECT 1")).get(1), /INVALID_ARGUMENT/)
})

test("too few positional params throws", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  await t.exception((await paraql.prepare("SELECT ? + ? AS r")).get(1), /INVALID_ARGUMENT/)
})

test("missing positional param alongside named throws", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  await t.exception(
    (await paraql.prepare("SELECT :a + ? AS r")).get({ a: 1 }),
    /INVALID_ARGUMENT/,
  )
})

test("named placeholder without object throws", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  await t.exception((await paraql.prepare("SELECT :a as a")).get(), /INVALID_ARGUMENT/)
})

test("missing named param throws", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  await t.exception(
    (await paraql.prepare("SELECT :a + :b AS r")).get({ a: 1 }),
    /INVALID_ARGUMENT/,
  )
})
