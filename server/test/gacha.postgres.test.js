import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createGachaRepository} from '../src/modules/gacha/repository.js';
import {transferInventoryItem} from '../src/modules/inventory/transfer.js';

test('PostgreSQL gacha isolated transaction and concurrency', {skip:process.env.RUN_GACHA_DB_TESTS!=='1'||!process.env.GACHA_TEST_DATABASE_URL}, async t=>{
    const url=new URL(process.env.GACHA_TEST_DATABASE_URL);
    assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname),'Only dedicated local PostgreSQL is allowed');
    assert(/test/i.test(url.pathname),'Dedicated test database name is required');
    const pool=new pg.Pool({connectionString:url.href}), characters=[], users=[], items=[], gachas=[];
    let ready=false;
    const setup=await pool.connect();
    try {
        await setup.query('begin');
        for(let n=0;n<2;n++) {
            characters.push((await setup.query("insert into public.game_character(name,hunter_grade,atk,def,agi,currency) values ($1,'B',5,5,5,100) returning id",[`DEV gacha test ${randomUUID()}`])).rows[0].id);
            users.push((await setup.query("insert into public.auth_user(character_id,role) values ($1,'USER') returning id",[characters[n]])).rows[0].id);
            items.push((await setup.query("insert into public.item(name,category,transferable,usable,battle_usable,use_target,effect_type,effect_value,is_active) values ($1,'ETC',true,false,false,'NONE',null,null,true) returning id",[`DEV gacha item ${randomUUID()}`])).rows[0].id);
            gachas.push((await setup.query('insert into public.gacha(name,price) values ($1,10) returning id',[`DEV gacha ${randomUUID()}`])).rows[0].id);
        }
        for(const g of gachas) await setup.query('insert into public.gacha_reward(gacha_id,item_id,quantity,weight,max_stock,remaining_stock,is_active) values ($1,$2,1,99,10,10,true),($1,$3,1,1,30,30,true)',[g,items[0],items[1]]);
        await setup.query('commit');ready=true;
    } catch(e){await setup.query('rollback');throw e;}
    finally{setup.release();if(!ready)await pool.end();}
    const repo=createGachaRepository(pool,{random:()=>0.5});
    const draw=(i=0,key=randomUUID(),g=gachas[0])=>repo.drawGacha(users[i],g,key);
    const rejects=(p,code)=>assert.rejects(p,e=>e.code===code);
    const snapshot=async()=>({chars:(await pool.query('select id,currency from public.game_character where id=any($1::bigint[]) order by id',[characters])).rows,
        inv:(await pool.query('select character_id,item_id,quantity from public.inventory where character_id=any($1::bigint[]) order by character_id,item_id',[characters])).rows,
        logs:(await pool.query('select id,detail from public.action_log where character_id=any($1::bigint[]) order by id',[characters])).rows,
        stock:(await pool.query('select id,remaining_stock from public.gacha_reward where gacha_id=any($1::bigint[]) order by id',[gachas])).rows});
    async function scenario(name,fn){await t.test(name,async()=>{
        await pool.query('delete from public.action_log where character_id=any($1::bigint[])',[characters]);
        await pool.query('delete from public.inventory where character_id=any($1::bigint[])',[characters]);
        await pool.query("update public.game_character set currency=100,status='ALIVE' where id=any($1::bigint[])",[characters]);
        await pool.query('update public.gacha set price=10,is_active=true,start_at=null,end_at=null where id=any($1::bigint[])',[gachas]);
        await pool.query('update public.item set is_active=true where id=any($1::bigint[])',[items]);
        await pool.query('update public.gacha_reward set remaining_stock=max_stock,is_active=true where gacha_id=any($1::bigint[])',[gachas]);
        await fn();
    });}
    try {
        await scenario('last global stock permits exactly one concurrent winner across characters',async()=>{
            await pool.query('update public.gacha_reward set remaining_stock=case when item_id=$2 then 1 else 0 end where gacha_id=$1',[gachas[0],items[0]]);
            const outcomes=await Promise.allSettled([draw(0),draw(1)]);
            assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
            assert.equal(outcomes.find(r=>r.status==='rejected').reason.code,'GACHA_SOLD_OUT');
            const saved=await snapshot();assert.equal(saved.logs.length,1);assert.equal(saved.inv[0].quantity,1);
            assert.equal(saved.chars.reduce((sum,c)=>sum+c.currency,0),199);
            const stock=(await pool.query('select sum(remaining_stock)::integer as total from public.gacha_reward where gacha_id=$1',[gachas[0]])).rows[0].total;
            assert.equal(stock,0);assert.equal((await repo.getGachaCatalog(users[0])).gachas.find(g=>g.id===gachas[0]).sold_out,true);
        });
        await scenario('awarded RP item transfers without restoring global stock',async()=>{
            const result=await draw(0),stock=(await snapshot()).stock;
            await transferInventoryItem(pool,users[0],characters[1],result.reward.itemId,1,randomUUID());
            assert.deepEqual((await snapshot()).stock,stock);
            assert.equal((await pool.query('select quantity from public.inventory where character_id=$1 and item_id=$2',[characters[1],result.reward.itemId])).rows[0].quantity,1);
        });
        await scenario('draw weighted reward, exact price, inventory and log; catalog rewards',async()=>{
            const r=await draw();assert.equal(r.currency,99);assert.equal(r.reward.itemId,items[1]);assert.equal(r.reward.quantity,1);assert.equal('totalWeight' in r.reward,false);assert.equal('weight' in r.reward,false);
            assert.equal(r.inventoryQuantity,1);assert.equal((await snapshot()).logs[0].detail.reward.itemId,items[1]);
            const list=(await repo.getGachaCatalog(users[0])).gachas.find(g=>g.id===gachas[0]);assert.equal('rewards' in list,false);assert.equal(list.outside,false);
        });
        await scenario('insufficient currency, DEAD and NEAR_DEATH restriction change nothing',async()=>{
            await pool.query('update public.game_character set currency=0 where id=$1',[characters[0]]);
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
            const before=await snapshot();await rejects(draw(),'GACHA_RP_ITEM_REQUIRED');assert.deepEqual(await snapshot(),before);
            const c=await pool.connect();await c.query('begin');
            try {
                await c.query('delete from public.gacha_reward where gacha_id=$1',[gachas[0]]);
                const isolated=createGachaRepository({async connect(){return {release(){},query(sql,args){
                    if(sql==='begin')return c.query('savepoint action');if(sql==='commit')return c.query('release savepoint action');if(sql==='rollback')return c.query('rollback to savepoint action');return c.query(sql,args);
                }};}});
                await rejects(isolated.drawGacha(users[0],gachas[0],randomUUID()),'GACHA_SOLD_OUT');
            }finally{await c.query('rollback');c.release();}
        });
        await scenario('concurrent draws with last balance charge and grant once',async()=>{
            await pool.query('update public.game_character set currency=1 where id=$1',[characters[0]]);
            const r=await Promise.allSettled([draw(),draw(0,randomUUID(),gachas[1])]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
            assert.equal(r.find(x=>x.status==='rejected').reason.code,'NOT_ENOUGH_CURRENCY');
            const s=await snapshot();assert.equal(s.logs.length,1);assert.equal(s.inv[0].quantity,1);assert.equal(s.chars[0].currency,0);
        });
        await scenario('concurrent sufficient balance accumulates both inventory grants',async()=>{
            await Promise.all([draw(),draw()]);const s=await snapshot();assert.equal(s.inv[0].quantity,2);assert.equal(s.chars[0].currency,98);assert.equal(s.logs.length,2);
        });
        await scenario('same key concurrent and changed gacha key reuse reject',async()=>{
            const key=randomUUID();assert.equal((await Promise.allSettled([draw(0,key),draw(0,key)])).filter(r=>r.status==='fulfilled').length,1);
            await rejects(draw(0,key,gachas[1]),'DUPLICATE_REQUEST');assert.equal((await snapshot()).logs.length,1);
        });
        await scenario('different characters same key UNIQUE loser rolls back',async()=>{
            const key=randomUUID();assert.equal((await Promise.allSettled([draw(0,key),draw(1,key,gachas[1])])).filter(r=>r.status==='fulfilled').length,1);
            const s=await snapshot();assert.equal(s.logs.length,1);assert.equal(s.chars.reduce((sum,c)=>sum+c.currency,0),199);assert.equal(s.inv.length,1);
        });
        await scenario('log failure rolls back stock/charge/grant; legacy DB price never grants free draw',async()=>{
            const faulty=createGachaRepository({async connect(){const c=await pool.connect();return {release:()=>c.release(),query(sql,args){
                if(sql.includes('insert into public.action_log'))throw new Error('injected log failure');return c.query(sql,args);
            }};}},{random:()=>0.25});
            const before=await snapshot();await assert.rejects(faulty.drawGacha(users[0],gachas[0],randomUUID()),/injected/);assert.deepEqual(await snapshot(),before);
            await pool.query('update public.gacha set price=0 where id=$1',[gachas[0]]);assert.equal((await draw()).currency,99);
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
