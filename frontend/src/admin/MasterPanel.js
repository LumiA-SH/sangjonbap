/* global BigInt */
import {useEffect,useRef,useState} from 'react';
import {api} from '../api/client';
import ItemPicker from './ItemPicker';
import GachaStockEditor from './GachaStockEditor';

const defaults={
  areas:{name:'',description:null,image_url:null,sort_order:0,encounter_rate:40,is_open:false,unlock_at:null},
  'food-grades':{name:'',blood_recovery:10,is_active:true},
  foods:{grade_id:null,is_failure:false,item_id:'',blood_recovery:0,stat_growth_enabled:false,stat_growth_rate:0,stat_growth_target:null,stat_growth_value:0,rp_effect_text:null,rp_effect_texts:[]},
  recipes:{name:'',description:null,discovery_grade:null,success_rate:80,result_quantity:3,result_item_id:'',failure_item_id:null,is_active:true,ingredients:[]},
  gachas:{name:'',price:1,is_active:true,start_at:null,end_at:null,period_enabled:null,start_inclusive:null,end_inclusive:null,rewards:[]}
};

const recipePrices={COMMON:2,RARE:3,SPECIAL:4};

const labels={
  period_enabled:'기간 제한',start_inclusive:'시작 경계 포함',end_inclusive:'종료 경계 포함',
  grade_id:'음식 등급',is_failure:'실패 RP 음식 (수치 효과 없음)',encounter_rate:'조우 확률 (%)',
  item_id:'아이템 ID',blood_recovery:'혈량 회복',stat_growth_enabled:'성장 활성',
  stat_growth_rate:'성장 확률 (%)',stat_growth_target:'고정 성장 스탯',stat_growth_value:'성장량',
  rp_effect_texts:'실패요리 RP 문구 후보 (한 줄에 하나, 최대 50개)',rp_effect_text:'기존 RP 효과 설명',
  name:'이름',description:'설명',success_rate:'성공 확률 (%)',
  result_item_id:'성공 음식 ID',failure_item_id:'실패 음식 ID',is_active:'활성',
  price:'가격',start_at:'시작 시각 (시간대 포함 ISO)',end_at:'종료 시각 (시간대 포함 ISO)'
};

const recipeLabels={
  discovery_grade:'레시피 등급',
  success_rate:'요리 성공 확률 (%)',
  result_item_id:'완성 음식',
  failure_item_id:'실패 요리',
  result_quantity:'완성 음식 지급 수량',
  is_active:'사용 여부'
};

const numeric=['encounter_rate','sort_order','blood_recovery','stat_growth_rate','stat_growth_value','success_rate','price','result_quantity'];
labels.result_quantity='성공 음식 수량';
Object.assign(labels,{is_open:'공개 허용',unlock_at:'공개 시각 (시간대 포함 ISO, 비우면 즉시)'});
Object.assign(labels,{image_url:'이미지 URL',sort_order:'표시 순서'});

const isId=value=>/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n;

