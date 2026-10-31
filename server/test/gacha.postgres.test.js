import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {loadConfig} from '../src/config/env.js';
import {createPool} from '../src/db/pool.js';
import {createGachaRepository} from '../src/modules/gacha/repository.js';

test('PostgreSQL gacha isolated transaction and concurrency', {skip:process.env.RUN_GACHA_DB_TESTS!=='1'}, async t=>{
    const pool=createPool(loadConfig()), characters=[], users=[], items=[], gachas=[];
    let ready=false;
    const setup=await pool.connect();
    try {
        await setup.query('begin');
        for(let n=0;n<2;n++) {
            characters.push((await setup.query("insert into public.game_character(name,hunter_grade,atk,def,agi,currency) values ($1,'B',5,5,5,100) returning id",[`DEV gacha test ${randomUUID()}`])).rows[0].id);
            users.push((await setup.query("insert into public.auth_user(character_id,role) values ($1,'USER') returning id",[characters[n]])).rows[0].id);
            items.push((await setup.query("insert into public.item(name,category) values ($1,'ETC') returning id",[`DEV gacha item ${randomUUID()}`])).rows[0].id);
            gachas.push((await setup.query('insert into public.gacha(name,price) values ($1,10) returning id',[`DEV gacha ${randomUUID()}`])).rows[0].id);
        }
        for(const g of gachas) await setup.query('insert into public.gacha_reward(gacha_id,item_id,quantity,weight) values ($1,$2,2,2),($1,$3,3,6)',[g,items[0],items[1]]);
        await setup.query('commit');ready=true;
    } catch(e){await setup.query('rollback');throw e;}
    finally{setup.release();if(!ready)await pool.end();}
    const repo=createGachaRepository(pool,{random:()=>0.25});
    const draw=(i=0,key=randomUUID(),g=gachas[0])=>repo.drawGacha(users[i],g,key);
    const rejects=(p,code)=>assert.rejects(p,e=>e.code===code);
    const snapshot=async()=>({chars:(await pool.query('select id,currency from public.game_character where id=any($1::bigint[]) order by id',[characters])).rows,
        inv:(await pool.query('select character_id,item_id,quantity from public.inventory where character_id=any($1::bigint[]) order by character_id,item_id',[characters])).rows,
        logs:(await pool.query('select id,detail from public.action_log where character_id=any($1::bigint[]) order by id',[characters])).rows});
    async function scenario(name,fn){await t.test(name,async()=>{
        await pool.query('delete from public.action_log where character_id=any($1::bigint[])',[characters]);
        await pool.query('delete from public.inventory where character_id=any($1::bigint[])',[characters]);
        await pool.query("update public.game_character set currency=100,status='ALIVE' where id=any($1::bigint[])",[characters]);
        await pool.query('update public.gacha set price=10,is_active=true,start_at=null,end_at=null where id=any($1::bigint[])',[gachas]);
        await pool.query('update public.item set is_active=true where id=any($1::bigint[])',[items]);
        await fn();
    });}
    try {
        await scenario('draw weighted reward, exact price, inventory and log; catalog rewards',async()=>{
            const r=await draw();assert.equal(r.currency,90);assert.equal(r.reward.itemId,items[1]);assert.equal(r.reward.quantity,3);assert.equal(r.reward.totalWeight,8);
            assert.equal(r.inventoryQuantity,3);assert.equal((await snapshot()).logs[0].detail.reward.itemId,items[1]);
            const list=(await repo.getGachaCatalog(users[0])).gachas.find(g=>g.id===gachas[0]);assert.equal(list.rewards.length,2);assert.equal(list.outside,false);
        });
        await scenario('insufficient currency, DEAD and NEAR_DEATH restriction change nothing',async()=>{
            await pool.query('update public.game_character set currency=9 where id=$1',[characters[0]]);
            const before=await snapshot();await rejects(draw(),'NOT_ENOUGH_CURRENCY');assert.deepEqual(await snapshot(),before);
            for(const [status,code] of [['DEAD','CHARACTER_DEAD'],['NEAR_DEATH','CHARACTER_NEAR_DEATH']]){
                await pool.query('update public.game_character set status=$1 where id=$2',[status,characters[0]]);await rejects(draw(),code);
            }
        });
        await scenario('inactive, future, expired and interior periods use DB clock',async()=>{
            await pool.query('update public.gacha set is_active=false where id=$1',[gachas[0]]);await rejects(draw(),'GACHA_NOT_FOUND');
            assert.equal((await repo.getGachaCatalog(users[0])).gachas.some(g=>g.id===gachas[0]),false);
            await pool.query("update public.gacha set is_active=true,start_at=clock_timestamp()+interval '1 hour' where id=$1",[gachas[0]]);await rejects(draw(),'GACHA_CLOSED');
            await pool.query("update public.gacha set start_at=null,end_at=clock_timestamp()-interval '1 hour' where id=$1",[gachas[0]]);await rejects(draw(),'GACHA_CLOSED');
            await pool.query("update public.gacha set start_at=clock_timestamp()-interval '1 hour',end_at=clock_timestamp()+interval '1 hour' where id=$1",[gachas[0]]);await draw();
        });
        await scenario('unselected inactive reward rejects before any charge; empty rewards reject',async()=>{
            await pool.query('update public.item set is_active=false where id=$1',[items[0]]);
            const before=await snapshot();await rejects(draw(),'GACHA_ITEM_UNAVAILABLE');assert.deepEqual(await snapshot(),before);
            const c=await pool.connect();await c.query('begin');
            try {
                await c.query('delete from public.gacha_reward where gacha_id=$1',[gachas[0]]);
                const isolated=createGachaRepository({async connect(){return {release(){},query(sql,args){
                    if(sql==='begin')return c.query('savepoint action');if(sql==='commit')return c.query('release savepoint action');if(sql==='rollback')return c.query('rollback to savepoint action');return c.query(sql,args);
                }};}});
                await rejects(isolated.drawGacha(users[0],gachas[0],randomUUID()),'GACHA_REWARDS_INVALID');
            }finally{await c.query('rollback');c.release();}
        });
        await scenario('concurrent draws with last balance charge and grant once',async()=>{
            await pool.query('update public.game_character set currency=10 where id=$1',[characters[0]]);
            const r=await Promise.allSettled([draw(),draw(0,randomUUID(),gachas[1])]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
            assert.equal(r.find(x=>x.status==='rejected').reason.code,'NOT_ENOUGH_CURRENCY');
            const s=await snapshot();assert.equal(s.logs.length,1);assert.equal(s.inv[0].quantity,3);assert.equal(s.chars[0].currency,0);
        });
        await scenario('concurrent sufficient balance accumulates both inventory grants',async()=>{
            await Promise.all([draw(),draw()]);const s=await snapshot();assert.equal(s.inv[0].quantity,6);assert.equal(s.chars[0].currency,80);assert.equal(s.logs.length,2);
        });
        await scenario('same key concurrent and changed gacha key reuse reject',async()=>{
            const key=randomUUID();assert.equal((await Promise.allSettled([draw(0,key),draw(0,key)])).filter(r=>r.status==='fulfilled').length,1);
            await rejects(draw(0,key,gachas[1]),'DUPLICATE_REQUEST');assert.equal((await snapshot()).logs.length,1);
        });
        await scenario('different characters same key UNIQUE loser rolls back',async()=>{
            const key=randomUUID();assert.equal((await Promise.allSettled([draw(0,key),draw(1,key,gachas[1])])).filter(r=>r.status==='fulfilled').length,1);
            const s=await snapshot();assert.equal(s.logs.length,1);assert.equal(s.chars.reduce((sum,c)=>sum+c.currency,0),190);assert.equal(s.inv.length,1);
        });
        await scenario('log failure rolls back charge/grant; retry and DB price zero work without free policy',async()=>{
            const faulty=createGachaRepository({async connect(){const c=await pool.connect();return {release:()=>c.release(),query(sql,args){
                if(sql.includes('insert into public.action_log'))throw new Error('injected log failure');return c.query(sql,args);
            }};}},{random:()=>0.25});
            const before=await snapshot();await assert.rejects(faulty.drawGacha(users[0],gachas[0],randomUUID()),/injected/);assert.deepEqual(await snapshot(),before);
            await pool.query('update public.gacha set price=0 where id=$1',[gachas[0]]);assert.equal((await draw()).currency,100);
        });
        await scenario('inventory integer overflow does not charge',async()=>{
            await pool.query('insert into public.inventory(character_id,item_id,quantity) values ($1,$2,2147483647)',[characters[0],items[1]]);
            const before=await snapshot();await rejects(draw(),'INVENTORY_LIMIT_CONFLICT');assert.deepEqual(await snapshot(),before);
        });
    } finally {
        const c=await pool.connect();try {
            await c.query('begin');await c.query('delete from public.action_log where character_id=any($1::bigint[])',[characters]);
            await c.query('delete from public.inventory where character_id=any($1::bigint[])',[characters]);
            await c.query('delete from public.gacha_reward where gacha_id=any($1::bigint[])',[gachas]);await c.query('delete from public.gacha where id=any($1::bigint[])',[gachas]);
            await c.query('delete from public.item where id=any($1::bigint[])',[items]);await c.query('delete from public.auth_user where id=any($1::bigint[])',[users]);
            await c.query('delete from public.game_character where id=any($1::bigint[])',[characters]);await c.query('commit');
        }catch(e){await c.query('rollback');throw e;}finally{c.release();await pool.end();}
    }
});
