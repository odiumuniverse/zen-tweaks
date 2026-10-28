"use strict";

/* global ExtensionAPI, ChromeUtils, Services, Cc, Ci, AppConstants */

// Привилегированная часть Zen Tweaks: код идёт внутри Zen с правами самого
// браузера. Обычному WebExtension ни одна из доработок недоступна.
//
// Каждая доработка включается настройкой extensions.zen-tweaks.<name>, по
// умолчанию true, если у доработки нет своего defaultEnabled. Страница
// настроек меняет их через setFeature, а наблюдатель за настройками сразу
// включает или выключает доработку, без перезапуска.
//
// Доработка с excludes взаимоисключающая с названной: включение одной
// выключает другую. Доработка с zenPrefs переопределяет настройки Zen:
// при включении запоминает прежние значения в extensions.zen-tweaks.<name>.saved
// и ставит свои, при выключении возвращает прежние. Если пользователь сам
// меняет в Zen настройку из zenPrefs.required, доработка выключается, а
// остальные её настройки Zen остаются как есть. Доработка с conflicts() не
// включается, пока он возвращает true.

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
// Окно браузера достроено: gURLBar и горячие клавиши Zen на месте
const WINDOW_READY_TOPIC = "browser-delayed-startup-finished";

// Набор, куда Zen складывает горячие клавиши из своих настроек
const ZEN_KEYSET_ID = "zenKeyset";

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

// Значение настройки с учётом значения по умолчанию
function readPref(name) {
  switch (Services.prefs.getPrefType(name)) {
    case Ci.nsIPrefBranch.PREF_BOOL:
      return Services.prefs.getBoolPref(name);
    case Ci.nsIPrefBranch.PREF_INT:
      return Services.prefs.getIntPref(name);
    case Ci.nsIPrefBranch.PREF_STRING:
      return Services.prefs.getStringPref(name);
    default:
      return undefined;
  }
}

// Значение, заданное пользователем, или null, если действует умолчание
function readUserPref(name) {
  return Services.prefs.prefHasUserValue(name) ? readPref(name) : null;
}

