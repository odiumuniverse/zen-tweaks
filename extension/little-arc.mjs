// Little Arc: маленькое окно для ссылок из других приложений, как в Arc.
// Модуль грузят и parent.js, и тесты в Node.

// true, если внешнюю ссылку надо открыть в Little Arc. route — ответ Space
// Routing без пространства по умолчанию для внешних ссылок, scheme — схема
// адреса: файлы и прочее открываются как обычно.
export function opensInLittleArc({ route, isPrivate, scheme }) {
  return !isPrivate && route == "most-recent-space" && (scheme == "http" || scheme == "https");
}

// Латинская буква из key, а если раскладка не латинская или Option подменил
// символ — физическая клавиша из code
function letter({ key, code }) {
  return /^[a-z]$/i.test(key) ? key.toLowerCase() : code?.match(/^Key([A-Z])$/)?.[1].toLowerCase();
}

// Что делает клавиша в окне Little Arc
export function littleArcCommand(event) {
  const { key, metaKey, altKey, shiftKey, ctrlKey } = event;
  if (key == "Escape") {
    return metaKey || altKey || shiftKey || ctrlKey ? null : "close";
  }
  if (!metaKey || ctrlKey) {
    return null;
  }
  switch (letter(event)) {
    case "o":
      return altKey ? null : shiftKey ? "openIn" : "open";
    case "n":
      return altKey && !shiftKey ? "new" : null;
    default:
      return null;
  }
}
