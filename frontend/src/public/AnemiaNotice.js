import {createContext,useContext} from 'react';
export const AnemiaPolicyContext=createContext(null);
export function anemiaText(character,policy){
 if(!character||!policy?.enabled||character.status==='DEAD'||character.status==='NEAR_DEATH'||Number(character.hp)<=0)return null;
 const blood=Number(character.blood);if(!Number.isInteger(blood)||blood<1||blood>100)return null;
 return policy.stages?.find(stage=>blood>=stage.min&&blood<=stage.max)?.name||null;
}
export default function AnemiaNotice({character}){const policy=useContext(AnemiaPolicyContext),name=anemiaText(character,policy);return name?<small aria-label="빈혈 RP 단계"> · {name}</small>:null;}
