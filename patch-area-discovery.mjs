import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE_COMMIT='3255c4655946021e46898a9e5efd285706a60a50';
const CHECK_ONLY=process.argv.includes('--check');

const candidates=[
    path.join(process.cwd(),'frontend/src/admin'),
    path.join(process.cwd(),'src/admin')
];

const adminDir=candidates.find(dir=>fs.existsSync(path.join(dir,'AreaHubPanel.js')));

if(!adminDir) {
    console.error('관리자 소스 폴더를 찾지 못했습니다. 프로젝트 루트에서 실행하세요.');
    process.exit(1);
}

function blobSha(content) {
    const bytes=Buffer.from(content.replace(/\r\n/g,'\n'),'utf8');
    return crypto.createHash('sha1')
        .update(Buffer.from(`blob ${bytes.length}\0`))
        .update(bytes)
        .digest('hex');
}

function replaceOnce(source,before,after,filename) {
    const occurrences=source.split(before).length-1;

    if(occurrences!==1) {
        throw new Error(`${filename}: 교체 대상이 ${occurrences}개입니다. 패치를 중단합니다.`);
    }

    return source.replace(before,after);
}

function replaceRange(source,start,end,replacement,filename,includeEnd=false) {
    const startCount=source.split(start).length-1;
    const endCount=source.split(end).length-1;

    if(startCount!==1||endCount!==1) {
        throw new Error(`${filename}: 교체 구간을 정확하게 찾지 못했습니다.`);
    }

    const from=source.indexOf(start);
    const to=source.indexOf(end);

    if(to<=from) {
        throw new Error(`${filename}: 교체 구간의 순서가 올바르지 않습니다.`);
    }

    return source.slice(0,from)+replacement+source.slice(to+(includeEnd?end.length:0));
}

/* ========================================
   01. AREA DISCOVERY JSX
======================================== */

const discoveryRender=String.raw` const renderRatio=items=>(
  <span className="area-discovery-ratio">
   <strong>{items.filter(item=>item.found).length}</strong>
   <span> / {items.length}</span>
  </span>
 );

 return (
  <section className="area-discovery-page">
   <div className="area-discovery-topbar">
    <p>구역별 발견 현황과 아직 발견되지 않은 대상을 조회합니다.</p>
    <button type="button" className="area-discovery-manage" onClick={()=>onManage(null)}>구역 관리로 이동</button>
   </div>

   {busy&&<p role="status">조사 현황을 불러오는 중…</p>}
   {error&&<p role="alert">{error}</p>}

   <div className="area-discovery-card">
    <header className="area-discovery-heading">
     <h3>구역별 발견 현황</h3>
     <span>전체 {count(rows.flatMap(r=>r.groups.flatMap(g=>g.items)))} 발견</span>
    </header>

    <div className="area-discovery-scroll">
     <table className="admin-log-table area-discovery-table">
      <thead>
       <tr>
        <th scope="col">구역</th>
        <th scope="col">현재 조사율</th>
        <th scope="col">고유 결과</th>
        <th scope="col">마물</th>
        <th scope="col">레시피</th>
        <th scope="col">합계</th>
       </tr>
      </thead>

      <tbody>
       {rows.map(({area,groups})=>(
        <Fragment key={area.id}>
         <tr className="area-discovery-row">
          <td>
           <div className="area-discovery-zone">
            <button type="button" aria-expanded={expanded===area.id} aria-label={area.name+' 발견 대상 펼치기'} onClick={()=>setExpanded(expanded===area.id?null:area.id)}>
             {expanded===area.id?'−':'+'}
            </button>
            <div>
             <strong>{area.name}</strong>
             <small>{String(area.id).startsWith('AREA-')?'':'ID '}{area.id}</small>
            </div>
           </div>
          </td>
          <td className="area-discovery-rate">
           {groups.some(group=>group.items.length)
            ? Number(area.investigation_rate??area.calculated_investigation_rate??0)+'%'
            : '—'}
          </td>
          {groups.map(group=><td key={group.title}>{renderRatio(group.items)}</td>)}
          <td>{renderRatio(groups.flatMap(group=>group.items))}</td>
         </tr>

         {expanded===area.id&&
          <tr className="area-discovery-expanded">
           <td colSpan={6}>
            <div className="area-discovery-details">
             {groups.map(group=>(
              <section key={group.title}>
               <h3>{group.title}</h3>
               <table>
                <tbody>
                 {group.items.map(item=>(
                  <tr key={item.id}>
                   <td>{item.name}</td>
                   <td>
                    <span className={item.found?'area-found':'area-missing'}>
                     {item.found===undefined?'확인 필요':item.found?'● 발견':'○ 미발견'}
                    </span>
                   </td>
                  </tr>
                 ))}
                 {!group.items.length&&<tr><td colSpan={2}>등록된 항목 없음</td></tr>}
                 <tr><th scope="row">합계</th><td>{count(group.items)}</td></tr>
                </tbody>
               </table>
              </section>
             ))}
            </div>
            <button type="button" className="area-discovery-detail-manage" onClick={()=>onManage(area.id)}>이 구역 관리</button>
           </td>
          </tr>
         }
        </Fragment>
       ))}

       {!busy&&!error&&!rows.length&&
        <tr className="area-discovery-empty">
         <td colSpan={6}>등록된 구역이 없습니다.</td>
        </tr>
       }
      </tbody>

      {!!rows.length&&
       <tfoot>
        <tr>
         <th scope="row">전체 합계</th>
         <td>—</td>
         {[0,1,2].map(i=><td key={i}>{renderRatio(rows.flatMap(r=>r.groups[i].items))}</td>)}
         <td>{renderRatio(rows.flatMap(r=>r.groups.flatMap(g=>g.items)))}</td>
        </tr>
       </tfoot>
      }
     </table>
    </div>
   </div>
  </section>
 );`;

