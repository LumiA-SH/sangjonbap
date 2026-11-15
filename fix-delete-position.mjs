import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';

const root=process.cwd();
const dir='frontend/src/admin/';
const names=['AdminDeleteControl.js','AdminPanel.js','MasterPanel.js','InvestigationAdminPanel.js','ClueAdminPanel.js','BattleAdminPanel.js','AreaHubPanel.js','admin-list-layout.css'];
const original=new Map(),changed=new Map();

for(const name of names){
    const path=resolve(root,dir+name);
    if(!existsSync(path))throw new Error('파일을 찾을 수 없습니다: '+dir+name);
    const content=readFileSync(path,'utf8');
    original.set(name,content);
    changed.set(name,content.replace(/\r\n/g,'\n'));
}

function edit(name,fn){
    changed.set(name,fn(changed.get(name)));
}

function replace(source,before,after,label){
    const pos=source.indexOf(before);
    if(pos<0||source.indexOf(before,pos+before.length)>=0){
        throw new Error(label+': 기존 코드를 찾을 수 없거나 중복입니다. 파일은 수정하지 않았습니다.');
    }
    return source.slice(0,pos)+after+source.slice(pos+before.length);
}

function removeBetween(source,start,end,label){
    const a=source.indexOf(start);
    const b=a<0?-1:source.indexOf(end,a+start.length);
    if(a<0||b<0||source.indexOf(start,a+start.length)>=0){
        throw new Error(label+': 삭제 구간을 확인하지 못했습니다. 파일은 수정하지 않았습니다.');
    }
    return source.slice(0,a)+source.slice(b);
}

function importDelete(source,anchor,label){
    return replace(source,anchor,anchor+"\nimport AdminDeleteControl from './AdminDeleteControl';",label);
}

// 공통 삭제 버튼을 목록 행에서 사용할 수 있도록 변경
edit('AdminDeleteControl.js',src=>{
    src=replace(src,'const labels={',"const labels={\n    items:'아이템',monsters:'마물','food-grades':'음식 등급',",'삭제 대상 확장');
    src=replace(src,'className="admin-toolbar-actions" role="group"','className={isHub?"admin-toolbar-actions":"admin-delete-inline"} role="group"','행 내부 삭제 버튼');
    src=replace(src,'{deleting?\'삭제 중…\':`미참조 ${labels[kind]} 영구 삭제`}',"{deleting?'삭제 중…':'삭제'}",'삭제 버튼 이름');
    return src;
});

// 아이템·상점 상품 목록
edit('AdminPanel.js',src=>{
    if(!src.includes("import AdminDeleteControl from './AdminDeleteControl';")){
        throw new Error('이전 삭제 기능 연결을 먼저 확인하세요.');
    }

    const start='                        <AdminDeleteControl\n';
    const end='                        {renderContent()}';
    const a=src.indexOf(start);
    const b=a<0?-1:src.indexOf(end,a);

    if(a<0||b<0||!src.slice(a,b).includes('onDeleted={async')){
        throw new Error('상단 공통 삭제 영역을 찾을 수 없습니다.');
    }

    src=src.slice(0,a)+src.slice(b);
    src=removeBetween(src,'    async function deleteItem() {\n','    function registerProduct() {\n','기존 아이템 전용 삭제 함수');

    src=replace(src,`                        <button disabled={busy} onClick={deleteItem}>
                            미참조 아이템 영구 삭제
                        </button>
`,'','기존 상단 아이템 삭제 버튼');

    src=replace(src,`                            <button disabled={busy} onClick={()=>select(row)}>
                                상세/수정
                            </button>`,`                            <div className="admin-record-actions">
                                <button disabled={busy} onClick={()=>select(row)}>상세/수정</button>
                                <AdminDeleteControl menu={kind} recordId={String(row.id)} disabled={busy} onDenied={denied}
                                    onDeleted={async()=>{
                                        invalidateAdminNames();
                                        if(String(selected?.id)===String(row.id)||String(recordId)===String(row.id)){
                                            setSelected(null);
                                            setEditorKey(value=>value+1);
                                            onNavigate?.({record:null});
                                        }
                                        setDeleteRevision(value=>value+1);
                                        await load(kind,route?.after);
                                        setMessage('삭제 완료');
                                    }}/>
                            </div>`,'아이템·상점 목록 행');

    return src;
});

