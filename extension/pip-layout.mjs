// Решения для Picture-in-Picture в духе Arc. Модуль грузят и parent.js, и тесты
// в Node, поэтому он без зависимостей.

// Верхняя полоса: слева «назад к вкладке», справа Minimize и Close, по центру
// домен вкладки. Ширины — в пикселях. minimize и close — { icon, label }, где
// label включает зазор между иконкой и подписью; origin — ширина домена.
export function pipTopBar({ width, padding, gap, back, minimize, close, origin }) {
  const inner = width - 2 * padding;
  const withLabels = minimize.icon + minimize.label + gap + close.icon + close.label;
  const labels = back + gap + withLabels <= inner;
  const right = labels ? withLabels : minimize.icon + gap + close.icon;
  // Домен стоит по центру окна, поэтому места ему хватит, только если
  // он не дотянется до более широкой из боковых групп
  const side = Math.max(back, right);
  return { labels, origin: origin > 0 && origin + 2 * gap + 2 * side <= inner };
}

// Сам Zen открывает плеер только с autoFocus: false. Такой плеер не нужен, если
// его вкладка выбрана, а окно снова на виду: оно закрывалось лишь на миг.
export function isStaleAutoPip({ autoFocus, tabSelected, outOfSight }) {
  return autoFocus === false && tabSelected && !outOfSight;
}
