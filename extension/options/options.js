"use strict";

const list = document.getElementById("features");
const template = document.getElementById("feature");
const t = name => browser.i18n.getMessage(name);

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
    toggle.addEventListener("change", () =>
      browser.zenTweaks.setFeature(name, toggle.checked)
    );
    list.append(row);
  }
}

render();
