import { displayLabel } from '../features/displayLabels';
/* global BigInt */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { toKstInput, fromKstInput } from './kstDateTime';
import ItemPicker from './ItemPicker';
import GachaStockEditor from './GachaStockEditor';
import ImageUploadField from './ImageUploadField';
import AdminReferenceName, { invalidateAdminNames } from './AdminReferenceName';
import AdminDeleteControl from './AdminDeleteControl';

const defaults = {
    areas: {
        name: '',
        description: null,
        image_url: null,
        sort_order: 0,
        encounter_rate: 40,
        is_open: false,
        auto_unlock: false,
        unlock_at: null,
    },
    'food-grades': {
        name: '',
        blood_recovery: 10,
        stat_growth_rate: 15,
        is_active: true,
    },
    foods: {
        description: null,
        is_active: true,
        image_url: null,
        grade_id: null,
        is_failure: false,
        name: '',
        blood_recovery: 0,
        stat_growth_enabled: false,
        stat_growth_target: null,
        stat_growth_value: 0,
        rp_effect_text: null,
        rp_effect_texts: [],
    },
    recipes: {
        image_url: null,
        name: '',
        description: null,
        discovery_grade: null,
        success_rate: 80,
        result_quantity: 3,
        result_item_id: '',
        failure_item_id: null,
        is_active: true,
        ingredients: [],
        area_recipes: [],
    },
    gachas: {
        name: '',
        price: 1,
        is_active: true,
        start_at: null,
        end_at: null,
        period_enabled: null,
        start_inclusive: null,
        end_inclusive: null,
        rewards: [],
    },
};

const recipePrices = { COMMON: 2, RARE: 3, SPECIAL: 4 };

const labels = {
    period_enabled: '기간 제한',
    start_inclusive: '시작 경계 포함',
    end_inclusive: '종료 경계 포함',
    grade_id: '음식 등급',
    is_failure: '실패 RP 음식 (수치 효과 없음)',
    encounter_rate: '조우 확률 (%)',
    item_id: '아이템 선택',
    blood_recovery: '혈량 회복',
    stat_growth_enabled: '능력치 성장 적용',
    stat_growth_rate: '능력치 성장 확률 (%)',
    stat_growth_target: '성장 대상 능력치',
    stat_growth_value: '성장량',
    rp_effect_texts: '실패요리 RP 문구 후보 (한 줄에 하나, 최대 50개)',
    rp_effect_text: '기존 RP 효과 설명',
    name: '이름',
    description: '설명',
    success_rate: '성공 확률 (%)',
    result_item_id: '완성 음식',
    failure_item_id: '실패 요리',
    is_active: '활성',
    price: '가격',
    start_at: '시작 시각 (시간대 포함 ISO)',
    end_at: '종료 시각 (시간대 포함 ISO)',
};

const recipeLabels = {
    discovery_grade: '레시피 등급',
    success_rate: '요리 성공 확률 (%)',
    result_item_id: '완성 음식',
    failure_item_id: '실패 요리',
    result_quantity: '완성 음식 지급 수량',
    is_active: '사용 여부',
};

const numeric = ['encounter_rate', 'sort_order', 'blood_recovery', 'stat_growth_rate', 'stat_growth_value', 'success_rate', 'price', 'result_quantity'];

labels.result_quantity = '성공 음식 수량';

Object.assign(labels, {
    is_open: '공개 허용',
    auto_unlock: '지정 시각에 예약 공개',
    unlock_at: '공개 시각 (KST, 비우면 즉시)',
});

Object.assign(labels, {
    image_url: '이미지 URL',
    sort_order: '표시 순서',
});

const isId = (value) => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;

