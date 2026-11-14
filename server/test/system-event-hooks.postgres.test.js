import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createIsolatedPool} from './isolated-pool.js';
import {changeCharacterResources} from '../src/shared/game.js';
import {createCharacterCareRepository} from '../src/modules/character/care-repository.js';
import {createCharacterCareService} from '../src/modules/character/care-service.js';
import {createGachaRepository} from '../src/modules/gacha/repository.js';
import {createCookingRepository} from '../src/modules/cooking/repository.js';
import {createInvestigationRepository} from '../src/modules/investigation/repository.js';
import {events} from '../src/modules/mastodon-system/outbox.js';

test('real game event hooks commit and rollback together', {skip: !process.env.ISOLATED_PG_CONFIG}, async () => {
    const raw = createIsolatedPool(), schema = 'event_hooks_' + randomUUID().replaceAll('-', ''); let failOutbox = false;
    const rewrite = q => q.replaceAll('public.', schema + '.');
    const query = (c, q, p) => {if (failOutbox && q.includes('insert into public.mastodon_event')) throw Error('outbox fault'); return c.query(rewrite(q), p);};
    const pool = {query: (q, p) => query(raw, q, p), async connect() {const c = await raw.connect(); return {query: (q, p) => query(c, q, p), release: () => c.release()};} };
    await raw.query(`create schema ${schema}`);
    try {
        const tables = (await raw.query("select tablename from pg_tables where schemaname='public'")).rows;
        for (const {tablename} of tables) {assert.match(tablename, /^[a-z_]+$/); await raw.query(`create table ${schema}.${tablename}(like public.${tablename} including all)`);}
        await raw.query(`insert into ${schema}.system_config select * from public.system_config`);
        await pool.query(fs.readFileSync(new URL('../../supabase/migrations/20261110160000_mastodon_delivery.sql', import.meta.url), 'utf8'));
        await pool.query('insert into public.daily_reset_state(singleton) values(true)');
        const policies = Object.fromEntries(events.map(type => [type, {enabled: true, template: '', visibility: 'unlisted', retryEnabled: false}]));
        await pool.query("update public.system_config set config_value=$1 where config_key='operating_announcements'", [JSON.stringify({events: policies})]);
        const actor = async name => {const c = (await pool.query("insert into public.game_character(name,hunter_grade,atk,def,agi,currency,ap) values($1,'B',12,12,12,10,10) returning *", [name])).rows[0]; const u = (await pool.query("insert into public.auth_user(character_id,role) values($1,'USER') returning *", [c.id])).rows[0]; return {c, u};};
        const a = await actor('시전자'), b = await actor('대상');
        const count = async type => Number((await pool.query('select count(*) n from public.mastodon_event where event_type=$1', [type])).rows[0].n);
        const c = await pool.connect(); await c.query('begin'); await changeCharacterResources(c, b.c, {hp: -100}); await c.query('rollback');
        assert.equal(await count('death'), 0);
        await c.query('begin'); const dead = await changeCharacterResources(c, b.c, {hp: -100}); await changeCharacterResources(c, dead, {hp: 0}); await c.query('commit'); c.release(); assert.equal(await count('death'), 1);
        const care = createCharacterCareService(createCharacterCareRepository(pool));
        const reviveKey = randomUUID(); await care.revive(a.u.id, b.c.id, {requestKey: reviveKey}); assert.equal(await count('revive'), 1);
        const revive = (await pool.query("select message from public.mastodon_event where event_type='revive'")).rows[0].message; assert.ok(revive.includes('시전자') && revive.includes('대상'));
        await assert.rejects(care.revive(a.u.id, b.c.id, {requestKey: reviveKey})); assert.equal(await count('revive'), 1);
        await care.heal(a.u.id, a.c.id, {requestKey: randomUUID()}); assert.equal(await count('heal'), 0);
        const item = (await pool.query("insert into public.item(name,category,transferable,usable,battle_usable,use_target) values('상품','ETC',true,false,false,'NONE') returning *")).rows[0];
        const g = (await pool.query("insert into public.gacha(name) values('뽑기') returning *")).rows[0];
        await pool.query('insert into public.gacha_reward(gacha_id,item_id,quantity,weight,max_stock,remaining_stock) values($1,$2,1,1,4,4)', [g.id, item.id]);
        const gacha = createGachaRepository(pool), key = randomUUID(); await gacha.drawGacha(a.u.id, g.id, key); assert.equal(await count('gacha'), 1);
        await assert.rejects(gacha.drawGacha(a.u.id, g.id, key)); assert.equal(await count('gacha'), 1);
        const before = (await pool.query('select currency from public.game_character where id=$1', [a.c.id])).rows[0]; failOutbox = true;
        await assert.rejects(gacha.drawGacha(a.u.id, g.id, randomUUID()), /outbox fault/); failOutbox = false;
        assert.deepEqual((await pool.query('select currency from public.game_character where id=$1', [a.c.id])).rows[0], before); assert.equal(await count('gacha'), 1);
        const food = (await pool.query("insert into public.item(name,category) values('실패 음식','FOOD') returning *")).rows[0];
        await pool.query("insert into public.food_config(item_id,is_failure,rp_effect_text,rp_effect_texts) values($1,true,'기존 문구',ARRAY['선택된 RP','다른 RP'])", [food.id]);
        await pool.query('insert into public.inventory(character_id,item_id,quantity) values($1,$2,2)', [a.c.id, food.id]);
        const cooking = createCookingRepository(pool, {random: () => 0}); const meal = await cooking.eatFood(a.u.id, food.id, randomUUID()); assert.equal(await count('failure_food'), 1);
        assert.ok((await pool.query("select message from public.mastodon_event where event_type='failure_food'")).rows[0].message.includes(meal.rpEffectText));
        const area = (await pool.query("insert into public.area(name,is_open,encounter_rate) values('구역',true,0) returning *")).rows[0];
        const clue = (await pool.query("insert into public.clue(area_id,title,content,is_public) values($1,'비밀 제목','스포일러 내용',true) returning *", [area.id])).rows[0];
        await pool.query("insert into public.investigation_result(area_id,result_grade,result_text,is_unique,investigation_rate_value,clue_id) values($1,'NORMAL','발견',false,0,$2)", [area.id, clue.id]);
        const investigation = createInvestigationRepository(pool); await Promise.all([a, b].map(x => investigation.investigate(x.u.id, area.id, randomUUID())));
        assert.equal(await count('clue_discovery'), 1); const msg = (await pool.query("select message from public.mastodon_event where event_type='clue_discovery'")).rows[0].message;
        assert.ok(!msg.includes('비밀 제목') && !msg.includes('스포일러 내용'));
    } finally {await raw.query(`drop schema ${schema} cascade`); await raw.end();}
});
