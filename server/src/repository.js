import {createPublicContentRepository} from './modules/public-content/repository.js';
import {createInteractionRepository} from './modules/character/interactions.js';
import {createDonationRepository} from './modules/character/donation.js';
import {createBattleRepository} from './modules/battle/repository.js';
import {createPostgresRepository} from './modules/character/repository.js';
import {createInventoryRepository} from './modules/inventory/repository.js';
import {createInvestigationRepository} from './modules/investigation/repository.js';
import {createCharacterCareRepository} from './modules/character/care-repository.js';
import {createDevRepository} from './modules/dev/repository.js';
import {createShopRepository} from './modules/shop/repository.js';
import {createCookingRepository} from './modules/cooking/repository.js';
import {createGachaRepository} from './modules/gacha/repository.js';
import {createAdminRepository} from './modules/admin/repository.js';
import {createTrainingRepository} from './modules/training/repository.js';
import {createBloodPackRepository} from './modules/inventory/blood-pack.js';
import {createOAuthRepository} from './modules/auth/oauth-repository.js';
import {createDailyRecovery} from './modules/daily/recovery.js';
import {createRecordsRepository} from './modules/records/repository.js';

// Factory only: no connections, listeners or schedulers are started here.
export function createGameRepository(pool) {
    const characterRepository = createPostgresRepository(pool);
    const inventoryRepository = createInventoryRepository(pool);
    const battleRepository = createBattleRepository(pool);

    return {
        ...createOAuthRepository(pool),
        ...createPublicContentRepository(pool),
        recoverDailyReset:createDailyRecovery(pool),
        ...createTrainingRepository(pool),
        ...createBloodPackRepository(pool),
        ...characterRepository,
        ...createDevRepository(pool),
        ...createRecordsRepository(pool),
        ...createShopRepository(pool),
        ...createCookingRepository(pool),
        ...createGachaRepository(pool),
        ...createAdminRepository(pool),
        ...createCharacterCareRepository(pool),
        ...createDonationRepository(pool),
        ...createInteractionRepository(pool),
        ...inventoryRepository,
        ...battleRepository,
        ...createInvestigationRepository(pool,{battleRepository})
    };
}
