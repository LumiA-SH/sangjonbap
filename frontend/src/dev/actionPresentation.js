export function statName(value) {
  return {atk: '공격력', def: '방어력', agi: '민첩', ATK: '공격력', DEF: '방어력', AGI: '민첩'}[value] || '능력치';
}

export function trainingSummary(result) {
  const growth = result.growth;
  const change = growth ? statName(growth.stat) + ' +' + (growth.after - growth.before) : '능력치 상승 없음';
  return '일일훈련 완료 · ' + change + ' · 코인 +' + (result.reward ?? 0);
}
