import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';

const root=process.cwd();
const deletePath='server/src/modules/admin/delete-repository.js';
const controlPath='frontend/src/admin/AdminDeleteControl.js';
const routePath='server/src/modules/admin/routes.js';
const panelPath='frontend/src/admin/AdminPanel.js';

for (const name of [deletePath,controlPath,routePath,panelPath]) {
    if (!existsSync(resolve(root,name))) {
        throw new Error(`필요한 프로젝트 파일을 찾을 수 없습니다: ${name}`);
    }
}

const deleteSource=readFileSync(resolve(root,deletePath),'utf8');
const controlSource=readFileSync(resolve(root,controlPath),'utf8');

if (!deleteSource.includes('investigation-results') ||
    !deleteSource.includes('products') ||
    !deleteSource.includes('clues')) {
    throw new Error('삭제 저장소에 신규 삭제 기능이 없습니다. 파일 내용을 확인하세요.');
}

if (!controlSource.includes('AdminDeleteControl')) {
    throw new Error('AdminDeleteControl.js의 내용을 확인하세요.');
}

function readSource(path) {
    const original=readFileSync(resolve(root,path),'utf8');
    return {
        content:original.replace(/\r\n/g,'\n'),
        eol:original.includes('\r\n')?'\r\n':'\n'
    };
}

function replaceOnce(source,find,replacement,label) {
    const at=source.indexOf(find);

    if (at<0) {
        throw new Error(`${label}: 적용 위치를 찾을 수 없습니다. 기존 코드는 변경하지 않았습니다.`);
    }

    if (source.indexOf(find,at+find.length)>=0) {
        throw new Error(`${label}: 적용 위치가 중복되었습니다.`);
    }

    return source.slice(0,at)+replacement+source.slice(at+find.length);
}

const routeFile=readSource(routePath);
const panelFile=readSource(panelPath);

let route=routeFile.content;
let panel=panelFile.content;

const routeApplied=route.includes("router.delete('/areas/:areaId/results/:id'");
const panelApplied=panel.includes("import AdminDeleteControl from './AdminDeleteControl';");

if (routeApplied&&panelApplied) {
    console.log('관리자 삭제 기능이 이미 적용되어 있습니다. 추가 변경하지 않았습니다.');
    process.exit(0);
}

if (routeApplied||panelApplied) {
    throw new Error('삭제 기능이 일부만 적용된 상태입니다. 중복 적용을 방지하기 위해 중단합니다.');
}

const routeAddition=`
    // 미참조 운영 콘텐츠만 영구 삭제한다. 실제 참조·이력 검증은 저장소에서 수행한다.
    for (const kind of ['products','foods','recipes','gachas','areas','clues']) {
        router.delete(\`/\${kind}/:id\`,async(req,res)=>{
            if (!validId(req.params.id)) {
                throw new AppError(400,'INVALID_ID','올바른 ID가 필요합니다.');
            }

            ok(res,await repository.deleteAdminRecord(
                req.auth.user.id,kind,req.params.id,req.body
            ));
        });
    }

    router.delete('/areas/:areaId/results/:id',async(req,res)=>{
        if (!validId(req.params.areaId)||!validId(req.params.id)) {
            throw new AppError(400,'INVALID_ID','올바른 구역 및 조사 결과 ID가 필요합니다.');
        }

        ok(res,await repository.deleteAdminRecord(
            req.auth.user.id,'investigation-results',req.params.id,req.body,
            {areaId:req.params.areaId}
        ));
    });
`;

route=replaceOnce(
    route,
    '    mountExtendedAdminRoutes(router,repository);\n',
    '    mountExtendedAdminRoutes(router,repository);\n'+routeAddition,
    '삭제 API 연결'
);

panel=replaceOnce(
    panel,
    "import AdminReferenceName, {invalidateAdminNames} from './AdminReferenceName';",
    "import AdminReferenceName, {invalidateAdminNames} from './AdminReferenceName';\nimport AdminDeleteControl from './AdminDeleteControl';",
    '관리자 삭제 UI import'
);

panel=replaceOnce(
    panel,
    '    const [resetting,setResetting]=useState(false);',
    '    const [resetting,setResetting]=useState(false);\n    const [deleteRevision,setDeleteRevision]=useState(0);',
    '관리자 새로고침 상태'
);

panel=replaceOnce(
    panel,
    '<AreaHubPanel route={route} onNavigate={onNavigate} onDenied={denied}/>',
    '<AreaHubPanel key={deleteRevision} route={route} onNavigate={onNavigate} onDenied={denied}/>',
    '통합 구역 화면 새로고침'
);

panel=replaceOnce(
    panel,
    '<ClueAdminPanel onDenied={denied} recordId={recordId} onOpen={onNavigate?openRecord:undefined}/>',
    '<ClueAdminPanel key={deleteRevision} onDenied={denied} recordId={recordId} onOpen={onNavigate?openRecord:undefined}/>',
    '단서 화면 새로고침'
);

panel=replaceOnce(
    panel,
    '<InvestigationAdminPanel onDenied={denied} route={route} onNavigate={onNavigate}/>',
    '<InvestigationAdminPanel key={deleteRevision} onDenied={denied} route={route} onNavigate={onNavigate}/>',
    '조사 화면 새로고침'
);

panel=replaceOnce(
    panel,
    '                    key={kind}\n                    kind={kind}',
    '                    key={`${kind}-${deleteRevision}`}\n                    kind={kind}',
    '마스터 화면 새로고침'
);

const toolbar=`                        <AdminDeleteControl
                            menu={kind}
                            recordId={recordId}
                            areaId={route?.area}
                            disabled={busy}
                            onDenied={denied}
                            onDeleted={async ({kind:deletedKind})=>{
                                invalidateAdminNames();
                                setSelected(null);
                                setEditorKey(value=>value+1);
                                setDeleteRevision(value=>value+1);

                                if (onNavigate) {
                                    if (kind==='area-hub') {
                                        if (deletedKind==='areas') {
                                            onNavigate({area:null,record:null});
                                        }
                                    } else {
                                        onNavigate({record:null});
                                    }
                                }

                                if (kind==='products') {
                                    await load(kind,route?.after);
                                }

                                setMessage('삭제 완료');
                            }}
                        />

`;

panel=replaceOnce(
    panel,
    '                        {renderContent()}',
    toolbar+'                        {renderContent()}',
    '관리자 공통 삭제 컨트롤'
);

// 모든 적용 위치가 정상 확인된 후 두 파일만 수정한다.
writeFileSync(resolve(root,routePath),route.replace(/\n/g,routeFile.eol),'utf8');
writeFileSync(resolve(root,panelPath),panel.replace(/\n/g,panelFile.eol),'utf8');

console.log('관리자 삭제 기능 연결 완료');
console.log(`수정: ${routePath}`);
console.log(`수정: ${panelPath}`);
console.log('기존 delete-repository.js와 AdminDeleteControl.js는 변경하지 않았습니다.');
console.log('GitHub 커밋 및 푸시는 수행하지 않았습니다.');