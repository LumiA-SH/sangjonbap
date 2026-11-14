import {writeActionLog} from '../../shared/game.js';
import {validateMasterInput,validateMasterState} from './master-service.js';
import {adminTransaction,requireAdminRow,checkDuplicate,fail} from './transaction.js';
import {saveGachaStock} from './gacha-stock.js';
import {lockRecipeAreas,saveRecipeAreas,validateRecipeFoodLinks} from './recipe-support.js';

const definitions={
    'food-grades':{table:'food_grade',pk:'id',target:'FOOD_GRADE'},
    areas:{table:'area',pk:'id',target:'AREA'},
    foods:{table:'food_config',pk:'item_id',target:'FOOD_CONFIG'},
    recipes:{table:'recipe',pk:'id',target:'RECIPE',child:'recipe_ingredient',foreign:'recipe_id',rows:'ingredients'},
    gachas:{table:'gacha',pk:'id',target:'GACHA',child:'gacha_reward',foreign:'gacha_id',rows:'rewards'}
};

// One SQL snapshot for parent and children, including bigint IDs as strings.
async function records(client,kind,id,after='0') {
    const d=definitions[kind];
    const nested=d.child?`,coalesce((select jsonb_agg(jsonb_build_object('item_id',x.item_id::text,'quantity',x.quantity${kind==='gachas'?",'id',x.id::text,'weight',x.weight,'is_active',x.is_active,'max_stock',x.max_stock,'remaining_stock',x.remaining_stock,'name',(select name from public.item where id=x.item_id)":''}) order by x.${kind==='gachas'?'id':'item_id'}) from public.${d.child} x where x.${d.foreign}=p.id),'[]'::jsonb) ${d.rows}`:'';
    const areaRecipes=kind==='recipes'?`,coalesce((select jsonb_agg(jsonb_build_object(
        'area_id',ar.area_id::text,'area_name',a.name,'weight',ar.weight,
        'drop_rate',ar.drop_rate,'discovered',exists(select 1 from public.recipe_discovery d where d.recipe_id=p.id)
    ) order by ar.area_id)
    from public.area_recipe ar join public.area a on a.id=ar.area_id
    where ar.recipe_id=p.id),'[]'::jsonb) area_recipes`:'';
    const timestamps=kind==='gachas'?`,to_char(p.start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') start_at,to_char(p.end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end_at`:'';
    const progressSelect=kind==='areas'?',ip.investigation_rate as calculated_investigation_rate':'';
    const progressJoin=kind==='areas'?' left join public.investigation_progress ip on ip.area_id=p.id':'';

    const rows=(await client.query(
        `select p.*,p.${d.pk} as id${kind==='foods'?`,(p.is_failure or exists(select 1 from public.recipe r where r.failure_item_id=p.item_id)) as effective_failure`:''}${nested}${areaRecipes}${timestamps}${progressSelect}
         from public.${d.table} p${progressJoin}
         where p.${d.pk}${id?'=':'>'}$1 order by p.${d.pk} limit 100`,
        [id||after]
    )).rows;

    return rows.map(row=>{
        if (kind==='areas') {
            row.investigation_rate=Number(row.calculated_investigation_rate);
            delete row.calculated_investigation_rate;
        }

        for (const key of ['stat_growth_rate','success_rate','encounter_rate','investigation_rate']) {
            if (key in row)row[key]=Number(row[key]);
        }

        if (row.rewards) {
            const total=row.rewards.filter(r=>r.is_active!==false).reduce((sum,r)=>sum+(r.remaining_stock||0),0);
            row.remainingStock=total;
            row.stockHold=row.rewards.some(r=>r.is_active!==false&&r.max_stock==null);
            row.rewards=row.rewards.map(r=>({...r,probability:total&&r.is_active!==false?(r.remaining_stock||0)/total*100:0}));
        }

        return row;
    });
}

async function lockItems(client,ids) {
    const sorted=[...new Set(ids.filter(Boolean))].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);

    for (const id of sorted) {
        if (!(await client.query('select id from public.item where id=$1 for update',[id])).rowCount) {
            fail('ITEM_NOT_FOUND','참조 아이템이 없습니다.',404);
        }
    }
}