export function validateDraft(kind,draft) {
  for (const [key,value] of Object.entries(draft)) {
    if (numeric.includes(key) && (typeof value!=='number'||!Number.isFinite(value)||value<0||value>2147483647||(!key.endsWith('rate')&&!Number.isInteger(value)))) return `${labels[key]} 값을 확인하세요.`;
    if (key.endsWith('rate')&&(value>100||Number(value.toFixed(2))!==value)) return '확률은 소수 둘째 자리까지의 0~100입니다.';
    if (key.endsWith('item_id') && !(key==='failure_item_id'&&value===null) && !isId(value)) return '아이템 ID는 양의 정수입니다.';
  }

  if (draft.rp_effect_texts && (draft.rp_effect_texts.length>50||draft.rp_effect_texts.some(v=>!v.trim()||v.length>500))) return 'RP 문구는 1~500자, 최대 50개입니다.';
  if ('grade_id' in draft && draft.grade_id!==null && !isId(draft.grade_id)) return '음식 등급을 선택하세요.';
  if ('name' in draft && (!draft.name.trim()||[...draft.name].length>100)) return '이름은 1~100자입니다.';
  if (kind==='foods' && (draft.stat_growth_enabled ? !draft.stat_growth_target||draft.stat_growth_value<=0 : draft.stat_growth_target!==null||draft.stat_growth_value!==0)) return '성장 활성: 대상과 양수 성장량 / 비활성: 대상 NULL과 성장량 0';

  const children=draft.ingredients||draft.rewards;

  if (children) {
    if (kind==='recipes'&&!children.length) return '재료를 한 개 이상 등록하세요.';
    if (kind==='recipes'&&children.length>5) return '레시피 재료는 최대 5종입니다.';
    if (children.some(r=>!isId(r.item_id)||!Number.isInteger(r.quantity)||r.quantity<1||r.quantity>2147483647||('weight' in r&&(!Number.isInteger(r.weight)||r.weight<1||r.weight>2147483647)))) return '재료/보상의 ID, 양수 정수 수량과 가중치를 확인하세요.';
    if (new Set(children.map(r=>r.item_id)).size!==children.length) return '아이템을 중복 등록할 수 없습니다.';
  }

  if (kind==='recipes'&&!draft.failure_item_id) return '실패 가능한 레시피에는 실패 음식이 필요합니다.';
  if (kind==='recipes'&&draft.result_quantity!==undefined&&draft.result_quantity<1) return '성공 음식 수량은 양수입니다.';

  for (const key of ['start_at','end_at','unlock_at']) {
    if (draft[key] && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(draft[key])||!Number.isFinite(Date.parse(draft[key])))) return '시각은 2026-10-11T00:00:00+09:00 형식입니다.';
  }

  if (kind==='gachas'&&draft.period_enabled===true&&(!draft.start_at||!draft.end_at||typeof draft.start_inclusive!=='boolean'||typeof draft.end_inclusive!=='boolean')) return '기간 활성 시 시작·종료 시각과 경계 포함 여부를 설정하세요.';

  const micros=value=>BigInt(Date.parse(value))*1000n+BigInt((value.match(/\.(\d+)/)?.[1]||'').padEnd(6,'0').slice(3,6));
  if (draft.start_at&&draft.end_at&&micros(draft.end_at)<=micros(draft.start_at)) return '종료 시각은 시작 시각 이후여야 합니다.';
  return '';
}

