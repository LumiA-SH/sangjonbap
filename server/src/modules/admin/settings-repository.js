import {AppError} from '../../shared/http.js';
import {readNumberSettings,resourceNumber} from '../../shared/settings.js';
import {writeActionLog} from '../../shared/game.js';
import {adminTransaction,requireAdminRow,checkDuplicate} from './transaction.js';

export const balanceRequirements={
    heal_blood_cost:resourceNumber,heal_hp_recovery:resourceNumber,
    investigation_ap_cost:resourceNumber,cooking_ap_cost:resourceNumber,
    training_ap_cost:resourceNumber,training_currency_reward:resourceNumber,
    training_growth:resourceNumber,training_great_growth:resourceNumber,
    training_great_rate_b:{min:0,max:100},training_great_rate_a:{min:0,max:100},training_great_rate_s:{min:0,max:100}
};
export function validateBalanceInput(body) {
    const invalid=()=>{throw new AppError(400,'INVALID_ADMIN_INPUT','설정 이름·숫자 범위·requestKey를 확인하세요.');};
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['settings','requestKey'].includes(k)))invalid();
    if(typeof body.requestKey!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestKey))invalid();
    if(!body.settings||typeof body.settings!=='object'||Array.isArray(body.settings)||!Object.keys(body.settings).length)invalid();
    for(const [key,value] of Object.entries(body.settings)) {
        const rule=balanceRequirements[key];
        if(!rule||typeof value!=='number'||!Number.isFinite(value)||(rule.integer&&!Number.isInteger(value))||value<rule.min||value>rule.max)invalid();
    }
    return {settings:body.settings,requestKey:body.requestKey.toLowerCase()};
}
export function createAdminSettingsRepository(pool) {
    return {
        getAdminBalanceSettings:()=>readNumberSettings(pool,balanceRequirements),
        saveAdminBalanceSettings(actor,body) {
            const {settings,requestKey}=validateBalanceInput(body);
            return adminTransaction(pool,async client=>{
                await requireAdminRow(client,actor);
                await checkDuplicate(client,requestKey);
                await client.query('select config_key from public.system_config where config_key=any($1::text[]) order by config_key for update',[Object.keys(balanceRequirements)]);
                const before=await readNumberSettings(client,balanceRequirements);
                for(const key of Object.keys(settings).sort())await client.query('update public.system_config set config_value=$2::jsonb where config_key=$1',[key,JSON.stringify(settings[key])]);
                const after={...before,...settings};
                await writeActionLog(client,{adminUserId:actor,category:'ADMIN',actionType:'BALANCE_UPDATE',description:'공통 밸런스 설정 변경',detail:{before,after},requestKey});
                return after;
            });
        }
    };
}
