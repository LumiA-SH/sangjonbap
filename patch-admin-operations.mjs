import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE_COMMIT='ae5fd9b58d71ffe7e55d4d774aad705e7a81476f';
const CHECK_ONLY=process.argv.includes('--check');

const candidates=[
    path.resolve('frontend/src/admin'),
    path.resolve('src/admin')
];

const adminDir=candidates.find(dir=>fs.existsSync(path.join(dir,'MasterPanel.js')));

if(!adminDir) {
    console.error('frontend/src/admin 또는 src/admin 폴더를 찾지 못했습니다.');
    process.exit(1);
}

function blobSha(content) {
    const bytes=Buffer.from(content.replace(/\r\n/g,'\n'),'utf8');
    return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
}

function replaceOnce(source,before,after,name) {
    const count=source.split(before).length-1;

    if(count!==1) {
        throw new Error(`${name}: 수정 대상 ${count}개 발견. 안전을 위해 중단합니다.`);
    }

    return source.replace(before,after);
}

/* ========================================
   01. GACHA CATALOG JSX
======================================== */

function patchMasterPanel(source) {
    const name='MasterPanel.js';

    source=replaceOnce(
        source,
        `        <div className="admin-toolbar-actions">
          <button disabled={busy || saving} onClick={() => {`,
        `        <div className="admin-toolbar-actions">
          {kind==='gachas'&&<h3 className="gacha-catalog-heading">등록된 가챠</h3>}
          <button disabled={busy || saving} onClick={() => {`,
        name
    );

    source=replaceOnce(
        source,
        `            새로 등록
          </button>`,
        `            {kind==='gachas'?'+ 가챠 생성':'새로 등록'}
          </button>`,
        name
    );

    source=replaceOnce(
        source,
        `        <label>
          현재 페이지 검색
          <input value={search} onChange={e => setSearch(e.target.value)}/>
        </label>`,
        `        <label className={kind==='gachas'?'gacha-catalog-search':undefined}>
          {kind==='gachas'?'가챠 이름 검색':'현재 페이지 검색'}
          <input value={search} placeholder={kind==='gachas'?'가챠 이름 검색':undefined} onChange={e => setSearch(e.target.value)}/>
        </label>`,
        name
    );

    source=replaceOnce(
        source,
        `{kind==='gachas'?<table className="gacha-catalog-table">`,
        `{kind==='gachas'?<div className="gacha-catalog-table-wrap"><table className="gacha-catalog-table">`,
        name
    );

    source=replaceOnce(
        source,
        `</tbody></table>: (`,
        `</tbody></table></div>: (`,
        name
    );

    source=replaceOnce(
        source,
        `<td>{row.is_active?'활성':'비활성'}</td><td>`,
        `<td><span className={row.is_active?'gacha-status is-active':'gacha-status'}>{row.is_active?'활성':'비활성'}</span></td><td>`,
        name
    );

    source=replaceOnce(
        source,
        `<td><AdminDeleteControl menu={kind} recordId={String(row.id)}`,
        `<td className="gacha-catalog-controls"><button type="button" disabled={busy||saving} onClick={()=>select(row)}>편집</button><AdminDeleteControl menu={kind} recordId={String(row.id)}`,
        name
    );

    return source;
}

/* ========================================
   02. GACHA CATALOG CSS
======================================== */

