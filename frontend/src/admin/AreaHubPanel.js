import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';
import ItemPicker from './ItemPicker';
import ImageUploadField from './ImageUploadField';
import './AreaHubPanel.css';

const emptyResult = () => ({
    result_text: '',
    weight: 1,
    is_unique: false,
    clue_id: null,
    is_active: true,
    rewards: []
});

const emptyClue = areaId => ({
    title: '',
    content: '',
    related_target: null,
    area_id: String(areaId),
    is_public: true
});

function numberValue(value) {
    return value === '' ? '' : Number(value);
}

function displayPercent(value) {
    return `${Number(value || 0).toFixed(2)}%`;
}

async function loadAll(kind) {
    const rows = [];
    let after = null;

    do {
        const result = await api(
            `/admin/${kind}${after ? `?after=${encodeURIComponent(after)}` : ''}`
        );

        rows.push(...(result.records || []));
        after = result.nextAfter;
    } while (after);

    return rows;
}

function AreaSection({title, description, count, children}) {
    return (
        <section className="area-hub-section">
            <header className="area-hub-section-head">
                <div>
                    <h3>{title}</h3>
                    {description && <p>{description}</p>}
                </div>

                {count != null && (
                    <span className="area-hub-count">{count}개</span>
                )}
            </header>

            {children}
        </section>
    );
}

function AreaBasicEditor({area, busy, onSave, onDenied}) {
    const [draft, setDraft] = useState(() => ({
        name: area.name ?? '',
        description: area.description ?? null,
        image_url: area.image_url ?? null,
        sort_order: Number(area.sort_order ?? 0),
        encounter_rate: Number(area.encounter_rate ?? 0),
        is_open: !!area.is_open,
        unlock_at: area.unlock_at ?? null
    }));

    const [uploading, setUploading] = useState(false);

    function change(key, value) {
        setDraft(previous => ({...previous, [key]: value}));
    }

    async function save(event) {
        event.preventDefault();

        const patch = {};

        for (const [key, value] of Object.entries(draft)) {
            const original = area[key] ?? null;

            if (value !== original) {
                patch[key] = value;
            }
        }

        if (!Object.keys(patch).length) {
            return;
        }

        await onSave(
            'base',
            () => api(`/admin/areas/${area.id}`, {
                method: 'PATCH',
                body: {...patch, requestKey: crypto.randomUUID()}
            }),
            '구역 기본 설정'
        );
    }

    return (
        <AreaSection
            title="구역 기본 설정"
            description="구역 정보와 공개 여부, 전체 마물 조우율을 관리합니다."
        >
            <form className="area-hub-form" onSubmit={save}>
                <div className="area-hub-form-grid">
                    <label>
                        구역 이름
                        <input required maxLength={100} disabled={busy}
                               value={draft.name}
                               onChange={e => change('name', e.target.value)}/>
                    </label>

                    <label>
                        표시 순서
                        <input required type="number" min="0" step="1"
                               disabled={busy} value={draft.sort_order}
                               onChange={e => change('sort_order', numberValue(e.target.value))}/>
                    </label>
                </div>

                <label>
                    구역 설명
                    <textarea disabled={busy} value={draft.description || ''}
                              onChange={e => change('description', e.target.value || null)}/>
                </label>

                <ImageUploadField kind="areas" label="구역 이미지"
                                  value={draft.image_url}
                                  onChange={value => change('image_url', value)}
                                  disabled={busy} onDenied={onDenied}
                                  onUploadingChange={setUploading}/>

                <div className="area-hub-form-grid">
                    <label>
                        마물 조우율 (%)
                        <input required type="number" min="0" max="100" step=".01"
                               disabled={busy} value={draft.encounter_rate}
                               onChange={e => change('encounter_rate', numberValue(e.target.value))}/>
                    </label>

                    <label>
                        공개 시작 시각
                        <input disabled={busy} value={draft.unlock_at || ''}
                               placeholder="2026-11-15T09:00:00+09:00"
                               onChange={e => change('unlock_at', e.target.value || null)}/>
                    </label>
                </div>

                <label className="area-hub-checkbox">
                    <input type="checkbox" disabled={busy}
                           checked={draft.is_open}
                           onChange={e => change('is_open', e.target.checked)}/>
                    구역 공개 허용
                </label>

                <div className="area-hub-buttons">
                    <button disabled={busy || uploading}>구역 기본 설정 저장</button>
                </div>
            </form>
        </AreaSection>
    );
}

