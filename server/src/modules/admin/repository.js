import {AppError} from '../../shared/http.js';
import {writeActionLog} from '../../shared/game.js';
import {createAdminMasterRepository} from './master-repository.js';
import {createAdminRoleRepository} from './role-repository.js';
import {createAdminBattleRepository} from './battle-repository.js';
import {createAdminSettingsRepository} from './settings-repository.js';
import {createAdminDeleteRepository} from './delete-repository.js';
import {createAdminCharacterOperations} from './character-operations.js';
import {createAdminInvestigationOperations} from './investigation-operations.js';
const tables={items:'item',products:'shop_product'};
const fail=(code,message,status=409)=>{throw new AppError(status,code,message);};

export function createAdminRepository(pool) {
    return {
        ...createAdminSettingsRepository(pool),
        ...createAdminDeleteRepository(pool),
        ...createAdminCharacterOperations(pool),
        ...createAdminInvestigationOperations(pool),
        ...createAdminBattleRepository(pool),
        ...createAdminMasterRepository(pool),
        ...createAdminRoleRepository(pool),
        async searchAdminItems(query,rpOnly=false) {
            return (await pool.query(`select id::text,name,category,is_active,effect_type
                from public.item where strpos(lower(name),lower($1))>0
                ${rpOnly?"and is_active and transferable and not usable and not battle_usable and effect_type is null and effect_value is null and use_target='NONE' and category<>'FOOD' and not exists(select 1 from public.food_config f where f.item_id=item.id)":''}
                order by name,id limit 30`, [query])).rows;
        },
        async listAdminRecords(kind,after='0') {
            return (await pool.query(`select * from public.${tables[kind]} where id>$1 order by id limit 100`,[after])).rows;
        },
        async getAdminRecord(kind,id) {
            const row=(await pool.query(`select * from public.${tables[kind]} where id=$1`,[id])).rows[0];
            if (!row) fail('ADMIN_RECORD_NOT_FOUND','대상이 없습니다.',404);
            return row;
        },
        async saveAdminRecord(userId,kind,id,patch,requestKey) {
            const c=await pool.connect();
            try {
                await c.query('begin');
                // Product first, matching purchase -> auth/character -> item order.
                let before=null;
                if (id && kind==='products') {
                    before=(await c.query('select * from public.shop_product where id=$1 for update',[id])).rows[0];
                    if (!before) fail('ADMIN_RECORD_NOT_FOUND','상품이 없습니다.',404);
                }
                // Hold role through commit; role revocation and this write serialize.
                const admin=(await c.query("select id from public.auth_user where id=$1 and is_active and role='ADMIN' for share",[userId])).rows[0];
                if (!admin) fail('ADMIN_REQUIRED','관리자 권한이 필요합니다.',403);
                if ((await c.query('select id from public.action_log where request_key=$1',[requestKey])).rowCount) fail('DUPLICATE_REQUEST','이미 처리된 요청입니다.');
                if (id && kind==='items') {
                    before=(await c.query('select * from public.item where id=$1 for update',[id])).rows[0];
                    if (!before) fail('ADMIN_RECORD_NOT_FOUND','아이템이 없습니다.',404);
                }
                if (kind==='products') {
                    const merged={...before,...patch};
                    const sold=id?Number((await c.query('select coalesce(sum(quantity),0) quantity from public.shop_purchase where product_id=$1',[id])).rows[0].quantity):0;
                    if (sold && merged.item_id!==before.item_id) fail('PRODUCT_ITEM_CHANGE_HOLD','판매 이력이 있는 상품의 아이템 교체는 보류합니다. 새 상품을 등록하세요.');
                    if (merged.stock_limit!==null && merged.stock_limit!==undefined && merged.stock_limit<sold) fail('STOCK_LIMIT_CONFLICT','전체 한도는 누적 판매 수량보다 작을 수 없습니다.');
                    const item=(await c.query('select * from public.item where id=$1 for update',[merged.item_id])).rows[0];
                    if (!item) fail('ITEM_NOT_FOUND','아이템이 없습니다.',404);
                    if(item.effect_type==='BLOOD_PACK'&&(merged.price!==0||merged.daily_limit!==1))fail('BLOOD_PACK_CONFIG_INVALID','혈액팩 상품은 가격 0, 일일 한도 1이어야 합니다.');
                }
                if(kind==='items') {
                    const merged={...before,...patch};
                    if(merged.effect_type==='BLOOD_PACK'&&(!Number.isInteger(merged.effect_value)||merged.effect_value<=0||!merged.usable||merged.use_target!=='SELF'||merged.transferable===false))fail('BLOOD_PACK_CONFIG_INVALID','혈액팩은 양수 회복량/사용 가능/SELF/양도 가능이어야 합니다.');
                    if(id && ['effect_type','usable','use_target'].some(k=>k in patch && patch[k]!==before[k])) {
                        const referenced=await c.query('select id from public.shop_product where item_id=$1 limit 1',[id]);
                        if(referenced.rowCount)fail('ITEM_EFFECT_CHANGE_HOLD','상품에 연결된 아이템의 효과 교체는 새 아이템으로 등록하세요.');
                    }
                }
                const keys=Object.keys(patch), values=Object.values(patch);
                // Keys come only from the service whitelist, never request keys.
                const sql=id?`update public.${tables[kind]} set ${keys.map((key,i)=>`${key}=$${i+1}`).join(',')} where id=$${keys.length+1} returning *`:
                    `insert into public.${tables[kind]} (${keys.join(',')}) values (${keys.map((_,i)=>`$${i+1}`).join(',')}) returning *`;
                const after=(await c.query(sql,id?[...values,id]:values)).rows[0];
                await writeActionLog(c,{adminUserId:userId,category:'ADMIN',actionType:`${kind==='items'?'ITEM':'SHOP_PRODUCT'}_${id?'UPDATE':'CREATE'}`,
                    targetType:kind==='items'?'ITEM':'SHOP_PRODUCT',targetId:after.id,description:'관리자 데이터 변경',detail:{before,after},requestKey});
                await c.query('commit');return after;
            } catch(e) {
                await c.query('rollback');
                if (e.code==='23505' && e.constraint==='action_log_request_key_key') fail('DUPLICATE_REQUEST','이미 처리된 요청입니다.');
                throw e;
            } finally {c.release();}
        }
    };
}
