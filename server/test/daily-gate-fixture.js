// Fixed, inactive reset state for existing business-rule unit tests. Real locking
// and midnight transitions are exercised separately against isolated PostgreSQL.
export function dailyGateFixture(sql) {
    // Existing rule tests run with automatic announcements unconfigured.
    if(sql === "select config_value from public.system_config where config_key='operating_announcements'")return {rows:[],rowCount:0};
    if (sql === "set local lock_timeout = '5s'") return {rows:[],rowCount:0};
    if (sql.includes('from public.daily_reset_state') && sql.includes('for share'))
        return {rows:[{start_date:null,last_completed_date:null}],rowCount:1};
    if (sql === "select (clock_timestamp() at time zone 'Asia/Seoul')::date::text as day")
        return {rows:[{day:'2026-11-08'}],rowCount:1};
    return null;
}