function MasterEditor({kind,record,onSaved,onDenied,onBusy}) {
  const [draft,setDraft]=useState(()=>Object.fromEntries(Object.entries(defaults[kind]).map(([k,v])=>[k,record?.[k]??v])));
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const saving=useRef(false);
  const [grades,setGrades]=useState([]);

  useEffect(()=>{
    if (kind==='foods') {
      (async()=>{
        let after=null,all=[];
        do {
          const r=await api('/admin/food-grades'+(after?'?after='+after:''));
          all=all.concat(r.records);
          after=r.nextAfter;
        } while(after);
        setGrades(all);
      })().catch(e=>{
        setMessage(e.message);
        if ([401,403].includes(e.status)) onDenied(e.message);
      });
    }
  },[kind,onDenied]);

  const child=kind==='recipes'?'ingredients':kind==='gachas'?'rewards':null;
  const rows=child?draft[child]:[];
  const total=rows.filter(r=>r.is_active!==false).reduce((sum,r)=>sum+(Number(r.weight)||0),0);

  function change(k,v) {
    setDraft(d=>({...d,[k]:v,...(k==='stat_growth_enabled'?{stat_growth_rate:20,stat_growth_value:v?1:0,stat_growth_target:v?d.stat_growth_target:null}:{})}));
  }

  function changeRow(index,k,v) {
    change(child,rows.map((r,i)=>i===index?{...r,[k]:v}:r));
  }

  async function save(event) {
    event.preventDefault();
    if (saving.current) return;

    const error=validateDraft(kind,draft);
    if (error) {
      setMessage(error);
      return;
    }

    saving.current=true;
    setBusy(true);
    onBusy(true);
    setMessage('');

    const body={...draft};
    if (record&&kind==='areas') {
      for (const key of Object.keys(body)) {
        if (body[key]===(record[key]??defaults.areas[key])) delete body[key];
      }
    }

    if (record&&kind==='foods') delete body.item_id;
    if (child) body[child]=rows.map(r=>({item_id:r.item_id,quantity:r.quantity,...(kind==='gachas'?{weight:r.weight,is_active:r.is_active??true}:{})}));

    try {
      const data=await api(`/admin/${kind}${record?`/${record.id}`:''}`,{method:record?'PATCH':'POST',body:{...body,requestKey:crypto.randomUUID()}});
      await onSaved(data.record);
    } catch(e) {
      setMessage(`${e.code||'SAVE_FAILED'}: ${e.message}`);
      if ([401,403].includes(e.status)) onDenied(e.message);
    } finally {
      saving.current=false;
      setBusy(false);
      onBusy(false);
    }
  }

  return <form onSubmit={save} className="admin-form">
    <h3>{record?`ID ${record.id} 상세/수정`:'새로 등록'}</h3>

    {kind==='foods'&&<p>등급 미지정은 기존 개별 회복량을 유지합니다. 등급 지정 시 등급 회복량이 우선합니다. 실패 RP 설정 또는 레시피 실패 결과로 연결된 아이템은 회복·성장이 0입니다. 현재 실패 판정: {record?.effective_failure?'예':'아니오'}</p>}

    {kind==='areas'&&<>
      <p>공개 허용과 공개 시각으로 접근을 제어합니다. 조사율은 발견된 고유 조사결과·마물·레시피에 따라 자동 계산되며 직접 수정할 수 없습니다.</p>
      <p>현재 조사율: {record?`${Number(record.investigation_rate).toFixed(2)}%`:'구역 등록 후 자동 계산'}</p>
    </>}

    {kind==='recipes'&&<>
      <p>기본 성공률 80%, 성공 3개 / 실패 1개. 성공률·성공 수량 변경은 다음 요리부터 적용됩니다. 실패 재료는 max(1, floor(수량/2))입니다.</p>
      <p>상점 판매 가격 (등급별 자동 적용): {recipePrices[draft.discovery_grade] ? `${recipePrices[draft.discovery_grade]}코인` : '등급 선택 후 자동 결정'}</p>
    </>}

    {kind==='gachas'&&<p>운영 시간대: KST (Asia/Seoul). ISO 시각에 +09:00을 입력하세요. 기간 제한을 끄면 저장된 시각과 관계없이 추첨합니다.<br/>{['start_at','end_at'].map(k=><span key={k}>{k==='start_at'?'시작':'종료'} KST: {draft[k]&&Number.isFinite(Date.parse(draft[k]))?new Date(draft[k]).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'미설정'} </span>)}</p>}

    {Object.entries(defaults[kind]).filter(([k])=>k!==child).map(([k,v])=>k.endsWith('item_id')?
        <ItemPicker key={k} label={kind==='recipes'?(recipeLabels[k]||labels[k]):labels[k]} value={draft[k]} disabled={busy||(k==='item_id'&&!!record)} onDenied={onDenied} onChange={id=>change(k,id)}/>:
        <label key={k}>{kind==='recipes'?(recipeLabels[k]||labels[k]):labels[k]}
          {['period_enabled','start_inclusive','end_inclusive'].includes(k)?
              <select value={draft[k]===null?'':String(draft[k])} disabled={busy} onChange={e=>change(k,e.target.value===''?null:e.target.value==='true')}>
                <option value="">기존 동작 유지 / 미설정</option>
                <option value="true">사용 / 포함</option>
                <option value="false">사용 안 함 / 제외</option>
              </select>:
              typeof v==='boolean'?
                  <input type="checkbox" checked={draft[k]} disabled={busy} onChange={e=>change(k,e.target.checked)}/>:
                  k==='grade_id'?
                      <select value={draft[k]??''} disabled={busy} onChange={e=>change(k,e.target.value||null)}>
                        <option value="">개별 회복량 유지</option>
                        {grades.map(g=><option key={g.id} value={g.id} disabled={!g.is_active}>{g.name} · +{g.blood_recovery}{g.is_active?'':' (비활성)'}</option>)}
                      </select>:
                      k==='stat_growth_target'?
                          <select value={draft[k]??''} disabled={busy} onChange={e=>change(k,e.target.value||null)}>
                            <option value="">NULL</option>
                            {['ATK','DEF','AGI'].map(s=><option key={s}>{s}</option>)}
                          </select>:
                          k==='discovery_grade'?
                              <select value={draft[k]??''} disabled={busy} onChange={e=>change(k,e.target.value||null)}>
                                <option value="">등급 미설정</option>
                                <option value="COMMON">일반 레시피</option>
                                <option value="RARE">희귀 레시피</option>
                                <option value="SPECIAL">특별 레시피</option>
                              </select>:
                              k==='rp_effect_texts'?
                                  <textarea disabled={busy} value={(draft[k]||[]).join('\n')} onChange={e=>change(k,e.target.value?e.target.value.split('\n'):[])}/>:
                                  ['description','rp_effect_text'].includes(k)?
                                      <textarea disabled={busy} value={draft[k]??''} onChange={e=>change(k,e.target.value||null)}/>:
                                      <input type={numeric.includes(k)?'number':'text'} step={k.endsWith('rate')?'any':1} value={draft[k]??''} disabled={busy||(k==='item_id'&&!!record)}
                                             onChange={e=>change(k,numeric.includes(k)?(e.target.value===''?'':Number(e.target.value)):(e.target.value||(v===null?null:'')))}/>
          }
        </label>
    )}

    {child&&<fieldset className="admin-wide" disabled={busy}>
      <legend>{kind==='recipes'?'필요 재료':'보상'}</legend>
      {rows.map((row,index)=><div className="admin-child-row" key={index}>
        <ItemPicker label={kind==='recipes'?'필요 재료':'보상'} value={row.item_id} disabled={busy} onDenied={onDenied} onChange={id=>changeRow(index,'item_id',id)}/>
        <label>{kind==='recipes'?'필요 수량':'수량'}<input type="number" min="1" value={row.quantity} onChange={e=>changeRow(index,'quantity',e.target.value===''?'':Number(e.target.value))}/></label>
        {kind==='gachas'&&<>
          <label>보상 활성<input type="checkbox" checked={row.is_active!==false} onChange={e=>changeRow(index,'is_active',e.target.checked)}/></label>
          <label>가중치<input type="number" min="1" value={row.weight} onChange={e=>changeRow(index,'weight',e.target.value===''?'':Number(e.target.value))}/></label>
          <span>확률 {total>0&&row.is_active!==false?(Number(row.weight)/total*100).toFixed(4):'0'}%</span>
        </>}
        <button type="button" onClick={()=>change(child,rows.filter((_,i)=>i!==index))}>행 제거</button>
      </div>)}
      <button type="button" onClick={()=>change(child,[...rows,{item_id:'',quantity:1,...(kind==='gachas'?{weight:1,is_active:true}:{})}])}>행 추가</button>
    </fieldset>}

    {record&&<details className="admin-wide">
      <summary>변경 전후 확인</summary>
      <pre>{JSON.stringify({before:record,after:draft},null,2)}</pre>
    </details>}

    {kind==='food-grades'&&record&&<button type="button" disabled={busy} onClick={async()=>{
      if (!window.confirm('참조 없는 등급만 영구 삭제합니다. 삭제하시겠습니까?')) return;
      setBusy(true);
      onBusy(true);
      try {
        await api('/admin/food-grades/'+record.id,{method:'DELETE',body:{requestKey:crypto.randomUUID()}});
        await onSaved(null);
      } catch(e) {
        setMessage(e.message);
        if ([401,403].includes(e.status)) onDenied(e.message);
      } finally {
        setBusy(false);
        onBusy(false);
      }
    }}>미참조 등급 삭제</button>}

    <button disabled={busy}>{busy?'저장 중…':'저장'}</button>
    <p role="alert">{message}</p>
  </form>;
}

