import {AppError} from '../../shared/http.js';
import {writeActionLog} from '../../shared/game.js';
import {adminTransaction,requireAdminRow,checkDuplicate} from './transaction.js';

const definitions={
    items:{table:'item',target:'ITEM',keys:['itemId','item_id']},
    monsters:{table:'monster',target:'MONSTER',keys:['monsterId','monster_id'],lockAreas:true,
        children:[['area_monster','monster_id'],['monster_action','monster_id'],['monster_drop','monster_id']]},
    products:{table:'shop_product',target:'SHOP_PRODUCT',keys:['productId','product_id','shopProductId','shop_product_id']},
    foods:{table:'food_config',pk:'item_id',target:'FOOD_CONFIG',keys:['foodId','food_id','itemId','item_id']},
    recipes:{table:'recipe',target:'RECIPE',keys:['recipeId','recipe_id'],lockAreas:true,
        children:[['recipe_ingredient','recipe_id'],['area_recipe','recipe_id']]},
    gachas:{table:'gacha',target:'GACHA',keys:['gachaId','gacha_id'],
        children:[['gacha_reward','gacha_id']]},
    areas:{table:'area',target:'AREA',keys:['areaId','area_id'],
        children:[['area_monster','area_id'],['area_recipe','area_id']]},
    clues:{table:'clue',target:'CLUE',keys:['clueId','clue_id']},
    'investigation-results':{table:'investigation_result',target:'INVESTIGATION_RESULT',
        keys:['resultId','result_id','investigationResultId','investigation_result_id'],
        children:[['investigation_reward','investigation_result_id']]}
};

const quote=value=>'"'+value.replaceAll('"','""')+'"';
const validId=value=>typeof value==='string'&&/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n;

export function validateDeleteInput(body) {
    if (!body||Array.isArray(body)||Object.keys(body).length!==1||typeof body.requestKey!=='string'||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestKey)) {
        throw new AppError(400,'INVALID_ADMIN_INPUT','삭제 requestKey UUID가 필요합니다.');
    }
    return body.requestKey.toLowerCase();
}

function block() {
    throw new AppError(409,'ADMIN_RECORD_REFERENCED',
        '사용 기록이나 참조 데이터가 있어 영구 삭제할 수 없습니다. 공개 또는 활성 설정을 해제하세요.');
}

async function checkActionHistory(client,definition,id) {
    const targets=definition.target==='FOOD_CONFIG' ? ['FOOD_CONFIG','FOOD'] : [definition.target];
    const paths=definition.keys.map(key=>`$.**.${key}`);
    const conditions=paths.map((_,index)=>
        `exists(select 1 from jsonb_path_query(detail,$${index+3}::jsonpath) value where value #>> '{}'=$2::text)`
    );
    const found=await client.query(
        `select 1 from public.action_log where category<>'ADMIN'
         and ((target_type=any($1::text[]) and target_id::text=$2::text)
              ${conditions.length?'or '+conditions.join(' or '):''}) limit 1`,
        [targets,id,...paths]
    );
    if (found.rowCount) block();
}

async function checkForeignKeys(client,definition,id) {
    const references=(await client.query(
        `select ns.nspname as schema_name,t.relname as table_name,a.attname as column_name,
                cardinality(c.conkey) as key_count
         from pg_constraint c
         join pg_class t on t.oid=c.conrelid
         join pg_namespace ns on ns.oid=t.relnamespace
         join pg_attribute a on a.attrelid=t.oid and a.attnum=c.conkey[1]
         where c.contype='f' and c.confrelid=$1::regclass`,
        [`public.${definition.table}`]
    )).rows;
    const owned=new Set((definition.children||[]).map(([table,column])=>`public.${table}.${column}`));

    for (const ref of references) {
        if (ref.key_count!==1) block();
        if (owned.has(`${ref.schema_name}.${ref.table_name}.${ref.column_name}`)) continue;
        const found=await client.query(
            `select 1 from ${quote(ref.schema_name)}.${quote(ref.table_name)} where ${quote(ref.column_name)}=$1 limit 1`,
            [id]
        );
        if (found.rowCount) block();
    }
}

