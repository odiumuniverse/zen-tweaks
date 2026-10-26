"use strict";

/* global ExtensionAPI, ChromeUtils, Services, Cc, Ci, AppConstants */

// Привилегированная часть Zen Tweaks: код идёт внутри Zen с правами самого
// браузера. Обычному WebExtension ни одна из трёх доработок недоступна.
//
// Каждая доработка включается настройкой extensions.zen-tweaks.<name>, по
// умолчанию true. Страница настроек меняет их через setFeature, а наблюдатель
// за настройками сразу включает или выключает доработку, без перезапуска.

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  UrlbarMuxerStandard: "moz-src:///browser/components/urlbar/UrlbarMuxerStandard.sys.mjs",
  UrlbarShared: "chrome://browser/content/urlbar/UrlbarShared.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

const PREF_BRANCH = "extensions.zen-tweaks.";

// Окно по ссылке из другого приложения или по щелчку в Dock появляется чуть
// позже активации; без паузы рядом с ним открылось бы второе.
const REOPEN_DELAY_MS = 300;

const APP_ACTIVATE_TOPIC = "mac_app_activate";
const FIRST_WINDOW_TOPIC = "browser-delayed-startup-finished";

function isEnabled(name) {
  return Services.prefs.getBoolPref(PREF_BRANCH + name, true);
}

// Приватные окна тоже считаются: они на экране, открывать ничего не надо
function hasBrowserWindows() {
  for (const win of Services.wm.getEnumerator("navigator:browser")) {
    if (!win.closed) {
      return true;
    }
  }
  return false;
}

function styleSheetService() {
  return Cc["@mozilla.org/content/style-sheet-service;1"].getService(
    Ci.nsIStyleSheetService
  );
}

// Панель поверх полноэкранного видео, правила лежат в fullscreen-sidebar.css
class FullscreenSidebar {
  available = true;
  #sheetURI;

  constructor(extension) {
    this.#sheetURI = Services.io.newURI(
      extension.rootURI.resolve("fullscreen-sidebar.css")
    );
  }

  enable() {
    const sss = styleSheetService();
    if (!sss.sheetRegistered(this.#sheetURI, sss.USER_SHEET)) {
      sss.loadAndRegisterSheet(this.#sheetURI, sss.USER_SHEET);
    }
  }

  disable() {
    const sss = styleSheetService();
    if (sss.sheetRegistered(this.#sheetURI, sss.USER_SHEET)) {
      sss.unregisterSheet(this.#sheetURI, sss.USER_SHEET);
    }
  }
}

// Zen регистрирует открытые вкладки всех пространств в одной таблице, и
// адресная строка предлагает «Перейти на вкладку» из чужого пространства,
// а Enter туда перебрасывает. Такие результаты выкидываются до сортировки:
// иначе muxer схлопнет с ними обычный URL-результат, и адрес не откроется
// в текущем пространстве. Эвристические тоже: именно их выбирает Enter, а без
// эвристики адресная строка откроет введённый адрес сама.
class WorkspaceTabs {
  available = true;

  enable() {
    const muxer = lazy.UrlbarMuxerStandard;
    const sort = Object.getPrototypeOf(muxer).sort;
    const { TAB_SWITCH } = lazy.UrlbarShared.RESULT_TYPE;
    muxer.sort = function (context, results) {
      const win = Services.wm.getMostRecentWindow("navigator:browser");
      if (!context.isPrivate && win?.gZenWorkspaces) {
        // visibleTabs — вкладки текущего пространства и Essentials
        const workspaceUrls = new Set(
          win.gBrowser.visibleTabs.map(tab => tab.linkedBrowser?.registeredOpenURI?.spec)
        );
        results = results.filter(
          r => r.type != TAB_SWITCH || workspaceUrls.has(r.payload.url)
        );
      }
      return sort.call(this, context, results);
    };
  }

  disable() {
    // sort — метод прототипа, собственное свойство ставит только enable
    delete lazy.UrlbarMuxerStandard.sort;
  }
}

// Cmd+Tab, в отличие от щелчка в Dock, не шлёт приложению reopen, и Zen без
// окон становится активным, но пустым. Об активации macOS сообщает через
// applicationDidBecomeActive, Firefox пересылает её как mac_app_activate.
class ReopenOnActivate {
  available = AppConstants.platform == "macosx";
  #timer = null;
  #waitingFirstWindow = false;

  enable() {
    // На запуске первое окно открывает сам Zen, до него активации не трогаем
    this.#waitingFirstWindow = !hasBrowserWindows();
    if (this.#waitingFirstWindow) {
      Services.obs.addObserver(this.#onFirstWindow, FIRST_WINDOW_TOPIC);
    }
    Services.obs.addObserver(this.#onAppActivate, APP_ACTIVATE_TOPIC);
  }

  disable() {
    Services.obs.removeObserver(this.#onAppActivate, APP_ACTIVATE_TOPIC);
    if (this.#waitingFirstWindow) {
      Services.obs.removeObserver(this.#onFirstWindow, FIRST_WINDOW_TOPIC);
      this.#waitingFirstWindow = false;
    }
    lazy.clearTimeout(this.#timer);
  }

  #onFirstWindow = () => {
    Services.obs.removeObserver(this.#onFirstWindow, FIRST_WINDOW_TOPIC);
    this.#waitingFirstWindow = false;
  };

  #onAppActivate = () => {
    if (this.#waitingFirstWindow) {
      return;
    }
    lazy.clearTimeout(this.#timer);
    this.#timer = lazy.setTimeout(() => {
      if (!hasBrowserWindows() && !Services.startup.shuttingDown) {
        lazy.BrowserWindowTracker.openWindow();
      }
    }, REOPEN_DELAY_MS);
  };
}

this.zenTweaks = class extends ExtensionAPI {
  #features = null;
  #active = new Set();

  onStartup() {
    this.#features = new Map([
      ["fullscreenSidebar", new FullscreenSidebar(this.extension)],
      ["workspaceTabs", new WorkspaceTabs()],
      ["reopenOnActivate", new ReopenOnActivate()],
    ]);
    Services.prefs.addObserver(PREF_BRANCH, this.#sync);
    this.#sync();
  }

  onShutdown(isAppShutdown) {
    if (isAppShutdown) {
      return;
    }
    Services.prefs.removeObserver(PREF_BRANCH, this.#sync);
    for (const name of this.#active) {
      this.#features.get(name).disable();
    }
    this.#active.clear();
  }

  getAPI() {
    return {
      zenTweaks: {
        getFeatures: async () =>
          Array.from(this.#features, ([name, feature]) => ({
            name,
            enabled: isEnabled(name),
            available: feature.available,
          })),
        setFeature: async (name, enabled) => {
          Services.prefs.setBoolPref(PREF_BRANCH + name, enabled);
        },
      },
    };
  }

  #sync = () => {
    for (const [name, feature] of this.#features) {
      const wanted = feature.available && isEnabled(name);
      if (wanted && !this.#active.has(name)) {
        feature.enable();
        this.#active.add(name);
      } else if (!wanted && this.#active.has(name)) {
        feature.disable();
        this.#active.delete(name);
      }
    }
  };
};