export default function MasterPanel({kind,onDenied,recordId,onOpen,after,onPage}) {
  const selection=useRef(0),listing=useRef(0);
  const [search,setSearch]=useState('');
  const Editor=kind==='gachas'?GachaStockEditor:MasterEditor;
  const [records,setRecords]=useState([]),[selected,setSelected]=useState(null),[revision,setRevision]=useState(0);
  const [busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState(''),[next,setNext]=useState(null);

  async function load(cursor=after||null) {
    const request=++listing.current;
    setBusy(true);
    try {
      const data=await api(`/admin/${kind}${cursor?`?after=${cursor}`:''}`);
      if (request!==listing.current) return false;
      setRecords(data.records);
      setNext(data.nextAfter);
      return true;
    } catch(e) {
      setMessage(`${e.code}: ${e.message}`);
      if ([401,403].includes(e.status)) onDenied(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  useEffect(()=>{
    load(); // Remounted for each menu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[after]);

  useEffect(()=>{
    selection.current++;
    if (!onOpen) return;
    setSelected(null);
    setRevision(v=>v+1);
    if (recordId&&recordId!=='new') select({id:recordId},false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[recordId]);

  async function select(row,navigate=true) {
    if (onOpen&&navigate) {
      onOpen(String(row.id));
      return;
    }

    const request=++selection.current;
    setBusy(true);
    setMessage('');
    try {
      const data=await api(`/admin/${kind}/${row.id}`);
      if (request!==selection.current) return;
      setSelected(data.record);
      setRevision(v=>v+1);
    } catch(e) {
      setMessage(`${e.code}: ${e.message}`);
      if ([401,403].includes(e.status)) onDenied(e.message);
    } finally {
      setBusy(false);
    }
  }

  return <section aria-label="마스터 관리">
    <p role="status">{busy?'불러오는 중…':message}</p>
    <button disabled={busy||saving} onClick={()=>{setSelected(null);setRevision(v=>v+1);setMessage('');onOpen?.('new');}}>새로 등록</button>
    <button disabled={busy||saving} onClick={()=>load()}>목록 새로고침</button>
    {!records.length&&!busy&&<p>등록된 데이터가 없습니다.</p>}

    <label>현재 페이지 검색<input value={search} onChange={e=>setSearch(e.target.value)}/></label>
    <ul>{records.filter(r=>[r.id,r.name,r.item_id].join(' ').toLowerCase().includes(search.toLowerCase())).map(r=>
        <li key={r.id}>ID {r.id} · {r.name||`음식 아이템 ${r.item_id}`} <button disabled={busy||saving} onClick={()=>select(r)}>상세/수정</button></li>
    )}</ul>

    {after&&<button disabled={busy||saving} onClick={()=>onPage(null)}>처음 페이지</button>}
    {next&&<button disabled={busy||saving} onClick={()=>onPage?onPage(next):load(next)}>다음 100건</button>}

    {!busy&&(!onOpen||recordId==='new'||selected)&&<Editor key={revision} kind={kind} record={selected} onDenied={onDenied} onBusy={setSaving} onSaved={async r=>{
      setSelected(r);
      setRevision(v=>v+1);
      if (await load()) setMessage('저장 성공');
    }}/>}
  </section>;
}