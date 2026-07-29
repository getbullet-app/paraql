import Buffer from "bare-buffer"
import Corestore from "corestore"
import ReadyResource from "ready-resource"
import { Duplex } from "streamx"
import Statement from "./lib/statement"

interface ParaQL extends ReadyResource {
  readonly name: string
  readonly key: Buffer
  readonly local: Buffer
  readonly discoveryKey: Buffer
  readonly encryptionKey: Buffer | null
  readonly writable: boolean
  readonly encrypted: boolean

  addWriter(key: Buffer): Promise<void>
  removeWriter(key: Buffer): Promise<void>
  replicate(isInitiatorOrStream: boolean | Duplex): Duplex

  compact(): Promise<void>
  info(): Promise<ParaQL.Info>

  exec(sql: string): Promise<void>
  prepare(sql: string): Promise<Statement>
}

declare class ParaQL {
  constructor(store: Corestore, options?: ParaQL.Options)
  constructor(store: Corestore, key: Buffer, options?: ParaQL.Options)
}

declare namespace ParaQL {
  export interface Options {
    cacheSize?: number
    name?: string
    keyPair?: { publicKey: Buffer; secretKey: Buffer } | null
    encrypted?: boolean
    encryptionKey?: Buffer | null
    compressed?: boolean
    compressionLevel?: number
  }

  export interface Info {
    database: number
    temporary: number
    total: number
  }
}

export = ParaQL