const gachaCatalogCss=String.raw`
/* ========================================
   02. GACHA CATALOG
======================================== */

.admin-panel .gacha-catalog {
    display: block;
    width: 100%;
    min-width: 0;
}

.admin-panel .gacha-catalog.has-editor > .admin-list-pane,
.admin-panel .gacha-catalog:not(.has-editor) > .admin-detail-pane {
    display: none;
}

.admin-panel .gacha-catalog > .admin-list-pane {
    width: 100%;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 1px solid #dce1e7;
    border-radius: 12px;
    background: #ffffff;
    box-shadow: 0 3px 14px #18252d0a;
    overflow: hidden;
}

.admin-panel .gacha-catalog > .admin-list-pane > p[role="status"]:empty {
    display: none;
}

/* ========================================
   03. GACHA HEADER / ACTIONS
======================================== */

.admin-panel .gacha-catalog > .admin-list-pane > .admin-toolbar-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    width: 100%;
    margin: 0;
    padding: 20px 22px;
    border-bottom: 1px solid #e5e9ed;
}

.admin-panel .gacha-catalog-heading {
    flex: 1 1 auto;
    min-width: 150px;
    margin: 0;
    color: #242428;
    font-size: 16px;
    font-weight: 850;
}

.admin-panel .gacha-catalog > .admin-list-pane > .admin-toolbar-actions button {
    min-height: 36px;
    margin: 0;
    padding: 8px 12px;
    font-size: 12px;
}

.admin-panel .gacha-catalog > .admin-list-pane > .admin-toolbar-actions button:first-of-type {
    border-color: #650c13;
    background: #650c13;
    color: #ffffff;
}

.admin-panel .gacha-catalog > .admin-list-pane > .admin-toolbar-actions button:first-of-type:hover:not(:disabled) {
    background: #80141e;
    color: #ffffff;
}

/* ========================================
   04. GACHA SEARCH / FILTER
======================================== */

.admin-panel .gacha-catalog > .admin-list-pane > label {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    margin: 0;
    padding: 13px 22px;
    border-bottom: 1px solid #edf0f2;
    color: #46515e;
    font-size: 12px;
    font-weight: 700;
}

.admin-panel .gacha-catalog > .admin-list-pane > label input,
.admin-panel .gacha-catalog > .admin-list-pane > label select {
    width: 100%;
    min-height: 40px;
    border: 1px solid #d7dde4;
    border-radius: 7px;
    background: #ffffff;
}

.admin-panel .gacha-catalog .admin-list-count {
    display: block;
    margin: 0;
    padding: 10px 22px;
    color: #8490a0;
    font-size: 11px;
}

/* ========================================
   05. GACHA TABLE
======================================== */

.admin-panel .gacha-catalog-table-wrap {
    width: 100%;
    min-width: 0;
    overflow-x: auto;
}

.admin-panel .gacha-catalog-table {
    display: table;
    width: 100%;
    min-width: 680px;
    margin: 0;
    border-collapse: collapse;
    table-layout: fixed;
    overflow: visible;
}

.admin-panel .gacha-catalog-table th,
.admin-panel .gacha-catalog-table td {
    padding: 15px 18px;
    border-bottom: 1px solid #e6e9ee;
    font-size: 13px;
    text-align: left;
    vertical-align: middle;
    overflow-wrap: anywhere;
}

.admin-panel .gacha-catalog-table th {
    background: #f2f4f6;
    color: #657184;
    font-size: 12px;
    font-weight: 800;
}

.admin-panel .gacha-catalog-table th:nth-child(1) {
    width: 32%;
}

.admin-panel .gacha-catalog-table th:nth-child(2) {
    width: 12%;
}

.admin-panel .gacha-catalog-table th:nth-child(3) {
    width: 16%;
}

.admin-panel .gacha-catalog-table th:nth-child(4) {
    width: 14%;
}

.admin-panel .gacha-catalog-table th:nth-child(5) {
    width: 26%;
}

.admin-panel .gacha-catalog-table tbody tr:hover td {
    background: #faf6f7;
}

.admin-panel .gacha-catalog-table tbody tr:last-child td {
    border-bottom: 0;
}

.admin-panel .gacha-catalog-table .admin-entry-title {
    display: block;
    width: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: #242428;
    font-size: 13px;
    font-weight: 750;
    text-align: left;
    white-space: normal;
}

.admin-panel .gacha-catalog-table .admin-entry-title:hover:not(:disabled) {
    border: 0;
    background: transparent;
    color: #650c13;
    text-decoration: underline;
}

/* ========================================
   06. GACHA STATUS
======================================== */

.admin-panel .gacha-status {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 24px;
    padding: 4px 8px;
    border-radius: 5px;
    background: #f4eded;
    color: #8b3036;
    font-size: 11px;
    font-weight: 800;
    white-space: nowrap;
}

.admin-panel .gacha-status.is-active {
    background: #eaf5ed;
    color: #237448;
}

/* ========================================
   07. GACHA MANAGEMENT
======================================== */

.admin-panel .gacha-catalog-table .gacha-catalog-controls {
    white-space: nowrap;
}

.admin-panel .gacha-catalog-controls > button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 34px;
    margin: 0 8px 0 0;
    padding: 7px 11px;
    border: 1px solid #d5dce4;
    border-radius: 6px;
    background: #ffffff;
    color: #242428;
    font-size: 12px;
}

.admin-panel .gacha-catalog-controls .admin-delete-inline {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    vertical-align: middle;
}

.admin-panel .gacha-catalog-controls .admin-delete-inline button {
    min-height: 34px;
    margin: 0;
    padding: 7px 11px;
    border-color: #e4c7cc;
    color: #9e303d;
    font-size: 12px;
}

/* ========================================
   08. GACHA RESPONSIVE
======================================== */

@media (max-width: 700px) {
    .admin-panel .gacha-catalog > .admin-list-pane > .admin-toolbar-actions {
        align-items: stretch;
        padding: 15px;
    }

    .admin-panel .gacha-catalog-heading {
        flex-basis: 100%;
    }

    .admin-panel .gacha-catalog > .admin-list-pane > label {
        padding: 12px 15px;
    }
}
`;