export function createAdminMasterRepository(pool) {
    return {
        deleteFoodGrade(userId,id,key) {
            return adminTransaction(pool,async c=>{
                await requireAdminRow(c,userId);
                await checkDuplicate(c,key);

                const before=(await c.query('select * from public.food_grade where id=$1 for update',[id])).rows[0];
                if (!before)fail('ADMIN_RECORD_NOT_FOUND','등급이 없습니다.',404);

                if ((await c.query('select 1 from public.food_config where grade_id=$1 limit 1',[id])).rowCount) {
                    fail('FOOD_GRADE_IN_USE','사용 중인 등급은 삭제할 수 없습니다. 비활성화를 사용하세요.');
                }

                await c.query('delete from public.food_grade where id=$1',[id]);

                await writeActionLog(c,{
                    adminUserId:userId,
                    category:'ADMIN',
                    actionType:'FOOD_GRADE_DELETE',
                    targetType:'FOOD_GRADE',
                    targetId:id,
                    description:'미참조 음식 등급 삭제',
                    detail:{before,after:null},
                    requestKey:key
                });

                return {deleted:true};
            });
        },

        listAdminMasters:(kind,after)=>records(pool,kind,null,after),

        async getAdminMaster(kind,id) {
            const row=(await records(pool,kind,id))[0];
            if (!row)fail('ADMIN_RECORD_NOT_FOUND','대상이 없습니다.',404);
            return row;
        },

        async saveAdminMaster(userId,kind,id,input,key) {
            const {patch,requestKey}=validateMasterInput(kind,{...input,requestKey:key},!id);
            const d=definitions[kind];

            return adminTransaction(pool,async c=>{
                const originalAreas=kind==='recipes'&&Object.hasOwn(patch,'area_recipes')
                    ?await lockRecipeAreas(c,id,patch.area_recipes):null;

                // Investigation locks area before auth/character. Match it for an admin playing concurrently.
                if (kind==='areas' && id && !(await c.query('select id from public.area where id=$1 for update',[id])).rowCount) {
                    fail('ADMIN_RECORD_NOT_FOUND','대상이 없습니다.',404);
                }

                await requireAdminRow(c,userId);
                await checkDuplicate(c,requestKey);

                // Player EAT locks item before food; COOK/DRAW lock parent before items.
                if (kind==='foods')await lockItems(c,[id||patch.item_id]);

                if (id && kind!=='areas' && !(await c.query(
                    `select ${d.pk} from public.${d.table} where ${d.pk}=$1 for update`,
                    [id]
                )).rowCount) {
                    fail('ADMIN_RECORD_NOT_FOUND','대상이 없습니다.',404);
                }

                const before=id?(await records(c,kind,id))[0]:null;

                if (kind==='recipes' && before && Object.hasOwn(patch,'discovery_grade') &&
                    patch.discovery_grade!==before.discovery_grade &&
                    (await c.query('select 1 from public.recipe_discovery where recipe_id=$1',[id])).rowCount) {
                    fail('RECIPE_GRADE_CHANGE_HOLD','발견 이후 등급·가격 변경 정책은 별도 확인이 필요합니다.');
                }

                const defaults=kind==='foods'
                    ? {blood_recovery:0,stat_growth_enabled:false,stat_growth_rate:0,stat_growth_target:null,stat_growth_value:0,rp_effect_text:null}
                    : kind==='recipes'
                        ? {result_quantity:3,learn_cost:0,failure_item_id:null,is_active:true}
                        : {is_active:true,start_at:null,end_at:null};

                const merged={...defaults,...before,...patch};
                validateMasterState(kind,merged);

                if (kind==='gachas' && merged.start_at && merged.end_at) {
                    const period=(await c.query(
                        'select $2::timestamptz > $1::timestamptz as valid',
                        [merged.start_at,merged.end_at]
                    )).rows[0];

                    if (!period.valid)fail('INVALID_ADMIN_INPUT','종료 시각은 시작 시각 이후여야 합니다.',400);
                }

                if (d.child) {
                    await lockItems(c,[
                        merged.result_item_id,
                        merged.failure_item_id,
                        ...(merged[d.rows]||[]).map(r=>r.item_id)
                    ]);

                    if (kind==='recipes' && !merged[d.rows]?.length) {
                        fail('INVALID_ADMIN_INPUT','재료를 한 개 이상 등록하세요.',400);
                    }
                }

                if (kind==='foods' && merged.grade_id &&
                    !(await c.query('select id from public.food_grade where id=$1 and is_active',[merged.grade_id])).rowCount) {
                    fail('FOOD_GRADE_NOT_FOUND','활성 음식 등급을 선택하세요.',400);
                }

                if (kind==='recipes')await validateRecipeFoodLinks(c,id,merged,before);

                const values=Object.fromEntries(
                    Object.entries(patch).filter(([k])=>k!==d.rows&&k!=='area_recipes')
                );
                const columns=Object.keys(values);
                const params=Object.values(values);
                let savedId=id;

                if (!id) {
                    const row=(await c.query(
                        `insert into public.${d.table} (${columns.join(',')}) values (${params.map((_,i)=>`$${i+1}`).join(',')}) returning ${d.pk}`,
                        params
                    )).rows[0];

                    savedId=row[d.pk];
                } else if (columns.length) {
                    await c.query(
                        `update public.${d.table} set ${columns.map((k,i)=>`${k}=$${i+1}`).join(',')} where ${d.pk}=$${params.length+1}`,
                        [...params,id]
                    );
                }

                if (kind==='gachas' && Object.hasOwn(patch,'rewards')) {
                    await saveGachaStock(c,savedId,before,patch.rewards);
                } else if (d.child && Object.hasOwn(patch,d.rows)) {
                    await c.query(`delete from public.${d.child} where ${d.foreign}=$1`,[savedId]);

                    for (const row of patch[d.rows]) {
                        const cols=[d.foreign,'item_id','quantity',...(kind==='gachas'?['weight','is_active']:[])];

                        await c.query(
                            `insert into public.${d.child} (${cols.join(',')}) values (${cols.map((_,i)=>`$${i+1}`).join(',')})`,
                            [savedId,row.item_id,row.quantity,...(kind==='gachas'?[row.weight,row.is_active??true]:[])]
                        );
                    }
                }

                if (kind==='recipes' && Object.hasOwn(patch,'area_recipes')) {
                    await saveRecipeAreas(c,savedId,patch.area_recipes,originalAreas);
                }

                const after=(await records(c,kind,savedId))[0];

                await writeActionLog(c,{
                    adminUserId:userId,
                    category:'ADMIN',
                    actionType:`${d.target}_${id?'UPDATE':'CREATE'}`,
                    targetType:d.target,
                    targetId:savedId,
                    description:'관리자 마스터 데이터 변경',
                    detail:{before,after},
                    requestKey
                });

                return after;
            });
        }
    };
}