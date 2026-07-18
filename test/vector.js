const test = require("brittle")
const { create } = require("./helpers")

test("basic vector search - cosine similarity", async (t) => {
  const [paraql] = await create(1, t)

  await paraql.exec("CREATE TABLE embeddings (v FLOAT32(4));")
  await paraql.exec("INSERT INTO embeddings VALUES (vector('[1,2,3,4]'));")
  await paraql.exec("INSERT INTO embeddings VALUES (vector('[2,3,4,5]'));")
  await paraql.exec("INSERT INTO embeddings VALUES (vector('[3,4,5,6]'));")
  await paraql.exec("INSERT INTO embeddings VALUES (vector('[4,5,6,7]'));")

  const result = await paraql.query(
    "SELECT rowid, vector_distance_cos(v, vector('[3,4,5,6]')) AS distance FROM embeddings ORDER BY distance ASC;",
  )

  t.alike(
    result.map((r) => r.rows[0]),
    ["3", "4", "2", "1"],
  )
})

test("basic vector search - euclidean distance", async (t) => {
  const [paraql] = await create(1, t)

  await paraql.exec("CREATE TABLE embeddings (v FLOAT32(4));")
  await paraql.exec("INSERT INTO embeddings VALUES (vector('[1,2,3,4]'));")
  await paraql.exec("INSERT INTO embeddings VALUES (vector('[2,3,4,5]'));")
  await paraql.exec("INSERT INTO embeddings VALUES (vector('[3,4,5,6]'));")
  await paraql.exec("INSERT INTO embeddings VALUES (vector('[4,5,6,7]'));")

  const result = await paraql.query(
    "SELECT rowid, vector_distance_l2(v, vector('[3,4,5,6]')) AS distance FROM embeddings ORDER BY distance ASC;",
  )

  t.alike(
    result.map((r) => r.rows[0]),
    ["3", "2", "4", "1"],
  )
})

test("basic vector search - indexed", async (t) => {
  const [paraql] = await create(1, t)

  await paraql.exec("CREATE TABLE embeddings (v FLOAT32(4));")
  await paraql.exec("CREATE INDEX embeddings_idx ON embeddings( libsql_vector_idx(v) );")
  await paraql.exec("INSERT INTO embeddings VALUES (vector('[1,2,3,4]'));")
  await paraql.exec("INSERT INTO embeddings VALUES (vector('[2,3,4,5]'));")
  await paraql.exec("INSERT INTO embeddings VALUES (vector('[3,4,5,6]'));")
  await paraql.exec("INSERT INTO embeddings VALUES (vector('[4,5,6,7]'));")

  const result = await paraql.query(
    "SELECT rowid FROM vector_top_k('embeddings_idx', vector('[3,4,5,6]'), 4);",
  )

  t.alike(
    result.map((r) => r.rows[0]),
    ["3", "4", "2", "1"],
  )
})
