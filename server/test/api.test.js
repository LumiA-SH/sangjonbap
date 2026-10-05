import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/app.js';
import {createMemoryRepository} from '../src/db/memory.js';
import {loadConfig} from '../src/config/env.js';
import {createSessions} from '../src/modules/auth/session.js';
import {createPostgresRepository} from '../src/modules/character/repository.js';

const config={mode:'memory',origin:'http://localhost:3000',loginKey:'test-only-passphrase',userId:'1'};
async function fixture(t,repository=createMemoryRepository()){
  const server=createApp(config,repository).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  async function request(path,{body,token,method='GET',headers={}}={}){
    const res=await fetch(base+'/api'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
    return {status:res.status,...await res.json()};
  }
  const login=()=>request('/auth/dev/login',{method:'POST',body:{key:config.loginKey}});
  return {request,login};
}
test('login, own character update, protected state, logout revocation',async t=>{
  const {request,login}=await fixture(t);
  assert.equal((await request('/characters/me')).status,401);
  assert.equal((await request('/auth/dev/login',{method:'POST',body:{key:'wrong'}})).status,401);
  const signed=await login();assert.equal(signed.status,200);const token=signed.data.token;
  assert.equal((await request('/auth/me',{token})).data.user.id,'1');
  assert.equal((await request('/characters/me',{token})).data.character.hp,100);
  const saved=await request('/characters/me/profile',{token,method:'PATCH',body:{name:'새 생존자'}});
  assert.equal(saved.data.character.name,'새 생존자');
  for(const body of [{name:'x',hp:999},{currency:1000},{name:'x',id:'2'},{name:' '},{name:'x'.repeat(41)}])assert.equal((await request('/characters/me/profile',{token,method:'PATCH',body})).status,400);
  assert.equal((await request('/characters/2',{token})).status,404);
  assert.equal((await request('/auth/logout',{token,method:'POST'})).status,200);
  assert.equal((await request('/characters/me',{token})).status,401);
});
test('request body cannot choose another user; foreign origins rejected',async t=>{
  const {request}=await fixture(t);
  const login=await request('/auth/dev/login',{method:'POST',body:{key:config.loginKey,userId:'2',role:'ADMIN'}});
  assert.equal(login.data.user.id,'1');assert.equal(login.data.user.role,'USER');
  assert.equal((await request('/health',{headers:{Origin:'https://evil.example'}})).status,403);
});
test('missing character and inactive account',async t=>{
  const repo=createMemoryRepository();repo.getCharacter=async()=>null;
  const {request,login}=await fixture(t,repo);const token=(await login()).data.token;
  assert.equal((await request('/characters/me',{token})).status,404);
  repo.getUser=async()=>({id:'1',is_active:false});
  assert.equal((await request('/characters/me',{token})).status,401);
  assert.equal((await login()).status,403);
});
test('malformed JSON uses common envelope',async t=>{
  const server=createApp(config,createMemoryRepository()).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const res=await fetch('http://127.0.0.1:'+server.address().port+'/api/auth/dev/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});
  assert.equal(res.status,400);const body=await res.json();assert.equal(body.error.code,'INVALID_JSON');assert.ok(body.requestId);
});
test('expired sessions rejected',async()=>{
  let now=0;const sessions=createSessions(createMemoryRepository(),{ttl:100,now:()=>now});
  const {token}=sessions.issue({id:'1'});now=101;
  await assert.rejects(sessions.require({headers:{authorization:'Bearer '+token}},{},()=>{}),e=>e.status===401);
});
test('dev production and nonlocal bind fail closed',()=>{
  assert.throws(()=>loadConfig({NODE_ENV:'production',DEV_LOGIN_KEY:config.loginKey}));
  assert.throws(()=>loadConfig({HOST:'0.0.0.0',DEV_LOGIN_KEY:config.loginKey}));
  assert.throws(()=>loadConfig({DEV_LOGIN_KEY:''}));
  assert.throws(()=>loadConfig({AUTH_PROVIDER:'mastodon',DEV_LOGIN_KEY:config.loginKey}));
});
test('database errors do not expose SQL or credentials',async t=>{
  const repo=createMemoryRepository();repo.getCharacter=async()=>{throw new Error('password=secret; select private');};
  const {request,login}=await fixture(t,repo);const token=(await login()).data.token;
  const result=await request('/characters/me',{token});assert.equal(result.status,500);assert.equal(JSON.stringify(result).includes('secret'),false);
});
test('repository binds ownership, commits success and rolls back write failure',async()=>{
  for(const failure of [false,true]){
    const calls=[];let released=false;
    const client={async query(sql,params){calls.push({sql,params});if(sql.startsWith('select'))return {rowCount:1,rows:[{id:'9007199254740993'}]};if(sql.startsWith('update')){if(failure)throw new Error('write failed');return {rows:[{id:'9007199254740993',name:'ok'}]};}return {};},release(){released=true;}};
    const repo=createPostgresRepository({connect:async()=>client});
    if(failure)await assert.rejects(repo.updateProfile('7',{name:'ok'}));else assert.equal((await repo.updateProfile('7',{name:'ok'})).id,'9007199254740993');
    assert.deepEqual(calls[1].params,['7']);assert.deepEqual(calls[2].params,['ok','9007199254740993']);assert.equal(calls.at(-1).sql,failure?'rollback':'commit');assert.equal(released,true);
  }
});
