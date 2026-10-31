import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/app.js';
import {createMemoryRepository} from '../src/db/memory.js';
import {createPostgresRepository} from '../src/modules/character/repository.js';
import {loadConfig} from '../src/config/env.js';
import {createPool} from '../src/db/pool.js';

test('search HTTP auth, query validation, safe shape, nullable profile and edit HOLD',async t=>{
    const repo=createMemoryRepository('1');
    const config={nodeEnv:'development',provider:'dev',userId:'1',loginKey:'dev-test-only-key',origin:'http://localhost:3000'};
    const server=createApp(config,repo).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    const base=`http://127.0.0.1:${server.address().port}/api`;
    assert.equal((await fetch(base+'/characters/search?q=test')).status,401);
    const login=await fetch(base+'/auth/dev/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:config.loginKey})});
    const headers={Authorization:`Bearer ${(await login.json()).data.token}`,'Content-Type':'application/json'};
    for(const query of ['', '?q=', '?q=a&q=b','?q=a&userId=2','?q='+ 'a'.repeat(41)]) assert.equal((await fetch(base+'/characters/search'+query,{headers})).status,400);
    const data=await (await fetch(base+'/characters/search?q='+encodeURIComponent('생존'),{headers})).json();
    assert.deepEqual(data.data.characters,[{id:'1',name:'개발 생존자'}]);
    assert.deepEqual((await (await fetch(base+'/characters/search?q=absent',{headers})).json()).data.characters,[]);
    const me=(await (await fetch(base+'/characters/me',{headers})).json()).data.character;
    for(const field of ['age','job','position','profile_url']) assert.equal(me[field],null);
    assert.equal((await fetch(base+'/characters/me/profile',{method:'PATCH',headers,body:JSON.stringify({age:'25'})})).status,400);
    repo.searchCharacters=async()=>{throw new Error('injected DB error');};
    const failure=await fetch(base+'/characters/search?q=a',{headers});assert.equal(failure.status,500);
    assert.equal(JSON.stringify(await failure.json()).includes('injected'),false);
});

test('PostgreSQL profile compatibility and duplicate-name literal substring search', {skip:process.env.RUN_PROFILE_DB_TESTS!=='1'},async()=>{
    const pool=createPool(loadConfig());const c=await pool.connect();
    try {
        await c.query('begin');const ids=[],users=[];const name=`DEV profile ${randomUUID()}`;
        for(let i=0;i<4;i++) {
            ids.push((await c.query("insert into public.game_character(name,hunter_grade,atk,def,agi) values ($1,'B',5,5,5) returning id",[name])).rows[0].id);
            users.push((await c.query("insert into public.auth_user(character_id,role) values ($1,'USER') returning id",[ids[i]])).rows[0].id);
        }
        await c.query('update public.game_character set is_active=false where id=$1',[ids[2]]);
        await c.query('update public.auth_user set is_active=false where id=$1',[users[3]]);
        const repo=createPostgresRepository({query:(...args)=>c.query(...args)});
        assert.deepEqual(await repo.searchCharacters(name.slice(4)),ids.slice(0,2).map(id=>({id,name})));
        const me=await repo.getCharacter(users[0]);
        for(const field of ['age','job','position','profile_url']) assert.equal(me[field],null);
        assert.equal(me.hp,100);assert.equal(me.atk,5);
        await c.query("update public.game_character set name=$1,age='미정',job='DEV 직업',position='T',profile_url='https://example.invalid/profile' where id=$2",[name+'%_',ids[0]]);
        assert.equal((await repo.searchCharacters('%_')).some(row=>row.id===ids[0]),true);
        assert.equal((await repo.searchCharacters(name+'%_')).length,1);
        assert.equal((await repo.getCharacter(users[0])).job,'DEV 직업');
        for(const position of ['T','M','B',null]) await c.query('update public.game_character set position=$1 where id=$2',[position,ids[0]]);
        await c.query('savepoint invalid_position');
        await assert.rejects(c.query("update public.game_character set position='X' where id=$1",[ids[0]]),e=>e.code==='23514');
        await c.query('rollback to savepoint invalid_position');
        assert.deepEqual(await repo.searchCharacters(name+"' OR 1=1 --"),[]);
    } finally {await c.query('rollback');c.release();await pool.end();}
});
