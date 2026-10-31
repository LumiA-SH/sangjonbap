// Calendar arithmetic uses UTC date-only values; business days use explicit KST.
export function kstDate(instant) {
    const date = new Date(instant);
    if (!Number.isFinite(date.getTime())) throw new Error('Invalid instant');
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

export function nextDate(day) {
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid calendar date');
    const date = new Date(`${day}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) throw new Error('Invalid calendar date');
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
}

export function nextPendingDate(startDate, lastCompletedDate, today) {
    if (startDate === null) return null;
    for (const day of [startDate, today, ...(lastCompletedDate ? [lastCompletedDate] : [])]) nextDate(day);
    if (lastCompletedDate && lastCompletedDate < startDate) throw new Error('Invalid reset checkpoint');
    const next = lastCompletedDate ? nextDate(lastCompletedDate) : startDate;
    return next <= today ? next : null;
}
