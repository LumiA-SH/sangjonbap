import {loadConfig} from './config/env.js';
import {createBattleRepository} from './modules/battle/repository.js';
import {startBattleExpiry} from './modules/battle/scheduler.js';
import {createPool} from './db/pool.js';
import {createMemoryRepository} from './db/memory.js';
import {createPostgresRepository} from './modules/character/repository.js';
import {createInventoryRepository} from './modules/inventory/repository.js';
import {createInvestigationRepository} from './modules/investigation/repository.js';
import {createCharacterCareRepository} from './modules/character/care-repository.js';
import {createDevRepository} from './modules/dev/repository.js';
import {createShopRepository} from './modules/shop/repository.js';
import {createCookingRepository} from './modules/cooking/repository.js';
import {createGachaRepository} from './modules/gacha/repository.js';
import {createAdminRepository} from './modules/admin/repository.js';
import {createApp} from './app.js';
import {createTrainingRepository} from './modules/training/repository.js';
import {createBloodPackRepository} from './modules/inventory/blood-pack.js';
import {createOAuthRepository} from './modules/auth/oauth-repository.js';
import {createDailyRecovery} from './modules/daily/recovery.js';
import {startDailyScheduler} from './modules/daily/scheduler.js';

const config = loadConfig();
const pool = config.mode === 'supabase' ? createPool(config) : null;

let repository;

if (pool) {
    const characterRepository = createPostgresRepository(pool);
    const inventoryRepository = createInventoryRepository(pool);
    const battleRepository = createBattleRepository(pool);

    repository = {
        ...createOAuthRepository(pool),
        recoverDailyReset:createDailyRecovery(pool),
        ...createTrainingRepository(pool),
        ...createBloodPackRepository(pool),
        ...characterRepository,
        ...createDevRepository(pool),
        ...createShopRepository(pool),
        ...createCookingRepository(pool),
        ...createGachaRepository(pool),
        ...createAdminRepository(pool),
        ...createCharacterCareRepository(pool),
        ...inventoryRepository,
        ...battleRepository,
        ...createInvestigationRepository(pool,{battleRepository})
    };
} else {
    repository = createMemoryRepository(config.userId);
}

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
