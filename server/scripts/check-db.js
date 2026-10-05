import {loadConfig} from '../src/config/env.js';
import {createPool} from '../src/db/pool.js';
import {createPostgresRepository} from '../src/modules/character/repository.js';
const config=loadConfig();
if(config.mode!=='supabase')throw new Error('Set DATA_MODE=supabase before db:check.');
const pool=createPool(config);
try{console.log(await createPostgresRepository(pool).check());}catch{console.error('Connection/schema check failed. Verify URI, password, network, trusted CA and permissions.');process.exitCode=1;}finally{await pool.end();}