function InvestigationEditor({areaId, data, busy, onSave, onDenied}) {
    const [editingId, setEditingId] = useState(null);
    const [draft, setDraft] = useState(null);

    const results = data.results || [];
    const clues = data.clues || [];
    const totalWeight = results
        .filter(row => row.is_active)
        .reduce((sum, row) => sum + Number(row.weight || 0), 0);

    function startNew() {
        setEditingId('new');
        setDraft(emptyResult());
    }

    function startEdit(row) {
        setEditingId(String(row.id));
        setDraft({
            result_text: row.result_text || '',
            weight: Number(row.weight),
            is_unique: !!row.is_unique,
            clue_id: row.clue_id == null ? null : String(row.clue_id),
            is_active: !!row.is_active,
            rewards: (row.rewards || []).map(reward => ({
                item_id: String(reward.item_id),
                quantity: Number(reward.quantity),
                probability: Number(reward.probability)
            }))
        });
    }

    function change(key, value) {
        setDraft(previous => ({...previous, [key]: value}));
    }

    function changeReward(index, key, value) {
        setDraft(previous => ({
            ...previous,
            rewards: previous.rewards.map((row, i) =>
                i === index ? {...row, [key]: value} : row
            )
        }));
    }

    async function save(event) {
        event.preventDefault();

        const success = await onSave(
            'results',
            () => api(
                `/admin/areas/${areaId}/results${editingId !== 'new' ? `/${editingId}` : ''}`,
                {
                    method: editingId === 'new' ? 'POST' : 'PATCH',
                    body: {...draft, requestKey: crypto.randomUUID()}
                }
            ),
            editingId === 'new' ? '조사 결과 등록' : '조사 결과 수정'
        );

        if (success) {
            setEditingId(null);
            setDraft(null);
        }
    }

    function cancel() {
        setEditingId(null);
        setDraft(null);
    }

    function renderForm() {
        if (!draft) return null;

        const original = results.find(row => String(row.id) === editingId);
        const uniqueLocked = !!original?.discovery;

        return (
            <form className="area-hub-form area-hub-inline-form" onSubmit={save}>
                <h4>{editingId === 'new' ? '새 조사 결과' : '조사 결과 수정'}</h4>

                <label>
                    조사 결과 내용
                    <textarea required disabled={busy} value={draft.result_text}
                              onChange={e => change('result_text', e.target.value)}/>
                </label>

                <label>
                    선택 가중치
                    <input required type="number" min="1" max="2147483647"
                           step="1" disabled={busy} value={draft.weight}
                           onChange={e => change('weight', numberValue(e.target.value))}/>
                </label>

                <div className="area-hub-checks">
                    <label className="area-hub-checkbox">
                        <input type="checkbox" checked={draft.is_active} disabled={busy}
                               onChange={e => change('is_active', e.target.checked)}/>
                        활성
                    </label>

                    <label className="area-hub-checkbox">
                        <input type="checkbox" checked={draft.is_unique}
                               disabled={busy || uniqueLocked}
                               onChange={e => change('is_unique', e.target.checked)}/>
                        서버 전체 고유 결과
                    </label>
                </div>

                <label>
                    제공 단서
                    <select disabled={busy} value={draft.clue_id ?? ''}
                            onChange={e => change('clue_id', e.target.value || null)}>
                        <option value="">단서 제공 없음</option>
                        {clues.map(clue => (
                            <option key={clue.id} value={clue.id}>{clue.title}</option>
                        ))}
                    </select>
                </label>

                <fieldset className="area-hub-fieldset">
                    <legend>아이템 보상</legend>

                    {draft.rewards.map((reward, index) => (
                        <div className="area-hub-reward-row" key={index}>
                            <ItemPicker label={`보상 아이템 ${index + 1}`}
                                        value={reward.item_id}
                                        disabled={busy} onDenied={onDenied}
                                        onChange={id => changeReward(index, 'item_id', id)}/>

                            <label>
                                수량
                                <input required type="number" min="1" step="1"
                                       disabled={busy} value={reward.quantity}
                                       onChange={e => changeReward(index, 'quantity', numberValue(e.target.value))}/>
                            </label>

                            <label>
                                지급 확률 (%)
                                <input required type="number" min="0" max="100" step=".01"
                                       disabled={busy} value={reward.probability}
                                       onChange={e => changeReward(index, 'probability', numberValue(e.target.value))}/>
                            </label>

                            <button type="button" disabled={busy}
                                    onClick={() => change(
                                        'rewards',
                                        draft.rewards.filter((_, i) => i !== index)
                                    )}>
                                제거
                            </button>
                        </div>
                    ))}

                    <button type="button" disabled={busy}
                            onClick={() => change('rewards', [
                                ...draft.rewards,
                                {item_id: '', quantity: 1, probability: 100}
                            ])}>
                        아이템 보상 추가
                    </button>
                </fieldset>

                {uniqueLocked && (
                    <p>최초 발견된 조사 결과는 고유 여부를 변경할 수 없습니다.</p>
                )}

                <div className="area-hub-buttons">
                    <button disabled={busy}>조사 결과 저장</button>
                    <button type="button" disabled={busy} onClick={cancel}>취소</button>
                </div>
            </form>
        );
    }

    return (
        <AreaSection
            title="조사 결과·보상"
            description="구역별 조사 결과, 고유 여부, 연결 단서, 아이템 보상을 한곳에서 관리합니다."
            count={results.length}
        >
            <div className="area-hub-buttons">
                <button type="button" disabled={busy} onClick={startNew}>
                    조사 결과 추가
                </button>
            </div>

            {editingId === 'new' && renderForm()}

            <div className="area-hub-list">
                {results.map(row => {
                    const clue = clues.find(
                        item => String(item.id) === String(row.clue_id)
                    );

                    const chance = row.is_active && totalWeight > 0
                        ? Number(row.weight) / totalWeight * 100
                        : 0;

                    const editing = editingId === String(row.id);

                    return (
                        <div className={`area-hub-list-item${editing ? ' is-editing' : ''}`}
                             key={row.id}>
                            <div className="area-hub-list-top">
                                <div className="area-hub-list-info">
                                    <strong>{row.result_text}</strong>

                                    <small>
                                        {row.is_unique ? '고유 결과' : '일반 결과'}
                                        {' · '}
                                        {row.is_active ? '활성' : '비활성'}
                                    </small>

                                    <small>
                                        선택 가중치 {row.weight}
                                        {' · '}
                                        선택 비율 {displayPercent(chance)}
                                    </small>

                                    <small>
                                        제공 단서: {clue?.title || (row.clue_id ? '연결 단서 확인 필요' : '없음')}
                                    </small>

                                    <small>
                                        아이템 보상 {(row.rewards || []).length}종
                                        {row.discovery ? ' · 최초 발견 완료' : ''}
                                    </small>
                                </div>

                                <button type="button" disabled={busy}
                                        onClick={() => editing ? cancel() : startEdit(row)}>
                                    {editing ? '닫기' : '수정'}
                                </button>
                            </div>

                            {editing && renderForm()}
                        </div>
                    );
                })}
            </div>

            {!results.length && (
                <p className="area-hub-empty">등록된 조사 결과가 없습니다.</p>
            )}
        </AreaSection>
    );
}

