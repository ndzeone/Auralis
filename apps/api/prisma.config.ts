import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';

class MigrationPg extends PrismaPg {
  override async connect() {
    const adapter = await super.connect();
    const queryRaw = adapter.queryRaw.bind(adapter);
    adapter.queryRaw = (query) => queryRaw({
      ...query,
      // Prisma 6.19's JS migration engine reads PostgreSQL catalog `name`
      // columns, but adapter-pg does not map OID 19. Cast the two catalog
      // identifiers to equivalent text before the adapter decodes the result.
      sql: query.sql
        .replace(/\btbl\.relname AS table_name\b/g, 'tbl.relname::text AS table_name')
        .replace(/\bnamespace\.nspname AS table_namespace\b/g, 'namespace.nspname::text AS table_namespace'),
    });
    return adapter;
  }
}

// Prisma 6.19 query compiler is GA. The JS migration adapter is opt-in in this
// Prisma release; it avoids platform-specific Rust engine downloads in CI/cloud.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  experimental: { adapter: true },
  engine: 'js',
  adapter: async () => new MigrationPg({ connectionString: process.env.DATABASE_URL ?? 'postgresql://auralis:auralis_local_only@localhost:5432/auralis' }),
});
