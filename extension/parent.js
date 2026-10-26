"use strict";

/* global ExtensionAPI, ChromeUtils, Services, Cc, Ci, AppConstants */

// Привилегированная часть Zen Tweaks: код идёт внутри Zen с правами самого
// браузера. Обычному WebExtension ни одна из доработок недоступна.
//
// Каждая доработка включается настройкой extensions.zen-tweaks.<name>, по
// умолчанию true. Страница настроек меняет их через setFeature, а наблюдатель
// за настройками сразу включает или выключает доработку, без перезапуска.

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  PictureInPicture: "moz-src:///toolkit/components/pictureinpicture/PictureInPicture.sys.mjs",
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

const PIP_WINDOW_TYPE = "Toolkit:PictureInPicture";
// Zen перематывает на 5 секунд за сообщение, Arc — на 15
const PIP_SEEK_MESSAGES = 3;

const seekIcon = (arc, arrow) =>
  `<path d="${arc}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>` +
  `<path d="${arrow}" fill="currentColor"/>` +
  `<text x="16" y="21.5" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" font-weight="700" fill="currentColor">15</text>`;

// Иконки Arc встроенным SVG: CSP плеера (default-src chrome:) не пускает
// data:-картинки из стилей. [кнопка, класс, viewBox, содержимое]
const PIP_ICONS = [
  [
    "unpip",
    "",
    "0 0 20 20",
    `<path d="M5 5h7M5 5v7M5 5l10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  ],
  [
    "minimize",
    "",
    "0 0 20 20",
    `<path d="M4 10h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  ],
  [
    "close",
    "",
    "0 0 20 20",
    `<path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  ],
  [
    "playpause",
    "zen-tweaks-pip-play",
    "0 0 24 24",
    `<path d="M6.5 3.9v16.2c0 .9 1 1.5 1.8 1l13.4-8.1c.7-.4.7-1.5 0-1.9L8.3 2.9c-.8-.5-1.8.1-1.8 1z" fill="currentColor"/>`,
  ],
  [
    "playpause",
    "zen-tweaks-pip-pause",
    "0 0 24 24",
    `<rect x="5" y="3" width="5" height="18" rx="1.5" fill="currentColor"/><rect x="14" y="3" width="5" height="18" rx="1.5" fill="currentColor"/>`,
  ],
  ["seekBackward", "", "0 0 32 32", seekIcon("M16 6A11 11 0 1 1 6.47 11.5", "M17 2.5L12.5 6L17 9.5z")],
  ["seekForward", "", "0 0 32 32", seekIcon("M16 6A11 11 0 1 0 25.53 11.5", "M15 2.5L19.5 6L15 9.5z")],
];

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

// Доработка, которую целиком описывает CSS-файл расширения
class UserSheet {
  #sheetURI;

  constructor(extension, file, available = true) {
    this.available = available;
    this.#sheetURI = Services.io.newURI(extension.rootURI.resolve(file));
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

// Окно Picture-in-Picture в духе Arc. Раскладку задаёт pip-arc.css, а здесь
// в плеер добавляются подписи Minimize и Close, домен вкладки и перемотка на
// 15 секунд. Подписи и домен показываются, только когда помещаются: решает
// pipTopBar из pip-layout.mjs.
class ArcPip {
  available = true;
  #sheet;
  #extension;
  #pipTopBar;
  #undo = new Map();

  constructor(extension, pipTopBar) {
    this.#extension = extension;
    this.#sheet = new UserSheet(extension, "pip-arc.css");
    this.#pipTopBar = pipTopBar;
  }

  enable() {
    this.#sheet.enable();
    Services.ww.registerNotification(this.#onWindow);
    for (const win of Services.wm.getEnumerator(PIP_WINDOW_TYPE)) {
      this.#decorate(win);
    }
  }

  disable() {
    Services.ww.unregisterNotification(this.#onWindow);
    for (const undo of this.#undo.values()) {
      undo();
    }
    this.#undo.clear();
    this.#sheet.disable();
  }

  #onWindow = (win, topic) => {
    if (topic != "domwindowopened") {
      return;
    }
    win.addEventListener(
      "load",
      () => {
        if (win.document.documentElement.getAttribute("windowtype") == PIP_WINDOW_TYPE) {
          this.#decorate(win);
        }
      },
      { once: true }
    );
  };

  #decorate(win) {
    const doc = win.document;
    const root = doc.documentElement;
    const controls = doc.getElementById("controls");
    const unpip = doc.getElementById("unpip");
    const minimize = doc.getElementById("minimize");
    const close = doc.getElementById("close");
    if (this.#undo.has(win) || !controls || !unpip || !minimize || !close) {
      return;
    }

    const label = (button, message) => {
      const span = doc.createElement("span");
      span.className = "zen-tweaks-pip-label";
      span.textContent = this.#extension.localizeMessage(message);
      button.append(span);
      return span;
    };
    const minimizeLabel = label(minimize, "pipMinimizeLabel");
    const closeLabel = label(close, "pipCloseLabel");

    const icons = PIP_ICONS.map(([id, className, viewBox, body]) => {
      const parsed = new win.DOMParser().parseFromString(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`,
        "image/svg+xml"
      );
      const svg = doc.importNode(parsed.documentElement, true);
      svg.setAttribute("class", `zen-tweaks-pip-icon ${className}`.trim());
      doc.getElementById(id).prepend(svg);
      return svg;
    });

    const right = doc.createElement("div");
    right.id = "zen-tweaks-pip-right";
    right.append(minimize, close);
    const origin = doc.createElement("div");
    origin.id = "zen-tweaks-pip-origin";
    origin.className = "control-item";
    unpip.after(origin, right);
    root.setAttribute("zen-tweaks-arc-pip", "");

    const layout = () => {
      origin.textContent = pipOrigin(win);
      const style = win.getComputedStyle(root);
      const labelPad = parseFloat(style.getPropertyValue("--zen-tweaks-pip-label-pad"));
      const unpipBox = unpip.getBoundingClientRect();
      const { labels, origin: showOrigin } = this.#pipTopBar({
        width: win.innerWidth,
        padding: unpipBox.left,
        gap: parseFloat(style.getPropertyValue("--zen-tweaks-pip-gap")),
        back: unpipBox.width,
        // Без подписи кнопка — квадрат, ширина иконки равна высоте
        minimize: {
          icon: minimize.getBoundingClientRect().height,
          label: minimizeLabel.scrollWidth + labelPad,
        },
        close: {
          icon: close.getBoundingClientRect().height,
          label: closeLabel.scrollWidth + labelPad,
        },
        origin: origin.scrollWidth,
      });
      root.toggleAttribute("zen-tweaks-pip-labels", labels);
      root.toggleAttribute("zen-tweaks-pip-origin", showOrigin);
    };

    let frame = 0;
    const scheduleLayout = () => {
      win.cancelAnimationFrame(frame);
      frame = win.requestAnimationFrame(layout);
    };

    // Свой обработчик раньше плеерного: тот перемотал бы всего на 5 секунд
    const onSeek = event => {
      const message = {
        seekBackward: "PictureInPicture:SeekBackward",
        seekForward: "PictureInPicture:SeekForward",
      }[event.target.id];
      if (!message || event.button != 0) {
        return;
      }
      event.stopPropagation();
      const actor = doc
        .getElementById("browser")
        .browsingContext.currentWindowGlobal.getActor("PictureInPicture");
      for (let i = 0; i < PIP_SEEK_MESSAGES; i++) {
        actor.sendAsyncMessage(message);
      }
    };

    controls.addEventListener("click", onSeek, true);
    controls.addEventListener("mouseenter", scheduleLayout);
    win.addEventListener("resize", scheduleLayout);
    scheduleLayout();

    const undo = () => {
      win.cancelAnimationFrame(frame);
      controls.removeEventListener("click", onSeek, true);
      controls.removeEventListener("mouseenter", scheduleLayout);
      win.removeEventListener("resize", scheduleLayout);
      root.removeAttribute("zen-tweaks-arc-pip");
      root.removeAttribute("zen-tweaks-pip-labels");
      root.removeAttribute("zen-tweaks-pip-origin");
      minimizeLabel.remove();
      closeLabel.remove();
      for (const icon of icons) {
        icon.remove();
      }
      // Исходный порядок в player.xhtml: close, minimize, unpip
      unpip.before(close, minimize);
      right.remove();
      origin.remove();
    };
    this.#undo.set(win, undo);
    win.addEventListener("unload", () => this.#undo.delete(win), { once: true });
  }
}

