import pg from 'pg';

// Separate from the unchanged local pool/TLS settings. Connections are lazy.
export function createEdgePool(config) {
    const url = new URL(config.databaseUrl);
    for (const key of ['ssl','sslmode','sslcert','sslkey','sslrootcert']) url.searchParams.delete(key);
    const pool = new pg.Pool({connectionString:url.toString(),max:1,
        connectionTimeoutMillis:10000,idleTimeoutMillis:5000,statement_timeout:10000,
        ssl:{rejectUnauthorized:true,...(config.databaseCa ? {ca:config.databaseCa} : {})}});
    pool.on('error', () => console.error('Edge database pool connection failed'));
    return pool;
}
