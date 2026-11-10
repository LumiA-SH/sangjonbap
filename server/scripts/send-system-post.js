// Server-only manual worker. Does not load private files or run on application startup.
import pg from 'pg';
import {createSystemOutbox} from '../src/modules/mastodon-system/outbox.js';
import {sendSystemPost} from '../src/modules/mastodon-system/sender.js';
const env=process.env;
if(!process.argv.includes('--send')||env.MASTODON_SYSTEM_POSTING_ENABLED!=='true'){
  console.log('System posting HOLD: explicit --send and enabled server setting required.');
}else{
 let pool;
 try{
  // Dedicated process: do not import login credentials or change the application pool.
  if(!env.EDGE_DATABASE_URL)throw Error('EDGE_DATABASE_URL_REQUIRED');
  const url=new URL(env.EDGE_DATABASE_URL);
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname.endsWith('.pooler.supabase.com')||url.port!=='6543')throw Error('INVALID_SYSTEM_DATABASE');
  for(const key of ['ssl','sslmode','sslcert','sslkey','sslrootcert'])url.searchParams.delete(key);
  pool=new pg.Pool({connectionString:url.toString(),max:1,connectionTimeoutMillis:10000,statement_timeout:15000,
    ssl:{rejectUnauthorized:true,...(env.EDGE_DATABASE_CA?{ca:env.EDGE_DATABASE_CA}:{})}});
  console.log(JSON.stringify(await sendSystemPost(createSystemOutbox(pool),env)));
  }
  catch{console.error('System delivery failed; inspect protected outbox status.');process.exitCode=1;}
  finally{if(pool)await pool.end();}
}
