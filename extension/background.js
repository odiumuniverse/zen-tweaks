"use strict";

// Щелчок по Zen Tweaks в панели расширений открывает его настройки: других
// действий у расширения нет, а переключатели живут там
browser.browserAction.onClicked.addListener(() => {
  browser.runtime.openOptionsPage();
});
