import {pathToFileURL} from 'node:url';
import {loadConfig} from '../src/config/env.js';
import {createPool} from '../src/db/pool.js';

const marker = 'SANGJONBAP_DEV_INVESTIGATION_V1';
const names = {
  item: '[DEV 조사 v1] 검증용 보급품', clue: '[DEV 조사 v1] 검증용 단서',
  normal: '[DEV 조사 v1] 일반 보상 지역', unique: '[DEV 조사 v1] 최초 발견 지역'
};
const texts = {normal: '[DEV 조사 v1] 보급품을 발견했습니다.', unique: '[DEV 조사 v1] 고유 단서와 보급품을 발견했습니다.'};
const descriptions = {
  item: '[DEV 조사 v1] 조사 보상과 창고 입출고를 검증하는 아이템입니다.',
  normal: '[DEV 조사 v1] 조사할 때마다 검증용 보급품 1개를 받습니다. 진행률은 증가하지 않습니다.',
  unique: '[DEV 조사 v1] 최초 조사에서 진행률이 25% 증가합니다. 다시 조사해도 보급품과 단서를 받습니다.',
  clue: '[DEV 조사 v1] 이 단서는 조사 응답 표시 검증용입니다. 최초 발견은 전체 캐릭터 기준으로 한 번만 처리됩니다.'
};

async function only(rows, label) {
  if (rows.length > 1) throw new Error(`${label}: 동일 식별자가 중복되어 있습니다. 수동 확인이 필요합니다.`);
  return rows[0] || null;
}

export async function manageDevInvestigationData(client, {remove = false} = {}) {
  // No schema change: serialize this seed/cleanup across repeated processes.
  await client.query('select pg_advisory_xact_lock(hashtext($1))', [marker]);
  async function named(table, name, extra = {}) {
    const description = extra.description || marker;
    const r = await client.query(`select * from public.${table} where name=$1 for update`, [name]);
    let row = await only(r.rows, name);
    if (row && row.description !== description) throw new Error(`${name}: 관리 대상이 아닌 기존 데이터와 이름이 충돌합니다.`);
    if (!row && !remove) {
      const fields = {name, description, ...extra};
      const keys = Object.keys(fields);
      row = (await client.query(`insert into public.${table} (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) returning *`, Object.values(fields))).rows[0];
    }
    return row;
  }
  const item = await named('item', names.item, {description: descriptions.item, category: 'ETC', transferable: true, is_active: true});
  const normal = await named('area', names.normal, {description: descriptions.normal, is_open: true, sort_order: 9001});
  const unique = await named('area', names.unique, {description: descriptions.unique, is_open: true, sort_order: 9002});
  let clue = await only((await client.query('select * from public.clue where title=$1 for update', [names.clue])).rows, names.clue);
  if (clue && (clue.content !== descriptions.clue || clue.area_id !== unique?.id)) throw new Error('DEV 단서가 수정되었거나 다른 지역에 연결되어 있습니다.');
  if (!clue && !remove) clue = (await client.query(
    'insert into public.clue(area_id,title,content,related_target) values ($1,$2,$3,$4) returning *',
    [unique.id, names.clue, descriptions.clue, 'DEV 콘솔 단서 표시 검증']
  )).rows[0];

  const results = [];
  for (const [type, area] of [['normal', normal], ['unique', unique]]) {
    if (!area) continue;
    let result = await only((await client.query(
      'select * from public.investigation_result where area_id=$1 and result_text=$2 for update', [area.id, texts[type]]
    )).rows, texts[type]);
    if (!result && !remove) result = (await client.query(
      `insert into public.investigation_result(area_id,result_grade,result_text,weight,is_unique,investigation_rate_value,clue_id)
       values ($1,'NORMAL',$2,1,$3,$4,$5) returning *`,
      [area.id, texts[type], type === 'unique', type === 'unique' ? 25 : 0, type === 'unique' ? clue.id : null]
    )).rows[0];
    if (!result) continue;
    results.push(result);
    if (!remove) {
      const rewards = await client.query('select * from public.investigation_reward where investigation_result_id=$1 and item_id=$2', [result.id, item.id]);
      await only(rewards.rows, 'DEV 보상');
      if (!rewards.rowCount) await client.query(
        'insert into public.investigation_reward(investigation_result_id,item_id,quantity,probability) values ($1,$2,1,100)', [result.id, item.id]
      );
    }
  }
  const ids = {areaIds: [normal?.id, unique?.id].filter(Boolean), itemId: item?.id || null,
    clueId: clue?.id || null, resultIds: results.map(result => result.id)};

  if (remove) {
    // Extra content is never silently deleted; foreign references also make the transaction fail.
    const extras = await client.query(
      'select id from public.investigation_result where area_id=any($1::bigint[]) and not(id=any($2::bigint[]))', [ids.areaIds, ids.resultIds]
    );
    if (extras.rowCount) throw new Error('DEV 지역에 별도 조사 결과가 있습니다. 삭제를 중단합니다.');
    await client.query('delete from public.unique_discovery where investigation_result_id=any($1::bigint[])', [ids.resultIds]);
    await client.query('delete from public.investigation_reward where investigation_result_id=any($1::bigint[])', [ids.resultIds]);
    await client.query('delete from public.investigation_result where id=any($1::bigint[])', [ids.resultIds]);
    if (clue) await client.query('delete from public.clue where id=$1', [clue.id]);
    await client.query("delete from public.action_log where category='INVESTIGATION' and target_type='AREA' and target_id=any($1::bigint[])", [ids.areaIds]);
    await client.query('delete from public.area where id=any($1::bigint[])', [ids.areaIds]);
    if (item) {
      await client.query("delete from public.action_log where category='INVENTORY' and target_type='ITEM' and target_id=$1", [item.id]);
      await client.query('delete from public.inventory where item_id=$1', [item.id]);
      await client.query('delete from public.storage where item_id=$1', [item.id]);
      await client.query('delete from public.item where id=$1', [item.id]);
    }
  }
  return {mode: remove ? 'deleted' : 'ready', ...ids};
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--delete')) throw new Error('사용법: node server/scripts/dev-investigation-data.js [--delete]');
  const config = loadConfig();
  if (config.mode !== 'supabase' || config.nodeEnv === 'production') throw new Error('Supabase 로컬 개발 모드에서만 실행하세요.');
  const pool = createPool(config);
  let client;
  try {
    client = await pool.connect();
    await client.query('begin');
    const result = await manageDevInvestigationData(client, {remove: args.includes('--delete')});
    await client.query('commit');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (client) await client.query('rollback');
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error('DEV 데이터 작업 실패:', error.message); process.exitCode = 1; });
}
