export function anemiaText(character){
 if(!character)return null;
 if(character.status==='DEAD'||Number(character.hp)===0)return '사망 · 빈혈 RP 단계와 별도로 사망 상태를 표시합니다.';
 if(character.status==='NEAR_DEATH'||Number(character.blood)===0)return '빈사 · 혈량 0';
 return `혈량 ${character.blood}/100 · 빈혈 RP 표시 구간은 운영진 확인 대기 중입니다. 능력치 페널티는 없습니다.`;
}
export default function AnemiaNotice({character}){return character?<p aria-label="빈혈 RP 상태">{anemiaText(character)}</p>:null;}
