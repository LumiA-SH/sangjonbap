import {adminTransaction,requireAdminRow,checkDuplicate,fail} from './transaction.js';
import {requestKey,invalid} from './master-service.js';
import {validId} from './service.js';
import {chooseMonsterAction} from '../battle/engine.js';
import {abilityRequirements} from '../battle/repository.js';
import {readNumberSettings} from '../../shared/settings.js';
import {validateInitialStats} from '../character/initial-stats.js';
import {writeActionLog} from '../../shared/game.js';

const fields=['name','description','image_url','max_hp','atk','def','agi','is_active'];
const integer=(v,min=0)=>Number.isInteger(v)&&v>=min&&v<=2147483647;
const decimal2=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v*100-Math.round(v*100))<0.000001;
export function validateMonster(body) {
    const key=requestKey(body);
    if(Object.keys(body).some(k=>![...fields,'actions','drops','areas','requestKey'].includes(k)))invalid('알 수 없는 마물 필드입니다.');
    if(typeof body.name!=='string'||!body.name.trim()||body.name.length>100||typeof body.is_active!=='boolean')invalid('마물 이름과 활성 상태가 필요합니다.');
    for(const k of ['description','image_url'])if(body[k]!=null&&typeof body[k]!=='string')invalid('설명/이미지는 문자열입니다.');
    for(const k of ['max_hp','atk','def','agi'])if(!integer(body[k],k==='max_hp'?1:0))invalid('마물 스탯 범위를 확인하세요.');
    for(const k of ['actions','drops','areas'])if(!Array.isArray(body[k])||body[k].length>100||
        body[k].some(row=>!row||typeof row!=='object'||Array.isArray(row)))invalid('구성 목록은 최대 100개의 객체입니다.');
    for(const a of body.actions) {
        if(a.condition_type!=null||a.condition_value!=null)fail('MONSTER_CONDITION_HOLD','조건부 행동은 상세 판정 명세 확인 후 수정할 수 있습니다.');
        if(Object.keys(a).some(k=>!['name','action_type','probability','multiplier','is_active','condition_type','condition_value','sort_order'].includes(k))||
            typeof a.name!=='string'||!a.name.trim()||a.name.length>100||typeof a.is_active!=='boolean'||
            !['ATTACK','SPECIAL_ATTACK','FLEE'].includes(a.action_type)||!decimal2(a.probability)||a.probability<0||a.probability>100||
            !decimal2(a.multiplier)||a.multiplier<=0||a.multiplier>9999.99||!integer(a.sort_order))invalid('행동 설정을 확인하세요. 확률과 배율은 DB에 맞게 소수 둘째 자리까지 입력합니다.');
    }
    chooseMonsterAction(body.actions,()=>0); // Includes unsupported conditional-policy HOLD.
    for(const [key,rows] of [['item_id',body.drops],['area_id',body.areas]]) {
        if(rows.some(r=>!validId(r[key]))||new Set(rows.map(r=>r[key])).size!==rows.length)invalid('참조 ID 중복 또는 형식 오류입니다.');
    }
    for(const d of body.drops)if(Object.keys(d).some(k=>!['item_id','drop_rate','min_quantity','max_quantity','is_ingredient'].includes(k))||
        !decimal2(d.drop_rate)||d.drop_rate<0||d.drop_rate>100||
        !integer(d.min_quantity,1)||!integer(d.max_quantity,d.min_quantity)||typeof d.is_ingredient!=='boolean')invalid('드롭 설정을 확인하세요.');
    for(const a of body.areas)if(Object.keys(a).some(k=>!['area_id','weight'].includes(k))||!integer(a.weight,1))invalid('지역 가중치를 확인하세요.');
    return {body,key};
}
async function readMonster(c,id) {
    const row=(await c.query('select * from public.monster where id=$1',[id])).rows[0];
    if(!row)fail('MONSTER_NOT_FOUND','마물이 없습니다.',404);
    for(const [field,table] of [['actions','monster_action'],['drops','monster_drop'],['areas','area_monster']])
        row[field]=(await c.query(`select * from public.${table} where monster_id=$1`,[id])).rows;
    return row;
}
export function createAdminBattleRepository(pool) {
    return {
        async listAdminBattleAreas(){return (await pool.query('select id,name,is_open from public.area order by id')).rows;},
        async getAdminVerifiedAccount(id){
            const row=(await pool.query(`select id,mastodon_instance,mastodon_account_id,oauth_verified_at,character_id,is_active
                from public.auth_user where id=$1`,[id])).rows[0];
            if(!row)fail('USER_NOT_FOUND','계정이 없습니다.',404);
            return row;
        },
        async listAdminMonsters(){return (await pool.query('select * from public.monster order by id limit 100')).rows;},
        getAdminMonster:id=>adminTransaction(pool,async c=>{
            await c.query('select id from public.monster where id=$1 for share',[id]);
            return readMonster(c,id);
        }),
        async getAdminAbilitySettings(){return readNumberSettings(pool,abilityRequirements);},
        saveAdminAbilitySettings(actor,body) {
            const key=requestKey(body),settings=body.settings;
            if(Object.keys(body).some(k=>!['settings','requestKey'].includes(k))||!settings||Array.isArray(settings)||
                Object.keys(settings).length!==Object.keys(abilityRequirements).length)invalid('모든 이능 설정이 필요합니다.');
            for(const [k,r] of Object.entries(abilityRequirements)) {
                const v=settings[k];if(typeof v!=='number'||!Number.isFinite(v)||v<r.min||v>r.max||(r.integer&&!Number.isInteger(v)))invalid('이능 설정 범위를 확인하세요.');
            }
            return adminTransaction(pool,async c=>{
                await requireAdminRow(c,actor);await checkDuplicate(c,key);
                await c.query('select config_key from public.system_config where config_key=any($1::text[]) order by config_key for update',[Object.keys(abilityRequirements)]);
                const before=await readNumberSettings(c,abilityRequirements);
                for(const [k,v] of Object.entries(settings))await c.query('update public.system_config set config_value=$2::jsonb where config_key=$1',[k,JSON.stringify(v)]);
                await writeActionLog(c,{adminUserId:actor,category:'ADMIN',actionType:'BATTLE_ABILITY_UPDATE',description:'이능관리등급 전투 설정 변경',detail:{before,after:settings},requestKey:key});
                return settings;
            });
        },
        saveAdminMonster(actor,id,input) {
            const {body,key}=validateMonster(input);
            return adminTransaction(pool,async c=>{
                // Same order as investigation: areas -> auth -> monsters -> items.
                const areas=(await c.query('select id from public.area order by id for update')).rows;
                if(body.areas.some(a=>!areas.some(r=>r.id===a.area_id)))fail('AREA_NOT_FOUND','지역이 없습니다.',404);
                await requireAdminRow(c,actor);await checkDuplicate(c,key);
                let before=null;
                if(id){await c.query('select id from public.monster where id=$1 for update',[id]);before=await readMonster(c,id);}
                if(before?.actions.some(a=>a.condition_type!=null||a.condition_value!=null))fail('MONSTER_CONDITION_HOLD','기존 조건부 행동을 덮어쓸 수 없습니다.');
                const sorted=[...body.drops].sort((a,b)=>BigInt(a.item_id)<BigInt(b.item_id)?-1:1);
                for(const d of sorted)if(!(await c.query('select id from public.item where id=$1 for share',[d.item_id])).rowCount)fail('ITEM_NOT_FOUND','아이템이 없습니다.',404);
                const values=fields.map(k=>body[k]??null);
                const row=(await c.query(id?`update public.monster set ${fields.map((k,i)=>`${k}=$${i+1}`).join(',')} where id=$9 returning *`:
                    `insert into public.monster(${fields.join(',')}) values(${fields.map((_,i)=>`$${i+1}`).join(',')}) returning *`,id?[...values,id]:values)).rows[0];
                for(const table of ['area_monster','monster_action','monster_drop'])await c.query(`delete from public.${table} where monster_id=$1`,[row.id]);
                for(const a of body.areas)await c.query('insert into public.area_monster(area_id,monster_id,weight) values($1,$2,$3)',[a.area_id,row.id,a.weight]);
                for(const a of body.actions)await c.query(`insert into public.monster_action(monster_id,name,action_type,probability,multiplier,is_active,sort_order)
                    values($1,$2,$3,$4,$5,$6,$7)`,[row.id,a.name,a.action_type,a.probability,a.multiplier,a.is_active,a.sort_order]);
                for(const d of body.drops)await c.query(`insert into public.monster_drop(monster_id,item_id,drop_rate,min_quantity,max_quantity,is_ingredient)
                    values($1,$2,$3,$4,$5,$6)`,[row.id,d.item_id,d.drop_rate,d.min_quantity,d.max_quantity,d.is_ingredient]);
                const after=await readMonster(c,row.id);
                await writeActionLog(c,{adminUserId:actor,category:'ADMIN',actionType:id?'MONSTER_UPDATE':'MONSTER_CREATE',targetType:'MONSTER',targetId:row.id,
                    description:'마물 설정 변경',detail:{before,after},requestKey:key});
                return after;
            });
        },
        registerAdminCharacter(actor,target,body) {
            const key=requestKey(body);
            if(Object.keys(body).some(k=>!['name','hunter_grade','atk','def','agi','has_ability','ability_grade','accountId','instance','requestKey'].includes(k)))invalid('등록 필드가 올바르지 않습니다.');
            validateInitialStats(body.hunter_grade,body);
            if(typeof body.name!=='string'||!body.name.trim()||body.name.length>40||typeof body.has_ability!=='boolean'||
                (body.has_ability?!['E','D','C','B','A','S'].includes(body.ability_grade):body.ability_grade!==null)||
                typeof body.accountId!=='string'||typeof body.instance!=='string')invalid('이름, 이능 및 인증 계정 식별자를 확인하세요.');
            return adminTransaction(pool,async c=>{
                const users=(await c.query('select * from public.auth_user where id=any($1::bigint[]) order by id for update',[[actor,target]])).rows;
                const admin=users.find(u=>u.id===actor),user=users.find(u=>u.id===target);
                if(!admin?.is_active||admin.role!=='ADMIN')fail('ADMIN_REQUIRED','관리자 권한이 필요합니다.',403);
                await checkDuplicate(c,key);
                if(!user?.is_active||!user.oauth_verified_at||user.mastodon_account_id!==body.accountId||user.mastodon_instance!==body.instance)
                    fail('VERIFIED_ACCOUNT_REQUIRED','실제 OAuth로 검증된 계정 식별자가 일치해야 합니다.');
                if(user.character_id)fail('CHARACTER_ALREADY_LINKED','이미 캐릭터가 연결되어 있습니다.');
                const character=(await c.query(`insert into public.game_character(name,hunter_grade,atk,def,agi,has_ability,ability_grade,
                    hp,max_hp,blood,max_blood,ap,max_ap) values($1,$2,$3,$4,$5,$6,$7,100,100,100,100,10,10) returning *`,
                    [body.name.trim(),body.hunter_grade,body.atk,body.def,body.agi,body.has_ability,body.ability_grade])).rows[0];
                await c.query('update public.auth_user set character_id=$1 where id=$2',[character.id,target]);
                await writeActionLog(c,{adminUserId:actor,characterId:character.id,category:'ADMIN',actionType:'CHARACTER_REGISTER',targetType:'AUTH_USER',targetId:target,
                    description:'승인 캐릭터 등록 및 인증 계정 연결',detail:{userId:target,character},requestKey:key});
                return character;
            });
        }
    };
}
