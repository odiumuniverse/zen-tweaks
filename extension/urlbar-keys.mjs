// Ctrl+J и Ctrl+K в адресной строке: двигают выделение в списке подсказок,
// как стрелки и встроенные Ctrl+N и Ctrl+P. Модуль грузят и parent.js, и
// тесты в Node.

const STEPS = { j: 1, k: -1 };

// 1 — вниз, -1 — вверх, 0 — клавиша не наша. Латинскую букву берём из key,
// чтобы Ctrl+J работал и в Dvorak. На русской раскладке key кириллический,
// тогда решает физическая клавиша code.
export function urlbarKeyStep({ key, code, ctrlKey, metaKey, altKey, shiftKey }) {
  if (!ctrlKey || metaKey || altKey || shiftKey) {
    return 0;
  }
  const letter = /^[a-z]$/i.test(key) ? key.toLowerCase() : code?.match(/^Key([A-Z])$/)?.[1].toLowerCase();
  return STEPS[letter] ?? 0;
}

// true, если в горячих клавишах Zen на Ctrl+J или Ctrl+K что-то назначено:
// тогда доработка уступает клавишу. keys — элементы <key> набора Zen.
export function urlbarKeysTaken(keys) {
  return keys.some(({ key, modifiers, disabled }) => !disabled && modifiers == "control" && key in STEPS);
}
