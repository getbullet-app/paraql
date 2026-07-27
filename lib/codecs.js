const c = require("compact-encoding")
const IndexEncoder = require("index-encoder")

const { OPERATION } = require("./constants")

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
      case OPERATION.RUN:
      case OPERATION.BATCH: {
        c.string.preencode(state, operation.sql)
        c.any.preencode(state, operation.named)
        c.any.preencode(state, operation.positional)
        break
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
      case OPERATION.RUN:
      case OPERATION.BATCH: {
        c.string.encode(state, operation.sql)
        c.any.encode(state, operation.named)
        c.any.encode(state, operation.positional)
        break
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
      case OPERATION.RUN:
      case OPERATION.BATCH: {
        operation.sql = c.string.decode(state)
        operation.named = c.any.decode(state)
        operation.positional = c.any.decode(state)
        break
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
