import {AppError} from '../../shared/http.js';
import {actionTransaction,requireActionCharacter,requireNoActiveBattle,rejectActionDuplicate,currentKstDay} from '../../shared/actions.js';
import {lockCharacterPairByUser,changeCharacterResources,writeActionLog} from '../../shared/game.js';
import {readPolicy} from '../admin/operating-policy.js';
import {requestKey} from '../admin/master-service.js';
import {validId} from '../admin/service.js';
import {bloodLimit} from '../../shared/balance.js';

const fail=(code,message)=>{throw new AppError(409,code,message);};
export function createDonationRepository(pool){
 async function perform(userId,targetId,body){
  if(!validId(targetId))throw new AppError(400,'INVALID_CHARACTER_ID','대상 ID를 확인하세요.');
  const key=body?requestKey(body):null;
  if(body&&Object.keys(body).some(k=>!['requestKey','expected'].includes(k)))throw new AppError(400,'INVALID_REQUEST','허용되지 않은 필드입니다.');
  return actionTransaction(pool,async c=>{
   if(key)await rejectActionDuplicate(c,key);
   const {provider,target}=await lockCharacterPairByUser(c,userId,targetId);
   if(key)await rejectActionDuplicate(c,key);
   requireActionCharacter(provider);requireActionCharacter(target,{allowNearDeath:true});
   if(String(provider.id)===String(target.id))fail('SELF_DONATION','자신에게 직접 헌혈할 수 없습니다.');
   for(const character of [provider,target].sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1))await requireNoActiveBattle(c,character);
   // Same ordering as admin: actor auth row before policy. Policy editor never locks characters.
   const settings=await readPolicy(c,'donation',true);
   if(!settings.enabled)fail('DONATION_DISABLED','직접 헌혈은 비활성 상태입니다.');
   if(Number(provider.blood)-settings.cost<settings.minimumRemaining)fail('NOT_ENOUGH_BLOOD','헌혈 후 최소 잔여 혈량을 지킬 수 없습니다.');
   const recovery=Math.min(settings.recovery,bloodLimit(target)-Number(target.blood));
   if(recovery<=0)fail('TARGET_BLOOD_FULL','대상의 혈량이 이미 최대입니다.');
   const day=await currentKstDay(c);
   if(settings.dailyLimitEnabled){
    const count=Number((await c.query("select count(*) as count from public.action_log where character_id=$1 and action_type='DIRECT_DONATION' and detail->>'dailyTransactionDay'=$2",[provider.id,day])).rows[0].count);
    if(count>=settings.dailyLimit)fail('DONATION_DAILY_LIMIT','오늘의 헌혈 횟수를 모두 사용했습니다.');
   }
   const expected={targetId:String(target.id),targetName:target.name,cost:settings.cost,recovery,settings};
   if(!body)return expected;
   // Compare JSON structurally in PostgreSQL; never trust browser cost or recipient recovery.
   if(!(await c.query('select $1::jsonb=$2::jsonb as same',[JSON.stringify(body.expected??null),JSON.stringify(expected)])).rows[0].same)fail('DONATION_PREVIEW_CHANGED','대상 또는 정책이 변경되었습니다. 다시 확인하세요.');
   const donor=await changeCharacterResources(c,provider,{blood:-settings.cost});
   const recipient=await changeCharacterResources(c,target,{blood:recovery});
   const result={...expected,donorBlood:donor.blood,recipientBlood:recipient.blood};
   await writeActionLog(c,{characterId:provider.id,category:'CHARACTER',actionType:'DIRECT_DONATION',targetType:'CHARACTER',targetId:target.id,description:`${target.name}에게 직접 헌혈`,detail:{...result,donorBefore:provider.blood,recipientBefore:target.blood},requestKey:key});
   return result;
  });
 }
 return {previewDonation:(u,t)=>perform(u,t),donateBlood:perform};
}
