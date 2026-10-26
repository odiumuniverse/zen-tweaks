# Zen Tweaks

[![Install in Zen](https://img.shields.io/badge/Install_in-Zen-F76F53?style=for-the-badge&logo=zenbrowser&logoColor=white)](https://odiumuniverse.github.io/zen-tweaks/)

Arc-like tweaks for [Zen Browser](https://zen-browser.app). Each one can be switched on or off on the add-on's options page, and the change applies at once.

- **Sidebar over fullscreen video.** In compact mode, move the pointer to the left edge of a fullscreen video and the sidebar slides out. Zen normally hides it until you leave fullscreen.
- **Only this space's tabs in the address bar.** “Switch to tab” stops offering tabs from other spaces, so typing an address that is open elsewhere opens it in the current space instead of jumping there.
- **Cmd+T like in Arc.** In the bar Cmd+T opens, an open tab of the current space that matches what you typed comes first, so Enter switches to it instead of searching. Cmd+L is left alone, as in Arc. The bar opens empty instead of bringing back text you left there, and new tabs go to the top of the list; a New Tab button hidden with “Show New Tab Button on Tab List” stays hidden. Off by default.
- **Open a window on Cmd+Tab** (macOS). When Zen has no windows left, switching to it opens a new one, the way clicking its Dock icon does.
- **Close and minimize on the right in Picture-in-Picture** (macOS). Close and minimize move to the right corner of the Picture-in-Picture window, and “Back to tab” moves to the left, as on Windows.
- **Picture-in-Picture like in Arc.** “Back to tab” in the top left corner, the site's domain in the middle, Minimize and Close in the top right; play/pause and 15-second seeking in the center; a thin progress bar at the bottom. The button labels and the domain show up only when they fit, so they never cover the buttons. Timestamp, volume, speed, subtitles and fullscreen buttons are hidden, as in Arc; their shortcuts still work. Off by default.

Two pairs of tweaks change the same thing and exclude each other: turning one on turns the other off. They are “Only this space's tabs in the address bar” with “Cmd+T like in Arc”, and the two Picture-in-Picture tweaks.

“Cmd+T like in Arc” changes Zen settings: `zen.urlbar.replace-newtab` and `zen.view.show-newtab-button-top` turn on, `zen.urlbar.wait-to-clear` becomes 0. Turning the tweak off brings back the values you had before. If you change one of the first two in Zen yourself, the tweak switches off and leaves the rest as they are; turn it on again to apply its settings once more.

## Why it needs two settings

None of this is possible with the regular WebExtension API, so Zen Tweaks is a [WebExtension Experiment](https://firefox-source-docs.mozilla.org/toolkit/components/extensions/webextensions/basics.html): its `parent.js` runs inside the browser with full privileges. addons.mozilla.org does not sign such add-ons, and Zen loads them only with these settings in `about:config`:

| Setting | Value |
|---|---|
| `xpinstall.signatures.required` | `false` |
| `extensions.experiments.enabled` | `true` |

With the first one off, Zen lets you install any unsigned add-on, so only install files you trust. It still asks before each install.

## Install

Follow the steps on **[odiumuniverse.github.io/zen-tweaks](https://odiumuniverse.github.io/zen-tweaks/)**: set the two settings, restart Zen, click **Install**. Updates arrive on their own after that.

The toggles live in `about:addons` → Zen Tweaks → Options. They are stored as `extensions.zen-tweaks.*` settings.

## Development

`./build.sh` packs `extension/` into `/tmp/zen-tweaks.xpi`. Install it from `about:addons` → gear → **Install Add-on From File**.

`npm test` runs the unit tests in `test/` with Node's built-in runner; there are no dependencies to install.

## Compatibility

Zen Tweaks hooks into Zen's internals (`UrlbarMuxerStandard`, compact-mode attributes, `mac_app_activate`, the Picture-in-Picture player markup and its `PictureInPicture` module), so a large Zen update can break it. It is written against Zen 1.23.4b.
