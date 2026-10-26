// Результаты адресной строки при Cmd+T в духе Arc: открытая вкладка текущего
// пространства, совпавшая с набранным, встаёт первой, и Enter переключает на
// неё, а не ищет в поисковике. Модуль грузят и parent.js, и тесты в Node.

// results — результаты в порядке Firefox; меняет у них флаг heuristic и
// возвращает новый порядок. tabSwitchType — UrlbarShared.RESULT_TYPE.TAB_SWITCH,
// spaceUrls — адреса вкладок текущего пространства, query — набранный текст.
export function promoteSpaceTab(results, { tabSwitchType, spaceUrls, query = "" }) {
  const tabs = results.filter(r => r.type == tabSwitchType && spaceUrls.has(r.payload.url));
  // Как Arc: вкладка, чей заголовок совпал с набранным целиком, важнее порядка Firefox
  const wanted = query.trim().toLowerCase();
  const tab = tabs.find(r => r.payload.title?.trim().toLowerCase() == wanted) ?? tabs[0];
  if (!tab) {
    return results;
  }
  for (const result of results) {
    result.heuristic = false;
  }
  tab.heuristic = true;
  return [tab, ...results.filter(r => r !== tab)];
}
