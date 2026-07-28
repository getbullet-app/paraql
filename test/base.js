const test = require("brittle")
const Corestore = require("corestore")

const { create, replicateAndSync } = require("./helpers")
const ParaQL = require("..")

test("writable", async (t) => {
  t.plan(6)

  const [a, b] = await create(2, t)
  const store = new Corestore(await t.tmp())
  const c = new ParaQL(store, a.key)

  await c.ready()

  t.teardown(() => c.close())

  t.ok(a.writable)
  t.absent(b.writable)
  t.absent(c.writable)

  await replicateAndSync(a, b, c)

  t.ok(a.writable)
  t.ok(b.writable)
  t.absent(c.writable)
})

test("replication", async (t) => {
  t.plan(1)

  const [a] = await create(1, t)
  const store = new Corestore(await t.tmp())
  const b = new ParaQL(store, a.key)

  t.teardown(() => b.close())

  await b.ready()

  await a.exec(`
    CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO t (name) VALUES ('alice'), ('bob');
  `)

  await replicateAndSync(a, b)

  const rows = await (await b.prepare("SELECT id, name FROM t ORDER BY id")).all()

  t.alike(rows, [
    { id: 1, name: "alice" },
    { id: 2, name: "bob" },
  ])
})

test("multiple writers", async (t) => {
  t.plan(2)

  const [a, b] = await create(2, t)

  await a.exec(`
    CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO t (name) VALUES ('alice');
  `)

  await replicateAndSync(a, b)

  {
    const rows = await (await b.prepare("SELECT id, name FROM t ORDER BY id")).all()

    t.alike(rows, [{ id: 1, name: "alice" }])
  }

  await b.exec("INSERT INTO t (name) VALUES ('bob');")

  await replicateAndSync(a, b)

  {
    const rows = await (await a.prepare("SELECT id, name FROM t ORDER BY id")).all()

    t.alike(rows, [
      { id: 1, name: "alice" },
      { id: 2, name: "bob" },
    ])
  }
})

test("concurrent writes", async (t) => {
  t.plan(1)

  const [a, b] = await create(2, t)

  await replicateAndSync(a, b)

  await a.exec(`
    CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO t (name) VALUES ('alice');
  `)
  await b.exec(`
    CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO t (name) VALUES ('bob');
  `)

  await replicateAndSync(a, b)

  const rows = await (await a.prepare("SELECT id, name FROM t ORDER BY id")).all()

  t.alike(rows, [
    { id: 1, name: "alice" },
    { id: 2, name: "bob" },
  ])
})
