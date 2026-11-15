import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecordsRepository, playerActionRecord} from '../src/modules/records/repository.js';
import {recordsPage, recordsCursor} from '../src/modules/records/routes.js';
import {createApp} from '../src/app.js';

test('historical gacha logs cannot reveal weights or candidate lists to players', () => {
    const stored = {id: '1', category: 'GACHA', detail: {price: 1, totalWeight: 10, candidates: [{weight: 5}], reward: {itemId: '7', quantity: 1, weight: 5, probability: 50}}};
    assert.deepEqual(playerActionRecord(stored).detail, {price: 1, reward: {itemId: '7', quantity: 1}});
    assert.equal(stored.detail.reward.weight, 5);
});

test('records queries are read-only, scoped, bounded and do not expose undiscovered clues', async () => {
    const calls = [];
    const repo = createRecordsRepository({async query(sql, params) {calls.push({sql, params}); return {rows: []};} });
    await repo.getActionRecords('7', '20');
    await repo.getActionRecords('7', null, true);
    await repo.getAdminActionRecords('7', '19');
    await repo.getDiscoveryRecords('7');
    await repo.getClueRecords('7', '4');
    for (const {sql} of calls) {
        assert.match(sql, /^select /); assert.match(sql, /limit 31/);
        assert.doesNotMatch(sql, /token|mastodon_account_id|password|for update|insert|delete/);
    }
    assert.match(calls[0].sql, /u.id=\$1 and u.is_active and c.is_active/);
    assert.match(calls[0].sql, /order by l.created_at desc,l.id desc/);
    assert.deepEqual(calls[1].params, ['7', null, true]);
    assert.match(calls[2].sql, /role='ADMIN'/);
    assert.match(calls[3].sql, /from public.unique_discovery d/);
    assert.match(calls[4].sql, /cl.is_discovered=true/);
    assert.match(calls[4].sql, /u.id=\$1 and u.is_active and own.is_active/);
    assert.doesNotMatch(calls[4].sql, /status='ALIVE'/);
});

test('record pagination rejects client-selected identity and provides a bounded next cursor', () => {
    for (const query of [{userId: '2'}, {characterId: '2'}, {before: '0'}, {before: ['1']}, {before: '9223372036854775808'}]) assert.throws(() => recordsCursor(query));
    assert.equal(recordsCursor({before: '9007199254740993'}), '9007199254740993');
    assert.equal(recordsCursor({}), null);
    const rows = Array.from({length: 31}, (_, i) => ({id: String(100 - i)}));
    assert.equal(recordsPage(rows).records.length, 30);
    assert.equal(recordsPage(rows).nextBefore, '71');
    assert.equal(recordsPage(rows.slice(0, 30)).nextBefore, null);
});

