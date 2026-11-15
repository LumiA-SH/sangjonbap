import {useEffect,useRef,useState} from 'react';
import {api} from '../api/client';

const labels={
    items:'아이템',monsters:'마물','food-grades':'음식 등급',
    products:'상점 상품',
    foods:'음식 설정',
    recipes:'레시피',
    gachas:'가챠',
    areas:'지역',
    clues:'단서',
    'investigation-results':'조사 결과'
};

export default function AdminDeleteControl({menu,recordId,areaId,disabled=false,onDeleted,onDenied}) {
    const isHub=menu==='area-hub';
    const [category,setCategory]=useState('investigation-results');
    const [target,setTarget]=useState('');
    const [entries,setEntries]=useState({results:[],clues:[]});
    const [loading,setLoading]=useState(false);
    const [deleting,setDeleting]=useState(false);
    const [message,setMessage]=useState('');
    const pending=useRef(false);

    useEffect(()=>{
        if (!isHub||!areaId)return;
        let live=true;
        setLoading(true);
        setTarget('');
        setMessage('');

        api(`/admin/areas/${areaId}/results`)
            .then(data=>{
                if (live)setEntries({results:data.results||[],clues:data.clues||[]});
            })
            .catch(e=>{
                if (!live)return;
                setMessage(`${e.code||'LOAD_FAILED'}: ${e.message}`);
                if ([401,403].includes(e.status))onDenied?.(e.message);
            })
            .finally(()=>{if(live)setLoading(false);});

        return ()=>{live=false;};
    },[isHub,areaId,onDenied]);

    const kind=isHub?category:menu==='investigation'?'investigation-results':menu;
    const id=isHub?(category==='areas'?areaId:target):recordId;
    const valid=Object.hasOwn(labels,kind)&&id&&id!=='new'&&
        (kind!=='investigation-results'||!!areaId);

    if (!valid&&!isHub)return null;
    if (isHub&&!areaId)return null;

    const options=isHub?(category==='clues'?entries.clues:entries.results):[];
    const url=kind==='investigation-results'
        ? `/admin/areas/${areaId}/results/${id}`
        : `/admin/${kind}/${id}`;

    async function remove() {
        if (pending.current||!valid||disabled)return;
        if (!window.confirm(
            `${labels[kind]} ID ${id}을 영구 삭제하시겠습니까?\n\n`+
            '이 작업은 되돌릴 수 없습니다. 실제 사용 기록, 발견 이력, 구매 내역 또는 참조가 있으면 삭제가 거부됩니다.'
        ))return;

        pending.current=true;
        setDeleting(true);
        setMessage('');

        try {
            await api(url,{
                method:'DELETE',
                body:{requestKey:crypto.randomUUID()}
            });
            setTarget('');
            await onDeleted?.({kind,id});
        } catch(e) {
            setMessage(`${e.code||'DELETE_FAILED'}: ${e.message}`);
            if ([401,403].includes(e.status))onDenied?.(e.message);
        } finally {
            pending.current=false;
            setDeleting(false);
        }
    }

    return (
        <div className={isHub?"admin-toolbar-actions":"admin-delete-inline"} role="group" aria-label="관리자 콘텐츠 삭제">
            {isHub&&<>
                <label>
                    삭제 대상 종류
                    <select value={category} disabled={disabled||loading||deleting}
                            onChange={e=>{setCategory(e.target.value);setTarget('');setMessage('');}}>
                        <option value="investigation-results">조사 결과</option>
                        <option value="clues">단서</option>
                        <option value="areas">현재 지역</option>
                    </select>
                </label>

                {category!=='areas'&&
                    <label>
                        삭제할 {labels[category]}
                        <select value={target} disabled={disabled||loading||deleting}
                                onChange={e=>setTarget(e.target.value)}>
                            <option value="">항목 선택</option>
                            {options.map(row=>
                                <option key={row.id} value={String(row.id)}>
                                    {category==='clues'?row.title:row.result_text} · ID {row.id}
                                </option>
                            )}
                        </select>
                    </label>
                }
            </>}

            <button type="button" disabled={disabled||loading||deleting||!valid} onClick={remove}>
                {deleting?'삭제 중…':'삭제'}
            </button>
            {message&&<p role="alert">{message}</p>}
        </div>
    );
}
