import {dailyGateFixture} from './daily-gate-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTrainingRepository} from '../src/modules/training/repository.js';

test('training repository applies configured chance, growth, AP cost and currency reward',async()=>{
    for(const rate of [0,100]){
        let character={id:'1',hunter_grade:'B',hp:100,max_hp:100,blood:100,max_blood:100,ap:10,max_ap:10,currency:5,atk:10,def:40,agi:40,status:'ALIVE',death_count:0};
        const settings={permanent_stat_cap:40,training_ap_cost:2,training_currency_reward:3,training_growth:2,training_great_growth:4,training_great_rate_b:rate};
        const rows=r=>({rows:r,rowCount:r.length});
        const c={release(){},async query(raw,p=[]){const dailyGateResult=dailyGateFixture(raw);if(dailyGateResult)return dailyGateResult;const sql=raw.replace(/\s+/g,' ').trim();
            if(['begin','commit','rollback'].includes(sql))return rows([]);
            if(sql.startsWith('select c.*'))return rows([{...character}]);
            if(sql.startsWith('select id from public.action_log')||sql.startsWith('select id from public.battle'))return rows([]);
            if(sql.includes("at time zone 'Asia/Seoul'"))return rows([{day:'2026-11-04'}]);
            if(sql.startsWith('select last_training_date'))return rows([{day:null}]);
            if(sql.startsWith('select config_key,config_value'))return rows(p[0].map(k=>({config_key:k,config_value:settings[k]})));
            if(sql.startsWith('update public.game_character set hp=')){['hp','blood','ap','currency','status','death_count'].forEach((k,i)=>character[k]=p[i]);return rows([{...character}]);}
            if(sql.startsWith('update public.game_character set atk=')){character.atk=p[0];return rows([]);}
            if(sql.startsWith('update public.game_character set daily_training_done'))return rows([]);
            if(sql.startsWith('insert into public.action_log'))return rows([]);throw Error(sql);
        }};
        const result=await createTrainingRepository({connect:async()=>c},{random:()=>.5}).trainCharacter('u',randomUUID());
        assert.equal(result.great,rate===100);assert.equal(result.growth.growth,rate===100?4:2);assert.equal(character.atk,rate===100?14:12);assert.equal(result.ap,8);assert.equal(result.currency,8);
    }
});
