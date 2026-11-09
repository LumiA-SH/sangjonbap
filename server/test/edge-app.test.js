import test from 'node:test';
import assert from 'node:assert/strict';
import {createEdgeApi} from '../src/edge-app.js';
import {loadEdgeConfig} from '../src/config/edge.js';
import {createEdgePool} from '../src/db/edge-pool.js';

const env = {
    EDGE_PROJECT_REF:'grkohfxvafbquhmgnvwj',FRONTEND_ORIGIN:'https://survivalbob.site',
    PUBLIC_API_BASE_URL:'https://api.survivalbob.site/functions/v1/api',
    EDGE_DATABASE_URL:'postgresql://postgres.grkohfxvafbquhmgnvwj:fixture@fixture.pooler.supabase.com:6543/postgres',
    MASTODON_CLIENT_ID:'fixture',MASTODON_CLIENT_SECRET:'fixture'
};

test('Edge config isolates local auth and derives a fixed trusted callback', () => {
    const config=loadEdgeConfig({...env,AUTH_PROVIDER:'dev',NODE_ENV:'development'});
    assert.equal(config.provider,'mastodon');
    assert.equal(config.nodeEnv,'production');
    assert.equal(config.oauthRedirect,'https://api.survivalbob.site/functions/v1/api/auth/mastodon/callback');
    for (const patch of [{PUBLIC_API_BASE_URL:'https://evil.example/functions/v1/api'},
        {PUBLIC_API_BASE_URL:env.PUBLIC_API_BASE_URL+'?redirect=bad'},
        {EDGE_DATABASE_URL:env.EDGE_DATABASE_URL.replace(':6543',':5432')},
        {EDGE_DATABASE_URL:env.EDGE_DATABASE_URL.replace('postgres.grkohfxvafbquhmgnvwj','postgres.other')},
        {MASTODON_CLIENT_SECRET:''},{FRONTEND_ORIGIN:'https://evil.example'}]) {
        assert.throws(()=>loadEdgeConfig({...env,...patch}));
    }
});

test('Edge pool remains lazy, small and certificate-verified', async () => {
    const pool=createEdgePool(loadEdgeConfig({...env,EDGE_DATABASE_URL:env.EDGE_DATABASE_URL+'?ssl=false&sslmode=disable'}));
    assert.equal(pool.totalCount,0);
    assert.equal(pool.options.max,1);
    assert.equal(pool.options.ssl.rejectUnauthorized,true);
    assert.equal(new URL(pool.options.connectionString).search,'');
    await pool.end();
});

test('Edge assembled API: health, credentials CORS, route auth before any DB activity', async t => {
    let calls=0;
    const fail=()=>{calls++;throw new Error('No real game or database action allowed');};
    const {app,repository}=createEdgeApi(env,{poolFactory:()=>({query:fail,connect:fail})});
    for (const name of ['recoverDailyReset','expireBattles','getCharacter']) assert.equal(typeof repository[name],'function');
    const registered=[];
    function inspect(stack) {
        for (const layer of stack) {
            if (layer.route) registered.push(layer.route.path);
            if (layer.handle?.stack) inspect(layer.handle.stack);
        }
    }
    inspect(app.router.stack);
    for (const path of ['/api/health','/areas','/products','/catalog','/current','/:id/commands',
        '/recipes/:recipeId/cook','/foods/:itemId/eat']) assert.ok(registered.includes(path),path);
    const server=app.listen(0,'127.0.0.1');
    await new Promise(r=>server.once('listening',r));
    t.after(()=>new Promise(r=>server.close(r)));
    const base=`http://127.0.0.1:${server.address().port}`;
    const health=await fetch(base+'/api/health',{headers:{Origin:env.FRONTEND_ORIGIN}});
    assert.equal(health.status,200);
    assert.equal((await health.json()).data.mode,'supabase');
    assert.equal(health.headers.get('access-control-allow-origin'),env.FRONTEND_ORIGIN);
    assert.equal(health.headers.get('access-control-allow-credentials'),'true');
    const preflight=await fetch(base+'/api/cooking/catalog',{method:'OPTIONS',headers:{Origin:env.FRONTEND_ORIGIN,
        'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'content-type'}});
    assert.equal(preflight.status,204);
    const denied=await fetch(base+'/api/health',{headers:{Origin:'https://evil.example'}});
    assert.equal(denied.status,403);
    assert.equal(denied.headers.get('access-control-allow-origin'),null);
    await denied.text();
    for (const path of ['/api/characters/me','/api/inventory','/api/investigation/areas','/api/shop/products',
        '/api/cooking/catalog','/api/gacha/catalog','/api/battles/current','/api/admin/items']) {
        const result=await fetch(base+path,{headers:{Origin:env.FRONTEND_ORIGIN}});
        assert.equal(result.status,401,path);
        assert.equal((await result.json()).error.code,'UNAUTHORIZED');
    }
    assert.equal(calls,0,'No scheduler, recovery, OAuth or game SQL should execute');
});

test('registered legacy callback can be kept without changing API base or allowing arbitrary redirects',()=>{
 const legacy='https://survivalbob.site/api/auth/mastodon/callback';
 const config=loadEdgeConfig({...env,MASTODON_REDIRECT_URI:legacy});
 assert.equal(config.oauthRedirect,legacy);
 assert.equal(config.apiBase,env.PUBLIC_API_BASE_URL);
 for(const value of ['https://evil.example/callback',legacy+'?next=bad',legacy+'/',legacy.replace('https:','http:')])assert.throws(()=>loadEdgeConfig({...env,MASTODON_REDIRECT_URI:value}));
});
