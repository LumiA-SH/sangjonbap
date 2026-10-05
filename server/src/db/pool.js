import pg from 'pg';
import fs from 'node:fs';

export function createPool(config) {
  const url = new URL(config.databaseUrl);

  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) {
    url.searchParams.delete(key);
  }

  const pool = new pg.Pool({
    connectionString: url.toString(),
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,

    ssl: config.caPath
        ? {
          rejectUnauthorized: true,
          ca: fs.readFileSync(config.caPath, 'utf8')
        }
        : {
      //TODO: 개발용, 배포 전 인증서 검증 필
          rejectUnauthorized: false
        }
  });

  pool.on('error', () => console.error('Database pool connection failed'));

  return pool;
}