export function validateDraft(kind, draft) {
    for (const [key, value] of Object.entries(draft)) {
        if (
            numeric.includes(key) &&
            (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2147483647 || (!key.endsWith('rate') && !Number.isInteger(value)))
        ) {
            return `${labels[key]} 값을 확인하세요.`;
        }

        if (key.endsWith('rate') && (value > 100 || Number(value.toFixed(2)) !== value)) {
            return '확률은 소수 둘째 자리까지의 0~100입니다.';
        }

        if (key.endsWith('item_id') && !(key === 'failure_item_id' && value === null) && !isId(value)) {
            return '아이템 선택값을 확인하세요.';
        }
    }

    if (draft.rp_effect_texts && (draft.rp_effect_texts.length > 50 || draft.rp_effect_texts.some((v) => !v.trim() || v.length > 500))) {
        return 'RP 문구는 1~500자, 최대 50개입니다.';
    }

    if ('grade_id' in draft && draft.grade_id !== null && !isId(draft.grade_id)) {
        return '음식 등급을 선택하세요.';
    }

    if ('name' in draft && (!draft.name.trim() || [...draft.name].length > 100)) {
        return '이름은 1~100자입니다.';
    }

    if (
        kind === 'foods' &&
        (draft.stat_growth_enabled
            ? !draft.stat_growth_target || draft.stat_growth_value !== 1
            : draft.stat_growth_target !== null || draft.stat_growth_value !== 0)
    ) {
        return '능력치 성장 적용 시 성장 대상과 +1 설정이 필요합니다.';
    }

    if (kind === 'foods' && draft.stat_growth_enabled && !draft.grade_id) {
        return '능력치 성장을 적용하려면 음식 등급을 선택하세요.';
    }

    const children = draft.ingredients || draft.rewards;

    if (children) {
        if (kind === 'recipes' && !children.length) {
            return '재료를 한 개 이상 등록하세요.';
        }

        if (kind === 'recipes' && children.length > 5) {
            return '레시피 재료는 최대 5종입니다.';
        }

        if (
            children.some(
                (r) =>
                    !isId(r.item_id) ||
                    !Number.isInteger(r.quantity) ||
                    r.quantity < 1 ||
                    r.quantity > 2147483647 ||
                    ('weight' in r && (!Number.isInteger(r.weight) || r.weight < 1 || r.weight > 2147483647)),
            )
        ) {
            return '재료/보상의 아이템 선택값, 수량과 가중치를 확인하세요.';
        }

        if (new Set(children.map((r) => r.item_id)).size !== children.length) {
            return '아이템을 중복 등록할 수 없습니다.';
        }
    }

    if (kind === 'recipes' && !draft.failure_item_id) {
        return '실패 가능한 레시피에는 실패 음식이 필요합니다.';
    }

    if (kind === 'recipes' && draft.result_quantity !== undefined && draft.result_quantity < 1) {
        return '성공 음식 수량은 양수입니다.';
    }

    if (kind === 'recipes') {
        const areas = draft.area_recipes || [];

        if (!Array.isArray(areas) || areas.length > 100) {
            return '등장 구역은 최대 100개까지 등록할 수 있습니다.';
        }

        for (const row of areas) {
            if (
                !isId(String(row.area_id || '')) ||
                !Number.isInteger(row.weight) ||
                row.weight < 1 ||
                row.weight > 2147483647 ||
                typeof row.drop_rate !== 'number' ||
                !Number.isFinite(row.drop_rate) ||
                row.drop_rate < 0 ||
                row.drop_rate > 100 ||
                Number(row.drop_rate.toFixed(2)) !== row.drop_rate
            ) {
                return '등장 구역, 선택 가중치, 발견 확률을 확인하세요.';
            }
        }

        if (new Set(areas.map((row) => String(row.area_id))).size !== areas.length) {
            return '같은 등장 구역을 중복 등록할 수 없습니다.';
        }
    }

    for (const key of ['start_at', 'end_at', 'unlock_at']) {
        if (
            draft[key] &&
            (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(draft[key]) || !Number.isFinite(Date.parse(draft[key])))
        ) {
            return '시각은 2026-10-11T00:00:00+09:00 형식입니다.';
        }
    }

    if (
        kind === 'gachas' &&
        draft.period_enabled === true &&
        (!draft.start_at || !draft.end_at || typeof draft.start_inclusive !== 'boolean' || typeof draft.end_inclusive !== 'boolean')
    ) {
        return '기간 활성 시 시작·종료 시각과 경계 포함 여부를 설정하세요.';
    }

    const micros = (value) => BigInt(Date.parse(value)) * 1000n + BigInt((value.match(/\.(\d+)/)?.[1] || '').padEnd(6, '0').slice(3, 6));

    if (draft.start_at && draft.end_at && micros(draft.end_at) <= micros(draft.start_at)) {
        return '종료 시각은 시작 시각 이후여야 합니다.';
    }

    return '';
}

