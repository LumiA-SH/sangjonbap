import {writeActionLog} from '../../shared/game.js';
import {validateMasterInput,validateMasterState} from './master-service.js';
import {adminTransaction,requireAdminRow,checkDuplicate,fail} from './transaction.js';

const definitions={
    foods:{table:'food_config',pk:'item_id',target:'FOOD_CONFIG'},
    recipes:{table:'recipe',pk:'id',target:'RECIPE',child:'recipe_ingredient',foreign:'recipe_id',rows:'ingredients'},
    gachas:{table:'gacha',pk:'id',target:'GACHA',child:'gacha_reward',foreign:'gacha_id',rows:'rewards'}
};
// One SQL snapshot for parent and children, including bigint IDs as strings.
async function records(client,kind,id,after='0') {
    const d=definitions[kind];
    const nested=d.child?`,coalesce((select jsonb_agg(jsonb_build_object('item_id',x.item_id::text,'quantity',x.quantity${kind==='gachas'?",'id',x.id::text,'weight',x.weight":''}) order by x.${kind==='gachas'?'id':'item_id'}) from public.${d.child} x where x.${d.foreign}=p.id),'[]'::jsonb) ${d.rows}`:'';
    const timestamps=kind==='gachas'?`,to_char(p.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') start_at,to_char(p.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end_at`:'';
    const rows=(await client.query(`select p.*,p.${d.pk} as id${nested}${timestamps} from public.${d.table} p where p.${d.pk}${id?'=':'>'}$1 order by p.${d.pk} limit 100`,[id||after])).rows;
    return rows.map(row=>{
        for (const key of ['stat_growth_rate','success_rate']) if (key in row) row[key]=Number(row[key]);
        if (row.rewards) {
            const total=row.rewards.reduce((sum,r)=>sum+r.weight,0);
            row.rewards=row.rewards.map(r=>({...r,probability:total?r.weight/total*100:0}));
        }
        return row;
    });
}
async function lockItems(client,ids) {
    const sorted=[...new Set(ids.filter(Boolean))].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
    for (const id of sorted) if (!(await client.query('select id from public.item where id=$1 for update',[id])).rowCount) fail('ITEM_NOT_FOUND','참조 아이템이 없습니다.',404);
}
export function createAdminMasterRepository(pool) {
    return {
        listAdminMasters:(kind,after)=>records(pool,kind,null,after),
        async getAdminMaster(kind,id) {
            const row=(await records(pool,kind,id))[0];
            if (!row) fail('ADMIN_RECORD_NOT_FOUND','대상이 없습니다.',404);
            return row;
        },
        async saveAdminMaster(userId,kind,id,input,key) {
            const {patch,requestKey}=validateMasterInput(kind,{...input,requestKey:key},!id);
            const d=definitions[kind];
            return adminTransaction(pool,async c=>{
                await requireAdminRow(c,userId);
                await checkDuplicate(c,requestKey);
                // Player EAT locks item before food; COOK/DRAW lock parent before items.
                if (kind==='foods') await lockItems(c,[id||patch.item_id]);
                if (id && !(await c.query(`select ${d.pk} from public.${d.table} where ${d.pk}=$1 for update`,[id])).rowCount) fail('ADMIN_RECORD_NOT_FOUND','대상이 없습니다.',404);
                const before=id?(await records(c,kind,id))[0]:null;
                const defaults=kind==='foods'?{blood_recovery:0,stat_growth_enabled:false,stat_growth_rate:0,stat_growth_target:null,stat_growth_value:0,rp_effect_text:null}:
                    kind==='recipes'?{result_quantity:4,learn_cost:0,failure_item_id:null,is_active:true}:{is_active:true,start_at:null,end_at:null};
                const merged={...defaults,...before,...patch};
                if (kind==='recipes') merged.result_quantity=4;
                validateMasterState(kind,merged);
                if (kind==='gachas' && merged.start_at && merged.end_at) {
                    const period=(await c.query('select $2::timestamptz > $1::timestamptz as valid',[merged.start_at,merged.end_at])).rows[0];
                    if (!period.valid) fail('INVALID_ADMIN_INPUT','종료 시각은 시작 시각 이후여야 합니다.',400);
                }
                if (d.child) {
                    await lockItems(c,[merged.result_item_id,merged.failure_item_id,...(merged[d.rows]||[]).map(r=>r.item_id)]);
                    if (!merged[d.rows]?.length) fail('INVALID_ADMIN_INPUT','재료/보상을 한 개 이상 등록하세요.',400);
                }
                const values=Object.fromEntries(Object.entries(patch).filter(([k])=>k!==d.rows));
                if (kind==='recipes') values.result_quantity=4;
                const columns=Object.keys(values), params=Object.values(values);
                let savedId=id;
                if (!id) {
                    const row=(await c.query(`insert into public.${d.table} (${columns.join(',')}) values (${params.map((_,i)=>`$${i+1}`).join(',')}) returning ${d.pk}` ,params)).rows[0];
                    savedId=row[d.pk];
                } else if (columns.length) await c.query(`update public.${d.table} set ${columns.map((k,i)=>`${k}=$${i+1}`).join(',')} where ${d.pk}=$${params.length+1}`,[...params,id]);
                if (d.child && Object.hasOwn(patch,d.rows)) {
                    await c.query(`delete from public.${d.child} where ${d.foreign}=$1`,[savedId]);
                    for (const row of patch[d.rows]) {
                        const cols=[d.foreign,'item_id','quantity',...(kind==='gachas'?['weight']:[])];
                        await c.query(`insert into public.${d.child} (${cols.join(',')}) values (${cols.map((_,i)=>`$${i+1}`).join(',')})`,[savedId,row.item_id,row.quantity,...(kind==='gachas'?[row.weight]:[])]);
                    }
                }
                const after=(await records(c,kind,savedId))[0];
                await writeActionLog(c,{adminUserId:userId,category:'ADMIN',actionType:`${d.target}_${id?'UPDATE':'CREATE'}`,targetType:d.target,targetId:savedId,
                    description:'관리자 마스터 데이터 변경',detail:{before,after},requestKey});
                return after;
            });
        }
    };
}
