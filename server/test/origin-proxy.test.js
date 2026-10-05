import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import setupProxy from '../../frontend/src/setupProxy.js';
import {createApp} from '../src/app.js';
import {createMemoryRepository} from '../src/db/memory.js';

test('development proxy preserves Origin and login/session/character flow', async t => {
  const config={origin:'http://localhost:3000',loginKey:'test-only-passphrase',userId:'1',mode:'memory'};
  const observed=[];
  const backend=express();
  backend.use((req,res,next)=>{observed.push(req.headers.origin);next();});
  backend.use(createApp(config,createMemoryRepository()));
  async function listen(app) {
    const server=app.listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    return 'http://127.0.0.1:'+server.address().port;
  }
  const target=await listen(backend);
  const frontend=express();setupProxy(frontend,{target});
  const base=await listen(frontend);
  async function request(path,{origin=config.origin,key,token,headers={}}={}) {
    const response=await fetch(base+path,{method:key===undefined?'GET':'POST',headers:{Origin:origin,...(key===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{}),...headers},...(key===undefined?{}:{body:JSON.stringify({key})})});
    return {status:response.status,body:await response.json()};
  }
  const signed=await request('/api/auth/dev/login',{key:config.loginKey});
  assert.equal(signed.status,200);
  assert.equal(observed.at(-1),config.origin);
  const token=signed.body.data.token;
  const character=await request('/api/characters/me',{token});
  assert.equal(character.status,200);assert.equal(character.body.data.character.hp,100);
  assert.equal((await request('/api/characters/me')).status,401);
  assert.equal((await request('/api/auth/dev/login',{key:'wrong'})).status,401);
  for(const origin of ['https://evil.example','http://localhost:3001','http://127.0.0.1:3000',target,'null']) {
    const result=await request('/api/auth/dev/login',{origin,key:config.loginKey,headers:{'X-Forwarded-Host':'localhost:3000','X-Forwarded-Proto':'http'}});
    assert.equal(result.status,403,origin);assert.equal(result.body.error.code,'ORIGIN_DENIED');
    assert.equal(observed.at(-1),origin);
  }
  assert.equal((await fetch(base+'/apiary')).status,404);
  assert.equal((await fetch(base+'/not-api')).status,404);
});
