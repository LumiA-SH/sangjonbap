import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';

const names = new Map();
const pending = new Map();

export function invalidateAdminNames() {
    names.clear();
    pending.clear();
}

function getName(type, id) {
    const key = `${type}:${id}`;

    if (names.has(key)) {
        return Promise.resolve(names.get(key));
    }

    if (pending.has(key)) {
        return pending.get(key);
    }

    const request = api(`/admin/${type}/${encodeURIComponent(String(id))}`)
        .then(data => {
            const name = data.record?.name;

            if (!name) {
                throw new Error('이름이 등록되지 않았습니다.');
            }

            names.set(key, name);
            return name;
        })
        .finally(() => {
            if (pending.get(key) === request) {
                pending.delete(key);
            }
        });

    pending.set(key, request);
    return request;
}

export default function AdminReferenceName({
                                               itemId = null,
                                               recipeId = null,
                                               eager = false,
                                               onResolved,
                                               onDenied
                                           }) {
    const type = recipeId != null ? 'recipes' : 'items';
    const id = recipeId != null ? recipeId : itemId;
    const key = id != null ? `${type}:${id}` : '';

    const element = useRef(null);
    const callback = useRef(onResolved);
    const deniedCallback = useRef(onDenied);

    const [name, setName] = useState(() => names.get(key) || '');
    const [error, setError] = useState(false);

    callback.current = onResolved;
    deniedCallback.current = onDenied;

    useEffect(() => {
        let active = true;
        let observer = null;

        setName(names.get(key) || '');
        setError(false);

        if (!id) {
            return () => {
                active = false;
            };
        }

        function load() {
            getName(type, id)
                .then(value => {
                    if (!active) return;

                    setName(value);
                    callback.current?.(key, value);
                })
                .catch(e => {
                    if (!active) return;

                    setError(true);

                    if ([401, 403].includes(e.status)) {
                        deniedCallback.current?.(e.message);
                    }
                });
        }

        if (eager || typeof IntersectionObserver === 'undefined') {
            load();
        } else {
            observer = new IntersectionObserver(entries => {
                if (entries.some(entry => entry.isIntersecting)) {
                    observer.disconnect();
                    load();
                }
            }, {rootMargin: '300px'});

            if (element.current) {
                observer.observe(element.current);
            } else {
                load();
            }
        }

        return () => {
            active = false;
            observer?.disconnect();
        };
    }, [key, type, id, eager]);

    if (!id) {
        return <span>연결된 항목 없음</span>;
    }

    return (
        <span ref={element} className="admin-reference-name">
            {name || (error ? '이름 확인 실패' : '이름 불러오는 중…')}
        </span>
    );
}