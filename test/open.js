const test = require("brittle")
const Corestore = require("corestore")

const { replicateAndSync } = require("./helpers")
const ParaQL = require("..")

test("open and close", async (t) => {
  t.plan(4)

  const store = new Corestore(await t.tmp())
  const paraql = new ParaQL(store)

  await t.execution(paraql.ready())
  t.ok(paraql.opened)
  await t.execution(paraql.close())
  t.ok(paraql.closed)
})

test("re-open empty", async (t) => {
  t.plan(2)

  const path = await t.tmp()
  const store1 = new Corestore(path)
  const paraql1 = new ParaQL(store1)

  await paraql1.ready()
  await paraql1.close()
  await store1.close()

  const store2 = new Corestore(path)
  const paraql2 = new ParaQL(store2)

  await t.execution(paraql2.ready())
  await t.execution(paraql2.close())
})

test("re-open non-empty", async (t) => {
  t.plan(2)

  const path = await t.tmp()
  const store1 = new Corestore(path)
  const paraql1 = new ParaQL(store1)

  await paraql1.ready()
  await paraql1.exec(`
    CREATE TABLE pts1 ('I' SMALLINT NOT NULL, 'DT' TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 'F1' VARCHAR(4) NOT NULL, 'F2' VARCHAR(16) NOT NULL);
    INSERT INTO 'pts1' ('I', 'DT', 'F1', 'F2') VALUES (1, CURRENT_TIMESTAMP, 'ABCD', 'EFGHIJKLMNOPQRST');
  `)
  await paraql1.close()
  await store1.close()

  const store2 = new Corestore(path)
  const paraql2 = new ParaQL(store2)

  await t.execution(paraql2.ready())
  await t.execution(paraql2.close())
})

test("re-open replicated", async (t) => {
  t.plan(4)

  const pathA = await t.tmp()
  const pathB = await t.tmp()
  const storeA1 = new Corestore(pathA)
  const storeB1 = new Corestore(pathB)
  const paraqlA1 = new ParaQL(storeA1)

  await paraqlA1.ready()

  const key = paraqlA1.key
  const paraqlB1 = new ParaQL(storeB1, key)

  await paraqlB1.ready()
  await paraqlA1.addWriter(paraqlB1.local)
  await paraqlA1.exec(`
    CREATE TABLE pts1 ('I' SMALLINT NOT NULL, 'DT' TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 'F1' VARCHAR(4) NOT NULL, 'F2' VARCHAR(16) NOT NULL);
    INSERT INTO 'pts1' ('I', 'DT', 'F1', 'F2') VALUES (1, CURRENT_TIMESTAMP, 'ABCD', 'EFGHIJKLMNOPQRST');
  `)
  await replicateAndSync(paraqlA1, paraqlB1)
  await paraqlA1.close()
  await storeA1.close()
  await paraqlB1.close()
  await storeB1.close()

  const storeA2 = new Corestore(pathA)
  const storeB2 = new Corestore(pathB)
  const paraqlA2 = new ParaQL(storeA2, key)
  const paraqlB2 = new ParaQL(storeB2, key)

  await t.execution(paraqlA2.ready())
  await t.execution(paraqlB2.ready())
  await t.execution(paraqlA2.close())
  await t.execution(paraqlB2.close())
})