// Домен вкладки, из которой открыли Picture-in-Picture, как его пишет Arc
function pipOrigin(win) {
  try {
    return lazy.PictureInPicture.weakWinToBrowser.get(win)?.currentURI.displayHost ?? "";
  } catch {
    // У about: и data: адресов хоста нет, геттер бросает исключение
    return "";
  }
}

function resourceProtocol() {
  return Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
}

this.zenTweaks = class extends ExtensionAPI {
  #features = null;
  #active = new Set();
  #resourceHost = null;

  onStartup() {
    // loadSubScript не грузит файлы из xpi, а ES-модуль грузится через
    // resource-подстановку. Версия в имени хоста нужна, чтобы после
    // обновления не достался модуль, закэшированный прежней версией.
    this.#resourceHost = `zen-tweaks-${this.extension.version.replaceAll(".", "-")}`;
    resourceProtocol().setSubstitution(this.#resourceHost, this.extension.rootURI);
    const { pipTopBar } = ChromeUtils.importESModule(
      `resource://${this.#resourceHost}/pip-layout.mjs`
    );

    this.#features = new Map([
      ["fullscreenSidebar", new UserSheet(this.extension, "fullscreen-sidebar.css")],
      ["workspaceTabs", new WorkspaceTabs()],
      ["reopenOnActivate", new ReopenOnActivate()],
      // На других платформах кнопки PiP и так стоят справа
      [
        "pipButtons",
        new UserSheet(this.extension, "pip-buttons.css", AppConstants.platform == "macosx"),
      ],
      ["arcPip", new ArcPip(this.extension, pipTopBar)],
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
    resourceProtocol().setSubstitution(this.#resourceHost, null);
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
