const test = require("brittle")

const { create } = require("./helpers")

test("exec single statement", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  await paraql.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)")

  const row = await (await paraql.prepare("SELECT count(*) AS n FROM t")).get()

  t.is(row.n, 0)
})

test("exec multiple statements", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  await paraql.exec(`
    CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO t (name) VALUES ('a'), ('b'), ('c');
    CREATE INDEX idx_name ON t (name);
  `)

  const row = await (await paraql.prepare("SELECT count(*) AS n FROM t")).get()

  t.is(row.n, 3)
})

test("exec discards rows from SELECT", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)
  const result = await paraql.exec("SELECT 1; SELECT 2;")

  t.is(result, undefined)
})

test.skip("exec propagates errors from latter statements", async (t) => {
  t.plan(2)

  const [paraql] = await create(1, t)

  await t.exception(
    paraql.exec("CREATE TABLE t (id INTEGER); INSERT INTO nonexistent VALUES (1);"),
    /ERROR/,
  )

  const row = await (
    await paraql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='t'")
  ).get()

  t.is(row.name, "t")
})

test.skip("exec on closed database throws", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  await paraql.close()

  await t.exception(paraql.exec("SELECT 1"), /DATABASE_NOT_OPEN/)
})

test("exec on invalid SQL throws", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  await t.exception(paraql.exec("NOT VALID SQL"), /ERROR/)
})

test("exec accepts whitespace and comments only", async (t) => {
  t.plan(1)

  const [paraql] = await create(1, t)

  await t.execution(paraql.exec("   -- a comment\n  /* another */  \n"))
})