test('production cookie auth permits own records, blocks unlinked users and non-admin full logs', async t => {
    let user = {id: '7', character_id: '10', role: 'USER', is_active: true};
    const calls = [];
    const repo = {
        getOAuthSession: async () => user,
        getAdminLogCategories: async()=>[],
        getSystemFeed: async(kind,before)=>({enabled:true,records:[],nextBefore:null,kind}),
        listAdminRecords: async () => [], getAdminRecord: async () => ({}), saveAdminRecord: async () => ({})
    };
    for (const name of ['getActionRecords', 'getClueRecords', 'getDiscoveryRecords', 'getAdminActionRecords']) {
        repo[name] = async (...args) => {calls.push({name, args}); return [{id: '5'}];};
    }
    const config = {provider: 'mastodon', nodeEnv: 'production', origin: 'https://survivalbob.site'};
    const server = createApp(config, repo).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const get = (path, auth = true) => fetch(base + path, {headers: auth ? {Cookie: '__Host-sangjonbap-session=' + 'a'.repeat(64)} : {}});
    assert.equal((await get('/public/system-feed?kind=notice',false)).status,200);
    assert.equal((await get('/public/system-feed?accountId=other',false)).status,400);
    assert.equal((await get('/records/clues', false)).status, 401);
    assert.equal((await get('/records/action-logs?requestKey=12345678-1234-4234-8234-123456789012', false)).status, 401);
    assert.equal((await get('/records/action-logs')).status, 200);
    assert.deepEqual(calls[0], {name: 'getActionRecords', args: ['7', null, false]});
    assert.equal((await get('/records/investigations?before=9')).status, 200);
    assert.deepEqual(calls[1].args, ['7', '9', true]);
    assert.equal((await get('/records/clues?userId=2')).status, 400);
    assert.equal((await get('/admin/action-logs')).status, 403);
    assert.equal((await get('/dev/action-logs')).status, 404);
    assert.equal((await get('/records/action-logs?requestKey=12345678-1234-4234-8234-123456789012&userId=8')).status, 400);
    assert.equal((await get('/records/action-logs?requestKey=12345678-1234-4234-8234-123456789012')).status, 200); assert.deepEqual(calls.at(-1).args, ['7', null, false, '12345678-1234-4234-8234-123456789012']);
    user = {...user, character_id: null};
    assert.equal((await get('/records/clues')).status, 403);
    user = {...user, role: 'ADMIN'};
    assert.equal((await get('/admin/action-logs?before=9')).status, 200);
    assert.deepEqual(calls.at(-1), {name: 'getAdminActionRecords', args: ['7', '9', null, '']});
    assert.equal((await get('/admin/action-logs?category=COOKING&q=요리&before=9')).status,200);
    assert.deepEqual(calls.at(-1).args,['7','9','COOKING','요리']);
    assert.equal((await get('/admin/action-logs?category=bad')).status,400);
    assert.equal((await get('/admin/action-logs?q=a&q=b')).status,400);
    assert.equal((await get('/admin/action-logs?userId=8')).status,400);
    user = {...user, role: 'USER'};
    assert.equal((await get('/admin/action-logs')).status, 403);
});