/* ========================================
   02. AREA DISCOVERY CSS
======================================== */

const discoveryCss=String.raw`/* ========================================
   AREA DISCOVERY - CONTENT
======================================== */

.area-discovery-page {
    width: 100%;
    min-width: 0;
    color: #242428;
}

.area-discovery-topbar {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 24px;
}

.area-discovery-topbar p {
    margin: 0;
    color: #77777b;
    font-size: 13px;
    line-height: 1.7;
}

.admin-panel .area-discovery-manage {
    flex: 0 0 auto;
    min-height: 38px;
    padding: 9px 14px;
    background: #ffffff;
    border: 1px solid #d7dce3;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 750;
}

/* ========================================
   AREA DISCOVERY - CARD
======================================== */

.area-discovery-card {
    width: 100%;
    min-width: 0;
    border: 1px solid #dce1e7;
    border-radius: 12px;
    background: #ffffff;
    box-shadow: 0 3px 14px #18252d0a;
    overflow: hidden;
}

.area-discovery-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 70px;
    padding: 20px 22px;
}

.admin-panel .area-discovery-heading h3 {
    margin: 0;
    color: #242428;
    font-size: 16px;
    font-weight: 850;
}

.area-discovery-heading > span {
    padding: 5px 9px;
    border-radius: 5px;
    background: #f2f3f5;
    color: #697383;
    font-size: 11px;
    font-weight: 700;
}

/* ========================================
   AREA DISCOVERY - TABLE
======================================== */

.area-discovery-scroll {
    width: 100%;
    min-width: 0;
    overflow-x: auto;
}

.admin-panel .area-discovery-page .area-discovery-scroll > table {
    display: table;
    width: 100%;
    min-width: 760px;
    margin: 0;
    border-collapse: collapse;
    table-layout: fixed;
    overflow: visible;
}

.admin-panel .area-discovery-table thead th {
    padding: 14px 12px;
    border-top: 0;
    border-bottom: 1px solid #e1e5ea;
    background: #f2f4f6;
    color: #657184;
    font-size: 12px;
    font-weight: 800;
    text-align: center;
    white-space: nowrap;
}

.admin-panel .area-discovery-table thead th:first-child {
    width: 34%;
    text-align: left;
}

.admin-panel .area-discovery-table .area-discovery-row > td {
    height: 57px;
    padding: 12px;
    border-bottom: 1px solid #e8ebef;
    background: #ffffff;
    color: #262b36;
    font-size: 13px;
    font-weight: 700;
    text-align: center;
    vertical-align: middle;
}

.admin-panel .area-discovery-table .area-discovery-row > td:first-child {
    text-align: left;
}

.admin-panel .area-discovery-table .area-discovery-row:hover > td {
    background: #faf7f8;
}

.admin-panel .area-discovery-table .area-discovery-row > td.area-discovery-rate {
    color: #650c13;
    font-weight: 850;
}

/* ========================================
   AREA DISCOVERY - ZONE / VALUES
======================================== */

.area-discovery-zone {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
}

.area-discovery-zone > div {
    min-width: 0;
}

.area-discovery-zone strong {
    display: block;
    color: #252b35;
    font-size: 13px;
    font-weight: 800;
    overflow-wrap: anywhere;
}

.area-discovery-zone small {
    display: block;
    margin-top: 3px;
    color: #8490a0;
    font-size: 11px;
    font-weight: 400;
}

.admin-panel .area-discovery-page .area-discovery-zone button {
    display: flex;
    flex: 0 0 28px;
    align-items: center;
    justify-content: center;
    width: 28px;
    min-width: 28px;
    height: 28px;
    min-height: 28px;
    margin: 0;
    padding: 0;
    border: 1px solid #dce1e7;
    border-radius: 6px;
    background: #ffffff;
    color: #650c13;
    font-size: 14px;
    font-weight: 800;
}

.area-discovery-ratio {
    display: inline-flex;
    align-items: baseline;
    justify-content: center;
    gap: 2px;
    white-space: nowrap;
}

.area-discovery-ratio strong {
    color: #a34b13;
    font-size: inherit;
    font-weight: 850;
}

.area-discovery-ratio span {
    color: #242d3b;
    font-weight: 700;
}

/* ========================================
   AREA DISCOVERY - TOTAL
======================================== */

.admin-panel .area-discovery-table tfoot th,
.admin-panel .area-discovery-table tfoot td {
    padding: 14px 12px;
    border-top: 1px solid #e6dfe1;
    border-bottom: 0;
    background: #faf5f6;
    color: #242428;
    font-size: 13px;
    font-weight: 800;
    text-align: center;
}

.admin-panel .area-discovery-table tfoot th {
    text-align: left;
}

.admin-panel .area-discovery-table .area-discovery-empty td {
    padding: 28px;
    color: #77777b;
    text-align: center;
}

/* ========================================
   AREA DISCOVERY - EXPANDED DETAILS
======================================== */

.admin-panel .area-discovery-table .area-discovery-expanded > td {
    width: auto;
    padding: 18px;
    border-bottom: 1px solid #e5e5e8;
    background: #fafafa;
    vertical-align: top;
}

.area-discovery-details {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    margin-bottom: 16px;
}

.area-discovery-details > section {
    min-width: 0;
    padding: 15px;
    border: 1px solid #dedee1;
    border-radius: 8px;
    background: #ffffff;
}

.admin-panel .area-discovery-details h3 {
    margin: 0 0 12px;
    color: #242428;
    font-size: 14px;
    font-weight: 800;
}

.admin-panel .area-discovery-page .area-discovery-details table {
    display: table;
    width: 100%;
    min-width: 0;
    border-collapse: collapse;
    table-layout: auto;
    overflow: visible;
}

.admin-panel .area-discovery-details th,
.admin-panel .area-discovery-details td {
    padding: 9px 6px;
    border-bottom: 1px solid #ececef;
    background: transparent;
    font-size: 12px;
    line-height: 1.5;
    overflow-wrap: anywhere;
}

.admin-panel .area-discovery-details td:last-child {
    text-align: right;
    white-space: nowrap;
}

.area-discovery-details .area-found {
    color: #650c13;
    font-weight: 800;
}

.area-discovery-details .area-missing {
    color: #77777b;
}

.admin-panel .area-discovery-detail-manage {
    min-height: 36px;
    padding: 8px 12px;
    border-color: #650c13;
    background: #650c13;
    color: #ffffff;
    font-size: 12px;
}

.admin-panel .area-discovery-detail-manage:hover:not(:disabled) {
    background: #80141e;
    color: #ffffff;
}

/* ========================================
   AREA DISCOVERY - RESPONSIVE
======================================== */

@media (max-width: 1100px) {
    .area-discovery-details {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

@media (max-width: 750px) {
    .area-discovery-topbar {
        flex-direction: column;
        align-items: stretch;
        gap: 12px;
    }

    .admin-panel .area-discovery-manage {
        align-self: flex-end;
    }

    .area-discovery-heading {
        padding: 16px;
    }

    .area-discovery-details {
        grid-template-columns: minmax(0, 1fr);
    }

    .admin-panel .area-discovery-table .area-discovery-expanded > td {
        padding: 12px;
    }
}

`;