export function MasterEditor({ kind, record, onSaved, onDenied, onBusy, deleteControl }) {
    const [draft, setDraft] = useState(() =>
        Object.fromEntries(
            Object.entries(defaults[kind]).map(([k, v]) => [
                k,
                kind === 'foods' && k === 'rp_effect_texts'
                    ? record?.rp_effect_texts?.length
                        ? record.rp_effect_texts
                        : record?.rp_effect_text
                          ? [record.rp_effect_text]
                          : []
                    : (record?.[k] ?? v),
            ]),
        ),
    );

    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const saving = useRef(false);
    const [grades, setGrades] = useState([]);
    const [areas, setAreas] = useState([]);
    const [imageUploading, setImageUploading] = useState(false);

    useEffect(() => {
        if (kind === 'foods') {
            (async () => {
                let after = null;
                let all = [];

                do {
                    const r = await api('/admin/food-grades' + (after ? '?after=' + after : ''));
                    all = all.concat(r.records);
                    after = r.nextAfter;
                } while (after);

                setGrades(all);
            })().catch((e) => {
                setMessage(e.message);

                if ([401, 403].includes(e.status)) {
                    onDenied(e.message);
                }
            });
        }
    }, [kind, onDenied]);

    useEffect(() => {
        if (kind !== 'recipes') return;

        let live = true;

        (async () => {
            let after = null;
            let all = [];

            do {
                const r = await api('/admin/areas' + (after ? '?after=' + after : ''));
                all = all.concat(r.records);
                after = r.nextAfter;
            } while (after);

            if (live) setAreas(all);
        })().catch((e) => {
            if (!live) return;

            setMessage(`${e.code || 'AREA_LOAD_FAILED'}: ${e.message}`);

            if ([401, 403].includes(e.status)) {
                onDenied(e.message);
            }
        });

        return () => {
            live = false;
        };
    }, [kind, onDenied]);

    const child = kind === 'recipes' ? 'ingredients' : kind === 'gachas' ? 'rewards' : null;
    const rows = child ? draft[child] : [];

    const total = rows.filter((r) => r.is_active !== false).reduce((sum, r) => sum + (Number(r.weight) || 0), 0);

    const selectedGrade = kind === 'foods' ? grades.find((g) => String(g.id) === String(draft.grade_id)) : null;

    const recipeAreas = kind === 'recipes' ? draft.area_recipes || [] : [];
    const hasRecipeDiscovery = kind === 'recipes' && (record?.area_recipes || []).some((row) => row.discovered);

    function change(k, v) {
        setDraft((d) => ({
            ...d,
            [k]: v,
            ...(k === 'stat_growth_enabled'
                ? {
                      stat_growth_value: v ? 1 : 0,
                      stat_growth_target: v ? d.stat_growth_target : null,
                  }
                : {}),
        }));
    }

    function changeRow(index, k, v) {
        change(
            child,
            rows.map((r, i) => (i === index ? { ...r, [k]: v } : r)),
        );
    }

    function changeAreaRecipe(index, k, v) {
        setDraft((d) => ({
            ...d,
            area_recipes: d.area_recipes.map((row, i) => (i === index ? { ...row, [k]: v } : row)),
        }));
    }

    async function save(event) {
        event.preventDefault();
        if (saving.current || imageUploading) return;

        const error = validateDraft(kind, draft);

        if (error) {
            setMessage(error);
            return;
        }

        saving.current = true;
        setBusy(true);
        onBusy(true);
        setMessage('');

        const body = { ...draft };
        if (kind === 'foods') body.rp_effect_text = null;

        if (record && kind === 'areas') {
            for (const key of Object.keys(body)) {
                if (body[key] === (record[key] ?? defaults.areas[key])) {
                    delete body[key];
                }
            }
        }

        if (record && kind === 'foods') delete body.item_id;

        if (child) {
            body[child] = rows.map((r) => ({
                item_id: r.item_id,
                quantity: r.quantity,
                ...(kind === 'gachas' ? { weight: r.weight, is_active: r.is_active ?? true } : {}),
            }));
        }

        if (kind === 'recipes') {
            body.area_recipes = recipeAreas.map((row) => ({
                area_id: String(row.area_id),
                weight: Number(row.weight),
                drop_rate: Number(row.drop_rate),
            }));
        }

        try {
            const data = await api(`/admin/${kind}${record ? `/${record.id}` : ''}`, {
                method: record ? 'PATCH' : 'POST',
                body: { ...body, requestKey: crypto.randomUUID() },
            });

            invalidateAdminNames();
            await onSaved(data.record);
        } catch (e) {
            setMessage(`${e.code || 'SAVE_FAILED'}: ${e.message}`);

            if ([401, 403].includes(e.status)) {
                onDenied(e.message);
            }
        } finally {
            saving.current = false;
            setBusy(false);
            onBusy(false);
        }
    }

    const renderFields = (keys) =>
        keys
            .map((k) => [k, defaults[kind][k]])
            .filter(([k]) => k !== child && k !== 'area_recipes' && !(kind === 'foods' && k === 'stat_growth_value'))
            .map(([k, v]) =>
                k === 'image_url' ? (
                    <ImageUploadField
                        key={k}
                        kind={kind === 'foods' ? 'items' : kind}
                        label={kind === 'foods' ? '음식 이미지' : kind === 'recipes' ? '레시피 이미지' : '구역 이미지'}
                        value={draft[k]}
                        onChange={(value) => change(k, value)}
                        disabled={busy}
                        onDenied={onDenied}
                        onUploadingChange={setImageUploading}
                    />
                ) : k.endsWith('item_id') ? (
                    <ItemPicker
                        key={k}
                        label={kind === 'recipes' ? recipeLabels[k] || labels[k] : labels[k]}
                        value={draft[k]}
                        disabled={busy || (k === 'item_id' && !!record)}
                        type={kind === 'recipes' ? (k === 'result_item_id' ? 'food' : k === 'failure_item_id' ? 'failure-food' : 'all') : 'all'}
                        onDenied={onDenied}
                        onChange={(id, item) => {
                            if (kind === 'foods' && k === 'item_id') {
                                setDraft((current) => ({
                                    ...current,
                                    item_id: id || '',
                                    name: item?.name || '',
                                    image_url: item?.image_url || null,
                                }));
                            } else {
                                change(k, id);
                            }
                        }}
                    />
                ) : (
                    <label
                        key={k}
                        className={
                            ['description', 'rp_effect_text', 'rp_effect_texts'].includes(k)
                                ? 'admin-field-wide'
                                : typeof v === 'boolean'
                                  ? 'admin-field-check'
                                  : undefined
                        }>
                        {kind === 'foods' && k === 'name' ? '음식 이름' : kind === 'recipes' ? recipeLabels[k] || labels[k] : labels[k]}

                        {['period_enabled', 'start_inclusive', 'end_inclusive'].includes(k) ? (
                            <select
                                value={draft[k] === null ? '' : String(draft[k])}
                                disabled={busy}
                                onChange={(e) => change(k, e.target.value === '' ? null : e.target.value === 'true')}>
                                <option value="">기존 동작 유지 / 미설정</option>
                                <option value="true">사용 / 포함</option>
                                <option value="false">사용 안 함 / 제외</option>
                            </select>
                        ) : typeof v === 'boolean' ? (
                            <input type="checkbox" checked={draft[k]} disabled={busy} onChange={(e) => change(k, e.target.checked)} />
                        ) : k === 'grade_id' ? (
                            <select value={draft[k] ?? ''} disabled={busy} onChange={(e) => change(k, e.target.value || null)}>
                                <option value="">음식 등급 미설정</option>
                                {grades.map((g) => (
                                    <option key={g.id} value={g.id} disabled={!g.is_active}>
                                        {g.name} · 혈량 +{g.blood_recovery} · 성장 {Number(g.stat_growth_rate)}%{g.is_active ? '' : ' (비활성)'}
                                    </option>
                                ))}
                            </select>
                        ) : k === 'stat_growth_target' ? (
                            <select value={draft[k] ?? ''} disabled={busy} onChange={(e) => change(k, e.target.value || null)}>
                                <option value="">성장 능력치 선택</option>
                                {['ATK', 'DEF', 'AGI'].map((s) => (
                                    <option key={s} value={s}>
                                        {displayLabel(s)}
                                    </option>
                                ))}
                            </select>
                        ) : k === 'discovery_grade' ? (
                            <select value={draft[k] ?? ''} disabled={busy} onChange={(e) => change(k, e.target.value || null)}>
                                <option value="">등급 미설정</option>
                                <option value="COMMON">일반 레시피</option>
                                <option value="RARE">희귀 레시피</option>
                                <option value="SPECIAL">특별 레시피</option>
                            </select>
                        ) : k === 'unlock_at' ? (
                            <input
                                type="datetime-local"
                                step="1"
                                disabled={busy}
                                value={toKstInput(draft[k])}
                                onChange={(e) => change(k, fromKstInput(e.target.value))}
                            />
                        ) : k === 'rp_effect_texts' ? (
                            <textarea
                                disabled={busy}
                                value={(draft[k] || []).join('\n')}
                                onChange={(e) => change(k, e.target.value ? e.target.value.split('\n') : [])}
                            />
                        ) : ['description', 'rp_effect_text'].includes(k) ? (
                            <textarea disabled={busy} value={draft[k] ?? ''} onChange={(e) => change(k, e.target.value || null)} />
                        ) : (
                            <input
                                type={numeric.includes(k) ? 'number' : 'text'}
                                step={k.endsWith('rate') ? 'any' : 1}
                                value={draft[k] ?? ''}
                                disabled={busy || (k === 'item_id' && !!record)}
                                onChange={(e) =>
                                    change(
                                        k,
                                        numeric.includes(k)
                                            ? e.target.value === ''
                                                ? ''
                                                : Number(e.target.value)
                                            : e.target.value || (v === null ? null : ''),
                                    )
                                }
                            />
                        )}
                    </label>
                ),
            );
    const section = (title, keys, note) => (
        <section className="admin-editor-section" key={title}>
            <h4>{title}</h4>
            <div className="admin-editor-grid">{renderFields(keys)}</div>
            {note && <p className="admin-editor-note">{note}</p>}
        </section>
    );
    const failureFood = kind === 'foods' && (draft.is_failure || (record?.effective_failure && !record?.is_failure));

    return (
        <form onSubmit={save} className="admin-form admin-structured-editor">
            <header className="admin-editor-heading admin-editor-heading-actions">
                <div>
                    <small>{record ? `수정 / ${record.id}` : '신규 등록'}</small>
                    <h3>
                        {record
                            ? kind === 'foods'
                                ? record.name || <AdminReferenceName itemId={record.item_id} eager onDenied={onDenied} />
                                : record.name || '등록 정보'
                            : '새로 등록'}
                    </h3>
                </div>
                <div className="admin-editor-heading-controls admin-editor-heading-vertical">
                    {Object.hasOwn(defaults[kind], 'is_active') && (
                        <label className="admin-editor-toggle">
                            <input type="checkbox" checked={!!draft.is_active} disabled={busy} onChange={(e) => change('is_active', e.target.checked)} />
                            활성화
                        </label>
                    )}
                    {deleteControl}
                </div>
            </header>

            {kind === 'areas' && (
                <>
                    <p>공개 허용과 공개 시각으로 접근을 제어합니다. 조사율은 발견된 고유 조사결과·마물·레시피에 따라 자동 계산되며 직접 수정할 수 없습니다.</p>
                    <p>현재 조사율: {record ? `${Number(record.investigation_rate).toFixed(2)}%` : '구역 등록 후 자동 계산'}</p>
                </>
            )}

            {kind === 'recipes' && (
                <details className="admin-editor-reference">
                    <summary>요리 규칙 · 등록 안내</summary>
                    <p>기본 성공률 80%, 성공 3개 / 실패 1개. 성공률·성공 수량 변경은 다음 요리부터 적용됩니다. 실패 재료는 max(1, floor(수량/2))입니다.</p>
                    <p>
                        상점 판매 가격 (등급별 자동 적용):{' '}
                        {recipePrices[draft.discovery_grade] ? `${recipePrices[draft.discovery_grade]}코인` : '등급 선택 후 자동 결정'}
                    </p>
                    <p>완성 음식과 실패 요리는 먼저 아이템·음식 설정에 등록되어 있어야 합니다. 필요한 식재료는 아이템 메뉴에서 등록합니다.</p>
                </details>
            )}

            {kind === 'gachas' && (
                <p>
                    운영 시간대: KST (Asia/Seoul). ISO 시각에 +09:00을 입력하세요. 기간 제한을 끄면 저장된 시각과 관계없이 추첨합니다.
                    <br />
                    {['start_at', 'end_at'].map((k) => (
                        <span key={k}>
                            {k === 'start_at' ? '시작' : '종료'} KST:{' '}
                            {draft[k] && Number.isFinite(Date.parse(draft[k]))
                                ? new Date(draft[k]).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
                                : '미설정'}{' '}
                        </span>
                    ))}
                </p>
            )}

            {kind === 'foods' ? (
                <>
                    {section(
                        '음식 기본 정보',
                        ['name', 'description', 'image_url'],
                        '음식 이름 변경은 연결된 아이템의 이름에도 반영됩니다. 인벤토리·상점의 연결은 유지됩니다.',
                    )}

                    {section('음식 구분', ['is_failure'])}

                    {failureFood ? (
                        section('실패요리 RP 효과', ['rp_effect_texts'], '섭취 시 문구 후보 중 하나를 사용합니다. 실제 자원·능력치 효과는 적용되지 않습니다.')
                    ) : (
                        <>
                            {section(
                                '일반 음식 효과',
                                selectedGrade
                                    ? ['grade_id', 'stat_growth_enabled', 'stat_growth_target']
                                    : ['grade_id', 'blood_recovery', 'stat_growth_enabled', 'stat_growth_target'],
                                selectedGrade
                                    ? `선택한 등급의 공통 효과 · 혈량 +${selectedGrade.blood_recovery} / 성장 확률 ${selectedGrade.stat_growth_rate}%`
: '공통 밸런스에 등록한 음식 등급을 선택하세요.',
)}
<details className="admin-editor-reference">
  <summary>기존 RP 문구 확인 · 수정</summary>
  {section('RP 문구', ['rp_effect_texts'])}
</details>
</>
)}
</>
) : kind === 'recipes' ? (
    <>{section('레시피 기본 정보', ['name', 'discovery_grade', 'description', 'image_url', 'success_rate'])}</>
) : kind === 'areas' ? (
    <>
      {section('구역 기본 정보', ['name', 'description', 'image_url', 'sort_order'])}
      {section('공개 · 조우 설정', ['is_open', 'auto_unlock', 'unlock_at', 'encounter_rate'])}
    </>
) : (
    section(
        '기본 정보',
        Object.keys(defaults[kind]).filter((key) => key !== 'is_active'),
    )
)}

{child && (
    <fieldset className="admin-wide" disabled={busy}>
      <legend>{kind === 'recipes' ? '필요 재료 (최대 5종)' : '보상'}</legend>

      {rows.map((row, index) => (
          <div className="admin-child-row" key={index}>
            <ItemPicker
                label={kind === 'recipes' ? '필요 재료' : '보상'}
                type={kind === 'recipes' ? 'material' : 'all'}
                value={row.item_id}
                disabled={busy}
                onDenied={onDenied}
                onChange={(id) => changeRow(index, 'item_id', id)}
            />

            <label>
              {kind === 'recipes' ? '필요 수량' : '수량'}
              <input
                  type="number"
                  min="1"
                  value={row.quantity}
                  onChange={(e) => changeRow(index, 'quantity', e.target.value === '' ? '' : Number(e.target.value))}
              />
            </label>

            {kind === 'gachas' && (
                <>
                  <label>
                    보상 활성
                    <input
                        type="checkbox"
                        checked={row.is_active !== false}
                        onChange={(e) => changeRow(index, 'is_active', e.target.checked)}
                    />
                  </label>

                  <label>
                    가중치
                    <input
                        type="number"
                        min="1"
                        value={row.weight}
                        onChange={(e) => changeRow(index, 'weight', e.target.value === '' ? '' : Number(e.target.value))}
                    />
                  </label>

                  <span>확률 {total > 0 && row.is_active !== false ? ((Number(row.weight) / total) * 100).toFixed(4) : '0'}%</span>
                </>
            )}

            <button
                type="button"
                onClick={() =>
                    change(
                        child,
                        rows.filter((_, i) => i !== index),
                    )
                }>
              행 제거
            </button>
          </div>
      ))}

      <button
          type="button"
          disabled={busy || (kind === 'recipes' && rows.length >= 5)}
          onClick={() =>
              change(child, [
                ...rows,
                {
                  item_id: '',
                  quantity: 1,
                  ...(kind === 'gachas' ? { weight: 1, is_active: true } : {}),
                },
              ])
          }>
        행 추가
      </button>
    </fieldset>
)}

{kind === 'recipes' && section('완성 음식 · 실패 음식', ['result_item_id', 'result_quantity', 'failure_item_id'])}

{kind === 'recipes' && (
    <fieldset className="admin-wide" disabled={busy}>
      <legend>등장 구역 · 레시피 발견 설정</legend>
      <p>
        선택한 구역에서 조사 또는 마물 처치 시 미발견 레시피 후보로 추첨됩니다. 선택 가중치는 후보 간 비율이며 발견 확률은 해당 레시피의 실제
        발견 판정입니다.
      </p>

      {recipeAreas.map((row, index) => (
          <div className="admin-child-row" key={index}>
            <label>
              등장 구역
              <select
                  required
                  value={String(row.area_id ?? '')}
                  disabled={busy || hasRecipeDiscovery}
                  onChange={(e) => changeAreaRecipe(index, 'area_id', e.target.value)}>
                <option value="">구역 선택</option>
                {areas.map((area) => (
                    <option key={area.id} value={String(area.id)}>
                      {area.name}
                    </option>
                ))}
              </select>
            </label>

            <label>
              선택 가중치
              <input
                  type="number"
                  min="1"
                  max="2147483647"
                  step="1"
                  value={row.weight}
                  disabled={busy}
                  onChange={(e) => changeAreaRecipe(index, 'weight', e.target.value === '' ? '' : Number(e.target.value))}
              />
            </label>

            <label>
              발견 확률 (%)
              <input
                  type="number"
                  min="0"
                  max="100"
                  step=".01"
                  value={row.drop_rate}
                  disabled={busy}
                  onChange={(e) => changeAreaRecipe(index, 'drop_rate', e.target.value === '' ? '' : Number(e.target.value))}
              />
            </label>

            {row.discovered && <span>최초 발견 완료</span>}

            <button
                type="button"
                disabled={busy || hasRecipeDiscovery}
                onClick={() =>
                    change(
                        'area_recipes',
                        recipeAreas.filter((_, i) => i !== index),
                    )
                }>
              구역 제거
            </button>
          </div>
      ))}

      <button
          type="button"
          disabled={busy || hasRecipeDiscovery}
          onClick={() => change('area_recipes', [...recipeAreas, { area_id: '', weight: 1, drop_rate: 100 }])}>
        등장 구역 추가
      </button>

      {hasRecipeDiscovery && (
          <p>
            이미 최초 발견된 레시피는 조사율과 발견 이력을 보호하기 위해 등장 구역을 추가하거나 제거할 수 없습니다. 기존 구역의 가중치와 발견
            확률은 수정할 수 있습니다.
          </p>
      )}
    </fieldset>
)}

{record && (
    <details className="admin-wide">
      <summary>변경 전후 확인</summary>
      <pre>{JSON.stringify({ before: record, after: draft }, null, 2)}</pre>
    </details>
)}

<footer className="admin-editor-footer">
  <button disabled={busy || imageUploading}>{imageUploading ? '이미지 업로드 중…' : busy ? '저장 중…' : '저장'}</button>

  <p role="alert">{message}</p>
</footer>
</form>
);
}

