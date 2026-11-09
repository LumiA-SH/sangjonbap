// RP only. Does not alter resource or growth calculations.
export function failureRpText(food,random){
 const candidates=(food.rp_effect_texts||[]).filter(text=>typeof text==='string'&&text.trim());
 if(!candidates.length)return food.rp_effect_text||'실패요리를 먹었습니다. 수치 효과는 없습니다.';
 if(candidates.length===1)return candidates[0];
 const unit=random();if(!Number.isFinite(unit)||unit<0||unit>=1)throw new Error('Invalid RP random value');
 return candidates[Math.floor(unit*candidates.length)];
}
