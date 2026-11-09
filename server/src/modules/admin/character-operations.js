import {validateInitialStats} from '../character/initial-stats.js';
import {AppError} from '../../shared/http.js';
import {lockCharacter,changeCharacterResources,changeInventoryQuantity,writeActionLog} from '../../shared/game.js';
import {requireNoActiveBattle} from '../../shared/actions.js';
import {readNumberSettings,positiveResourceNumber} from '../../shared/settings.js';
import {bloodLimit} from '../../shared/balance.js';
import {adminTransaction,requireAdminRow,checkDuplicate,fail} from './transaction.js';
import {requestKey,invalid} from './master-service.js';
import {validId} from './service.js';

export function validateCharacterOperation(body,inventory=false) {
    const key=requestKey(body),fields=inventory?['itemId','quantity']:['hp','blood','ap','currency','atk','def','agi'];
    if(Object.keys(body).some(k=>!fields.includes(k)&&k!=='requestKey'))invalid('허용되지 않은 캐릭터 수정 필드입니다.');
    const patch=Object.fromEntries(fields.filter(k=>Object.hasOwn(body,k)).map(k=>[k,body[k]]));
    if(!Object.keys(patch).length)invalid('수정할 값이 필요합니다.');
    for(const [k,v] of Object.entries(patch))if(k!=='itemId'&&(!Number.isInteger(v)||v<0||v>2147483647))invalid('수정값은 비음수 정수입니다.');
    if(inventory&&(!validId(body.itemId)||!Object.hasOwn(body,'quantity')))invalid('아이템과 최종 보유 수량이 필요합니다.');
    return {patch,key};
}
export function createAdminCharacterOperations(pool) {
    async function read(client,id){
        const character=(await client.query('select * from public.game_character where id=$1',[id])).rows[0];
        if(!character)fail('CHARACTER_NOT_FOUND','캐릭터가 없습니다.',404);
        const inventory=(await client.query('select i.item_id,i.quantity,m.name,m.category from public.inventory i join public.item m on m.id=i.item_id where i.character_id=$1 order by i.item_id',[id])).rows;
        return {character,inventory};
    }
    return {
        initializeAdminCharacter(actor,id,body) {
            const key=requestKey(body);
            const allowed=['requestKey','expectedUpdatedAt','hunter_grade','has_ability','ability_grade','atk','def','agi'];
            if(Object.keys(body).some(k=>!allowed.includes(k))||typeof body.expectedUpdatedAt!=='string')invalid('초기 설정과 현재 버전이 필요합니다.');
            const stats=validateInitialStats(body.hunter_grade,body);
            if(typeof body.has_ability!=='boolean'||(body.has_ability?!['E','D','C','B','A','S'].includes(body.ability_grade):body.ability_grade!==null))invalid('이능 보유 여부와 등급을 확인하세요.');
            return adminTransaction(pool,async c=>{
                await requireAdminRow(c,actor);await checkDuplicate(c,key);
                const before=await lockCharacter(c,id);
                if(!before)fail('CHARACTER_NOT_FOUND','캐릭터가 없습니다.',404);
                if(before.initial_setup_complete!==false)fail('CHARACTER_ALREADY_CONFIGURED','초기 설정이 이미 완료되었습니다.');
                if(new Date(before.updated_at).toISOString()!==body.expectedUpdatedAt)fail('ADMIN_EDIT_CONFLICT','캐릭터가 변경되었습니다. 다시 조회하세요.');
                await requireNoActiveBattle(c,before);
                await c.query(`update public.game_character set hunter_grade=$2,has_ability=$3,ability_grade=$4,
                    atk=$5,def=$6,agi=$7,initial_setup_complete=true,updated_at=clock_timestamp() where id=$1`,
                    [id,body.hunter_grade,body.has_ability,body.ability_grade,stats.atk,stats.def,stats.agi]);
                const after=await read(c,id);
                await writeActionLog(c,{adminUserId:actor,characterId:id,category:'ADMIN',actionType:'CHARACTER_INITIAL_SETTINGS',targetType:'CHARACTER',targetId:id,
                    description:'관리자 게임 초기 능력치 설정',detail:{before,after:after.character},requestKey:key});
                return after;
            });
        },
        async searchAdminCharacters(query,after='0') {return (await pool.query('select id,name,status,is_active from public.game_character where id>$2 and strpos(lower(name),lower($1))>0 order by id limit 50',[query,after])).rows;},
        getAdminCharacter:id=>read(pool,id),
        saveAdminCharacter(actor,id,body,inventory=false) {
            const {patch,key}=validateCharacterOperation(body,inventory);
            return adminTransaction(pool,async c=>{
                await requireAdminRow(c,actor);await checkDuplicate(c,key);
                const before=await lockCharacter(c,id);
                if(!before)fail('CHARACTER_NOT_FOUND','활성 캐릭터가 없습니다.',404);
                await requireNoActiveBattle(c,before);
                let detail;
                if(inventory) {
                    if(!(await c.query('select id from public.item where id=$1 for update',[patch.itemId])).rowCount)fail('ITEM_NOT_FOUND','아이템이 없습니다.',404);
                    const owned=(await c.query('select quantity from public.inventory where character_id=$1 and item_id=$2 for update',[id,patch.itemId])).rows[0];
                    const result=await changeInventoryQuantity(c,id,patch.itemId,patch.quantity-Number(owned?.quantity||0));
                    if(!result.ok)fail('INVENTORY_CONFLICT','인벤토리를 다시 확인하세요.');
                    detail={itemId:patch.itemId,before:result.before,after:result.after};
                } else {
                    if(before.status==='DEAD'&&patch.hp>0)fail('ADMIN_REVIVE_HOLD','사망 이력을 보존합니다. 관리자 강제 부활은 지원하지 않습니다.');
                    const limits={hp:Number(before.max_hp),blood:bloodLimit(before),ap:Number(before.max_ap)};
                    for(const k of Object.keys(limits))if(patch[k]!==undefined&&patch[k]>limits[k])throw new AppError(400,'RESOURCE_LIMIT_CONFLICT',`${k} 최대값을 초과합니다.`);
                    const stats=['atk','def','agi'].filter(k=>Object.hasOwn(patch,k));
                    if(stats.length){
                        const {permanent_stat_cap:cap}=await readNumberSettings(c,{permanent_stat_cap:positiveResourceNumber});
                        if(stats.some(k=>patch[k]>Math.min(40,cap)))throw new AppError(400,'STAT_CAP_CONFLICT','영구 스탯 상한을 초과합니다.');
                    }
                    const deltas=Object.fromEntries(['hp','blood','ap','currency'].filter(k=>Object.hasOwn(patch,k)).map(k=>[k,patch[k]-Number(before[k])]));
                    await changeCharacterResources(c,before,deltas);
                    if(stats.length)await c.query(`update public.game_character set ${stats.map((k,i)=>`${k}=$${i+1}`).join(',')} where id=$${stats.length+1}`,[...stats.map(k=>patch[k]),id]);
                    detail={before,after:(await read(c,id)).character};
                }
                await writeActionLog(c,{adminUserId:actor,characterId:id,category:'ADMIN',actionType:inventory?'CHARACTER_INVENTORY_UPDATE':'CHARACTER_UPDATE',targetType:'CHARACTER',targetId:id,description:'관리자 캐릭터 운영 수정',detail,requestKey:key});
                return read(c,id);
            });
        }
    };
}