/* ========================================
   03. PATCH TARGETS
======================================== */

const files=[
    {
        name:'AreaHubPanel.js',
        expectedSha:'831db8db401675a8b228247b704fdb7cb55cb1b7',
        markers:['className="area-discovery-topbar"','className="area-discovery-card"'],
        apply(source) {
            return replaceRange(
                source,
                ' return <section className="area-discovery-page"><p>구역별 발견 현황과 미발견 대상을 확인합니다.</p>',
                ' </tbody></table></div></section>;',
                discoveryRender,
                this.name,
                true
            );
        }
    },
    {
        name:'AreaHubPanel.css',
        expectedSha:'34a3d614b26b2c613c45702b17630d80860061e8',
        markers:['.area-discovery-card {','.area-discovery-table thead th {'],
        apply(source) {
            let updated=replaceRange(
                source,
                '.area-discovery-page {min-width:0;width:100%;}',
                '.area-hub-sections {min-width:0;}',
                discoveryCss,
                this.name
            );

            updated=replaceRange(
                updated,
                '.area-discovery-heading {display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 0;}',
                '@media(max-width:900px){.admin-panel .area-hub.admin-record-workspace',
                '',
                this.name
            );

            return updated;
        }
    },
    {
        name:'AdminPanel.js',
        expectedSha:'1b62fdcd2cc388f718da7a9d33f888e07ea76e11',
        markers:['area:id==null?null:String(id)'],
        apply(source) {
            return replaceOnce(
                source,
                "onManage={id=>onNavigate?onNavigate({menu:'areas',area:String(id),record:null,after:null}):setKind('areas')}",
                "onManage={id=>onNavigate?onNavigate({menu:'areas',area:id==null?null:String(id),record:null,after:null}):setKind('areas')}",
                this.name
            );
        }
    }
];

