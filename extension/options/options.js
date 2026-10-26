"use strict";

const list = document.getElementById("features");
const template = document.getElementById("feature");
const t = name => browser.i18n.getMessage(name);
const toggles = new Map();

// Состояние меняется и без этой страницы: включение одной доработки из пары
// выключает другую, а смена важной настройки в Zen выключает доработку
async function refresh() {
  for (const { name, enabled, available } of await browser.zenTweaks.getFeatures()) {
    const toggle = toggles.get(name);
    if (toggle) {
      toggle.checked = enabled && available;
    }
  }
}

async function render() {
  let features;
  try {
    features = await browser.zenTweaks.getFeatures();
  } catch {
    // Без extensions.experiments.enabled Zen не подключает browser.zenTweaks
    list.textContent = t("loadError");
    list.classList.add("error");
    return;
  }

  for (const { name, enabled, available } of features) {
    const row = template.content.firstElementChild.cloneNode(true);
    row.querySelector(".title").textContent = t(`${name}Title`);
    row.querySelector(".description").textContent = available
      ? t(`${name}Description`)
      : t("macOnly");

    const toggle = row.querySelector(".toggle");
    toggle.checked = enabled && available;
    toggle.disabled = !available;
    toggle.addEventListener("change", async () => {
      await browser.zenTweaks.setFeature(name, toggle.checked);
      await refresh();
    });
    toggles.set(name, toggle);
    list.append(row);
  }
}

render();
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && toggles.size) {
    refresh();
  }
});