function MonsterEditor({areaId, data, busy, onSave}) {
    const [draft, setDraft] = useState(() =>
        (data.assignments || []).map(row => ({
            monster_id: String(row.monster_id),
            weight: Number(row.weight)
        }))
    );

    const [candidateId, setCandidateId] = useState('');

    const monsters = data.monsters || [];
    const assignedIds = new Set(draft.map(row => row.monster_id));

    const available = monsters.filter(row =>
        !assignedIds.has(String(row.monster_id)) &&
        (
            row.assigned_area_id == null ||
            String(row.assigned_area_id) === String(areaId)
        )
    );

    const activeWeight = draft.reduce((sum, row) => {
        const monster = monsters.find(
            item => String(item.monster_id) === row.monster_id
        );

        return sum + (monster?.is_active ? Number(row.weight) || 0 : 0);
    }, 0);

    const encounterRate = Number(data.area.encounter_rate || 0);

    function changeWeight(index, value) {
        setDraft(previous => previous.map((row, i) =>
            i === index ? {...row, weight: value} : row
        ));
    }

    function addMonster() {
        if (!candidateId || assignedIds.has(candidateId)) return;

        setDraft(previous => [
            ...previous,
            {monster_id: candidateId, weight: 1}
        ]);
        setCandidateId('');
    }

    async function save(event) {
        event.preventDefault();

        await onSave(
            'monsters',
            () => api(`/admin/areas/${areaId}/monsters`, {
                method: 'PUT',
                body: {
                    monsters: draft,
                    expectedVersion: data.version,
                    requestKey: crypto.randomUUID()
                }
            }),
            '마물 출현 설정'
        );
    }

    return (
        <AreaSection
            title="마물 출현"
            description="구역의 전체 조우율과 등장 마물별 가중치를 관리합니다."
            count={draft.length}
        >
            <div className="area-hub-monster-summary">
                구역 전체 조우율 <strong>{displayPercent(encounterRate)}</strong>
                <span>마물별 선택 비율은 활성 마물 가중치 합계를 기준으로 계산됩니다.</span>
            </div>

            <form className="area-hub-form" onSubmit={save}>
                <div className="area-hub-monster-list">
                    {draft.map((row, index) => {
                        const monster = monsters.find(
                            item => String(item.monster_id) === row.monster_id
                        );

                        const chance = monster?.is_active && activeWeight > 0
                            ? Number(row.weight) / activeWeight * 100
                            : 0;

                        const encounterChance = encounterRate * chance / 100;

                        return (
                            <div className="area-hub-monster-item" key={row.monster_id}>
                                <div className="area-hub-list-info">
                                    <strong>{monster?.name || '마물 이름 확인 필요'}</strong>
                                    <small>{monster?.is_active ? '활성' : '비활성'}</small>
                                    <small>조우 후 선택: {displayPercent(chance)}</small>
                                    <small>조사당 조우: {displayPercent(encounterChance)}</small>
                                </div>

                                <label>
                                    출현 가중치
                                    <input required type="number" min="1" max="2147483647"
                                           step="1" value={row.weight} disabled={busy}
                                           onChange={e => changeWeight(index, numberValue(e.target.value))}/>
                                </label>

                                <button type="button" disabled={busy}
                                        onClick={() => setDraft(previous =>
                                            previous.filter((_, i) => i !== index)
                                        )}>
                                    배치 해제
                                </button>
                            </div>
                        );
                    })}
                </div>

                {!draft.length && (
                    <p className="area-hub-empty">이 구역에 배치된 마물이 없습니다.</p>
                )}

                <div className="area-hub-add-row">
                    <label>
                        등장 마물 추가
                        <select disabled={busy} value={candidateId}
                                onChange={e => setCandidateId(e.target.value)}>
                            <option value="">마물 선택</option>
                            {available.map(monster => (
                                <option key={monster.monster_id}
                                        value={monster.monster_id}>
                                    {monster.name}
                                    {monster.is_active ? '' : ' (비활성)'}
                                </option>
                            ))}
                        </select>
                    </label>

                    <button type="button" disabled={busy || !candidateId}
                            onClick={addMonster}>
                        마물 추가
                    </button>
                </div>

                {encounterRate > 0 && activeWeight <= 0 && (
                    <p className="area-hub-warning" role="alert">
                        조우율이 0%보다 크지만 활성 마물이 없습니다.
                        실제 조사 시 마물 설정 오류가 발생할 수 있습니다.
                    </p>
                )}

                <div className="area-hub-buttons">
                    <button disabled={busy}>마물 출현 설정 저장</button>
                </div>
            </form>
        </AreaSection>
    );
}

