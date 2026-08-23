import { expect, test } from 'bun:test'

// The exported handle prepares through bun:sqlite's statement cache, so two
// call sites sharing one SQL string share one statement. Interleaving them must
// still read and write correctly.
test('cached statements stay correct when the same SQL is reused', async () => {
  process.env.SWEAT_DATABASE_PATH = ':memory:'
  const { sqlite } = await import('#/lib/database')
  sqlite.prepare('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER)').run()

  const insert = 'INSERT INTO t (id, n) VALUES (?, ?)'
  const select = 'SELECT n FROM t WHERE id = ?'
  sqlite.prepare(insert).run('a', 1)
  expect(sqlite.prepare(select).get('a')).toEqual({ n: 1 })

  // Second reader of the same SQL, obtained before the first is done with.
  const reader = sqlite.prepare(select)
  sqlite.prepare(insert).run('b', 2)
  expect(sqlite.prepare(select).get('b')).toEqual({ n: 2 })
  expect(reader.get('a')).toEqual({ n: 1 })

  expect(
    sqlite.transaction(() => {
      sqlite.prepare(insert).run('c', 3)
      return sqlite.prepare(select).get('c')
    })(),
  ).toEqual({ n: 3 })
})
