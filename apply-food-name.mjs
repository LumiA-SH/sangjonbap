import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';

const root=process.cwd();

const files=[
    'frontend/src/admin/MasterPanel.js',
    'server/src/modules/admin/master-service.js',
    'server/src/modules/admin/master-repository.js',
    'server/test/admin-v2.test.js',
    'server/test/admin-v2.postgres.test.js'
];

const originals=new Map();
const updated=new Map();

for(const file of files){
    const path=resolve(root,file);

    if(!existsSync(path)){
        throw new Error(`프로젝트 파일을 찾을 수 없습니다: ${file}`);
    }

    const content=readFileSync(path,'utf8');

    originals.set(file,content);
    updated.set(file,content.replace(/\r\n/g,'\n'));
}

function replaceOnce(source,before,after,label){
    const index=source.indexOf(before);

    if(index<0){
        throw new Error(`${label}: 기존 코드 위치를 찾을 수 없습니다. 파일은 변경하지 않았습니다.`);
    }

    if(source.indexOf(before,index+before.length)>=0){
        throw new Error(`${label}: 수정 위치가 중복되었습니다.`);
    }

    return source.slice(0,index)+after+source.slice(index+before.length);
}

function edit(file,callback){
    updated.set(file,callback(updated.get(file)));
}

// 1. 음식 이름 입력란 추가
edit('frontend/src/admin/MasterPanel.js',source=>{
    source=replaceOnce(
        source,
        `    item_id: '',
    blood_recovery: 0,`,
        `    item_id: '',
    name: '',
    blood_recovery: 0,`,
        '음식 기본값'
    );

    source=replaceOnce(
        source,
        '              <p>음식 등급을 선택하면',
        `              <p>
                음식 이름은 연결된 아이템의 이름입니다.
                이름을 변경하면 인벤토리·상점 등에서도 같은 이름으로 표시됩니다.
              </p>
              <p>음식 등급을 선택하면`,
        '음식 이름 안내'
    );

    // 아이템 선택 시 기존 아이템의 이름을 자동 입력한다.
    source=replaceOnce(
        source,
        '                        onChange={id => change(k, id)}',
        `                        onChange={(id,item)=>{
                          if(kind==='foods'&&k==='item_id'){
                            setDraft(current=>({
                              ...current,
                              item_id:id||'',
                              name:item?.name||''
                            }));
                          }else{
                            change(k,id);
                          }
                        }}`,
        '아이템 선택 시 음식 이름 자동 입력'
    );

    // 일반 입력 필드의 라벨만 변경한다.
    // ItemPicker에도 같은 표현식이 있으므로 <label>을 포함해 구분한다.
    source=replaceOnce(
        source,
        `                    <label key={k}>
                      {kind === 'recipes' ? (recipeLabels[k] || labels[k]) : labels[k]}`,
        `                    <label key={k}>
                      {kind==='foods'&&k==='name'
                          ? '음식 이름'
                          : kind==='recipes'
                              ? (recipeLabels[k]||labels[k])
                              : labels[k]}`,
        '음식 이름 입력란 명칭'
    );

    return source;
});

// 2. 음식 저장 API에서 name 필드 허용
edit('server/src/modules/admin/master-service.js',source=>{
    return replaceOnce(
        source,
        "foods: ['grade_id','is_failure','item_id',",
        "foods: ['grade_id','is_failure','item_id','name',",
        '음식 API 입력 필드'
    );
});

// 3. 연결된 item.name 조회 및 저장
edit('server/src/modules/admin/master-repository.js',source=>{
    source=replaceOnce(
        source,
        "    const progressSelect=kind==='areas'?",
        `    const foodName=kind==='foods'
        ? ",(select i.name from public.item i where i.id=p.item_id) as name"
        : '';
    const progressSelect=kind==='areas'?`,
        '음식 이름 조회'
    );

    source=replaceOnce(
        source,
        "p.${d.pk} as id${kind==='foods'?",
        "p.${d.pk} as id${foodName}${kind==='foods'?",
        '음식 목록 및 상세 이름 반환'
    );

    // food_config에는 name 컬럼이 없으므로 INSERT/UPDATE에서 제외한다.
    source=replaceOnce(
        source,
        "Object.entries(patch).filter(([k])=>k!==d.rows&&k!=='area_recipes')",
        "Object.entries(patch).filter(([k])=>k!==d.rows&&k!=='area_recipes'&&!(kind==='foods'&&k==='name'))",
        '음식 설정 저장 컬럼'
    );

    // 기존 트랜잭션 안에서 연결된 아이템 이름까지 변경한다.
    source=replaceOnce(
        source,
        '                const after=(await records(c,kind,savedId))[0];',
        `                if(kind==='foods'&&Object.hasOwn(patch,'name')&&
                    patch.name.trim()!==before?.name){
                    await c.query(
                        'update public.item set name=$2 where id=$1',
                        [savedId,patch.name.trim()]
                    );
                }

                const after=(await records(c,kind,savedId))[0];`,
        '연결된 음식 아이템 이름 저장'
    );

    return source;
});

// 4. 입력값 검증 테스트
edit('server/test/admin-v2.test.js',source=>{
    return replaceOnce(
        source,
        "    assert.throws(() => validateMasterInput('foods', {item_id: '2', requestKey: key}, false));",
        `    assert.throws(() => validateMasterInput('foods', {item_id: '2', requestKey: key}, false));

    assert.equal(
        validateMasterInput('foods',{
            name:'새 음식',
            requestKey:key
        },false).patch.name,
        '새 음식'
    );

    assert.throws(()=>
        validateMasterInput('foods',{
            name:'   ',
            requestKey:key
        },false)
    );`,
        '음식 이름 유효성 테스트'
    );
});

// 5. DB에서 음식 이름과 아이템 이름이 함께 변경되는지 확인
edit('server/test/admin-v2.postgres.test.js',source=>{
    return replaceOnce(
        source,
        "            let row = await save('foods', null, {item_id: food.id, blood_recovery: 7});",
        `            let row = await save('foods', null, {item_id: food.id, blood_recovery: 7});

            assert.equal(row.name,'DEV isolated food');

            row=await save('foods',food.id,{
                name:'DEV renamed food'
            });

            assert.equal(row.name,'DEV renamed food');

            const itemName=(await pool.query(
                'select name from public.item where id=$1',
                [food.id]
            )).rows[0].name;

            assert.equal(itemName,'DEV renamed food');`,
        '음식 이름 DB 연결 테스트'
    );
});

// 모든 수정 위치 확인 후에만 파일 저장
let count=0;

for(const file of files){
    const original=originals.get(file);
    const next=updated.get(file);

    if(original.replace(/\r\n/g,'\n')===next)continue;

    const eol=original.includes('\r\n')?'\r\n':'\n';

    writeFileSync(
        resolve(root,file),
        next.replace(/\n/g,eol),
        'utf8'
    );

    console.log('수정:',file);
    count++;
}

console.log(`음식 이름 입력 및 저장 기능 연결 완료. 수정 파일 ${count}개.`);
console.log('기존 아이템 연결, 음식 효과, 레시피 기능은 유지했습니다.');
console.log('GitHub 커밋·푸시 및 Supabase 배포는 수행하지 않았습니다.');