function RecipeEditor({areaId, data, recipes, busy, onSave}) {
    const [draft, setDraft] = useState(() =>
        (data.areaRecipes || []).map(row => ({
            recipe_id: String(row.recipe_id),
            recipe_name: row.recipe_name,
            weight: Number(row.weight),
            drop_rate: Number(row.drop_rate),
            discovered: !!row.discovered
        }))
    );

    function change(index, key, value) {
        setDraft(previous => previous.map((row, i) =>
            i === index ? {...row, [key]: value} : row
        ));
    }

    async function save(event) {
        event.preventDefault();

        const ids = draft.map(row => row.recipe_id);

        if (ids.some(id => !id) || new Set(ids).size !== ids.length) {
            window.alert('레시피가 선택되지 않았거나 중복되었습니다.');
            return;
        }

        await onSave(
            'recipes',
            () => api(`/admin/areas/${areaId}/recipes`, {
                method: 'PUT',
                body: {
                    recipes: draft.map(row => ({
                        recipe_id: row.recipe_id,
                        weight: Number(row.weight),
                        drop_rate: Number(row.drop_rate)
                    })),
                    requestKey: crypto.randomUUID()
                }
            }),
            '레시피 발견 설정'
        );
    }

    return (
        <AreaSection
            title="레시피 발견"
            description="구역별 레시피 후보의 가중치와 발견 확률을 관리합니다."
            count={draft.length}
        >
            <form className="area-hub-form" onSubmit={save}>
                <div className="area-hub-list">
                    {draft.map((row, index) => {
                        const recipe = recipes.find(
                            item => String(item.id) === row.recipe_id
                        );

                        return (
                            <fieldset className="area-hub-fieldset" key={`${index}-${row.recipe_id}`}>
                                <legend>
                                    {recipe?.name || row.recipe_name || `레시피 후보 ${index + 1}`}
                                    {row.discovered ? ' · 최초 발견 완료' : ''}
                                </legend>

                                <label>
                                    레시피
                                    <select required disabled={busy || row.discovered}
                                            value={row.recipe_id}
                                            onChange={e => change(index, 'recipe_id', e.target.value)}>
                                        <option value="">레시피 선택</option>

                                        {row.recipe_id && !recipe && (
                                            <option value={row.recipe_id}>
                                                {row.recipe_name || '기존 연결 레시피'}
                                            </option>
                                        )}

                                        {recipes.filter(item =>
                                            item.is_active ||
                                            String(item.id) === row.recipe_id
                                        ).map(item => (
                                            <option key={item.id} value={item.id}>
                                                {item.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>

                                <div className="area-hub-form-grid">
                                    <label>
                                        선택 가중치
                                        <input required type="number" min="1" max="2147483647"
                                               step="1" value={row.weight} disabled={busy}
                                               onChange={e => change(index, 'weight', numberValue(e.target.value))}/>
                                    </label>

                                    <label>
                                        발견 확률 (%)
                                        <input required type="number" min="0" max="100"
                                               step=".01" value={row.drop_rate} disabled={busy}
                                               onChange={e => change(index, 'drop_rate', numberValue(e.target.value))}/>
                                    </label>
                                </div>

                                <button type="button" disabled={busy || row.discovered}
                                        onClick={() => setDraft(previous =>
                                            previous.filter((_, i) => i !== index)
                                        )}>
                                    후보 제거
                                </button>
                            </fieldset>
                        );
                    })}
                </div>

                {!draft.length && (
                    <p className="area-hub-empty">등록된 레시피 후보가 없습니다.</p>
                )}

                <div className="area-hub-buttons">
                    <button type="button" disabled={busy}
                            onClick={() => setDraft(previous => [
                                ...previous,
                                {
                                    recipe_id: '',
                                    recipe_name: '',
                                    weight: 1,
                                    drop_rate: 100,
                                    discovered: false
                                }
                            ])}>
                        레시피 후보 추가
                    </button>

                    <button disabled={busy}>레시피 발견 설정 저장</button>
                </div>

                <p className="area-hub-hint">
                    최초 발견된 레시피는 구역에서 제거할 수 없습니다.
                    기존 가중치와 발견 확률은 수정할 수 있습니다.
                </p>
            </form>
        </AreaSection>
    );
}

function ClueEditor({areaId, data, busy, onSave}) {
    const [editingId, setEditingId] = useState(null);
    const [loaded, setLoaded] = useState(null);
    const [draft, setDraft] = useState(null);
    const [reason, setReason] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const sequence = useRef(0);
    const clues = data.clues || [];
    const results = data.results || [];

    function startNew() {
        sequence.current++;
        setEditingId('new');
        setLoaded(null);
        setDraft(emptyClue(areaId));
        setReason('');
        setError('');
    }

    async function startEdit(id) {
        const token = ++sequence.current;

        setEditingId(String(id));
        setDraft(null);
        setLoaded(null);
        setError('');
        setLoading(true);

        try {
            const response = await api(`/admin/clues/${id}`);

            if (token !== sequence.current) return;

            setLoaded(response);
            setDraft({
                title: response.record.title,
                content: response.record.content,
                related_target: response.record.related_target,
                area_id: String(areaId),
                is_public: response.record.is_public
            });
            setReason('');
        } catch (e) {
            if (token === sequence.current) {
                setError(`${e.code || 'CLUE_LOAD_FAILED'}: ${e.message}`);
            }
        } finally {
            if (token === sequence.current) {
                setLoading(false);
            }
        }
    }

    function cancel() {
        sequence.current++;
        setEditingId(null);
        setLoaded(null);
        setDraft(null);
        setReason('');
        setError('');
        setLoading(false);
    }

    function change(key, value) {
        setDraft(previous => ({...previous, [key]: value}));
    }

    async function save(event) {
        event.preventDefault();

        const success = await onSave(
            'clues',
            () => api(`/admin/clues${loaded ? `/${loaded.record.id}` : ''}`, {
                method: loaded ? 'PATCH' : 'POST',
                body: {
                    ...draft,
                    area_id: String(areaId),
                    reason,
                    ...(loaded ? {expectedVersion: loaded.version} : {}),
                    requestKey: crypto.randomUUID()
                }
            }),
            loaded ? '단서 수정' : '단서 등록'
        );

        if (success) cancel();
    }

    function renderForm() {
        if (!draft) return null;

        return (
            <form className="area-hub-form area-hub-inline-form" onSubmit={save}>
                <h4>{editingId === 'new' ? '새 단서' : '단서 수정'}</h4>

                <label>
                    단서 제목
                    <input required maxLength={100} disabled={busy}
                           value={draft.title}
                           onChange={e => change('title', e.target.value)}/>
                </label>

                <label>
                    단서 내용
                    <textarea maxLength={10000} disabled={busy}
                              value={draft.content}
                              onChange={e => change('content', e.target.value)}/>
                </label>

                <label>
                    관련 대상
                    <input maxLength={200} disabled={busy}
                           value={draft.related_target || ''}
                           onChange={e => change('related_target', e.target.value || null)}/>
                </label>

                <label className="area-hub-checkbox">
                    <input type="checkbox" checked={draft.is_public} disabled={busy}
                           onChange={e => change('is_public', e.target.checked)}/>
                    발견 후 공개 허용
                </label>

                <label>
                    수정 사유
                    <input required maxLength={500} disabled={busy}
                           value={reason}
                           onChange={e => setReason(e.target.value)}/>
                </label>

                {loaded && (
                    <p className="area-hub-hint">
                        {loaded.record.is_discovered ? '이미 발견된 단서' : '미발견 단서'}
                        {' · '}발견 이력은 이 화면에서 변경하지 않습니다.
                    </p>
                )}

                <div className="area-hub-buttons">
                    <button disabled={busy}>단서 저장</button>
                    <button type="button" disabled={busy} onClick={cancel}>취소</button>
                </div>
            </form>
        );
    }

    return (
        <AreaSection
            title="단서 관리"
            description="해당 구역의 단서와 연결된 조사 결과를 함께 확인하고 수정합니다."
            count={clues.length}
        >
            <div className="area-hub-buttons">
                <button type="button" disabled={busy || loading}
                        onClick={startNew}>
                    단서 추가
                </button>
            </div>

            {editingId === 'new' && renderForm()}

            <div className="area-hub-list">
                {clues.map(clue => {
                    const editing = editingId === String(clue.id);

                    const linkedResults = results.filter(
                        result => String(result.clue_id) === String(clue.id)
                    );

                    return (
                        <div className={`area-hub-list-item${editing ? ' is-editing' : ''}`}
                             key={clue.id}>
                            <div className="area-hub-list-top">
                                <div className="area-hub-list-info">
                                    <strong>{clue.title}</strong>

                                    <small>
                                        {clue.is_discovered ? '발견 완료' : '미발견'}
                                        {' · '}
                                        {typeof clue.is_public === 'boolean'
                                            ? clue.is_public ? '발견 후 공개' : '비공개'
                                            : '공개 설정은 수정에서 확인'}
                                    </small>

                                    <small>
                                        연결된 조사 결과: {linkedResults.length
                                        ? linkedResults.map(result => result.result_text).join(', ')
                                        : '없음'}
                                    </small>
                                </div>

                                <button type="button" disabled={busy || loading}
                                        onClick={() => editing ? cancel() : startEdit(clue.id)}>
                                    {editing ? '닫기' : '수정'}
                                </button>
                            </div>

                            {editing && loading && (
                                <p role="status">단서 상세 조회 중…</p>
                            )}

                            {editing && error && (
                                <p role="alert">{error}</p>
                            )}

                            {editing && renderForm()}
                        </div>
                    );
                })}
            </div>

            {!clues.length && (
                <p className="area-hub-empty">등록된 단서가 없습니다.</p>
            )}
        </AreaSection>
    );
}

export default function AreaHubPanel({route, onNavigate, onDenied}) {
    const [localAreaId, setLocalAreaId] = useState('');
    const areaId = route?.area || localAreaId;

    const [areas, setAreas] = useState([]);
    const [recipes, setRecipes] = useState([]);
    const [area, setArea] = useState(null);
    const [data, setData] = useState(null);
    const [monsterData, setMonsterData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [revision, setRevision] = useState({
        base: 0,
        results: 0,
        monsters: 0,
        recipes: 0,
        clues: 0
    });

    const sequence = useRef(0);
    const savingRef = useRef(false);

    useEffect(() => {
        let active = true;

        Promise.all([
            loadAll('areas'),
            loadAll('recipes')
        ]).then(([areaRows, recipeRows]) => {
            if (!active) return;
            setAreas(areaRows);
            setRecipes(recipeRows);
        }).catch(e => {
            if (!active) return;

            setError(`${e.code || 'CATALOG_FAILED'}: ${e.message}`);

            if ([401, 403].includes(e.status)) {
                onDenied?.(e.message);
            }
        });

        return () => {
            active = false;
        };

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function refreshArea(id = areaId) {
        if (!id) {
            setArea(null);
            setData(null);
            setMonsterData(null);
            return false;
        }

        const token = ++sequence.current;

        setLoading(true);
        setError('');

        try {
            const [areaResponse, resultResponse, monsterResponse] = await Promise.all([
                api(`/admin/areas/${id}`),
                api(`/admin/areas/${id}/results`),
                api(`/admin/areas/${id}/monsters`)
            ]);

            if (token !== sequence.current) return false;

            setArea(areaResponse.record);
            setData(resultResponse);
            setMonsterData(monsterResponse);

            return true;
        } catch (e) {
            if (token !== sequence.current) return false;

            setError(`${e.code || 'AREA_LOAD_FAILED'}: ${e.message}`);

            if ([401, 403].includes(e.status)) {
                onDenied?.(e.message);
            }

            return false;
        } finally {
            if (token === sequence.current) {
                setLoading(false);
            }
        }
    }

    useEffect(() => {
        setArea(null);
        setData(null);
        setMonsterData(null);
        setMessage('');

        if (areaId) {
            refreshArea(areaId);
        }

        return () => {
            sequence.current++;
        };

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [areaId]);

    async function saveSection(section, task, label) {
        if (savingRef.current) return false;

        savingRef.current = true;
        setSaving(true);
        setMessage('');
        setError('');

        try {
            const saved = await task();

            if (section === 'base' && saved?.record) {
                setAreas(previous => previous.map(item =>
                    String(item.id) === String(saved.record.id)
                        ? {...item, ...saved.record}
                        : item
                ));
            }

            const refreshed = await refreshArea();

            setRevision(previous => ({
                ...previous,
                [section]: previous[section] + 1
            }));

            setMessage(
                refreshed
                    ? `${label} 저장 완료`
                    : `${label} 저장 완료 · 목록 재조회 실패. 새로고침해 주세요.`
            );

            return true;
        } catch (e) {
            setError(`${e.code || 'SAVE_FAILED'}: ${e.message}`);

            if ([401, 403].includes(e.status)) {
                onDenied?.(e.message);
            }

            return false;
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    }

    function selectArea(value) {
        if (onNavigate) {
            onNavigate({
                area: value || null,
                record: null,
                after: null
            });
        } else {
            setLocalAreaId(value);
        }
    }

    const busy = loading || saving;

    return (
        <section className="area-hub">
            <header className="area-hub-heading">
                <div>
                    <h2>구역 통합 관리</h2>
                    <p>한 구역의 조사 결과, 마물, 레시피, 단서를 이 페이지에서 관리합니다.</p>
                </div>

                <button type="button" disabled={!onNavigate || busy}
                        onClick={() => onNavigate?.({
                            menu: 'areas',
                            area: null,
                            record: 'new',
                            after: null
                        })}>
                    새 구역 등록
                </button>
            </header>

            <div className="area-hub-selector">
                <label>
                    관리할 구역
                    <select value={areaId} disabled={busy}
                            onChange={e => selectArea(e.target.value)}>
                        <option value="">구역 선택</option>
                        {areas.map(item => (
                            <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                    </select>
                </label>

                <button type="button" disabled={busy || !areaId}
                        onClick={() => refreshArea()}>
                    전체 새로고침
                </button>
            </div>

            {error && <p className="area-hub-error" role="alert">{error}</p>}
            {message && <p className="area-hub-message" role="status">{message}</p>}

            {!areaId && (
                <p className="area-hub-empty">관리할 구역을 선택하세요.</p>
            )}

            {loading && !area && (
                <p role="status">구역 데이터를 불러오는 중…</p>
            )}

            {area && data && monsterData && (
                <>
                    <div className="area-hub-overview">
                        <div>
                            <strong>{area.name}</strong>
                            <span>{area.is_open ? '공개 허용' : '비공개'}</span>
                        </div>

                        <div className="area-hub-summary-grid">
                            <div><small>조사 결과</small><strong>{data.results.length}개</strong></div>
                            <div><small>등장 마물</small><strong>{monsterData.assignments.length}종</strong></div>
                            <div><small>레시피</small><strong>{data.areaRecipes.length}종</strong></div>
                            <div><small>단서</small><strong>{data.clues.length}개</strong></div>
                        </div>
                    </div>

                    <div className="area-hub-sections">
                        <AreaBasicEditor
                            key={`${areaId}:${revision.base}`}
                            area={area} busy={busy} onSave={saveSection}
                            onDenied={onDenied}
                        />

                        <InvestigationEditor
                            key={`${areaId}:${revision.results}`}
                            areaId={areaId} data={data} busy={busy}
                            onSave={saveSection} onDenied={onDenied}
                        />

                        <MonsterEditor
                            key={`${areaId}:${revision.monsters}`}
                            areaId={areaId} data={monsterData} busy={busy}
                            onSave={saveSection}
                        />

                        <RecipeEditor
                            key={`${areaId}:${revision.recipes}`}
                            areaId={areaId} data={data} recipes={recipes}
                            busy={busy} onSave={saveSection}
                        />

                        <ClueEditor
                            key={`${areaId}:${revision.clues}`}
                            areaId={areaId} data={data} busy={busy}
                            onSave={saveSection}
                        />
                    </div>
                </>
            )}
        </section>
    );
}