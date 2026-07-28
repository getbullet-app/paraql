const Autobee = require("autobee")
const Buffer = require("bare-buffer")
// const fs = require("bare-fs/promises")
const path = require("bare-path")
const ReadyResource = require("ready-resource")
const RocksDB = require("rocksdb-native")

const binding = require("../binding")
const { PageKey, Operation, deflate, inflate } = require("./codecs")
const { OPERATION, PAGE_SIZE } = require("./constants")
const Deferred = require("./deferred")
const Encryption = require("./encryption")
const errors = require("./errors")

module.exports = class ParaVFS extends ReadyResource {
  constructor(db, store, key, options) {
    const {
      name = "paraql.db",
      keyPair = null,
      encrypted = false,
      encryptionKey = null,
      compressed = false,
      compressionLevel = 6,
    } = options

    super()

    this._handle = null
    this._db = db
    this._name = name

    this._encryption = null
    this._compressed = compressed
    this._compressionLevel = compressionLevel

    this.store = store.namespace(name)
    this.bee = new Autobee(this.store, key, {
      apply: this._apply.bind(this),
      keyPair,
      encrypted,
      encryptionKey,
      optimistic: false,
    })
    this.tmp = new RocksDB(path.resolve(this.store.storage.path, name))

    this._view = null
    this._files = new Map()
    this._interactive = null
  }

  get name() {
    return this._name
  }

  get key() {
    return this.bee.key
  }

  get local() {
    return this.bee.local.key
  }

  get discoveryKey() {
    return this.bee.discoveryKey
  }

  get encryptionKey() {
    return this.bee.encryptionKey
  }

  get writable() {
    return this.bee.writable
  }

  get encrypted() {
    return !!this._encryption
  }

  get compressed() {
    return !!this._compressed
  }

  async _open() {
    await this.bee.ready()

    this._encryption =
      this.bee.encryptionKey && new Encryption(this.key, this.bee.encryptionKey)
    this._handle = binding.vfsInit(
      this,
      this._xDelete,
      this._xAccess,
      this._xRead,
      this._xWrite,
      this._xTruncate,
      this._xSync,
      this._xSize,
    )
  }

  async _close() {
    if (this._handle) {
      binding.vfsDestroy(this._handle)

      this._handle = null
    }

    for (const batch of this._files.values()) {
      batch.close()
    }

    await this.bee.close()
    // Explicit rocksdb.close() crashes in some situations
    // So since it doesn't seem to keep any handles open
    // Just leave it for now
    // await this.tmp.close()
  }

  async _apply(nodes, view, host) {
    let stmt = null
    let changes = 0
    let lastInsertRowid = 0
    let errors = 0

    for (const node of nodes) {
      const op = Operation.decode(
        this.compressed
          ? await inflate(node.value, { level: this._compressionLevel })
          : node.value,
      )

      switch (op.type) {
        case OPERATION.WRITER_ADD: {
          const batch = view.write()
          host.addWriter(op.key)
          await batch.flush()
          break
        }
        case OPERATION.WRITER_DEL: {
          const batch = view.write()
          host.removeWriter(op.key)
          await batch.flush()
          break
        }
        case OPERATION.EXEC: {
          this._write(view)
          try {
            await this._db._exec(op.sql)
            this._interactive?.resolve()
          } catch (err) {
            this._interactive?.reject(err)
          }
          this._write(null)
          break
        }
        case OPERATION.RUN: {
          this._write(view)
          try {
            stmt = await this._db.prepare(op.sql)
            const result = await stmt._run(op.named, op.positional)
            this._interactive?.resolve(result)
          } catch (err) {
            this._interactive?.reject(err)
          }
          this._write(null)
          break
        }
        case OPERATION.STMT: {
          try {
            stmt = await this._db.prepare(op.sql)
          } catch (err) {
            throw errors.INTERNAL(`Received invalid statement: ${op.sql}`)
          }
        }
        case OPERATION.BATCH: {
          this._write(view)
          try {
            const result = await stmt._run(op.named, op.positional)
            changes += result.changes
            lastInsertRowid = result.lastInsertRowid
          } catch (err) {
            errors++
          }
          this._write(null)
          break
        }
        case OPERATION.FLUSH: {
          this._interactive?.resolve({ changes, lastInsertRowid, errors })
          break
        }
      }
    }
  }

  _write(view = null) {
    if (this._files.size) {
      throw errors.INTERNAL(`Unflushed batches: ${this._files.size}`)
    }

    this._view = view
  }

  async addWriter(key) {
    await this.bee.append(
      this.compressed
        ? await deflate(Operation.encode({ type: OPERATION.WRITER_ADD, key }), {
            level: this._compressionLevel,
          })
        : Operation.encode({ type: OPERATION.WRITER_ADD, key }),
    )
  }

  async removeWriter(key) {
    await this.bee.append(
      this.compressed
        ? await deflate(Operation.encode({ type: OPERATION.WRITER_DEL, key }), {
            level: this._compressionLevel,
          })
        : Operation.encode({ type: OPERATION.WRITER_DEL, key }),
    )
  }

  replicate(isInitiator) {
    return this.bee.replicate(isInitiator)
  }

  async compact() {
    this.bee.bee.cache.empty()
    await this.bee.bee.core.startMarking()

    for await (const _ of this.bee.bee.createReadStream()) {
    }

    await this.bee.bee.core.sweep()

    await this.bee.store.storage.db.compact()

    await this.tmp.compact()
  }

  async exec(sql) {
    this._interactive = new Deferred()
    try {
      const promise = this.bee.append(
        this.compressed
          ? await deflate(Operation.encode({ type: OPERATION.EXEC, sql }), {
              level: this._compressionLevel,
            })
          : Operation.encode({ type: OPERATION.EXEC, sql }),
      )
      await this._interactive.promise
        .then(() => promise)
        .catch(async (err) => {
          await promise
          throw err
        })
    } finally {
      this._interactive = null
    }
  }

  async run(sql, named, positional) {
    this._interactive = new Deferred()
    try {
      const promise = this.bee.append(
        this.compressed
          ? await deflate(Operation.encode({ type: OPERATION.RUN, sql, named, positional }), {
              level: this._compressionLevel,
            })
          : Operation.encode({ type: OPERATION.RUN, sql, named, positional }),
      )
      return await this._interactive.promise
        .then(async (result) => {
          await promise
          return result
        })
        .catch(async (err) => {
          await promise
          throw err
        })
    } finally {
      this._interactive = null
    }
  }

  async flush(sql, operations) {
    this._interactive = new Deferred()
    try {
      const promise = this.bee.append(
        this.compressed
          ? await Promise.all(
              [
                { type: OPERATION.STMT, sql },
                ...operations.map((op) => ({ type: OPERATION.BATCH, ...op })),
                { type: OPERATION.FLUSH },
              ].map((op) => deflate(Operation.encode(op), { level: this._compressionLevel })),
            )
          : [
              { type: OPERATION.STMT, sql },
              ...operations.map((op) => ({ type: OPERATION.BATCH, ...op })),
              { type: OPERATION.FLUSH },
            ].map(Operation.encode),
      )
      return await this._interactive.promise
        .then(async (result) => {
          await promise
          return result
        })
        .catch(async (err) => {
          await promise
          throw err
        })
    } finally {
      this._interactive = null
    }
  }

  async _get(name, index) {
    const tmp = name !== this.name
    const key = PageKey.encode([name, index])
    let value = null

    if (tmp) {
      value = await this.tmp.get(key)

      if (value && this.encrypted) {
        value = this._encryption.decrypt(value, name, index)
      }
    } else {
      const entry = await (this._view ?? this.bee.view).get(key)

      value = entry?.value ?? null
    }

    if (this.compressed) {
      value = await inflate(value, { level: this._compressionLevel })
    }

    return value
  }

  async _last(name) {
    const range = PageKey.encodeRange({ gte: [name], lte: [name] })
    const view = name === this.name ? (this._view ?? this.bee.view) : this.tmp

    const entry = await view.peek({ ...range, reverse: true })

    if (entry) {
      const [_, index] = PageKey.decode(entry.key)

      return index
    }

    return -1
  }

  async _tryPut(name, index, value) {
    const tmp = name !== this.name
    const key = PageKey.encode([name, index])
    const view = tmp ? this.tmp : (this._view ?? this.bee.view)
    const batch = this._files.get(name) ?? view.write()

    this._files.set(name, batch)

    if (this.compressed) {
      value = await deflate(value, { level: this._compressionLevel })
    }

    if (tmp && this.encrypted) {
      value = this._encryption.encrypt(value, name, index)
    }

    batch.tryPut(key, value)
  }

  async _tryDelete(name, index) {
    const key = PageKey.encode([name, index])
    const view = name === this.name ? (this._view ?? this.bee.view) : this.tmp
    const batch = this._files.get(name) ?? view.write()

    this._files.set(name, batch)

    batch.tryDelete(key)
  }

  async _flush(name) {
    const batch = this._files.get(name)

    if (!batch) throw errors.INTERNAL(`No batch for ${name}`)

    this._files.delete(name)

    await batch.flush()
  }

  async _xDelete(name, callback) {
    try {
      const index = await this._last(name)

      if (index >= 0) {
        for (let i = 0; i <= index; i++) {
          this._tryDelete(name, i)
        }
      }

      await this._flush(name)

      callback(null)
    } catch (err) {
      callback(err)
    }
  }

  async _xAccess(name, callback) {
    try {
      const index = await this._last(name)

      callback(null, index >= 0)
    } catch (err) {
      callback(err)
    }
  }

  async _xRead(name, buffer, offset, callback) {
    try {
      const data = Buffer.from(buffer)
      const end = offset + data.byteLength
      const startPage = Math.floor(offset / PAGE_SIZE)
      const endPage = Math.floor((end - 1) / PAGE_SIZE)

      for (let i = startPage; i <= endPage; i++) {
        const pageStart = i * PAGE_SIZE
        const pageEnd = pageStart + PAGE_SIZE
        const readStart = Math.max(offset, pageStart)
        const readEnd = Math.min(end, pageEnd)

        if (readStart < readEnd) {
          const page = (await this._get(name, i)) ?? Buffer.alloc(PAGE_SIZE)
          const sliceStart = readStart - pageStart
          const sliceLength = readEnd - readStart
          const dataOffset = readStart - offset

          page.copy(data, dataOffset, sliceStart, sliceStart + sliceLength)
        }
      }

      callback(null)
    } catch (err) {
      callback(err)
    }
  }

  async _xWrite(name, buffer, offset, callback) {
    try {
      const data = Buffer.from(buffer)
      const start = Math.floor(offset / PAGE_SIZE)
      const end = Math.floor((offset + data.byteLength - 1) / PAGE_SIZE)

      for (let i = start; i <= end; i++) {
        const pageStart = i * PAGE_SIZE
        const pageEnd = pageStart + PAGE_SIZE
        const writeStart = Math.max(offset, pageStart)
        const writeEnd = Math.min(offset + data.byteLength, pageEnd)
        const writeLength = writeEnd - writeStart
        const pageOffset = writeStart - pageStart
        const dataStart = writeStart - offset

        if (writeLength === PAGE_SIZE) {
          this._tryPut(name, i, data.subarray(dataStart, dataStart + PAGE_SIZE))
        } else {
          const page = (await this._get(name, i)) ?? Buffer.alloc(PAGE_SIZE)
          const patch = data.subarray(dataStart, dataStart + writeLength)

          patch.copy(page, pageOffset)
          this._tryPut(name, i, page)
        }
      }

      callback(null)
    } catch (err) {
      callback(err)
    }
  }

  async _xTruncate(name, size, callback) {
    try {
      const index = await this._last(name)
      const current = (index + 1) * PAGE_SIZE

      if (size > current) {
        const targetIndex = Math.floor((size - 1) / PAGE_SIZE)

        for (let i = index + 1; i <= targetIndex; i++) {
          this._tryPut(name, i, Buffer.alloc(PAGE_SIZE))
        }
      } else if (size < current) {
        const start = Math.floor(size / PAGE_SIZE)
        const remainder = size % PAGE_SIZE

        for (let i = lastIndex; i > start; i--) {
          this._tryDelete(name, i)
        }

        if (remainder > 0) {
          const page = await this._get(name, start)
          const data = Buffer.alloc(PAGE_SIZE)

          if (page) {
            const length = Math.min(page.byteLength, remainder)
            page.value.copy(data, 0, 0, length)
          }

          this._tryPut(name, start, data)
        }
      }

      callback(null)
    } catch (err) {
      callback(err)
    }
  }

  async _xSync(name, callback) {
    try {
      await this._flush(name)
      callback(null)
    } catch (err) {
      callback(err)
    }
  }

  async _xSize(name, callback) {
    try {
      const index = await this._last(name)
      const size = (index + 1) * PAGE_SIZE

      callback(null, size)
    } catch (err) {
      callback(err)
    }
  }
}
