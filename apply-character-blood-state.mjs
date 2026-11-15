import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';

const root=process.cwd();
const files=[
    'frontend/src/public/AnemiaNotice.js',
    'frontend/src/App.js',
    'frontend/src/dev/CharacterPanel.js',
    'frontend/src/public/CharacterDirectory.js',
    'frontend/src/dev/PublicCharacterPanel.js',
    'server/src/modules/character/interactions.js',
    'server/test/p3-public-content.test.js'
];

const originals=new Map();
const edits=new Map();

for(const file of files){
    const path=resolve(root,file);
    if(!existsSync(path))throw new Error(`파일을 찾을 수 없습니다: ${file}`);

    const original=readFileSync(path,'utf8');
    originals.set(file,original);
    edits.set(file,original.replace(/\r\n/g,'\n'));
}

function replaceOnce(source,before,after,label){
    const pos=source.indexOf(before);
    if(pos<0||source.indexOf(before,pos+before.length)>=0){
        throw new Error(`${label}: 수정 위치를 찾지 못했거나 중복되었습니다.`);
    }
    return source.slice(0,pos)+after+source.slice(pos+before.length);
}

function removeRange(source,start,end,label){
    const a=source.indexOf(start);
    const b=a<0?-1:source.indexOf(end,a+start.length);

    if(a<0||b<0){
        throw new Error(`${label}: 기존 코드 범위를 확인할 수 없습니다.`);
    }

    return source.slice(0,a)+source.slice(b);
}

function removeStatusNames(source){
    return source.replace(
        /const statusNames\s*=\s*\{[\s\S]*?\};\s*/,
        ''
    );
}

function edit(file,fn){
    edits.set(file,fn(edits.get(file)));
}

// 1. 공통 혈량 상태 판정
edit('frontend/src/public/AnemiaNotice.js',source=>{
    if(source.includes('export function characterStateText('))return source;

    if(!source.includes('export function anemiaText(')||
        !source.includes('AnemiaPolicyContext')){
        throw new Error('AnemiaNotice.js 구조가 예상과 다릅니다.');
    }

    return `import {createContext,useContext} from 'react';

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
`;
});

// 2. 메인 화면
edit('frontend/src/App.js',source=>{
    if(!source.includes('characterStateText} from')){
        source=replaceOnce(
            source,
            "import AnemiaNotice, {AnemiaPolicyContext} from './public/AnemiaNotice';",
            "import AnemiaNotice, {AnemiaPolicyContext,characterStateText} from './public/AnemiaNotice';",
            '메인 import'
        );
    }

    if(source.includes('function getMainCharacterStatus(character) {')){
        source=removeRange(
            source,
            'function getMainCharacterStatus(character) {',
            'function HomeDailyTraining({character, busy, run, refresh, today}) {',
            '메인 기존 상태 함수'
        );
    }

    if(source.includes('{getMainCharacterStatus(character)}')){
        source=replaceOnce(
            source,
            '{getMainCharacterStatus(character)}',
            '{characterStateText(character,anemiaPolicy)}',
            '메인 상태 출력'
        );
    }

    if(!source.includes('const adminWasOpen = useRef(false);')){
        source=replaceOnce(
            source,
            '  const running = useRef(false);',
            '  const running = useRef(false);\n  const adminWasOpen = useRef(false);',
            '관리자 화면 복귀 추적'
        );
    }

    if(!source.includes('async function refreshAfterAdmin()')){
        const addition=`  async function refreshAfterAdmin(){
    try{
      const result=await api('/characters/me');
      setCharacter(result.character);
      setErrors(previous=>({...previous,character:undefined}));
    }catch(error){
      setErrors(previous=>({...previous,character:error.message}));
    }
  }

  useEffect(()=>{
    if(adminOpen){
      adminWasOpen.current=true;
      return;
    }

    if(!adminWasOpen.current)return;
    adminWasOpen.current=false;

    if(loggedIn&&user?.character_id){
      refreshAfterAdmin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[adminOpen,loggedIn,user?.character_id]);

`;

        source=replaceOnce(
            source,
            "  useEffect(() => {\n    if (!loggedIn || !user?.character_id) {",
            addition+"  useEffect(() => {\n    if (!loggedIn || !user?.character_id) {",
            '관리자 복귀 후 새로고침'
        );
    }

    return source;
});

