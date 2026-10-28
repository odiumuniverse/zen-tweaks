import { test } from "node:test";
import assert from "node:assert/strict";
import { urlbarKeyStep, urlbarKeysTaken } from "../extension/urlbar-keys.mjs";

const ctrl = (key, code = `Key${key.toUpperCase()}`) => ({ key, code, ctrlKey: true });

// Элемент <key> из набора горячих клавиш Zen: modifiers как в атрибуте
const zenKey = (key, modifiers, disabled = false) => ({ key, modifiers, disabled });

test("Ctrl+J двигает выделение вниз", () => {
  assert.equal(urlbarKeyStep(ctrl("j")), 1);
});

test("Ctrl+K двигает выделение вверх", () => {
  assert.equal(urlbarKeyStep(ctrl("k")), -1);
});

test("на русской раскладке Ctrl+О и Ctrl+Л работают как Ctrl+J и Ctrl+K", () => {
  assert.equal(urlbarKeyStep(ctrl("о", "KeyJ")), 1);
  assert.equal(urlbarKeyStep(ctrl("л", "KeyK")), -1);
});

// Cmd+J открывает загрузки, Cmd+K — поиск, а «j» без Ctrl просто набирается
test("без Ctrl или с Cmd, Option, Shift клавиша не наша", () => {
  assert.equal(urlbarKeyStep({ key: "j", code: "KeyJ" }), 0);
  assert.equal(urlbarKeyStep({ ...ctrl("j"), metaKey: true }), 0);
  assert.equal(urlbarKeyStep({ ...ctrl("k"), altKey: true }), 0);
  assert.equal(urlbarKeyStep({ ...ctrl("K", "KeyK"), shiftKey: true }), 0);
});

// Ctrl+N и Ctrl+P адресная строка Zen обрабатывает сама
test("Ctrl с другой буквой не наш", () => {
  assert.equal(urlbarKeyStep(ctrl("n")), 0);
  assert.equal(urlbarKeyStep(ctrl("p")), 0);
  assert.equal(urlbarKeyStep(ctrl("т", "KeyN")), 0);
});

test("Ctrl+J или Ctrl+K, назначенные в Zen, заняты", () => {
  assert.equal(urlbarKeysTaken([zenKey("t", "accel"), zenKey("j", "control")]), true);
  assert.equal(urlbarKeysTaken([zenKey("k", "control")]), true);
});

test("Cmd+J и Ctrl+Shift+K не занимают Ctrl+J и Ctrl+K", () => {
  assert.equal(urlbarKeysTaken([zenKey("j", "accel"), zenKey("k", "control,shift")]), false);
});

test("выключенная или стёртая клавиша Zen не занимает Ctrl+J и Ctrl+K", () => {
  assert.equal(urlbarKeysTaken([zenKey("j", "control", true), zenKey("", "")]), false);
});