// null снимает значение пользователя и возвращает умолчание
function writePref(name, value) {
  if (value === null) {
    Services.prefs.clearUserPref(name);
  } else if (typeof value == "boolean") {
    Services.prefs.setBoolPref(name, value);
  } else if (typeof value == "number") {
    Services.prefs.setIntPref(name, value);
  } else {
    Services.prefs.setStringPref(name, value);
  }
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

// Окна браузера, в которых уже есть gURLBar и горячие клавиши Zen
function readyBrowserWindows() {
  return Array.from(Services.wm.getEnumerator("navigator:browser")).filter(
    win => !win.closed && win.gBrowserInit?.delayedStartupFinished
  );
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

// Панель поверх полноэкранного видео: выдвигает её fullscreen-sidebar.css.
// Вкладка выбирается уже на нажатии кнопки мыши, и Zen сразу выходит из
// полноэкранного режима: панель уезжает, а кнопка ещё зажата. Тогда малейшее
// движение превращает щелчок в перетаскивание вкладки, а вкладку, брошенную
// у края страницы, Zen ставит рядом в split view. Поэтому перетаскивание,
// начатое нажатием в полноэкранном режиме, отменяется.
class FullscreenSidebar {
  available = true;
  #sheet;
  #undo = new Map();

  constructor(extension) {
    this.#sheet = new UserSheet(extension, "fullscreen-sidebar.css");
  }

  enable() {
    this.#sheet.enable();
    Services.obs.addObserver(this.#onWindow, WINDOW_READY_TOPIC);
    for (const win of readyBrowserWindows()) {
      this.#onWindow(win);
    }
  }

  disable() {
    Services.obs.removeObserver(this.#onWindow, WINDOW_READY_TOPIC);
    for (const undo of this.#undo.values()) {
      undo();
    }
    this.#undo.clear();
    this.#sheet.disable();
  }

  #onWindow = win => {
    if (this.#undo.has(win)) {
      return;
    }
    const root = win.document.documentElement;
    // Каждое нажатие перезаписывает флаг, так что потерянный mouseup его не залипит
    let pressedInFullscreen = false;
    const onMouseDown = () => {
      pressedInFullscreen = root.getAttribute("inDOMFullscreen") == "true";
    };
    const onMouseUp = () => {
      pressedInFullscreen = false;
    };
    // Вкладки начинают перетаскивание в dragstart контейнера, окно ловит его раньше
    const onDragStart = event => {
      if (pressedInFullscreen && event.target.closest("#navigator-toolbox")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    win.addEventListener("mousedown", onMouseDown, true);
    win.addEventListener("mouseup", onMouseUp, true);
    win.addEventListener("dragstart", onDragStart, true);

    this.#undo.set(win, () => {
      win.removeEventListener("mousedown", onMouseDown, true);
      win.removeEventListener("mouseup", onMouseUp, true);
      win.removeEventListener("dragstart", onDragStart, true);
    });
    win.addEventListener("unload", () => this.#undo.delete(win), { once: true });
  };
}

// Две доработки правят результаты адресной строки до сортировки. sort
// подменяется один раз, а доработки кладут в него свои фильтры: иначе
// выключение одной сняло бы подмену и у другой.
const muxerFilters = new Set();

function addMuxerFilter(filter) {
  const muxer = lazy.UrlbarMuxerStandard;
  if (!muxerFilters.size) {
    const sort = Object.getPrototypeOf(muxer).sort;
    muxer.sort = function (context, results) {
      for (const muxerFilter of muxerFilters) {
        results = muxerFilter(context, results);
      }
      return sort.call(this, context, results);
    };
  }
  muxerFilters.add(filter);
}

function removeMuxerFilter(filter) {
  muxerFilters.delete(filter);
  if (!muxerFilters.size) {
    // sort — метод прототипа, собственное свойство ставит только addMuxerFilter
    delete lazy.UrlbarMuxerStandard.sort;
  }
}

// visibleTabs — вкладки текущего пространства и Essentials
function spaceTabUrls(win) {
  return new Set(win.gBrowser.visibleTabs.map(tab => tab.linkedBrowser?.registeredOpenURI?.spec));
}

// Zen регистрирует открытые вкладки всех пространств в одной таблице, и
// адресная строка предлагает «Перейти на вкладку» из чужого пространства,
// а Enter туда перебрасывает. Такие результаты выкидываются до сортировки:
// иначе muxer схлопнет с ними обычный URL-результат, и адрес не откроется
// в текущем пространстве. Эвристические тоже: именно их выбирает Enter, а без
// эвристики адресная строка откроет введённый адрес сама.
class WorkspaceTabs {
  available = true;
  excludes = "arcNewTab";

  enable() {
    addMuxerFilter(this.#filter);
  }

  disable() {
    removeMuxerFilter(this.#filter);
  }

  #filter = (context, results) => {
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    if (context.isPrivate || !win?.gZenWorkspaces) {
      return results;
    }
    const { TAB_SWITCH } = lazy.UrlbarShared.RESULT_TYPE;
    const workspaceUrls = spaceTabUrls(win);
    return results.filter(r => r.type != TAB_SWITCH || workspaceUrls.has(r.payload.url));
  };
}

// Cmd+T в духе Arc. В строке новой вкладки открытая вкладка текущего
// пространства, совпавшая с набранным, встаёт первой, и Enter переключает на
// неё, а не ищет в поисковике. Cmd+L не трогаем: Arc там открывает найденный
// адрес в текущей вкладке.
class ArcNewTab {
  available = true;
  defaultEnabled = false;
  excludes = "workspaceTabs";
  zenPrefs = {
    // Без них доработка теряет смысл: Cmd+T открывает строку, а не пустую
    // вкладку, и новая вкладка встаёт наверх, как в Arc. Кнопку «Новая
    // вкладка» прячет zen.tabs.show-newtab-vertical, его не трогаем: место
    // новых вкладок от него не зависит.
    required: {
      "zen.urlbar.replace-newtab": true,
      "zen.view.show-newtab-button-top": true,
    },
    // Arc открывает строку пустой, а Zen полминуты помнит брошенный в ней текст
    extra: { "zen.urlbar.wait-to-clear": 0 },
  };
  #promoteSpaceTab;

  constructor(promoteSpaceTab) {
    this.#promoteSpaceTab = promoteSpaceTab;
  }

  enable() {
    addMuxerFilter(this.#filter);
  }

  disable() {
    removeMuxerFilter(this.#filter);
  }

  #filter = (context, results) => {
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    // zen-newtab стоит на адресной строке, пока она заменяет новую вкладку
    if (
      context.isPrivate ||
      context.searchMode ||
      !context.searchString.trim() ||
      !win?.gURLBar.hasAttribute("zen-newtab")
    ) {
      return results;
    }
    const promoted = this.#promoteSpaceTab(results, {
      tabSwitchType: lazy.UrlbarShared.RESULT_TYPE.TAB_SWITCH,
      spaceUrls: spaceTabUrls(win),
      query: context.searchString,
    });
    if (promoted !== results) {
      context.heuristicResult = promoted[0];
    }
    return promoted;
  };
}

// Ctrl+J и Ctrl+K двигают выделение в списке адресной строки, как встроенные
// Ctrl+N и Ctrl+P. Клавиши строки разбирает handleKeyNavigation её
// контроллера; он подменяется в прототипе, общем для адресной строки и поля
// поиска. Модуль контроллера Zen грузит в каждое окно отдельно, поэтому и
// подмена в каждом окне своя. На Windows и Linux Ctrl+J и Ctrl+K — загрузки
// и поиск, там доработка не нужна.
//
// Если в горячих клавишах Zen на Ctrl+J или Ctrl+K что-то назначено,
// доработка выключается: иначе при открытом списке она перебивала бы клавишу.
class UrlbarKeys {
  available = AppConstants.platform == "macosx";
  defaultEnabled = false;
  #keyStep;
  #keysTaken;
  #switchOff;
  #undo = new Map();

  constructor({ urlbarKeyStep, urlbarKeysTaken }, switchOff) {
    this.#keyStep = urlbarKeyStep;
    this.#keysTaken = urlbarKeysTaken;
    this.#switchOff = switchOff;
  }

  // Пока клавишу занимает Zen, доработка не включается
  conflicts() {
    return readyBrowserWindows().some(win => this.#taken(win));
  }

  enable() {
    Services.obs.addObserver(this.#onWindow, WINDOW_READY_TOPIC);
    for (const win of readyBrowserWindows()) {
      this.#patch(win);
    }
  }

  disable() {
    Services.obs.removeObserver(this.#onWindow, WINDOW_READY_TOPIC);
    for (const undo of this.#undo.values()) {
      undo();
    }
    this.#undo.clear();
  }

  // При запуске Zen успевает заполнить набор раньше, чем за ним начнут следить
  #onWindow = win => {
    this.#patch(win);
    if (this.#taken(win)) {
      this.#switchOff();
    }
  };

  #taken(win) {
    const keyset = win.document.getElementById(ZEN_KEYSET_ID);
    if (!keyset) {
      return false;
    }
    return this.#keysTaken(
      Array.from(keyset.children, key => ({
        key: key.getAttribute("key"),
        modifiers: key.getAttribute("modifiers"),
        disabled: key.getAttribute("disabled") == "true",
      }))
    );
  }

  #patch(win) {
    if (this.#undo.has(win)) {
      return;
    }
    const proto = Object.getPrototypeOf(win.gURLBar.controller);
    const { handleKeyNavigation } = proto;
    const keyStep = this.#keyStep;
    // Повторяет ветку Ctrl+N и Ctrl+P из исходного метода. executeAction
    // ложен, когда строка откладывает клавишу до прихода результатов: тогда
    // метод зовут дважды, и сдвигать выделение надо только во второй раз.
    proto.handleKeyNavigation = function (event, executeAction = true) {
      const step = keyStep(event);
      if (step && this.view.isOpen && !this.view.isResultMenuOpen()) {
        if (executeAction) {
          this.view.selectBy(1, { reverse: step < 0 });
        }
        event.preventDefault();
        return;
      }
      handleKeyNavigation.call(this, event, executeAction);
    };

    // Zen пересобирает набор целиком, когда клавишу меняют в настройках
    const observer = new win.MutationObserver(() => {
      if (this.#taken(win)) {
        this.#switchOff();
      }
    });
    const keyset = win.document.getElementById(ZEN_KEYSET_ID);
    if (keyset) {
      observer.observe(keyset, { childList: true });
    }

    this.#undo.set(win, () => {
      observer.disconnect();
      // Метод живёт в самом прототипе, delete удалил бы и исходный
      proto.handleKeyNavigation = handleKeyNavigation;
    });
    win.addEventListener("unload", () => this.#undo.delete(win), { once: true });
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
      Services.obs.addObserver(this.#onFirstWindow, WINDOW_READY_TOPIC);
    }
    Services.obs.addObserver(this.#onAppActivate, APP_ACTIVATE_TOPIC);
  }

  disable() {
    Services.obs.removeObserver(this.#onAppActivate, APP_ACTIVATE_TOPIC);
    if (this.#waitingFirstWindow) {
      Services.obs.removeObserver(this.#onFirstWindow, WINDOW_READY_TOPIC);
      this.#waitingFirstWindow = false;
    }
    lazy.clearTimeout(this.#timer);
  }

  #onFirstWindow = () => {
    Services.obs.removeObserver(this.#onFirstWindow, WINDOW_READY_TOPIC);
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
  defaultEnabled = false;
  excludes = "pipButtons";
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
  #starting = false;
  #writingZenPrefs = false;
  // Доработки, которые выключились, потому что пользователь сам поменял их
  // важную настройку в Zen: остальные их настройки Zen тогда не возвращаем
  #keepZenPrefs = new Set();

  onStartup() {
    // loadSubScript не грузит файлы из xpi, а ES-модуль грузится через
    // resource-подстановку. Версия в имени хоста нужна, чтобы после
    // обновления не достался модуль, закэшированный прежней версией.
    this.#resourceHost = `zen-tweaks-${this.extension.version.replaceAll(".", "-")}`;
    resourceProtocol().setSubstitution(this.#resourceHost, this.extension.rootURI);
    const { pipTopBar } = ChromeUtils.importESModule(
      `resource://${this.#resourceHost}/pip-layout.mjs`
    );
    const { promoteSpaceTab } = ChromeUtils.importESModule(
      `resource://${this.#resourceHost}/newtab-results.mjs`
    );
    const urlbarKeys = ChromeUtils.importESModule(
      `resource://${this.#resourceHost}/urlbar-keys.mjs`
    );

    this.#features = new Map([
      ["fullscreenSidebar", new FullscreenSidebar(this.extension)],
      ["workspaceTabs", new WorkspaceTabs()],
      ["arcNewTab", new ArcNewTab(promoteSpaceTab)],
      [
        "urlbarKeys",
        new UrlbarKeys(urlbarKeys, () =>
          Services.prefs.setBoolPref(PREF_BRANCH + "urlbarKeys", false)
        ),
      ],
      ["reopenOnActivate", new ReopenOnActivate()],
      // На других платформах кнопки PiP и так стоят справа
      [
        "pipButtons",
        Object.assign(
          new UserSheet(this.extension, "pip-buttons.css", AppConstants.platform == "macosx"),
          { excludes: "arcPip" }
        ),
      ],
      ["arcPip", new ArcPip(this.extension, pipTopBar)],
    ]);

    // Через about:config можно включить обе из пары: остаётся та, что выше в списке
    for (const [name, feature] of this.#features) {
      if (feature.excludes && this.#isEnabled(name) && this.#isEnabled(feature.excludes)) {
        Services.prefs.setBoolPref(PREF_BRANCH + feature.excludes, false);
      }
    }

    Services.prefs.addObserver(PREF_BRANCH, this.#sync);
    this.#starting = true;
    try {
      this.#sync();
    } finally {
      this.#starting = false;
    }
  }

  onShutdown(isAppShutdown) {
    if (isAppShutdown) {
      return;
    }
    Services.prefs.removeObserver(PREF_BRANCH, this.#sync);
    // Настройки Zen не возвращаем: при обновлении расширение тут же запустится снова
    for (const name of [...this.#active]) {
      this.#deactivate(name, false);
    }
    resourceProtocol().setSubstitution(this.#resourceHost, null);
  }

  getAPI() {
    return {
      zenTweaks: {
        getFeatures: async () =>
          Array.from(this.#features, ([name, feature]) => ({
            name,
            enabled: this.#isEnabled(name),
            available: feature.available,
          })),
        setFeature: async (name, enabled) => {
          Services.prefs.setBoolPref(PREF_BRANCH + name, enabled);
        },
      },
    };
  }

  #isEnabled(name) {
    return Services.prefs.getBoolPref(
      PREF_BRANCH + name,
      this.#features.get(name).defaultEnabled ?? true
    );
  }

  #wanted(name) {
    return this.#features.get(name).available && this.#isEnabled(name);
  }

  #sync = (subject, topic, pref) => {
    // Служебные настройки вроде <name>.saved доработки не включают
    const changed = pref?.slice(PREF_BRANCH.length);
    if (pref && !this.#features.has(changed)) {
      return;
    }
    // Включили одну из пары — выключаем вторую, дальше доделает вложенный вызов
    const partner = changed && this.#features.get(changed).excludes;
    if (partner && this.#isEnabled(changed) && this.#isEnabled(partner)) {
      Services.prefs.setBoolPref(PREF_BRANCH + partner, false);
      return;
    }
    // Сначала выключение: взаимоисключающие доработки не работают одновременно
    for (const name of this.#features.keys()) {
      if (this.#active.has(name) && !this.#wanted(name)) {
        this.#deactivate(name, true);
      }
    }
    for (const name of this.#features.keys()) {
      if (!this.#active.has(name) && this.#wanted(name)) {
        this.#activate(name);
      }
    }
  };

  #activate(name) {
    const feature = this.#features.get(name);
    if (feature.zenPrefs && !this.#applyZenPrefs(name, feature.zenPrefs)) {
      return;
    }
    // Клавишу доработки уже занял сам Zen
    if (feature.conflicts?.()) {
      Services.prefs.setBoolPref(PREF_BRANCH + name, false);
      return;
    }
    feature.enable();
    this.#active.add(name);
  }

  #deactivate(name, restoreZenPrefs) {
    const feature = this.#features.get(name);
    feature.disable();
    this.#active.delete(name);
    if (!feature.zenPrefs) {
      return;
    }
    for (const pref of Object.keys(feature.zenPrefs.required)) {
      Services.prefs.removeObserver(pref, this.#onZenPref);
    }
    const keep = this.#keepZenPrefs.delete(name);
    if (restoreZenPrefs && !keep) {
      this.#restoreZenPrefs(name);
    }
  }

  // false, если доработку пришлось выключить: пользователь сам поменял её
  // важную настройку, пока Zen Tweaks не работал
  #applyZenPrefs(name, { required, extra }) {
    const savedPref = `${PREF_BRANCH}${name}.saved`;
    const values = { ...required, ...extra };
    if (!Services.prefs.prefHasUserValue(savedPref)) {
      const saved = Object.fromEntries(Object.keys(values).map(pref => [pref, readUserPref(pref)]));
      Services.prefs.setStringPref(savedPref, JSON.stringify(saved));
      this.#writeZenPrefs(values);
    } else if (!this.#starting) {
      // Пользователь снова включил доработку: переопределяем настройки заново
      this.#writeZenPrefs(values);
    } else if (Object.entries(required).some(([pref, value]) => readPref(pref) !== value)) {
      Services.prefs.setBoolPref(PREF_BRANCH + name, false);
      return false;
    }
    // На запуске всё совпало: значения уже наши, и прочие пользователь мог поправить
    for (const pref of Object.keys(required)) {
      Services.prefs.addObserver(pref, this.#onZenPref);
    }
    return true;
  }

  #restoreZenPrefs(name) {
    const savedPref = `${PREF_BRANCH}${name}.saved`;
    if (Services.prefs.prefHasUserValue(savedPref)) {
      this.#writeZenPrefs(JSON.parse(Services.prefs.getStringPref(savedPref)));
      Services.prefs.clearUserPref(savedPref);
    }
  }

  #writeZenPrefs(values) {
    this.#writingZenPrefs = true;
    try {
      for (const [pref, value] of Object.entries(values)) {
        writePref(pref, value);
      }
    } finally {
      this.#writingZenPrefs = false;
    }
  }

  #onZenPref = (subject, topic, pref) => {
    if (this.#writingZenPrefs) {
      return;
    }
    for (const name of [...this.#active]) {
      const required = this.#features.get(name).zenPrefs?.required;
      if (required && pref in required && readPref(pref) !== required[pref]) {
        this.#keepZenPrefs.add(name);
        Services.prefs.setBoolPref(PREF_BRANCH + name, false);
      }
    }
  };
};
