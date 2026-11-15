import {createContext,useContext} from 'react';

export const AnemiaPolicyContext=createContext(null);

export function anemiaText(character,policy){
    if(!character||character.status==='DEAD'||character.status==='NEAR_DEATH'){
        return null;
    }

    if(character.hp!=null&&Number(character.hp)<=0){
        return null;
    }

    // 공개 목록에는 수치 대신 서버에서 계산한 단계명만 전달한다.
    if(typeof character.anemia_stage==='string'&&character.anemia_stage.trim()){
        return character.anemia_stage;
    }

    if(!policy?.enabled||character.blood==null)return null;

    const blood=Number(character.blood);
    if(!Number.isInteger(blood)||blood<1||blood>100)return null;

    return policy.stages?.find(stage=>
        blood>=Number(stage.min)&&blood<=Number(stage.max)
    )?.name||null;
}

export function characterStateText(character,policy=null){
    if(!character)return '미확인';

    if(character.status==='DEAD'||
        (character.hp!=null&&Number(character.hp)<=0)){
        return '사망';
    }

    if(character.status==='NEAR_DEATH'||
        (character.blood!=null&&Number(character.blood)<=0)){
        return '빈사';
    }

    if(character.status!=='ALIVE'){
        return character.status||'미확인';
    }

    return anemiaText(character,policy)||'생존';
}

export default function AnemiaNotice({character}){
    const policy=useContext(AnemiaPolicyContext);
    const name=anemiaText(character,policy);

    return name?<small aria-label="빈혈 RP 단계"> · {name}</small>:null;
}
