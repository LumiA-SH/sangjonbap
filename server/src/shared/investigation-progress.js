import {AppError} from './http.js';

// 구역별 조사율은 DB의 발견 기록을 기준으로 계산한다.
// 기존 area.investigation_rate 저장값은 사용하지 않는다.
export async function getAreaInvestigationProgress(client, areaId) {
    const result = await client.query(
        `select investigation_rate, discovered_count, total_count
         from public.investigation_progress
         where area_id=$1`,
        [areaId]
    );

    const row = result.rows[0];
    if (!row) {
        throw new AppError(404, 'AREA_NOT_FOUND', '존재하지 않는 조사 지역입니다.');
    }

    return {
        rate: Number(row.investigation_rate),
        discoveredCount: Number(row.discovered_count),
        totalCount: Number(row.total_count)
    };
}