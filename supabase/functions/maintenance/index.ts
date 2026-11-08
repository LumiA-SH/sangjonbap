import {createDailyRecovery} from '../../../server/src/modules/daily/recovery.js';
import {createBattleRepository} from '../../../server/src/modules/battle/repository.js';
import {createEdgePool} from '../../../server/src/db/edge-pool.js';
import {loadEdgeConfig} from '../../../server/src/config/edge.js';
import {createMaintenanceApp} from '../../../server/src/modules/maintenance/app.js';

const env=Deno.env.toObject();
// Only validate/reuse the existing connection settings. No OAuth routes or sessions.
const config=loadEdgeConfig({...env,MASTODON_CLIENT_ID:'MAINTENANCE_DISABLED',MASTODON_CLIENT_SECRET:'MAINTENANCE_DISABLED'});
const pool=createEdgePool(config);
const battle=createBattleRepository(pool);
const app=createMaintenanceApp({recoverDailyReset:createDailyRecovery(pool),expireBattles:battle.expireBattles},
    {secret:env.MAINTENANCE_SECRET,executionReady:false});
// Intentionally fail closed until all gameplay transactions share a proven barrier.
// No environment switch can activate maintenance in this draft.
app.listen(8000);
