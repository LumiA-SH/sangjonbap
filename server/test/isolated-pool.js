import fs from 'node:fs';
import pg from 'pg';

export function createIsolatedPool() {
    const file=process.env.ISOLATED_PG_CONFIG;
    if(!file)throw new Error('ISOLATED_PG_CONFIG is required; no application DB fallback');
    const config=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
    if(config.host!=='127.0.0.1'||Number(config.port)!==55432||config.database!=='sangjonbap_test'||config.ssl!==false)
        throw new Error('Only 127.0.0.1:55432/sangjonbap_test is authorized');
    return new pg.Pool({...config,max:10,connectionTimeoutMillis:5000,statement_timeout:15000});
}
