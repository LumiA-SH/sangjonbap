import test from 'node:test';
import assert from 'node:assert/strict';
import {events,messageFor,enqueueSystemEvent} from '../src/modules/mastodon-system/outbox.js';
import {sendSystemPost} from '../src/modules/mastodon-system/sender.js';
test('all required event messages, missing values and lengths',()=>{
 for(const type of events)assert.ok(messageFor(type,{provider:'제공자',quantity:'1',character:'러너',area:'구역',monster:'마물',clue:'단서',reward:'상품',rp:'RP 문구'}));
 assert.throws(()=>messageFor('death',{}));assert.throws(()=>messageFor('death',{character:'a'.repeat(501)}));
 assert.throws(()=>messageFor('unknown',{}));
});
test('disabled policy never inserts; enabled policy snapshots message and deterministic key',async()=>{
 const calls=[];let enabled=false;
 const client={query:async(q,p)=>{calls.push([q,p]);return {rows:[{config_value:{events:{death:{enabled,visibility:'unlisted',template:'{character} 사망'}}}}]};}};
 const event={type:'death',key:'death:1:2',values:{character:'러너'}};
 assert.equal(await enqueueSystemEvent(client,event),false);assert.equal(calls.length,1);
 enabled=true;await enqueueSystemEvent(client,event);const first=calls.at(-1);await enqueueSystemEvent(client,event);
 assert.deepEqual(first,calls.at(-1));assert.match(first[0],/on conflict/);
});
const env={MASTODON_SYSTEM_POSTING_ENABLED:'true',MASTODON_SYSTEM_ACCESS_TOKEN:'fake-test-token',MASTODON_SYSTEM_ACCOUNT_ID:'123'};
const identity=()=>new Response(JSON.stringify({id:'123',username:'System'}),{status:200});
function fixture(){const finishes=[];let claimed=0;return {finishes,get claimed(){return claimed;},outbox:{claim:async()=>{claimed++;return {id:'1',dedupe_key:'stable',message:'RP',visibility:'unlisted',lease_token:'lease'};},finish:async(...args)=>finishes.push(args)}};}
test('HOLD and missing config never call external API',async()=>{
 const fetcher=()=>assert.fail('must not call');assert.deepEqual(await sendSystemPost({}, {},{fetcher}),{state:'HOLD'});
 await assert.rejects(sendSystemPost({}, {MASTODON_SYSTEM_POSTING_ENABLED:'true'},{fetcher}),/SETTINGS/);
});
test('wrong account rejected before claim',async()=>{
 const f=fixture();await assert.rejects(sendSystemPost(f.outbox,env,{fetcher:async()=>new Response('{"id":"9","username":"other"}')}),/UNVERIFIED/);assert.equal(f.claimed,0);
});
test('success sends only system bearer, fixed host, idempotency header and stores ID',async()=>{
 const f=fixture(),calls=[];
 const result=await sendSystemPost(f.outbox,env,{fetcher:async(url,options)=>{calls.push({url,options});return calls.length===1?identity():new Response('{"id":"456"}');}});
 assert.equal(result.state,'SENT');assert.equal(calls[1].url,'https://survival-bob.site/api/v1/statuses');
 assert.equal(calls[1].options.headers['Idempotency-Key'],'stable');assert.equal(f.finishes[0][1].remoteId,'456');
});
for(const status of [401,403,429,500])test('HTTP '+status+' is not recorded as success',async()=>{
 const f=fixture();let n=0;
 const result=await sendSystemPost(f.outbox,env,{fetcher:async()=>++n===1?identity():new Response('private internal body',{status})});
 assert.equal(result.state,'FAILED');assert.equal(f.finishes[0][1].retry===true,status===429);
 assert.ok(!JSON.stringify(f.finishes).includes('private internal body'));
});
test('lost response stops automatic retry',async()=>{
 const f=fixture();let n=0;await sendSystemPost(f.outbox,env,{fetcher:async()=>{if(++n===1)return identity();throw Error('secret upstream details');}});
 assert.equal(f.finishes[0][1].error,'DELIVERY_UNCERTAIN');assert.ok(!f.finishes[0][1].retry);
});
