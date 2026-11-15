// datetime-local has no timezone: explicitly display and submit KST.
export function toKstInput(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return '';
    return new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 19);
}
export function fromKstInput(value) {
    if (!value) return null;
    return (value.length === 16 ? value + ':00' : value) + '+09:00';
}
