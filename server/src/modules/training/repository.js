import {AppError} from '../../shared/http.js';
import {lockCharacterByUser,changeCharacterResources,writeActionLog} from '../../shared/game.js';
import {readNumberSettings,resourceNumber} from '../../shared/settings.js';
import {requireNoActiveBattle,actionTransaction,requireActionCharacter,currentKstDay,rejectActionDuplicate} from '../../shared/actions.js';
import {loadTrainingGrowthContext,calculateTrainingGrowth} from './growth.js';
import {randomUnit,winsReward} from '../investigation/random.js';

export function createTrainingRepository(pool,{random=randomUnit}={}) {
    return {
        trainCharacter(userId,key) {
            return actionTransaction(pool,async c=>{
                const before=await lockCharacterByUser(c,userId);
                await rejectActionDuplicate(c,key);requireActionCharacter(before);await requireNoActiveBattle(c,before);
                const day=await currentKstDay(c);
                const previous=(await c.query('select last_training_date::text as day from public.game_character where id=$1',[before.id])).rows[0].day;
                if (previous && previous>=day) throw new AppError(409,'TRAINING_ALREADY_DONE','오늘 훈련을 완료했습니다.');
                const rateKey=`training_great_rate_${before.hunter_grade.toLowerCase()}`;
                const settings=await readNumberSettings(c,{training_ap_cost:resourceNumber,training_currency_reward:resourceNumber,
                    training_growth:resourceNumber,training_great_growth:resourceNumber,[rateKey]:{min:0,max:100}});
                if (before.ap<settings.training_ap_cost) throw new AppError(409,'NOT_ENOUGH_AP','AP가 부족합니다.');
                if (Number(before.currency)+settings.training_currency_reward>2147483647) throw new AppError(409,'CURRENCY_LIMIT_CONFLICT','재화 저장 범위를 초과합니다.');
                const context=await loadTrainingGrowthContext(c,before);
                let growth=null,great=false;
                if (context.candidates.length) {
                    great=winsReward(settings[rateKey],random);
                    const unit=random();if(!Number.isFinite(unit)||unit<0||unit>=1)throw new Error('Invalid RNG');
                    const stat=context.candidates[Math.floor(unit*context.candidates.length)];
                    growth=calculateTrainingGrowth(before,context,stat,great?settings.training_great_growth:settings.training_growth);
                }
                const after=await changeCharacterResources(c,before,{ap:-settings.training_ap_cost,currency:settings.training_currency_reward});
                if(growth)await c.query(`update public.game_character set ${growth.stat}=$1 where id=$2`,[growth.after,before.id]);
                await c.query('update public.game_character set daily_training_done=true,last_training_date=$1 where id=$2',[day,before.id]);
                const result={day,great,growth,currency:after.currency,reward:settings.training_currency_reward,ap:after.ap,permanentStatCap:context.cap};
                await writeActionLog(c,{characterId:before.id,category:'TRAINING',actionType:'DAILY_TRAINING',description:'일일훈련 완료',detail:result,requestKey:key});
                return result;
            });
        }
    };
}
