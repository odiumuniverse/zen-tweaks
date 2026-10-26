# Zen Tweaks

[![Install in Zen](https://img.shields.io/badge/Install_in-Zen-F76F53?style=for-the-badge&logo=zenbrowser&logoColor=white)](https://odiumuniverse.github.io/zen-tweaks/)

Arc-like tweaks for [Zen Browser](https://zen-browser.app). Each one can be switched on or off on the add-on's options page, and the change applies at once.

- **Sidebar over fullscreen video.** In compact mode, move the pointer to the left edge of a fullscreen video and the sidebar slides out. Zen normally hides it until you leave fullscreen.
- **Only this space's tabs in the address bar.** “Switch to tab” stops offering tabs from other spaces, so typing an address that is open elsewhere opens it in the current space instead of jumping there.
- **Open a window on Cmd+Tab** (macOS). When Zen has no windows left, switching to it opens a new one, the way clicking its Dock icon does.

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

Only want the sidebar over fullscreen video? It is also a plain CSS mod, see [`mod/`](mod/). That one needs no settings changes.

## Development

`./build.sh` packs `extension/` into `/tmp/zen-tweaks.xpi`. Install it from `about:addons` → gear → **Install Add-on From File**.

## Compatibility

Zen Tweaks hooks into Zen's internals (`UrlbarMuxerStandard`, compact-mode attributes, `mac_app_activate`), so a large Zen update can break it. It is written against Zen 1.23.4b.
