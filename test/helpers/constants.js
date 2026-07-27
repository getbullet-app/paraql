module.exports.BENCH_ROWS = 2_500
module.exports.INSERT = "INSERT INTO 'pts1' ('I', 'DT', 'F1', 'F2') VALUES (?, 'ABCD', ?, ?);"
module.exports.TABLE =
  "CREATE TABLE pts1 ('I' SMALLINT NOT NULL, 'DT' VARCHAR(4) NOT NULL, 'F1' VARCHAR(4) NOT NULL, 'F2' VARCHAR(16) NOT NULL);"