function patchGachaCss(source) {
    const start='\n.admin-panel .gacha-catalog{display:block}';
    const end='.gacha-catalog-table td:first-child{width:45%}';

    if(source.split(start).length!==2||!source.trimEnd().endsWith(end)) {
        throw new Error('GachaStockEditor.css: 기존 가챠 목록 스타일을 찾지 못했습니다.');
    }

    return source.slice(0,source.indexOf(start))+'\n'+gachaCatalogCss.trimStart()+'\n';
}

/* ========================================
   03. BALANCE PANEL
======================================== */

function patchBalancePanel(source) {
    return replaceOnce(
        source,
        '<section className="admin-operations-page">',
        '<section className="admin-operations-page admin-balance-workspace">',
        'BalancePanel.js'
    );
}

/* ========================================
   04. COMMON OPERATIONS CSS
======================================== */

const operationsCss=String.raw`
/* ========================================
   OPERATIONS - STORAGE / BALANCE LAYOUT
======================================== */

.admin-panel :is(.admin-storage-inline, .admin-balance-workspace) {
    width: 100%;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
}

/* ========================================
   OPERATIONS - TABLE WRAPPER
======================================== */

.admin-panel :is(.admin-storage-inline, .admin-balance-workspace) .admin-balance-table-wrap {
    width: 100%;
    min-width: 0;
    margin: 16px 0;
    padding: 0;
    border: 1px solid #dce1e7;
    border-radius: 9px;
    background: #ffffff;
    overflow-x: auto;
}

.admin-panel :is(.admin-storage-inline, .admin-balance-workspace) .admin-balance-table {
    display: table;
    width: 100%;
    min-width: 560px;
    margin: 0;
    border-collapse: collapse;
    table-layout: auto;
    overflow: visible;
}

.admin-panel :is(.admin-storage-inline, .admin-balance-workspace) .admin-balance-table thead th {
    padding: 13px 15px;
    border-bottom: 1px solid #e0e5eb;
    background: #f2f4f6;
    color: #657184;
    font-size: 12px;
    font-weight: 800;
    white-space: nowrap;
}

.admin-panel :is(.admin-storage-inline, .admin-balance-workspace) .admin-balance-table tbody td {
    padding: 14px 15px;
    border-bottom: 1px solid #e8ebef;
    background: #ffffff;
    color: #242428;
    font-size: 13px;
    vertical-align: middle;
}

.admin-panel :is(.admin-storage-inline, .admin-balance-workspace) .admin-balance-table tbody tr:last-child td {
    border-bottom: 0;
}

.admin-panel :is(.admin-storage-inline, .admin-balance-workspace) .admin-balance-table tbody tr:hover td {
    background: #faf7f8;
}

/* ========================================
   OPERATIONS - FORM FIELDS
======================================== */

.admin-panel :is(.admin-storage-inline, .admin-balance-workspace) .admin-balance-table input:not([type="checkbox"]) {
    width: 100%;
    min-width: 85px;
    max-width: 100%;
    box-sizing: border-box;
}

.admin-panel .admin-storage-inline .admin-storage-form {
    width: 100%;
    min-width: 0;
}

.admin-panel .admin-balance-workspace [aria-label="음식 등급별 공통 효과"] {
    width: 100%;
    min-width: 0;
}

@media (max-width: 650px) {
    .admin-panel :is(.admin-storage-inline, .admin-balance-workspace) .admin-balance-table th,
    .admin-panel :is(.admin-storage-inline, .admin-balance-workspace) .admin-balance-table td {
        padding: 11px 9px;
        font-size: 12px;
    }
}
`;

