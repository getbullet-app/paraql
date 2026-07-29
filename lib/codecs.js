const c = require("compact-encoding")
const IndexEncoder = require("index-encoder")
const zlib = require("zlib")

const { OPERATION, PAGE_SIZE } = require("./constants")

const op = {
  preencode(state, operation) {
    c.uint8.preencode(state, operation.type)

    switch (operation.type) {
      case OPERATION.WRITER_ADD:
      case OPERATION.WRITER_DEL: {
        c.fixed32.preencode(state, operation.key)
        break
      }
      case OPERATION.EXEC: {
        c.string.preencode(state, operation.sql)
        break
      }
      case OPERATION.RUN: {
        c.string.preencode(state, operation.sql)
        c.any.preencode(state, operation.named)
        c.any.preencode(state, operation.positional)
        break
      }
      case OPERATION.STMT: {
        c.string.preencode(state, operation.sql)
      }
      case OPERATION.BATCH: {
        c.any.preencode(state, operation.named)
        c.any.preencode(state, operation.positional)
      }
      case OPERATION.FLUSH: {
        break
      }
    }
  },
  encode(state, operation) {
    c.uint8.encode(state, operation.type)

    switch (operation.type) {
      case OPERATION.WRITER_ADD:
      case OPERATION.WRITER_DEL: {
        c.fixed32.encode(state, operation.key)
        break
      }
      case OPERATION.EXEC: {
        c.string.encode(state, operation.sql)
        break
      }
      case OPERATION.RUN: {
        c.string.encode(state, operation.sql)
        c.any.encode(state, operation.named)
        c.any.encode(state, operation.positional)
        break
      }
      case OPERATION.STMT: {
        c.string.encode(state, operation.sql)
      }
      case OPERATION.BATCH: {
        c.any.encode(state, operation.named)
        c.any.encode(state, operation.positional)
      }
      case OPERATION.FLUSH: {
        break
      }
    }
  },
  decode(state) {
    const type = c.uint8.decode(state)

    const operation = { type }

    switch (type) {
      case OPERATION.WRITER_ADD:
      case OPERATION.WRITER_DEL: {
        operation.key = c.fixed32.decode(state)
        break
      }
      case OPERATION.EXEC: {
        operation.sql = c.string.decode(state)
        break
      }
      case OPERATION.RUN: {
        operation.sql = c.string.decode(state)
        operation.named = c.any.decode(state)
        operation.positional = c.any.decode(state)
        break
      }
      case OPERATION.STMT: {
        operation.sql = c.string.decode(state)
      }
      case OPERATION.BATCH: {
        operation.named = c.any.decode(state)
        operation.positional = c.any.decode(state)
      }
      case OPERATION.FLUSH: {
        break
      }
    }

    return operation
  },
}

module.exports.PageKey = new IndexEncoder([IndexEncoder.STRING, IndexEncoder.UINT])

module.exports.Operation = {
  encode(operation) {
    return c.encode(op, operation)
  },
  decode(operation) {
    return c.decode(op, operation)
  },
}

module.exports.deflate = async function (buffer, options) {
  return new Promise((resolve, reject) =>
    zlib.deflate(buffer, { chunkSize: PAGE_SIZE, ...options }, (err, result) => {
      if (err) {
        return reject(result)
      }
      resolve(result)
    }),
  )
}

module.exports.inflate = async function (buffer, options) {
  return new Promise((resolve, reject) =>
    zlib.inflate(buffer, { chunkSize: PAGE_SIZE, ...options }, (err, result) => {
      if (err) {
        return reject(result)
      }
      resolve(result)
    }),
  )
}
