import {loadEdgeConfig} from './config/edge.js';
import {createEdgePool} from './db/edge-pool.js';
import {createGameRepository} from './repository.js';
import {createApp} from './app.js';

export function createEdgeApi(env, {poolFactory=createEdgePool}={}) {
    const config = loadEdgeConfig(env);
    const pool = poolFactory(config);
    const repository = createGameRepository(pool);
    // No startup queries or schedulers. The gateway preserves the /api prefix.
    const app = createApp(config, repository);
    return {app, pool, repository, config};
}
