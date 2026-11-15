import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';

const root=process.cwd();
const files=[
    'frontend/src/public/AnemiaNotice.js',
    'frontend/src/admin/CharacterOperationsPanel.js',
    'server/src/modules/admin/character-operations.js'
];

const originals=new Map();
const edits=new Map();

for(const file of files){
    const path=resolve(root,file);
    if(!existsSync(path))throw new Error(`파일이 없습니다: ${file}`);

    const content=readFileSync(path,'utf8');
    originals.set(file,content);
    edits.set(file,content.replace(/\r\n/g,'\n'));
}

function replaceOnce(source,before,after,label){
    const index=source.indexOf(before);
    if(index<0||source.indexOf(before,index+before.length)>=0){
        throw new Error(`${label}: 수정 위치를 확인할 수 없습니다. 파일은 변경하지 않았습니다.`);
    }

    return source.slice(0,index)+after+source.slice(index+before.length);
}

function replaceBetween(source,start,end,replacement,label){
    const first=source.indexOf(start);
    const last=first<0?-1:source.indexOf(end,first+start.length);

    if(first<0||last<0||source.indexOf(start,first+start.length)>=0){
        throw new Error(`${label}: 기존 코드 구간을 찾을 수 없습니다. 파일은 변경하지 않았습니다.`);
    }

    return source.slice(0,first)+replacement+source.slice(last);
}

function edit(file,callback){
    edits.set(file,callback(edits.get(file)));
}

// 기존 공통 상태 함수가 없는 경우에만 추가한다.
edit('frontend/src/public/AnemiaNotice.js',source=>{
    if(source.includes('export function characterStateText('))return source;

    const helper=String.raw`export function characterStateText(character,policy=null){
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

    const stage=typeof character.anemia_stage==='string'
        ? character.anemia_stage.trim()
        : '';

    return stage||anemiaText(character,policy)||'생존';
}

`;

    return replaceOnce(
        source,
        'export default function AnemiaNotice({character}) {',
        helper+'export default function AnemiaNotice({character}) {',
        '공통 캐릭터 상태 함수'
    );
});

// 공개 목록과 동일한 UI를 관리자 캐릭터 목록에 적용
edit('frontend/src/admin/CharacterOperationsPanel.js',source=>{
    if(source.includes('className="public-character-list"')){
        throw new Error('관리자 캐릭터 목록 디자인이 이미 적용되어 있습니다.');
    }

    source=replaceOnce(
        source,
        "import {useEffect,useRef,useState} from 'react';",
        "import {useContext,useEffect,useRef,useState} from 'react';",
        'React import'
    );

    source=replaceOnce(
        source,
        "import ItemPicker from './ItemPicker';",
        "import ItemPicker from './ItemPicker';\nimport {publicAsset} from '../publicAsset';\nimport {AnemiaPolicyContext,characterStateText} from '../public/AnemiaNotice';\nimport '../public/public.css';",
        '공개 캐릭터 디자인 import'
    );

    const avatar=String.raw`const FALLBACK_AVATAR=publicAsset('assets/decor/icon-user.svg');

function CharacterAvatar({character}){
    const source=character?.profile_image_url||character?.image_url||'';
    const [failed,setFailed]=useState(false);

    useEffect(()=>{
        setFailed(false);
    },[source]);

    const valid=typeof source==='string'&&
        (/^https?:\/\//i.test(source)||/^\/(?!\/)/.test(source));

    const image=valid&&!failed?source:FALLBACK_AVATAR;
    const fallback=image===FALLBACK_AVATAR;

    return (
        <div className={'public-character-avatar'+(fallback?' is-fallback':'')}>
            <img src={image} alt={(character?.name||'캐릭터')+' 프로필'}
                 loading="lazy" onError={()=>setFailed(true)}/>
        </div>
    );
}

`;

    source=replaceOnce(source,'const fields={',avatar+'const fields={','프로필 이미지');

    source=replaceOnce(
        source,
        '  const pending=useRef(false);',
        '  const pending=useRef(false);\n  const anemiaPolicy=useContext(AnemiaPolicyContext);',
        '관리자 빈혈 정책 연결'
    );

    const roster=String.raw`        <div className="public-content public-character-directory">
          <div className="public-directory-heading">
            <div>
              <span className="badge">SURVIVOR ROSTER</span>
              <h2>캐릭터 목록</h2>
            </div>
            <span className="public-directory-count">{rows.length}명 표시</span>
          </div>

          <form className="public-character-search" onSubmit={searchSubmit}>
            <label>
              캐릭터 이름
              <input type="search" value={query} maxLength={100}
                     placeholder="캐릭터 이름을 입력하세요."
                     disabled={busy} onChange={e=>setQuery(e.target.value)}/>
            </label>
            <button disabled={busy}>검색</button>
          </form>

          <p>
            빈 검색어로 등록된 러너·캐릭터를 조회할 수 있습니다.
            계정 권한과 게임 초기 설정은 별개입니다.
          </p>

          <p role="alert">{message}</p>

          {rows.length>0&&(
            <ul className="public-character-list">
              {rows.map(r=>(
                <li key={r.id} className="public-character-item">
                  <CharacterAvatar character={r}/>

                  <div className="public-character-info">
                    <button type="button" className="public-character-name"
                            disabled={busy}
                            onClick={()=>onOpen?onOpen(String(r.id)):work(()=>select(r.id))}>
                      {r.name}
                    </button>

                    <div className="public-character-information">
                      <span>
                        헌터등급 <strong>{r.hunter_grade||'미설정'}</strong>
                      </span>
                      <span>
                        이능등급 <strong>
                          {r.initial_setup_complete===false
                            ? '미설정'
                            : r.has_ability?r.ability_grade||'미설정':'없음'}
                        </strong>
                      </span>
                      <span className={'public-character-status status-'+String(r.status||'').toLowerCase()}>
                        상태 <strong>{characterStateText(r,anemiaPolicy)}</strong>
                      </span>
                    </div>

                    <div className="public-character-information">
                      <span>ID <strong>{r.id}</strong></span>
                      <span>
                        {r.user_id
                          ? '계정 '+r.user_id+' ('+(r.user_role==='ADMIN'?'관리자':'일반 러너')+')'
                          : '연결 계정 없음'}
                      </span>
                      <span>
                        {r.initial_setup_complete===false
                          ? '초기 설정 미완료'
                          : '초기 설정 완료'}
                      </span>
                      <span>{r.is_active?'활성':'비활성'}</span>
                    </div>
                  </div>

                  <button type="button" className="public-character-detail-button"
                          disabled={busy}
                          onClick={()=>onOpen?onOpen(String(r.id)):work(()=>select(r.id))}>
                    선택
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!busy&&rows.length===0&&(
            <p className="public-directory-empty">조회된 캐릭터가 없습니다.</p>
          )}

          {next&&(
            <div className="public-directory-pagination">
              <button type="button" disabled={busy}
                      onClick={()=>work(()=>search(next))}>
                다음 50건
              </button>
            </div>
          )}
        </div>

`;

    source=replaceBetween(
        source,
        '        <form onSubmit={searchSubmit}>',
        '        {data&&(',
        roster,
        '관리자 캐릭터 목록'
    );

    source=replaceOnce(
        source,
        '{statusLabels[data.character.status]||data.character.status}',
        '{characterStateText(data.character,anemiaPolicy)}',
        '선택 캐릭터 상태'
    );

    source=source.replace(
        /const statusLabels\s*=\s*\{[\s\S]*?\};\s*/,
        ''
    );

    return source;
});