export default function MasterPanel({ kind, onDenied, recordId, onOpen, after, onPage }) {
  const selection = useRef(0);
  const listing = useRef(0);

  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const Editor = kind === 'gachas' ? GachaStockEditor : MasterEditor;

  const [records, setRecords] = useState([]);
  const [selected, setSelected] = useState(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [next, setNext] = useState(null);
  const [resolvedNames, setResolvedNames] = useState({});

  const handleNameResolved = useCallback((key, name) => {
    setResolvedNames((previous) => {
      if (previous[key] === name) return previous;
      return { ...previous, [key]: name };
    });
  }, []);

  async function load(cursor = after || null) {
    const request = ++listing.current;
    setBusy(true);

    try {
      const data = await api(`/admin/${kind}${cursor ? `?after=${cursor}` : ''}`);

      if (request !== listing.current) return false;

      setRecords(data.records);
      setNext(data.nextAfter);
      return true;
    } catch (e) {
      setMessage(`${e.code}: ${e.message}`);

      if ([401, 403].includes(e.status)) {
        onDenied(e.message);
      }

      return false;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [after]);

  useEffect(() => {
    selection.current++;

    if (!onOpen) return;

    setSelected(null);
    setRevision((v) => v + 1);

    if (recordId && recordId !== 'new') {
      select({ id: recordId }, false);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);

  async function select(row, navigate = true) {
    if (onOpen && navigate) {
      onOpen(String(row.id));
      return;
    }

    const request = ++selection.current;
    setBusy(true);
    setMessage('');

    try {
      const data = await api(`/admin/${kind}/${row.id}`);

      if (request !== selection.current) return;

      setSelected(data.record);
      setRevision((v) => v + 1);
    } catch (e) {
      setMessage(`${e.code}: ${e.message}`);

      if ([401, 403].includes(e.status)) {
        onDenied(e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const normalizedSearch = search.trim().toLowerCase();

  const visibleRecords = records.filter((row) => {
    if (activeFilter !== 'all' && typeof row.is_active === 'boolean' && row.is_active !== (activeFilter === 'active')) return false;
    if (!normalizedSearch) return true;

    const referenceKey = kind === 'foods' ? `items:${row.item_id}` : '';
    const resolvedName = referenceKey ? resolvedNames[referenceKey] : '';

    const text = [row.id, row.name, row.item_id, resolvedName]
        .filter((value) => value != null)
        .join(' ')
        .toLowerCase();

    return text.includes(normalizedSearch) || (kind === 'foods' && !resolvedName);
  });

  function openAdminRow(event, row) {
    if (busy || saving) return;

    if (
        event.target.closest(
            'button, a, input, select, textarea, label, summary, [role="button"], [role="link"], .admin-record-actions, .admin-delete-inline',
        )
    )
      return;
    if (kind === 'gachas' && event.target.closest('td:last-child')) return;

    select(row);
  }

  return (
      <section aria-label="마스터 관리" className={'admin-record-workspace' + (kind === 'gachas' ? ' gacha-catalog' + (recordId === 'new' || selected ? ' has-editor' : '') : '')}>
        <div className="admin-list-pane">
          <p role="status">{busy ? '불러오는 중…' : message}</p>

          <div className="admin-toolbar-actions">
            {kind === 'gachas' && <h3 className="gacha-catalog-heading">등록된 가챠</h3>}
            <button
                disabled={busy || saving}
                onClick={() => {
                  setSelected(null);
                  setRevision((v) => v + 1);
                  setMessage('');
                  onOpen?.('new');
                }}>
              {kind === 'gachas' ? '+ 가챠 생성' : '새로 등록'}
            </button>

            <button disabled={busy || saving} onClick={() => load()}>목록 새로고침</button>
          </div>

          {!records.length && !busy && <p>등록된 데이터가 없습니다.</p>}

          <label className={kind === 'gachas' ? 'gacha-catalog-search' : undefined}>
            {kind === 'gachas' ? '가챠 이름 검색' : '현재 페이지 검색'}
            <input value={search} placeholder={kind === 'gachas' ? '가챠 이름 검색' : undefined} onChange={(e) => setSearch(e.target.value)} />
          </label>

          {['foods', 'recipes', 'gachas'].includes(kind) && (
              <label>
                표시 상태
                <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)}>
                  <option value="all">전체</option>
                  <option value="active">활성 데이터만</option>
                  <option value="inactive">비활성 데이터만</option>
                </select>
              </label>
          )}
          <small className="admin-list-count">
            현재 페이지 {visibleRecords.length} / {records.length}건
          </small>
          {kind === 'gachas' ? (
              <div className="gacha-catalog-table-wrap">
                <table className="gacha-catalog-table">
                  <thead>
                  <tr>
                    <th>가챠 이름</th>
                    <th>가격</th>
                    <th>보상 종류</th>
                    <th>상태</th>
                    <th>관리</th>
                  </tr>
                  </thead>
                  <tbody>
                  {visibleRecords.map((row) => (
                      <tr key={row.id} className="admin-clickable-row" onClick={(event) => openAdminRow(event, row)}>
                        <td>
                          <button type="button" className="admin-entry-title" disabled={busy || saving} onClick={() => select(row)}>
                            {row.name}
                          </button>
                        </td>
                        <td>1 코인</td>
                        <td>{(row.rewards || []).filter((r) => r.is_active !== false).length}종</td>
                        <td>
                                            <span className={row.is_active ? 'gacha-status is-active' : 'gacha-status'}>
                                                {row.is_active ? '활성' : '비활성'}
                                            </span>
                        </td>
                        <td className="gacha-catalog-controls">
                          <div className="gacha-management-actions">
                            <button type="button" disabled={busy || saving} onClick={() => select(row)}>편집</button>
                            <AdminDeleteControl
                                menu={kind}
                                recordId={String(row.id)}
                                disabled={busy || saving}
                                onDenied={onDenied}
                                onDeleted={async () => {
                                  invalidateAdminNames();
                                  await load();
                                  setMessage('삭제 완료');
                                }}
                            />
                          </div>
                        </td>
                      </tr>
                  ))}
                  </tbody>
                </table>
              </div>
          ) : (
              <ul className="admin-master-records">
                {visibleRecords.map((row) => (
                    <li key={row.id} className="admin-clickable-row" onClick={(event) => openAdminRow(event, row)}>
                      <div className="admin-record-summary">
                        <button
                            type="button"
                            className="admin-entry-title"
                            disabled={busy || saving}
                            aria-current={String(selected?.id) === String(row.id) ? 'true' : undefined}
                            onClick={() => select(row)}>
                          {kind === 'foods'
                              ? row.name || (
                              <AdminReferenceName itemId={row.item_id} eager={!!normalizedSearch} onResolved={handleNameResolved} onDenied={onDenied} />
                          )
                              : row.name || '이름 미등록'}
                        </button>

                        <small>
                          {kind === 'foods'
                              ? `${row.is_failure ? '실패 음식' : '음식 설정'} · 혈량 +${row.blood_recovery}`
                              : kind === 'recipes'
                                  ? `레시피 · ${row.is_active ? '사용 중' : '비활성'}`
                                  : kind === 'gachas'
                                      ? `가챠 · ${row.is_active ? '사용 중' : '비활성'}`
                                      : kind === 'areas'
                                          ? `지역 · ${row.is_open ? '공개 중' : '비공개'}`
                                          : '음식 등급'}
                        </small>

                        <small>등록 ID {row.id}</small>
                      </div>
                    </li>
                ))}
              </ul>
          )}

          {after && (
              <button disabled={busy || saving} onClick={() => onPage(null)}>처음 페이지</button>
          )}

          {next && (
              <button disabled={busy || saving} onClick={() => (onPage ? onPage(next) : load(next))}>다음 100건</button>
          )}
        </div>
        <div className="admin-detail-pane">
          {!busy && (!onOpen || recordId === 'new' || selected) && (
              <Editor
                  key={revision}
                  kind={kind}
                  record={selected}
                  deleteControl={
                      selected && (
                          <AdminDeleteControl
                              menu={kind}
                              recordId={String(selected.id)}
                              disabled={busy || saving}
                              onDenied={onDenied}
                              onDeleted={async () => {
                                invalidateAdminNames();
                                setSelected(null);
                                setRevision((v) => v + 1);
                                onOpen?.(null);
                                await load();
                                setMessage('삭제 완료');
                              }}
                          />
                      )
                  }
                  onDenied={onDenied}
                  onBusy={setSaving}
                  onSaved={async (record) => {
                    invalidateAdminNames();
                    setResolvedNames({});
                    setSelected(record);
                    setRevision((v) => v + 1);

                    if (await load()) {
                      setMessage('저장 성공');
                    }
                  }}
              />
          )}
          {!selected && recordId !== 'new' && <p className="admin-empty-detail">목록에서 항목을 선택하거나 새로 등록하세요.</p>}
        </div>
      </section>
  );
}