/* ========================================
   04. VALIDATION / BACKUP / APPLY
======================================== */

function prepare(file) {
    const filePath=path.join(adminDir,file.name);
    const original=fs.readFileSync(filePath,'utf8');
    const normalized=original.replace(/\r\n/g,'\n');
    const markerCount=file.markers.filter(marker=>normalized.includes(marker)).length;

    if(markerCount===file.markers.length) {
        return {...file,filePath,original,updated:original,skip:true};
    }

    if(markerCount>0) {
        throw new Error(`${file.name}: 일부 패치만 적용된 상태입니다. 자동 수정을 중단합니다.`);
    }

    const actualSha=blobSha(original);

    if(actualSha!==file.expectedSha) {
        throw new Error(
            `${file.name}: GitHub 기준 버전과 일치하지 않습니다.\n`+
            `기준 SHA: ${file.expectedSha}\n`+
            `현재 SHA: ${actualSha}\n`+
            '로컬 변경 사항을 확인하세요. 파일은 변경하지 않았습니다.'
        );
    }

    const patched=file.apply(normalized);
    const newline=original.includes('\r\n')?'\r\n':'\n';

    return {
        ...file,
        filePath,
        original,
        updated:patched.replace(/\n/g,newline),
        skip:false
    };
}

try {
    const prepared=files.map(prepare);
    const changes=prepared.filter(file=>!file.skip);

    console.log(`기준 커밋: ${BASE_COMMIT}`);
    console.log(`관리자 소스: ${adminDir}`);

    for(const file of prepared) {
        console.log(`${file.skip?'[이미 적용]':'[수정 대상]'} ${file.name}`);
    }

    if(!changes.length) {
        console.log('이미 패치가 적용되어 있습니다.');
        process.exit(0);
    }

    if(CHECK_ONLY) {
        console.log('검사 완료. 실제 파일은 변경하지 않았습니다.');
        process.exit(0);
    }

    const backupDir=fs.mkdtempSync(path.join(os.tmpdir(),'sangjonbap-area-discovery-'));

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
    console.log('조사 현황 디자인 패치 완료.');
    console.log('GitHub 커밋 또는 푸시는 수행하지 않았습니다.');
} catch(error) {
    console.error('[패치 중단]',error.message);
    process.exitCode=1;
}