// 관리자 검색 API에 혈량 RP 단계명만 추가
edit('server/src/modules/admin/character-operations.js',source=>{
    const start="        async searchAdminCharacters(query, after = '0') {";
    const end='        getAdminCharacter: id => read(pool, id),';

    const a=source.indexOf(start);
    const b=a<0?-1:source.indexOf(end,a+start.length);

    if(a<0||b<0){
        throw new Error('관리자 캐릭터 검색 API를 찾을 수 없습니다.');
    }

    let section=source.slice(a,b);

    if(section.includes('as anemia_stage')){
        return source;
    }

    const stage=String.raw`                        c.status,
                        case
                            when c.status='ALIVE'
                                and c.hp>0
                                and c.blood between 1 and 100
                            then (
                                select stage->>'name'
                                from public.system_config policy
                                cross join lateral jsonb_array_elements(
                                    policy.config_value->'stages'
                                ) stage
                                where policy.config_key='operating_anemia'
                                    and policy.config_value->>'enabled'='true'
                                    and c.blood between
                                        (stage->>'min')::integer
                                        and (stage->>'max')::integer
                                order by (stage->>'order')::integer
                                limit 1
                            )
                            else null
                        end as anemia_stage,
                        c.is_active,`;

    section=replaceOnce(
        section,
        '                        c.status,\n                        c.is_active,',
        stage,
        '관리자 검색 결과 혈량 단계'
    );

    return source.slice(0,a)+section+source.slice(b);
});

// 수정 위치를 전부 검사한 뒤 파일 저장
let count=0;

for(const file of files){
    const original=originals.get(file);
    const modified=edits.get(file);

    if(original.replace(/\r\n/g,'\n')===modified)continue;

    const eol=original.includes('\r\n')?'\r\n':'\n';
    writeFileSync(resolve(root,file),modified.replace(/\n/g,eol),'utf8');
    console.log('수정:',file);
    count++;
}

console.log(`관리자 캐릭터 목록 UI 수정 완료. 변경 파일 ${count}개.`);
console.log('기존 캐릭터 수정 폼, 인벤토리, 권한 로직은 유지했습니다.');
console.log('Git 커밋·푸시와 Supabase 배포는 수행하지 않았습니다.');