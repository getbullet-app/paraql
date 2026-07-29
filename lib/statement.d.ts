import ReadyResource from "ready-resource"
import Buffer from "bare-buffer"

interface ParaQLStatement extends ReadyResource {
  readonly sourceSQL: string
  readonly batching: boolean

  batch(on: boolean): void

  flush(): Promise<ParaQLStatement.FlushResult>

  finalize(): Promise<void>

  all<T extends ParaQLStatement.Row = ParaQLStatement.Row>(
    ...params: ParaQLStatement.Parameters
  ): Promise<T[]>

  get<T extends ParaQLStatement.Row = ParaQLStatement.Row>(
    ...params: ParaQLStatement.Parameters
  ): Promise<T | undefined>

  run(...params: ParaQLStatement.Parameters): Promise<ParaQLStatement.RunResult | undefined>

  iterate<T extends ParaQLStatement.Row = ParaQLStatement.Row>(
    ...params: ParaQLStatement.Parameters
  ): AsyncIterableIterator<T>
}

declare class ParaQLStatement {}

declare namespace ParaQLStatement {
  export type Value = null | number | string | Buffer

  export type BindValue =
    null | undefined | number | bigint | string | ArrayBuffer | ArrayBufferView

  export type Row = Record<string, Value>

  export type NamedParameters = Record<string, BindValue>

  export type Parameters = [NamedParameters, ...BindValue[]] | BindValue[]

  export interface RunResult {
    changes: number
    lastInsertRowid: number
  }

  export interface FlushResult {
    changes: number
    lastInsertRowid: number
    errors: number
  }
}

export = ParaQLStatement
