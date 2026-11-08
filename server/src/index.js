import {createGameRepository} from './repository.js';
import {loadConfig} from './config/env.js';
import {startBattleExpiry} from './modules/battle/scheduler.js';
import {createPool} from './db/pool.js';
import {createMemoryRepository} from './db/memory.js';
import {createApp} from './app.js';
import {startDailyScheduler} from './modules/daily/scheduler.js';

const config = loadConfig();
const pool = config.mode === 'supabase' ? createPool(config) : null;

const repository = pool ? createGameRepository(pool) : createMemoryRepository(config.userId);

await repository.check();

// Start-date NULL is a read-only HOLD; no operational baseline is invented.
// Log codes only, never DB connection details or query payloads.
let lastResetNotice=null;
const notice=code=>{if(code!==lastResetNotice){console.warn('Daily reset:',code);lastResetNotice=code;}};
const dailyScheduler=pool?startDailyScheduler(repository.recoverDailyReset,{
    onHold:notice,onError:error=>notice(error.code||'DAILY_RESET_FAILED')
}):null;
const battleScheduler=pool?startBattleExpiry(repository.expireBattles,{
    onError:error=>console.warn('Battle expiry:',error.code||'BATTLE_EXPIRY_FAILED')
}):null;

const server = createApp(config, repository).listen(
    config.port,
    config.host,
    () => {
        console.log('Sangjonbap API ready on port', config.port, 'mode:', config.mode);
    }
);

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        server.close(async () => {
            if (dailyScheduler) await dailyScheduler.stop();
            if (battleScheduler) await battleScheduler.stop();
            if (pool) await pool.end();
            process.exit(0);
        });
    });
}
