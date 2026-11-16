import {systemPostKey} from './modules/mastodon-system/outbox.js';
import {createDicePostWakeup,createEventPostJob,withSystemPostWakeup} from './modules/mastodon-system/jobs.js';
import {loadEdgeConfig} from './config/edge.js';
import {createEdgePool} from './db/edge-pool.js';
import {createGameRepository} from './repository.js';
import {createApp} from './app.js';

export function createEdgeApi(env, {poolFactory=createEdgePool,waitUntil=globalThis.EdgeRuntime?.waitUntil?.bind(globalThis.EdgeRuntime)}={}) {
    const config = loadEdgeConfig(env);
    const pool = poolFactory(config);
    const wake=createDicePostWakeup(createEventPostJob(pool,env),waitUntil);
    const gamePool=withSystemPostWakeup(pool,keys=>{for(const key of keys)wake(key);});
    const repository = createGameRepository(gamePool,{systemFeedEnv:env});
    repository.scheduleDicePost=key=>wake(systemPostKey('dice',key));
    // No startup queries or schedulers. The gateway preserves the /api prefix.
    const app = createApp(config, repository);
    return {app, pool, repository, config};
}