function patchOrganization(source) {
    const name='admin-organization.css';

    const oldContainer=`.admin-panel .admin-operations-page {
 min-width: 0;
 padding: 20px;
 border: 1px solid var(--admin-border);
 border-radius: 9px;
 background: #ffffff;
}`;

    source=replaceOnce(
        source,
        oldContainer,
        oldContainer+'\n\n'+operationsCss.trim(),
        name
    );

    source=replaceOnce(
        source,
        `.admin-panel .admin-log-table,
.admin-panel .admin-balance-table {
 width: 100%;
 border-collapse: collapse;
}`,
        `.admin-panel .admin-log-table,
.admin-panel .admin-balance-table {
 display: table;
 width: 100%;
 border-collapse: collapse;
}`,
        name
    );

    return source;
}

/* ========================================
   05. PATCH FILES
======================================== */

const files=[
    {
        name:'MasterPanel.js',
        sha:'f274cd2079432faac299d41063834a6d67ead991',
        markers:['gacha-catalog-heading','gacha-catalog-table-wrap','gacha-catalog-controls'],
        patch:patchMasterPanel
    },
    {
        name:'GachaStockEditor.css',
        sha:'cbb95486e2e5ea7a765d941c8fe098514c8ec7e3',
        markers:['.gacha-catalog-table-wrap {','.gacha-status.is-active {'],
        patch:patchGachaCss
    },
    {
        name:'BalancePanel.js',
        sha:'d3fb2c217aec8d4cc306ae9648521f542622d184',
        markers:['admin-balance-workspace'],
        patch:patchBalancePanel
    },
    {
        name:'admin-organization.css',
        sha:'640fe945bc23b1fda19f3ff6e037501143297fbd',
        markers:['OPERATIONS - STORAGE / BALANCE LAYOUT','OPERATIONS - TABLE WRAPPER'],
        patch:patchOrganization
    }
];

/* ========================================
   06. VALIDATION / BACKUP / APPLY
======================================== */

function prepare(file) {
    const filePath=path.join(adminDir,file.name);
    const original=fs.readFileSync(filePath,'utf8');
    const normalized=original.replace(/\r\n/g,'\n');
    const markers=file.markers.filter(marker=>normalized.includes(marker));

    if(markers.length===file.markers.length) {
        return {...file,filePath,original,updated:original,skip:true};
    }

    if(markers.length>0) {
        throw new Error(`${file.name}: 패치가 일부만 적용된 것으로 보입니다.`);
    }

    const currentSha=blobSha(original);

    if(currentSha!==file.sha) {
        throw new Error(
            `${file.name}: 최신 커밋과 파일 내용이 다릅니다.\n`+
            `기준 SHA: ${file.sha}\n`+
            `현재 SHA: ${currentSha}\n`+
            '다른 로컬 변경 사항이 있는지 확인하세요.'
        );
    }

    let updated=file.patch(normalized);
    updated=updated.replace(/\n/g,original.includes('\r\n')?'\r\n':'\n');

    return {...file,filePath,original,updated,skip:false};
}

try {
    const prepared=files.map(prepare);
    const changes=prepared.filter(file=>!file.skip);

    console.log(`기준 커밋: ${BASE_COMMIT}`);
    console.log(`관리자 폴더: ${adminDir}`);

    for(const file of prepared) {
        console.log(`${file.skip?'[이미 적용]':'[수정 대상]'} ${file.name}`);
    }

    if(!changes.length) {
        console.log('추가로 수정할 파일이 없습니다.');
        process.exit(0);
    }

    if(CHECK_ONLY) {
        console.log(`검사 완료: ${changes.length}개 파일 수정 가능. 실제 변경 없음.`);
        process.exit(0);
    }

    const backupDir=fs.mkdtempSync(path.join(os.tmpdir(),'sangjonbap-operations-'));

    for(const file of changes) {
        fs.copyFileSync(file.filePath,path.join(backupDir,file.name));
    }

    const written=[];

    try {
        for(const file of changes) {
            fs.writeFileSync(file.filePath,file.updated,'utf8');
            written.push(file);
            console.log(`[적용 완료] ${file.name}`);
        }
    } catch(error) {
        for(const file of written) {
            fs.writeFileSync(file.filePath,file.original,'utf8');
        }

        throw error;
    }

    console.log(`원본 백업: ${backupDir}`);
    console.log('가챠 · 공용창고 · 공통 밸런스 패치 완료.');
    console.log('GitHub 커밋이나 푸시는 수행하지 않았습니다.');
} catch(error) {
    console.error('[패치 중단]',error.message);
    process.exitCode=1;
}