// 음식 설정·음식 등급·레시피·가챠·지역 목록
edit('MasterPanel.js',src=>{
    src=importDelete(src,"import AdminReferenceName, {invalidateAdminNames} from './AdminReferenceName';",'마스터 import');
    src=removeBetween(src,"        {kind === 'food-grades' && record && (\n",'        <button disabled={busy || imageUploading}>','음식 등급 중복 삭제');

    src=replace(src,`                <button disabled={busy || saving} onClick={() => select(row)}>
                  상세/수정
                </button>`,`                <div className="admin-record-actions">
                  <button disabled={busy || saving} onClick={() => select(row)}>상세/수정</button>
                  <AdminDeleteControl menu={kind} recordId={String(row.id)} disabled={busy || saving} onDenied={onDenied}
                    onDeleted={async()=>{
                      invalidateAdminNames();
                      if(String(selected?.id)===String(row.id)||String(recordId)===String(row.id)){
                        setSelected(null);
                        setRevision(v=>v+1);
                        onOpen?.(null);
                      }
                      await load();
                      setMessage('삭제 완료');
                    }}/>
                </div>`,'마스터 목록 행');

    return src;
});

// 조사 결과 개별 관리
edit('InvestigationAdminPanel.js',src=>{
    src=importDelete(src,"import ItemPicker from './ItemPicker';",'조사 import');

    src=replace(src,'              <button type="button" disabled={busy} onClick={()=>editInvestigation(r)}>결과 수정</button>',`              <div className="admin-record-actions">
                <button type="button" disabled={busy} onClick={()=>editInvestigation(r)}>결과 수정</button>
                <AdminDeleteControl menu="investigation-results" recordId={String(r.id)} areaId={String(areaId)} disabled={busy} onDenied={onDenied}
                  onDeleted={async()=>{
                    if(String(id)===String(r.id)||String(route?.record)===String(r.id)){
                      setId(null);
                      setDraft(empty());
                      onNavigate?.({record:null});
                    }
                    await load(areaId);
                    setMessage('삭제 완료');
                  }}/>
              </div>`,'조사 결과 목록 행');

    return src;
});

// 단서 관리
edit('ClueAdminPanel.js',src=>{
    src=importDelete(src,"import {api} from '../api/client';",'단서 import');

    src=replace(src,`            <button disabled={busy} onClick={() => choose(String(r.id))}>
             단서 상세
            </button>`,`             <div className="admin-record-actions">
              <button disabled={busy} onClick={() => choose(String(r.id))}>단서 상세</button>
              <AdminDeleteControl menu="clues" recordId={String(r.id)} disabled={busy} onDenied={onDenied}
                onDeleted={async()=>{
                  if(String(loaded?.record?.id)===String(r.id)||String(recordId)===String(r.id)){
                    setLoaded(null);
                    setDraft(null);
                    setReason('');
                    onOpen?.(null);
                  }
                  await list();
                  setMessage('삭제 완료');
                }}/>
             </div>`,'단서 목록 행');

    return src;
});

// 마물 등록 목록
edit('BattleAdminPanel.js',src=>{
    src=importDelete(src,"import ImageUploadField from './ImageUploadField';",'마물 import');
    src=removeBetween(src,'  async function deleteMonster() {\n','  function newMonster() {\n','마물 상단 삭제 함수');

    src=replace(src,`            {id && (
                <button disabled={busy} onClick={deleteMonster}>
                  미참조 마물 영구 삭제
                </button>
            )}
`,'','마물 상단 삭제 버튼');

    src=replace(src,`                  <button disabled={busy} onClick={() => openMonster(r)}>
                    상세/수정
                  </button>`,`                  <div className="admin-record-actions">
                    <button disabled={busy} onClick={() => openMonster(r)}>상세/수정</button>
                    <AdminDeleteControl menu="monsters" recordId={String(r.id)} disabled={busy} onDenied={onDenied}
                      onDeleted={async()=>{
                        if(String(id)===String(r.id)||String(recordId)===String(r.id)){
                          setId(null);
                          setDraft(emptyMonster());
                          setOriginal(null);
                          onOpen?.(null);
                        }
                        await reload();
                        setMessage('삭제 완료');
                      }}/>
                  </div>`,'마물 목록 행');

    return src;
});

