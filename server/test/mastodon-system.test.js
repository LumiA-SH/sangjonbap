import test from 'node:test';
import assert from 'node:assert/strict';
import {events, messageFor, enqueueSystemEvent} from '../src/modules/mastodon-system/outbox.js';
import {sendSystemPost} from '../src/modules/mastodon-system/sender.js';
test('all required event messages, missing values and lengths', () => {
    for (const type of events) assert.ok(messageFor(type, {provider: '제공자', quantity: '1', character: '러너', area: '구역', monster: '마물', clue: '단서', reward: '상품', rp: 'RP 문구', progress:'50',result:'42'}));
    assert.throws(() => messageFor('death', {})); assert.throws(() => messageFor('death', {character: 'a'.repeat(501)}));
    assert.throws(() => messageFor('unknown', {}));
});
test('disabled policy never inserts; enabled policy snapshots message and deterministic key', async () => {
    const calls = []; let enabled = false;
    const client = {query: async (q, p) => {calls.push([q, p]); return {rows: [{config_value: {events: {death: {enabled, visibility: 'unlisted', template: '{character} 사망'}}}}]};}};
    const event = {type: 'death', key: 'death:1:2', values: {character: '러너'}};
    assert.equal(await enqueueSystemEvent(client, event), false); assert.equal(calls.length, 1);
    enabled = true; await enqueueSystemEvent(client, event); const first = calls.at(-1); await enqueueSystemEvent(client, event);
    assert.deepEqual(first, calls.at(-1)); assert.match(first[0], /on conflict/);
});
const env = {MASTODON_SYSTEM_POSTING_ENABLED: 'true', MASTODON_SYSTEM_ACCESS_TOKEN: 'fake-test-token', MASTODON_SYSTEM_ACCOUNT_ID: '123'};
const identity = () => new Response(JSON.stringify({id: '123', username: 'System'}), {status: 200});
function fixture() {const finishes = []; let claimed = 0; return {finishes, get claimed() {return claimed;}, outbox: {claim: async () => {claimed++; return {id: '1', dedupe_key: 'stable', message: 'RP', visibility: 'unlisted', lease_token: 'lease'};}, finish: async (...args) => finishes.push(args)}};}
test('HOLD and missing config never call external API', async () => {
    const fetcher = () => assert.fail('must not call'); assert.deepEqual(await sendSystemPost({}, {}, {fetcher}), {state: 'HOLD'});
    await assert.rejects(sendSystemPost({}, {MASTODON_SYSTEM_POSTING_ENABLED: 'true'}, {fetcher}), /SETTINGS/);
});
test('wrong account rejected before claim', async () => {
    const f = fixture(); await assert.rejects(sendSystemPost(f.outbox, env, {fetcher: async () => new Response('{"id":"9","username":"other"}')}), /UNVERIFIED/); assert.equal(f.claimed, 0);
});
test('success sends only system bearer, fixed host, idempotency header and stores ID', async () => {
    const f = fixture(), calls = [];
    const result = await sendSystemPost(f.outbox, env, {fetcher: async (url, options) => {calls.push({url, options}); return calls.length === 1 ? identity() : new Response('{"id":"456"}');}});
    assert.equal(result.state, 'SENT'); assert.equal(calls[1].url, 'https://survival-bob.site/api/v1/statuses');
    assert.equal(calls[1].options.headers['Idempotency-Key'], 'stable'); assert.equal(f.finishes[0][1].remoteId, '456');
});
for (const status of [401, 403, 429, 500]) test('HTTP ' + status + ' is not recorded as success', async () => {
    const f = fixture(); let n = 0;
    const result = await sendSystemPost(f.outbox, env, {fetcher: async () => ++n === 1 ? identity() : new Response('private internal body', {status})});
    assert.equal(result.state, 'FAILED'); assert.equal(f.finishes[0][1].retry === true, status === 429);
    assert.ok(!JSON.stringify(f.finishes).includes('private internal body'));
});
test('lost response stops automatic retry', async () => {
    const f = fixture(); let n = 0; await sendSystemPost(f.outbox, env, {fetcher: async () => {if (++n === 1) return identity(); throw Error('secret upstream details');}});
    assert.equal(f.finishes[0][1].error, 'DELIVERY_UNCERTAIN'); assert.ok(!f.finishes[0][1].retry);
});
import {enqueueProgressEvents,createSystemPostJob} from '../src/modules/mastodon-system/jobs.js';
import {createOperatingPolicyRepository,policyDefaults} from '../src/modules/admin/operating-policy.js';

test('templates neutralize HTML and mentions; variables are event-specific',()=>{
 assert.equal(messageFor('death',{character:'<b>@runner</b>'}),'＠runner 사망');
 assert.throws(()=>messageFor('death',{rp:'secret'},'{rp}'));
 assert.equal(messageFor('dice',{character:'러너',result:'42'}),'러너의 결과는 42입니다.');
});
test('progress only emits crossed configured area thresholds',async()=>{
 const inserts=[];const policy={enabled:true,visibility:'unlisted',thresholds:[25,50,100],template:'{area} {progress}%'};
 const c={query:async(q,p)=>{if(q.startsWith('insert')){inserts.push(p);return {rows:[]};}return {rows:[{config_value:{events:{investigation_progress:policy}}}]};}};
 await enqueueProgressEvents(c,{id:'3',name:'구역'},{id:'2',name:'러너'},24,60);
 assert.equal(inserts.length,2);assert.equal(inserts[0][2],'구역 25%');assert.equal(inserts[1][2],'구역 50%');
 await enqueueProgressEvents(c,{id:'3',name:'구역'},{id:'2',name:'러너'},60,60);assert.equal(inserts.length,2);
});
test('posting job HOLD performs no SQL or external requests',async()=>{
 const fail=()=>assert.fail('must not execute');assert.deepEqual(await createSystemPostJob({connect:fail,query:fail},{},{fetcher:fail})(),{state:'HOLD'});
});
test('policy saves reject unconnected story/raid and unsupported retry/dedupe before SQL',async()=>{
 const repo=createOperatingPolicyRepository({connect:()=>assert.fail('must reject before SQL')});
 for(const [name,patch,code] of [['story',{},'POST_EVENT_NOT_READY'],['raid',{},'POST_EVENT_NOT_READY'],['death',{deduplicate:false},'POST_DEDUPE_REQUIRED'],['death',{retryEnabled:true,maxAttempts:4,retryMinutes:5},'POST_RETRY_LIMIT'],['death',{template:'{rp}'},'INVALID_POST_TEMPLATE']]){
  const settings=structuredClone(policyDefaults.announcements);Object.assign(settings.events[name],{enabled:true,template:'알림',visibility:'unlisted'},patch);
  await assert.rejects(repo.saveOperatingPolicy('1','announcements',{settings,before:settings,requestKey:'12345678-1234-4234-8234-123456789012'}),e=>e.code===code);
 }
});
test('rate-limit reset timestamp sets a bounded retry instead of immediate send',async()=>{
 const f=fixture();let n=0;await sendSystemPost(f.outbox,env,{fetcher:async()=>++n===1?identity():new Response('',{status:429,headers:{'X-RateLimit-Reset':new Date(Date.now()+600000).toISOString()}})});
 assert.equal(f.finishes[0][1].retry,true);assert.ok(f.finishes[0][1].delay>=599&&f.finishes[0][1].delay<=600);
});
