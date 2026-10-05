export function createMemoryRepository(userId='1') {
  const user={id:userId,character_id:'1',role:'USER',is_active:true};
  const character={id:'1',name:'개발 생존자',profile_image_url:null,hunter_grade:'B',has_ability:false,ability_name:null,ability_grade:null,hp:100,max_hp:100,blood:100,max_blood:100,ap:10,max_ap:10,atk:10,def:10,agi:10,currency:0,status:'ALIVE',death_count:0,revive_count:0,daily_meal_count:0,daily_training_done:false,is_active:true};
  return {getUser:async id=>id===user.id?{...user}:null,getCharacter:async id=>id===user.id&&user.is_active?{...character}:null,updateProfile:async(id,patch)=>{if(id!==user.id||!user.is_active)return null;Object.assign(character,patch);return {...character};},check:async()=>({mode:'memory',persistent:false})};
}