// 구역 통합 관리
edit('AreaHubPanel.js',src=>{
    src=importDelete(src,"import ImageUploadField from './ImageUploadField';",'구역 통합 import');
    src=replace(src,'function InvestigationEditor({areaId, data, busy, onSave, onDenied}) {','function InvestigationEditor({areaId, data, busy, onSave, onDenied, onRemove}) {','구역 조사 props');
    src=replace(src,'function ClueEditor({areaId, data, busy, onSave}) {','function ClueEditor({areaId, data, busy, onSave, onDenied, onRemove}) {','구역 단서 props');

    src=replace(src,`                                <button type="button" disabled={busy}
                                        onClick={() => editing ? cancel() : startEdit(row)}>
                                    {editing ? '닫기' : '수정'}
                                </button>`,`                                <div className="admin-record-actions">
                                    <button type="button" disabled={busy}
                                            onClick={() => editing ? cancel() : startEdit(row)}>
                                        {editing ? '닫기' : '수정'}
                                    </button>
                                    <AdminDeleteControl menu="investigation-results" recordId={String(row.id)} areaId={String(areaId)} disabled={busy} onDenied={onDenied}
                                        onDeleted={async()=>{if(editing)cancel();await onRemove('results');}}/>
                                </div>`,'통합 조사 결과 목록 행');

    src=replace(src,`                                <button type="button" disabled={busy || loading}
                                        onClick={() => editing ? cancel() : startEdit(clue.id)}>
                                    {editing ? '닫기' : '수정'}
                                </button>`,`                                <div className="admin-record-actions">
                                    <button type="button" disabled={busy || loading}
                                            onClick={() => editing ? cancel() : startEdit(clue.id)}>
                                        {editing ? '닫기' : '수정'}
                                    </button>
                                    <AdminDeleteControl menu="clues" recordId={String(clue.id)} disabled={busy || loading} onDenied={onDenied}
                                        onDeleted={async()=>{if(editing)cancel();await onRemove('clues');}}/>
                                </div>`,'통합 단서 목록 행');

    src=replace(src,'    function selectArea(value) {',`    async function refreshAfterDelete(section) {
        const refreshed=await refreshArea(areaId);
        setRevision(previous=>({...previous,[section]:previous[section]+1}));
        setMessage(refreshed?'삭제 완료':'삭제 완료 · 목록을 새로고침해 주세요.');
    }

    function selectArea(value) {`,'통합 목록 삭제 후 갱신');

    src=replace(src,`                            onSave={saveSection} onDenied={onDenied}
                        />`,`                            onSave={saveSection} onDenied={onDenied} onRemove={refreshAfterDelete}
                        />`,'통합 조사 갱신 연결');

    src=replace(src,`                            onSave={saveSection}
                        />
                    </div>`,`                            onSave={saveSection} onDenied={onDenied} onRemove={refreshAfterDelete}
                        />
                    </div>`,'통합 단서 갱신 연결');

    src=replace(src,`                            <span>{area.is_open ? '공개 허용' : '비공개'}</span>
                        </div>`,`                            <span>{area.is_open ? '공개 허용' : '비공개'}</span>
                        </div>
                        <AdminDeleteControl menu="areas" recordId={String(areaId)} disabled={busy} onDenied={onDenied}
                            onDeleted={async()=>{
                                setAreas(rows=>rows.filter(row=>String(row.id)!==String(areaId)));
                                if(onNavigate)onNavigate({area:null,record:null});
                                else setLocalAreaId('');
                                setArea(null);
                                setData(null);
                                setMonsterData(null);
                                setMessage('지역 삭제 완료');
                            }}/>`,'현재 지역 삭제 버튼');

    return src;
});

// 버튼 배치 CSS
edit('admin-list-layout.css',src=>{
    if(src.includes('.admin-panel .admin-content .admin-record-actions {')){
        throw new Error('버튼 위치 변경 CSS가 이미 적용되어 있습니다.');
    }

    return src+`
/* 수정·삭제 버튼을 항목마다 나란히 배치 */
.admin-panel .admin-content .admin-record-actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    min-width: 0;
    margin-left: auto;
}

.admin-panel .admin-content .admin-record-actions > button,
.admin-panel .admin-content .admin-record-actions .admin-delete-inline > button {
    flex: 0 0 auto;
    min-width: 62px;
    min-height: 40px;
    margin: 0;
    padding: 9px 12px;
    white-space: nowrap;
}

.admin-panel .admin-content .admin-delete-inline {
    display: flex;
    align-items: center;
    gap: 8px;
}

.admin-panel .admin-content .admin-delete-inline p[role="alert"] {
    max-width: 180px;
    margin: 0;
    font-size: 12px;
}
`;
});

// 교체 위치를 모두 확인한 후에만 파일 저장
for(const name of names){
    const before=original.get(name);
    const eol=before.includes('\r\n')?'\r\n':'\n';
    writeFileSync(resolve(root,dir+name),changed.get(name).replace(/\n/g,eol),'utf8');
}

console.log('수정/상세 버튼 옆에 항목별 삭제 버튼 배치 완료.');
console.log('백엔드·DB·다른 게임 화면·Git 커밋은 건드리지 않았습니다.');