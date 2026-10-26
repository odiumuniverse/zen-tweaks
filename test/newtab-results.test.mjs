import { test } from "node:test";
import assert from "node:assert/strict";
import { promoteSpaceTab } from "../extension/newtab-results.mjs";

// Типы результатов адресной строки, как в UrlbarShared.RESULT_TYPE
const TAB_SWITCH = 1;
const SEARCH = 2;
const URL = 3;

const search = () => ({ type: SEARCH, heuristic: true, payload: { query: "kiwi" } });
const tab = (url, title = "") => ({ type: TAB_SWITCH, heuristic: false, payload: { url, title } });
const brief = results => results.map(r => [r.type, r.heuristic, r.payload.url ?? r.payload.query]);

test("совпавший таб этого спейса встаёт первым вместо поиска", () => {
  const results = [search(), tab("https://kiwi.example/")];
  const promoted = promoteSpaceTab(results, {
    tabSwitchType: TAB_SWITCH,
    spaceUrls: new Set(["https://kiwi.example/"]),
  });
  assert.deepEqual(brief(promoted), [
    [TAB_SWITCH, true, "https://kiwi.example/"],
    [SEARCH, false, "kiwi"],
  ]);
});

test("из нескольких табов спейса первым встаёт лучший по порядку Firefox", () => {
  const results = [search(), tab("https://a.example/"), tab("https://b.example/")];
  const promoted = promoteSpaceTab(results, {
    tabSwitchType: TAB_SWITCH,
    spaceUrls: new Set(["https://a.example/", "https://b.example/"]),
  });
  assert.deepEqual(brief(promoted), [
    [TAB_SWITCH, true, "https://a.example/"],
    [SEARCH, false, "kiwi"],
    [TAB_SWITCH, false, "https://b.example/"],
  ]);
});

// Arc на «kiwi» выбирает таб «Kiwi», даже если выше него «kiwi - Google Search»
// или «Kiwi recipes»
test("таб, чей заголовок совпал с набранным целиком, важнее порядка Firefox", () => {
  const results = [
    search(),
    tab("https://www.google.com/search?q=kiwi", "kiwi - Google Search"),
    tab("https://kiwi.example/", "Kiwi"),
  ];
  const promoted = promoteSpaceTab(results, {
    tabSwitchType: TAB_SWITCH,
    spaceUrls: new Set(["https://www.google.com/search?q=kiwi", "https://kiwi.example/"]),
    query: "kiwi",
  });
  assert.deepEqual(brief(promoted), [
    [TAB_SWITCH, true, "https://kiwi.example/"],
    [SEARCH, false, "kiwi"],
    [TAB_SWITCH, false, "https://www.google.com/search?q=kiwi"],
  ]);
});

test("подставленный адрес тоже уступает открытому табу, как «apple» в Arc", () => {
  const url = { type: URL, heuristic: true, payload: { url: "https://apple.com/" } };
  const promoted = promoteSpaceTab([url, tab("https://apple.example/")], {
    tabSwitchType: TAB_SWITCH,
    spaceUrls: new Set(["https://apple.example/"]),
  });
  assert.deepEqual(brief(promoted), [
    [TAB_SWITCH, true, "https://apple.example/"],
    [URL, false, "https://apple.com/"],
  ]);
});

test("таб чужого спейса не перебивает поиск", () => {
  const results = [search(), tab("https://kiwi.example/")];
  const promoted = promoteSpaceTab(results, {
    tabSwitchType: TAB_SWITCH,
    spaceUrls: new Set(["https://other.example/"]),
  });
  assert.deepEqual(brief(promoted), [
    [SEARCH, true, "kiwi"],
    [TAB_SWITCH, false, "https://kiwi.example/"],
  ]);
});