// 3. 내 캐릭터 탭
edit('frontend/src/dev/CharacterPanel.js',source=>{
    if(!source.includes('useContext')){
        source=replaceOnce(
            source,
            "import {useEffect, useState} from 'react';",
            "import {useContext,useEffect,useState} from 'react';",
            '내 캐릭터 React import'
        );
    }

    if(!source.includes("characterStateText} from '../public/AnemiaNotice'")){
        source=replaceOnce(
            source,
            "import {publicAsset} from '../publicAsset';",
            "import {publicAsset} from '../publicAsset';\nimport {AnemiaPolicyContext,characterStateText} from '../public/AnemiaNotice';",
            '내 캐릭터 상태 import'
        );
    }

    source=removeStatusNames(source);

    if(!source.includes('const anemiaPolicy=useContext(AnemiaPolicyContext);')){
        source=replaceOnce(
            source,
            '  const [imageFailed, setImageFailed] = useState(false);',
            '  const [imageFailed, setImageFailed] = useState(false);\n  const anemiaPolicy=useContext(AnemiaPolicyContext);',
            '내 캐릭터 운영 정책'
        );
    }

    source=source.replace(
        /\{statusNames\[character\.status\]\s*\|\|\s*character\.status\s*\|\|\s*'미확인'\}/,
        '{characterStateText(character,anemiaPolicy)}'
    );

    if(!source.includes('{characterStateText(character,anemiaPolicy)}')){
        throw new Error('내 캐릭터 상태 출력 위치를 찾을 수 없습니다.');
    }

    return source;
});

// 4. 공개 캐릭터 목록 및 프로필
edit('frontend/src/public/CharacterDirectory.js',source=>{
    if(!source.includes("import {characterStateText} from './AnemiaNotice';")){
        source=replaceOnce(
            source,
            "import PublicCharacterPanel from '../dev/PublicCharacterPanel';",
            "import PublicCharacterPanel from '../dev/PublicCharacterPanel';\nimport {characterStateText} from './AnemiaNotice';",
            '공개 캐릭터 import'
        );
    }

    // 기존 GitHub 코드와 이전에 전달한 코드 모두 처리
    source=source.replace(
        /const status\s*=\s*statusNames\[character\.status\]\s*\|\|\s*character\.status\s*\|\|\s*'미확인';/,
        'const status=characterStateText(character);'
    );

    source=source.replace(
        /const anemiaStage\s*=\s*character\.status\s*===\s*'ALIVE'\s*\?\s*character\.anemia_stage\s*:\s*null;/,
        ''
    );

    source=removeStatusNames(source);

    source=source.replace(
        /\{statusNames\[character\.status\]\s*\|\|\s*character\.status\s*\|\|\s*'미확인'\}/,
        '{characterStateText(character)}'
    );

    source=source.replace(
        "{status}{anemiaStage?` · ${anemiaStage}`:''}",
        '{status}'
    );

    if(!source.includes('characterStateText(character)')){
        throw new Error('공개 캐릭터 상태 출력 위치를 찾을 수 없습니다.');
    }

    if(/\bstatusNames\b|\banemiaStage\b/.test(source)){
        throw new Error('공개 캐릭터에서 이전 상태 계산 코드가 남았습니다.');
    }

    return source;
});