async function checkAdditionalReferences(client,kind,id,before) {
    if (kind==='clues'&&(before.is_discovered||before.first_discoverer_id||before.discovered_at)) block();

    if (kind==='products'&&before.recipe_id!=null) {
        throw new AppError(409,'RECIPE_PRODUCT_REQUIRED',
            '최초 발견된 레시피의 상점 상품은 영구 삭제할 수 없습니다. 판매 상태를 비활성화하세요.');
    }

    if (kind==='items'||kind==='recipes') {
        const column=kind==='items'?'item_id':'recipe_id';
        const found=await client.query(
            `select 1 from public.battle b where exists(
                 select 1 from jsonb_array_elements(coalesce(b.snapshot->'drops','[]'::jsonb)) d
                 where d->>$1=$2
             ) limit 1`,
            [column,id]
        );
        if (found.rowCount) block();
    }

    if (kind==='foods') {
        const used=await client.query(
            'select 1 from public.recipe where result_item_id=$1 or failure_item_id=$1 limit 1',
            [id]
        );
        if (used.rowCount) block();
    }

    if (kind==='areas') {
        const discovered=await client.query(
            `select 1 from public.area_recipe ar
             join public.recipe_discovery d on d.recipe_id=ar.recipe_id
             where ar.area_id=$1 limit 1`,
            [id]
        );
        if (discovered.rowCount) block();
    }
}

export function createAdminDeleteRepository(pool) {
    return {
        deleteAdminRecord(actor,kind,id,body,{areaId=null}={}) {
            const definition=definitions[kind];
            const requestKey=validateDeleteInput(body);
            if (!definition||!validId(String(id))) {
                throw new AppError(400,'INVALID_ADMIN_INPUT','삭제할 수 없는 종류 또는 ID입니다.');
            }
            if (kind==='investigation-results'&&!validId(String(areaId))) {
                throw new AppError(400,'INVALID_ADMIN_INPUT','조사 결과의 구역 ID가 필요합니다.');
            }

            return adminTransaction(pool,async client=>{
                // 조사/마물 편집과 동일하게 구역을 먼저 잠근다.
                if (definition.lockAreas) {
                    await client.query('select id from public.area order by id for update');
                } else if (kind==='areas'||kind==='investigation-results'||kind==='clues') {
                    let parent=kind==='areas'?id:areaId;
                    if (kind==='clues') {
                        parent=(await client.query('select area_id from public.clue where id=$1',[id])).rows[0]?.area_id;
                    }
                    if (parent!=null) {
                        await client.query('select id from public.area where id=$1 for update',[parent]);
                    }
                } else if (kind==='foods') {
                    await client.query('select id from public.item where id=$1 for update',[id]);
                }

                await requireAdminRow(client,actor);
                await checkDuplicate(client,requestKey);

                const pk=definition.pk||'id';
                const before=(await client.query(
                    `select * from public.${definition.table} where ${pk}=$1 for update`,
                    [id]
                )).rows[0];
                if (!before)throw new AppError(404,'ADMIN_RECORD_NOT_FOUND','삭제 대상이 없습니다.');
                if (kind==='investigation-results'&&String(before.area_id)!==String(areaId)) {
                    throw new AppError(404,'ADMIN_RECORD_NOT_FOUND','해당 구역의 조사 결과가 아닙니다.');
                }

                await checkActionHistory(client,definition,String(id));
                await checkForeignKeys(client,definition,id);
                await checkAdditionalReferences(client,kind,String(id),before);

                for (const [child,column] of definition.children||[]) {
                    await client.query(`delete from public.${child} where ${column}=$1`,[id]);
                }
                await client.query(`delete from public.${definition.table} where ${pk}=$1`,[id]);
                await writeActionLog(client,{
                    adminUserId:actor,
                    category:'ADMIN',
                    actionType:`${definition.target}_DELETE`,
                    targetType:definition.target,
                    targetId:id,
                    description:'미참조 콘텐츠 영구 삭제',
                    detail:{before,after:null},
                    requestKey
                });
                return {id,deleted:true};
            });
        }
    };
}
