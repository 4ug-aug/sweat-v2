import * as authSchema from '#/lib/auth-schema'
import type { TransactionalSqlite } from '#/server/secret-box'

const databasePath = process.env.SWEAT_DATABASE_PATH ?? './sweat.sqlite'
const usingBun = typeof Bun !== 'undefined'

const connection = await (async () => {
  if (usingBun) {
    const [{ Database }, { drizzle }] = await Promise.all([
      import('bun:sqlite'),
      import('drizzle-orm/bun-sqlite'),
    ])
    const sqlite = new Database(databasePath, { create: true })
    sqlite.exec('PRAGMA foreign_keys = ON')
    sqlite.exec('PRAGMA journal_mode = WAL')
    sqlite.exec('PRAGMA busy_timeout = 5000')
    return {
      // `query` caches the prepared statement per SQL string; `prepare` reparses
      // on every call, and the stores prepare inline on every read and write.
      // Drizzle keeps the raw handle so it still owns its own statements.
      sqlite: {
        prepare: (sql: string) => sqlite.query(sql),
        transaction: <T>(fn: () => T) => sqlite.transaction(fn),
        close: () => sqlite.close(),
      },
      db: drizzle(sqlite, { schema: authSchema }),
    }
  }

  const [{ default: Database }, { drizzle }] = await Promise.all([
    import('better-sqlite3'),
    import('drizzle-orm/better-sqlite3'),
  ])
  const sqlite = new Database(databasePath)
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('busy_timeout = 5000')
  return { sqlite, db: drizzle(sqlite, { schema: authSchema }) }
})()

export const sqlite: TransactionalSqlite & { close(): void } = connection.sqlite
export const db = connection.db
export { authSchema }

export async function migrateDatabase(migrationsFolder: string): Promise<void> {
  if (usingBun) {
    const { migrate } = await import('drizzle-orm/bun-sqlite/migrator')
    migrate(db as never, { migrationsFolder })
  } else {
    const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
    migrate(db as never, { migrationsFolder })
  }
}