test('request key filtering remains scoped to session owner', async () => {
    let query, params; await createRecordsRepository({query: async (q, p) => {query = q; params = p; return {rows: []};}}).getActionRecords('7', null, false, '12345678-1234-4234-8234-123456789012'); assert.match(query, /u.id=\$1 and u.is_active and c.is_active/); assert.match(query, /l.request_key=\$4::uuid/); assert.deepEqual(params, ['7', null, false, '12345678-1234-4234-8234-123456789012']);
});
import {createSystemFeedRepository,postText} from '../src/modules/public-content/system-feed.js';
const homepagePolicy=()=>({enabled:true,accountId:'123',noticeTag:'공지',eventTag:'이벤트',limit:3,publicOnly:true,excludeReplies:true,excludeBoosts:true});
const statusPost=(id,extra={})=>({id,account:{id:'123'},visibility:'public',content:'<p>소식 &amp; 안내</p>',created_at:'2026-11-15T00:00:00Z',tags:[{name:'공지'}],...extra});
function feedFixture(policy=homepagePolicy(),rows=[statusPost('9')]){
 const calls=[];const pool={async query(sql){assert.match(sql,/^select /);return {rows:[{config_value:policy}]};}};
 const fetcher=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(url.includes('/statuses?')?rows:{id:'123',username:'System',acct:'System'}),{status:200});};
 return {repo:createSystemFeedRepository(pool,{fetcher}),calls,policy};
}
test('System feed respects disabled policy without external requests and validates query',async()=>{
 const {repo,calls}=feedFixture({...homepagePolicy(),enabled:false});assert.deepEqual(await repo.getSystemFeed(),{enabled:false,records:[],nextBefore:null});assert.equal(calls.length,0);
 await assert.rejects(repo.getSystemFeed('private'),{code:'INVALID_FEED_QUERY'});await assert.rejects(repo.getSystemFeed('activity','../secrets'),{code:'INVALID_FEED_QUERY'});
});
test('System feed shares cache, filters tags/visibility/replies/boosts and never sends OAuth tokens',async()=>{
 const {repo,calls,policy}=feedFixture(homepagePolicy(),[statusPost('9'),statusPost('8',{visibility:'private'}),statusPost('7',{visibility:'unlisted'}),statusPost('6',{tags:[{name:'이벤트'}]}),statusPost('5',{in_reply_to_id:'1'}),statusPost('4',{reblog:statusPost('2')}),statusPost('3',{account:{id:'999'}})]);
 const [a,n,e]=await Promise.all([repo.getSystemFeed(),repo.getSystemFeed('notice'),repo.getSystemFeed('event')]);assert.deepEqual(a.records.map(r=>r.id),['9','6']);assert.deepEqual(n.records.map(r=>r.id),['9']);assert.deepEqual(e.records.map(r=>r.id),['6']);assert.equal(calls.length,2);
 assert.deepEqual(Object.keys(a.records[0]).sort(),['id','text','warning','createdAt','url','boosted'].sort());assert.equal(a.records[0].text,'소식 & 안내');assert.ok(calls.every(c=>!c.options.headers.Authorization&&c.options.redirect==='error'&&c.url.startsWith('https://survival-bob.site/')));
 policy.publicOnly=false;assert.ok((await repo.getSystemFeed()).records.some(r=>r.id==='7'));
 policy.enabled=false;assert.equal((await repo.getSystemFeed()).records.length,0);
});
test('System feed pagination preserves filtered remainder and private boosted posts stay hidden',async()=>{
 const policy={...homepagePolicy(),limit:1,excludeBoosts:false,publicOnly:false};const {repo}=feedFixture(policy,[statusPost('9'),statusPost('8'),statusPost('7',{reblog:statusPost('2',{visibility:'direct'})})]);const r=await repo.getSystemFeed();assert.equal(r.nextBefore,'9');assert.deepEqual((await repo.getSystemFeed('activity','9')).records.map(x=>x.id),['8']);
 assert.equal(postText('<script>secret()</script><p>&lt;img onerror=x&gt;<br>본문</p>'),'<img onerror=x>\n본문');
});
test('System feed fails closed for wrong account, upstream failures and throttles retries',async()=>{
 for(const mode of ['wrong','429','network','invalid']){let calls=0;const repo=createSystemFeedRepository({async query(){return {rows:[{config_value:homepagePolicy()}]};}},{fetcher:async()=>{calls++;if(mode==='network')throw Error('internal secret');if(mode==='429')return new Response('',{status:429,headers:{'retry-after':'60'}});if(mode==='invalid')return new Response('not json');return new Response(JSON.stringify({id:'123',username:'runner',acct:'runner'}));}});
 await assert.rejects(repo.getSystemFeed(),{code:'SYSTEM_FEED_UNAVAILABLE'});await assert.rejects(repo.getSystemFeed(),{code:'SYSTEM_FEED_UNAVAILABLE'});assert.equal(calls,1);}
});
test('System feed uses only System credentials, verifies the owner and reports read permission failures safely',async()=>{
 const calls=[],env={MASTODON_SYSTEM_ACCESS_TOKEN:'fake-system-token',MASTODON_SYSTEM_ACCOUNT_ID:'123',MASTODON_CLIENT_SECRET:'never-use-login-secret'};
 const repo=createSystemFeedRepository({async query(){return {rows:[{config_value:homepagePolicy()}]};}},{env,fetcher:async(url,options)=>{calls.push({url,options});return url.endsWith('verify_credentials')?new Response(JSON.stringify({id:'123',username:'System',acct:'System'})):new Response('',{status:403});}});
 await assert.rejects(repo.getSystemFeed(),e=>e.code==='SYSTEM_FEED_AUTH_REQUIRED'&&!e.message.includes('token'));
 assert.equal(calls.length,2);assert.ok(calls.every(c=>c.options.headers.Authorization==='Bearer fake-system-token'&&!JSON.stringify(c).includes('never-use-login-secret')));
});
