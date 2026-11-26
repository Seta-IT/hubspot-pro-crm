import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabaseUrl, useDirectDatabaseUrlForMigrations } from '../src/db/postgres';

test('app usa DATABASE_URL (pooled) e migracoes usam DATABASE_URL_UNPOOLED (direta)', () => {
  const saved = { a: process.env.DATABASE_URL, b: process.env.DATABASE_URL_UNPOOLED, c: process.env.DATABASE_POSTGRES_URL };
  try {
    process.env.DATABASE_URL = 'postgresql://u:p@ep-x-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require';
    process.env.DATABASE_URL_UNPOOLED = 'postgresql://u:p@ep-x.sa-east-1.aws.neon.tech/neondb?sslmode=require';
    delete process.env.DATABASE_POSTGRES_URL;
    assert.match(getDatabaseUrl() || '', /-pooler\./);
    useDirectDatabaseUrlForMigrations();
    assert.doesNotMatch(getDatabaseUrl() || '', /-pooler\./);
    delete process.env.DATABASE_URL_UNPOOLED;
    assert.match(getDatabaseUrl() || '', /-pooler\./, 'sem UNPOOLED, cai no DATABASE_URL');
  } finally {
    for (const [k, v] of [['DATABASE_URL', saved.a], ['DATABASE_URL_UNPOOLED', saved.b], ['DATABASE_POSTGRES_URL', saved.c]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
