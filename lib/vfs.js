const Autobee = require("autobee")
const ReadyResource = require("ready-resource")

const binding = require("../binding")
const { PageKey, Operation } = require("./codecs")
const { OPERATION, PAGE_SIZE } = require("./constants")
const Deferred = require("./deferred")

module.exports = class ParaVFS extends ReadyResource {
  constructor(db, store, key, options) {
    const { ...opts } = options

    super()

    this.store = store.namespace("paraql")
    this.bee = new Autobee(this.store, key, { apply: this._apply.bind(this), ...opts })

    this._db = db
    this._handle = null
    this._view = null
    this._batches = new Map()
    this._executing = null
  }

  async _open() {
    await this.bee.ready()

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

    for (const batch of this._batches.values()) {
      batch.close()
    }

    await this.bee.close()
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

  get view() {
    return this._view ?? this.bee.view
  }

  async _apply(nodes, view, host) {
    for (const node of nodes) {
      const op = Operation.decode(node.value)

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
          this._transact(view)
          try {
            await binding.exec(this._db._handle, op.query)
            this._executing?.resolve()
          } catch (err) {
            this._executing?.reject(err)
          }
          this._transact()
          break
        }
      }
    }
  }

  _transact(view = null) {
    if (view == null) {
      for (const batch of this._batches.values()) {
        batch.close()
      }

      this._batches.clear()
    }

    this._view = view
  }

  _batch(name) {
    const batch = this._batches.get(name) ?? this.view.write()

    this._batches.set(name, batch)

    return batch
  }

  async addWriter(key) {
    await this.bee.append(Operation.encode({ type: OPERATION.WRITER_ADD, key }))
  }

  async removeWriter(key) {
    await this.bee.append(Operation.encode({ type: OPERATION.WRITER_DEL, key }))
  }

  replicate(isInitiator) {
    return this.bee.replicate(isInitiator)
  }

  async exec(query) {
    this._executing = new Deferred()
    await this.bee.append(Operation.encode({ type: OPERATION.EXEC, query }))
    await this._executing.promise
  }

  async _xDelete(name, callback) {
    try {
      const lastPage = await this.view.peek({
        ...PageKey.encodeRange({ gte: [name], lte: [name] }),
        reverse: true,
      })

      if (lastPage) {
        const [_, lastIndex] = PageKey.decode(lastPage.key)

        for (let i = 0; i <= lastIndex; i++) {
          this._batch(name).tryDelete(PageKey.encode([name, i]))
        }
      }

      await this._batch(name).flush()
      this._batches.delete(name)

      callback(null)
    } catch (err) {
      callback(err)
    }
  }

  async _xAccess(name, callback) {
    try {
      const page = await this.view.peek(PageKey.encodeRange({ gte: [name], lte: [name] }))

      callback(null, !!page)
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
        const key = PageKey.encode([name, i])
        const page = (await this.view.get(key))?.value ?? Buffer.alloc(PAGE_SIZE)
        const pageStart = i * PAGE_SIZE
        const pageEnd = pageStart + PAGE_SIZE
        const readStart = Math.max(offset, pageStart)
        const readEnd = Math.min(end, pageEnd)

        if (readStart < readEnd) {
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
        const key = PageKey.encode([name, i])
        const pageStart = i * PAGE_SIZE
        const pageEnd = pageStart + PAGE_SIZE
        const writeStart = Math.max(offset, pageStart)
        const writeEnd = Math.min(offset + data.byteLength, pageEnd)
        const writeLength = writeEnd - writeStart
        const pageOffset = writeStart - pageStart
        const dataStart = writeStart - offset

        if (writeLength === PAGE_SIZE) {
          this._batch(name).tryPut(key, data.subarray(dataStart, dataStart + PAGE_SIZE))
        } else {
          const page = (await this.view.get(key))?.value ?? Buffer.alloc(PAGE_SIZE)
          const patch = data.subarray(dataStart, dataStart + writeLength)

          patch.copy(page, pageOffset)
          this._batch(name).tryPut(key, page)
        }
      }

      callback(null)
    } catch (err) {
      callback(err)
    }
  }

  async _xTruncate(name, size, callback) {
    try {
      const lastPage = await this.view.peek({
        ...PageKey.encodeRange({ gte: [name], lte: [name] }),
        reverse: true,
      })
      const lastIndex = lastPage ? PageKey.decode(lastPage.key)[1] : -1
      const current = (lastIndex + 1) * PAGE_SIZE

      if (size > current) {
        const targetIndex = Math.floor((size - 1) / PAGE_SIZE)

        for (let i = lastIndex + 1; i <= targetIndex; i++) {
          this._batch(name).tryPut(PageKey.encode([name, i]), Buffer.alloc(PAGE_SIZE))
        }
      } else if (size < current) {
        const start = Math.floor(size / PAGE_SIZE)
        const remainder = size % PAGE_SIZE

        for (let i = lastIndex; i > start; i--) {
          this._batch(name).tryDelete(PageKey.encode([name, i]))
        }

        if (remainder > 0) {
          const key = PageKey.encode([name, start])
          const page = await this.view.get(key)
          const data = Buffer.alloc(PAGE_SIZE)

          if (page) {
            const length = Math.min(page.value.byteLength, remainder)
            page.value.copy(data, 0, 0, length)
          }

          this._batch(name).tryPut(key, data)
        }
      }

      callback(null)
    } catch (err) {
      callback(err)
    }
  }

  async _xSync(name, callback) {
    try {
      await this._batch(name).flush()
      this._batches.delete(name)
      callback(null)
    } catch (err) {
      callback(err)
    }
  }

  async _xSize(name, callback) {
    try {
      const page = await this.view.peek({
        ...PageKey.encodeRange({ gte: [name], lte: [name] }),
        reverse: true,
      })

      if (page) {
        const [_, i] = PageKey.decode(page.key)
        const size = (i + 1) * PAGE_SIZE

        callback(null, size)
      } else {
        callback(null, 0)
      }
    } catch (err) {
      callback(err)
    }
  }
}
