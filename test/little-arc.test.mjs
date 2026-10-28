import { test } from "node:test";
import assert from "node:assert/strict";
import { littleArcCommand, opensInLittleArc } from "../extension/little-arc.mjs";

const key = (key, mods = {}, code = `Key${key.toUpperCase()}`) => ({ key, code, ...mods });

// Внешняя ссылка: по умолчанию https без правила Space Routing из обычного окна
const link = (props = {}) =>
  opensInLittleArc({ route: "most-recent-space", isPrivate: false, scheme: "https", ...props });

test("Esc закрывает Little Arc", () => {
  assert.equal(littleArcCommand({ key: "Escape", code: "Escape" }), "close");
});

test("Cmd+O открывает ссылку в пространстве", () => {
  assert.equal(littleArcCommand(key("o", { metaKey: true })), "open");
});

test("Cmd+Shift+O открывает меню пространств", () => {
  assert.equal(littleArcCommand(key("O", { metaKey: true, shiftKey: true })), "openIn");
});

// С Option macOS подставляет в key особый символ: Cmd+Opt+N даёт «˜»
test("Cmd+Opt+N открывает пустой Little Arc", () => {
  assert.equal(littleArcCommand(key("˜", { metaKey: true, altKey: true }, "KeyN")), "new");
});

test("на русской раскладке Cmd+Щ работает как Cmd+O", () => {
  assert.equal(littleArcCommand(key("щ", { metaKey: true }, "KeyO")), "open");
});

// Cmd+N — новое окно, Ctrl+O и Cmd+Ctrl+O не наши, Esc с модификаторами тоже
test("без Cmd или с лишними модификаторами клавиша не наша", () => {
  assert.equal(littleArcCommand(key("o", { ctrlKey: true })), null);
  assert.equal(littleArcCommand(key("o", { metaKey: true, ctrlKey: true })), null);
  assert.equal(littleArcCommand(key("n", { metaKey: true })), null);
  assert.equal(littleArcCommand({ key: "Escape", code: "Escape", shiftKey: true }), null);
});

// route — ответ Space Routing без учёта пространства по умолчанию для внешних
// ссылок: "most-recent-space", если ни одно правило не подошло
test("внешняя ссылка без правила Space Routing идёт в Little Arc", () => {
  assert.equal(link(), true);
});

test("ссылка, под которую подошло правило, идёт в своё пространство", () => {
  assert.equal(link({ route: "{work-space-id}" }), false);
});

test("в приватном окне ссылка открывается как обычно", () => {
  assert.equal(link({ isPrivate: true }), false);
});

test("в Little Arc идут только веб-страницы, а file: и прочее — как обычно", () => {
  assert.equal(link({ scheme: "http" }), true);
  assert.equal(link({ scheme: "file" }), false);
  assert.equal(link({ scheme: "about" }), false);
});
