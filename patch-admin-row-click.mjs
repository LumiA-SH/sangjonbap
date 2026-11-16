import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE_COMMIT='3255c4655946021e46898a9e5efd285706a60a50';
const CHECK_ONLY=process.argv.includes('--check');
const INTERACTIVE_SELECTOR='button, a, input, select, textarea, label, summary, [role="button"], [role="link"], .admin-record-actions, .admin-delete-inline';

const candidates=[
    path.resolve(process.cwd(),'frontend/src/admin'),
    path.resolve(process.cwd(),'src/admin')
];

const adminDir=candidates.find(dir=>fs.existsSync(path.join(dir,'MasterPanel.js')));

if(!adminDir) {
    console.error('관리자 소스 폴더를 찾지 못했습니다. 프로젝트 루트에서 실행하세요.');
    process.exit(1);
}

function gitBlobSha(content) {
    const normalized=content.replace(/\r\n/g,'\n');
    const body=Buffer.from(normalized,'utf8');
    const header=Buffer.from(`blob ${body.length}\0`);
    return crypto.createHash('sha1').update(header).update(body).digest('hex');
}

function replaceOnce(source,before,after,file) {
    const count=source.split(before).length-1;

    if(count!==1) {
        throw new Error(`${file}: 수정 위치가 ${count}개 발견되었습니다. 안전을 위해 중단합니다.`);
    }

    return source.replace(before,after);
}

const masterRowHandler=`
  function openAdminRow(event,row) {
    if(busy||saving) return;

    if(event.target.closest('${INTERACTIVE_SELECTOR}')) return;
    if(kind==='gachas'&&event.target.closest('td:last-child')) return;

    select(row);
  }

`;

const masterPatch=[
    {
        before:'  return (\n      <section aria-label="마스터 관리"',
        after:masterRowHandler+'  return (\n      <section aria-label="마스터 관리"'
    },
    {
        before:'{visibleRecords.map(row=><tr key={row.id}>',
        after:'{visibleRecords.map(row=><tr key={row.id} className="admin-clickable-row" onClick={event=>openAdminRow(event,row)}>'
    },
    {
        before:'<ul className="admin-master-records">\n          {visibleRecords.map(row => (\n              <li key={row.id}>',
        after:'<ul className="admin-master-records">\n          {visibleRecords.map(row => (\n              <li key={row.id} className="admin-clickable-row" onClick={event=>openAdminRow(event,row)}>'
    }
];

const monsterPatch=[
    {
        before:'<ul className="admin-two-column-list admin-monster-list">\n            {rows.map(r => (\n                <li key={r.id}>',
        after:`<ul className="admin-two-column-list admin-monster-list">
            {rows.map(r => (
                <li key={r.id} className="admin-clickable-row" onClick={event=>{
                  if(busy||event.target.closest('${INTERACTIVE_SELECTOR}')) return;
                  openMonster(r);
                }}>`
    }
];

const cluePatch=[
    {
        before:'<ul className="admin-two-column-list admin-clue-list">\n       {rows.map(r => (\n           <li key={r.id}>',
        after:`<ul className="admin-two-column-list admin-clue-list">
       {rows.map(r => (
           <li key={r.id} className="admin-clickable-row" onClick={event=>{
             if(busy||event.target.closest('${INTERACTIVE_SELECTOR}')) return;
             choose(String(r.id));
           }}>`
    }
];

const cssPatch=[
    {
        before:'.admin-panel .admin-list-pane .admin-record-open {',
        after:`.admin-panel .admin-content .admin-clickable-row {
    cursor: pointer;
}

.admin-panel .admin-content .admin-clickable-row:hover {
    background: #faf0f1;
}

.admin-panel .admin-list-pane .admin-record-open {`
    }
];

const targets=[
    {
        file:'MasterPanel.js',
        sha:'2d944ac592259eba631e27b4bd9f2a01c407447c',
        patches:masterPatch
    },
    {
        file:'BattleAdminPanel.js',
        sha:'3467647de5c16c4e8b11f96f454e7673b33fd11e',
        patches:monsterPatch
    },
    {
        file:'ClueAdminPanel.js',
        sha:'3df524e204c84a2001232cf97065d4f9efa95276',
        patches:cluePatch
    },
    {
        file:'admin-organization.css',
        sha:'6ad9bfb39358051f2f22223de19601e3ac2db239',
        patches:cssPatch
    }
];

function prepare(target) {
    const filePath=path.join(adminDir,target.file);
    const original=fs.readFileSync(filePath,'utf8');
    const normalized=original.replace(/\r\n/g,'\n');
    const alreadyPatched=target.patches.every(patch=>normalized.includes(patch.after));

    if(alreadyPatched) {
        return {...target,filePath,original,updated:original,skip:true};
    }

    const actualSha=gitBlobSha(original);

    if(actualSha!==target.sha) {
        throw new Error(
            `${target.file}: 최신 커밋과 파일 내용이 다릅니다.\n`+
            `기준 SHA: ${target.sha}\n`+
            `현재 SHA: ${actualSha}\n`+
            '로컬 수정 사항이 있는지 확인하세요. 파일은 변경하지 않았습니다.'
        );
    }

    let updated=normalized;

    for(const patch of target.patches) {
        updated=replaceOnce(updated,patch.before,patch.after,target.file);
    }

    const eol=original.includes('\r\n')?'\r\n':'\n';
    updated=updated.replace(/\n/g,eol);

    return {...target,filePath,original,updated,skip:false};
}

try {
    const changes=targets.map(prepare);
    const pending=changes.filter(change=>!change.skip);

    console.log(`기준 커밋: ${BASE_COMMIT}`);
    console.log(`관리자 폴더: ${adminDir}`);

    for(const change of changes) {
        console.log(`${change.skip?'[이미 적용]':'[수정 대상]'} ${change.file}`);
    }

    if(!pending.length) {
        console.log('추가로 수정할 파일이 없습니다.');
        process.exit(0);
    }

    if(CHECK_ONLY) {
        console.log(`검사 완료: ${pending.length}개 파일 수정 가능. 실제 변경은 하지 않았습니다.`);
        process.exit(0);
    }

    const rootDir=path.resolve(adminDir,'../../..');
    const backupName='admin-row-click-'+new Date().toISOString().replace(/[:.]/g,'-');
    const backupDir=path.join(rootDir,'.patch-backups',backupName);

    fs.mkdirSync(backupDir,{recursive:true});

    for(const change of pending) {
        fs.copyFileSync(change.filePath,path.join(backupDir,change.file));
    }

    const written=[];

    try {
        for(const change of pending) {
            fs.writeFileSync(change.filePath,change.updated,'utf8');
            written.push(change);
            console.log(`[수정 완료] ${change.file}`);
        }
    } catch(error) {
        for(const change of written) {
            fs.writeFileSync(change.filePath,change.original,'utf8');
        }

        throw error;
    }

    console.log('');
    console.log('관리자 목록 전체 클릭 패치 완료');
    console.log(`원본 백업: ${backupDir}`);
    console.log('GitHub 커밋이나 푸시는 수행하지 않았습니다.');
} catch(error) {
    console.error('');
    console.error('[패치 중단]',error.message);
    process.exitCode=1;
}