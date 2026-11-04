import {AppError} from '../../shared/http.js';
import {writeActionLog} from '../../shared/game.js';
import {adminTransaction,requireAdminRow,checkDuplicate} from './transaction.js';

const quote=value=>'"'+value.replaceAll('"','""')+'"';
export function validateDeleteInput(body) {
    if(!body||Object.keys(body).length!==1||typeof body.requestKey!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestKey))
        throw new AppError(400,'INVALID_ADMIN_INPUT','삭제 requestKey UUID가 필요합니다.');
    return body.requestKey.toLowerCase();
}
export function createAdminDeleteRepository(pool) {
    return {deleteAdminRecord(actor,kind,id,body) {
        const table={items:'item',monsters:'monster'}[kind],requestKey=validateDeleteInput(body);
        if(!table)throw new AppError(400,'INVALID_ADMIN_INPUT','삭제할 수 없는 종류입니다.');
        return adminTransaction(pool,async client=>{
            // Same order as monster edits and investigation encounters.
            if(kind==='monsters')await client.query('select id from public.area order by id for update');
            await requireAdminRow(client,actor);await checkDuplicate(client,requestKey);
            const before=(await client.query(`select * from public.${table} where id=$1 for update`,[id])).rows[0];
            if(!before)throw new AppError(404,'ADMIN_RECORD_NOT_FOUND','삭제 대상이 없습니다.');
            const blocked=()=>{throw new AppError(409,'ADMIN_RECORD_REFERENCED','참조 또는 전투 기록이 있어 영구 삭제할 수 없습니다. 비활성화를 사용하세요.');};
            const history=await client.query(`select 1 from public.action_log where category<>'ADMIN' and
                ((target_type=$1 and target_id::text=$2::text) or exists(select 1 from jsonb_path_query(detail,$3::jsonpath) value where value #>> '{}'=$2::text)
                 or exists(select 1 from jsonb_path_query(detail,$4::jsonpath) value where value #>> '{}'=$2::text)) limit 1`,
                [table.toUpperCase(),id,`$.**.${table}Id`,`$.**.${table}_id`]);
            if(history.rowCount)blocked();
            // Inspect actual FK metadata so even CASCADE constraints cannot remove gameplay data.
            const refs=(await client.query(`select ns.nspname as schema_name,t.relname as table_name,a.attname as column_name,
                cardinality(c.conkey) as key_count from pg_constraint c
                join pg_class t on t.oid=c.conrelid join pg_namespace ns on ns.oid=t.relnamespace
                join pg_attribute a on a.attrelid=t.oid and a.attnum=c.conkey[1]
                where c.contype='f' and c.confrelid=$1::regclass`,[`public.${table}`])).rows;
            const owned=new Set(['area_monster','monster_action','monster_drop']);
            for(const ref of refs) {
                if(kind==='monsters'&&ref.schema_name==='public'&&owned.has(ref.table_name)&&ref.column_name==='monster_id'&&ref.key_count===1)continue;
                if(ref.key_count!==1)blocked();
                const found=await client.query(`select 1 from ${quote(ref.schema_name)}.${quote(ref.table_name)} where ${quote(ref.column_name)}=$1 limit 1`,[id]);
                if(found.rowCount)blocked();
            }
            if(kind==='items') {
                const snapshots=await client.query(`select 1 from public.battle b where exists
                    (select 1 from jsonb_array_elements(coalesce(b.snapshot->'drops','[]'::jsonb)) d where d->>'item_id'=$1) limit 1`,[String(id)]);
                if(snapshots.rowCount)blocked();
            } else {
                for(const child of owned)await client.query(`delete from public.${child} where monster_id=$1`,[id]);
            }
            await client.query(`delete from public.${table} where id=$1`,[id]);
            await writeActionLog(client,{adminUserId:actor,category:'ADMIN',actionType:`${table.toUpperCase()}_DELETE`,targetType:table.toUpperCase(),targetId:id,description:'미참조 콘텐츠 영구 삭제',detail:{before,after:null},requestKey});
            return {id,deleted:true};
        });
    }};
}
