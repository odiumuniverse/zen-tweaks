import { test } from "node:test";
import assert from "node:assert/strict";
import { pipTopBar } from "../extension/pip-layout.mjs";

// Ширины в пикселях: кнопка «назад к вкладке» 24, у Minimize и Close иконки
// по 24, подписи 60 и 40, отступ от края окна 12, зазор между группами 10.
// Подписи помещаются с ширины 216, домен в 110 рядом с подписями — с 470.
const bar = {
  padding: 12,
  gap: 10,
  back: 24,
  minimize: { icon: 24, label: 60 },
  close: { icon: 24, label: 40 },
};

test("в широком окне видны и подписи, и домен", () => {
  assert.deepEqual(pipTopBar({ ...bar, width: 600, origin: 110 }), {
    labels: true,
    origin: true,
  });
});

test("подписи пропадают, когда не помещаются между краями окна", () => {
  assert.equal(pipTopBar({ ...bar, width: 216, origin: 110 }).labels, true);
  assert.equal(pipTopBar({ ...bar, width: 215, origin: 110 }).labels, false);
});

test("домен прячется, если налез бы на кнопки с подписями", () => {
  assert.deepEqual(pipTopBar({ ...bar, width: 469, origin: 110 }), {
    labels: true,
    origin: false,
  });
});

test("короткий домен остаётся рядом с кнопками без подписей", () => {
  assert.deepEqual(pipTopBar({ ...bar, width: 200, origin: 30 }), {
    labels: false,
    origin: true,
  });
});

test("без домена показывать нечего даже в широком окне", () => {
  assert.equal(pipTopBar({ ...bar, width: 600, origin: 0 }).origin, false);
});