// 5. 로그인 후 타 캐릭터 상세
edit('frontend/src/dev/PublicCharacterPanel.js',source=>{
    if(!source.includes('useContext')){
        source=source.replace(
            /import\s*\{\s*useEffect\s*,\s*useRef\s*,\s*useState\s*\}\s*from\s*'react';/,
            "import {useContext,useEffect,useRef,useState} from 'react';"
        );
    }

    if(!source.includes('characterStateText')){
        if(source.includes("import AnemiaNotice from '../public/AnemiaNotice';")){
            source=replaceOnce(
                source,
                "import AnemiaNotice from '../public/AnemiaNotice';",
                "import {AnemiaPolicyContext,characterStateText} from '../public/AnemiaNotice';",
                '타 캐릭터 기존 import 교체'
            );
        }else{
            source=replaceOnce(
                source,
                "import CharacterSearch from './CharacterSearch';",
                "import CharacterSearch from './CharacterSearch';\nimport {AnemiaPolicyContext,characterStateText} from '../public/AnemiaNotice';",
                '타 캐릭터 import'
            );
        }
    }

    source=removeStatusNames(source);

    if(!source.includes('const anemiaPolicy=useContext(AnemiaPolicyContext);')){
        source=source.replace(
            /(export default function PublicCharacterPanel\(\{targetId\}\)\s*\{)/,
            '$1\n const anemiaPolicy=useContext(AnemiaPolicyContext);'
        );
    }

    source=source.replace(
        /\{statusNames\[data\.character\.status\]\s*\|\|\s*data\.character\.status\}/,
        '{characterStateText(data.character,anemiaPolicy)}'
    );

    source=source.replace(
        '{data.character.status}',
        '{characterStateText(data.character,anemiaPolicy)}'
    );

    // 이전 버전의 개별 빈혈 표시를 제거하여 중복 방지
    source=source.replace(
        '<AnemiaNotice character={data.character}/>',
        ''
    );

    if(!source.includes('{characterStateText(data.character,anemiaPolicy)}')){
        throw new Error('타 캐릭터 상태 출력 위치를 찾을 수 없습니다.');
    }

    return source;
});

// 6. 공개 캐릭터 API: 단계명만 추가
edit('server/src/modules/character/interactions.js',source=>{
    if(/\bas anemia_stage\b/.test(source))return source;

    const oldColumns=" const visitorColumns = 'c.id::text,c.name,c.hunter_grade,c.has_ability,c.ability_grade,c.status,c.profile_image_url';";

    const newColumns=` const visitorColumns = \`
  c.id::text,c.name,c.hunter_grade,c.has_ability,c.ability_grade,
  c.status,c.profile_image_url,
  case
   when c.status='ALIVE' and c.hp>0 and c.blood between 1 and 100 then (
    select stage->>'name'
    from public.system_config policy
    cross join lateral jsonb_array_elements(policy.config_value->'stages') stage
    where policy.config_key='operating_anemia'
      and policy.config_value->>'enabled'='true'
      and c.blood between (stage->>'min')::integer and (stage->>'max')::integer
    order by (stage->>'order')::integer
    limit 1
   )
   else null
  end as anemia_stage
 \`;`;

    return replaceOnce(
        source,
        oldColumns,
        newColumns,
        '공개 캐릭터 API'
    );
});

// 7. 공개 API 테스트의 예상 필드 갱신
edit('server/test/p3-public-content.test.js',source=>{
    if(source.includes("'anemia_stage'"))return source;

    return replaceOnce(
        source,
        "['id', 'name', 'hunter_grade', 'has_ability', 'ability_grade', 'status'].sort()",
        "['id', 'name', 'hunter_grade', 'has_ability', 'ability_grade', 'status', 'profile_image_url', 'anemia_stage'].sort()",
        '공개 API 테스트'
    );
});

// 검사 이후 일괄 저장
let count=0;

for(const file of files){
    const before=originals.get(file);
    const updated=edits.get(file);
    if(before.replace(/\r\n/g,'\n')===updated)continue;

    const eol=before.includes('\r\n')?'\r\n':'\n';
    writeFileSync(resolve(root,file),updated.replace(/\n/g,eol),'utf8');
    console.log('수정:',file);
    count++;
}

console.log(`혈량 상태 통합 완료. 수정 파일 ${count}개.`);
console.log('Git 커밋·푸시·Supabase 배포는 하지 않았습니다.');