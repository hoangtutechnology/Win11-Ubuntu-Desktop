# Win11-Ubuntu-Desktop

**Project author and maintainer:** hoangtutech

A reusable GNOME desktop setup based on the configuration currently used on this computer. It keeps Ubuntu/GNOME and adds a Windows 11 inspired panel, Start menu, search, icons, and a small resource monitor.

## Included

- HoangTuTech-Win11 GTK theme package, based on Fluent GTK and Materia; upstream notices and licenses are retained.
- HoangTuTech Win11 icon overlay, plus the custom Start and search icons; it inherits the separately installed Fluent icon theme.
- HoangTuTech Win11 Start Menu, a customized ArcMenu 73 fork with Windows-style search, Task View, and tray overflow. Its GNOME extension ID stays `arcmenu@arcmenu.com` for compatibility; upstream credit and GPL-2.0 license are retained.
- The CPU, Memory, Disk, and Ethernet desktop widget, including hide/restore and autostart.
- A login script that enables Dash-to-Panel and ArcMenu and disables Ubuntu Dock when those extensions are installed.

The project integration, resource widget, setup scripts, and custom Windows-style additions are by `hoangtutech`. Bundled third-party code and assets remain identified with their original authors and licenses in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The install script does not export this computer's app history, credentials, Codex state, or project bookmarks. It adds the generic `Ubuntu` root bookmark. A project bookmark can be supplied when installing.

## Requirements

- Ubuntu or another GNOME Shell desktop, tested against GNOME Shell 50 and GTK 3.
- `python3-gi` and GTK 3 introspection bindings for the resource widget.
- Dash-to-Panel installed. The customized ArcMenu fork is included.
- The Fluent base icon theme and Bibata-Modern-Classic cursor theme. They are separate dependencies; this repository contains the local Windows-style icon overlay.

On Ubuntu, the GTK widget dependency is available with:

```sh
sudo apt install git python3-gi gir1.2-gtk-3.0 bibata-cursor-theme
git clone https://github.com/vinceliuice/Fluent-icon-theme.git ~/Downloads/Fluent-icon-theme
cd ~/Downloads/Fluent-icon-theme
./install.sh
```

The Fluent base icon theme is maintained at [Fluent-icon-theme](https://github.com/vinceliuice/Fluent-icon-theme). The bundled GTK theme's source and license history are documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Install

Clone the repository, then run:

```sh
git clone https://github.com/hoangtutechnology/Win11-Ubuntu-Desktop.git
cd Win11-Ubuntu-Desktop
./install.sh
```

To add a project folder to the Files sidebar at install time:

```sh
./install.sh /path/to/project
```

The installer backs up an existing ArcMenu extension before replacing it, installs the branded theme and widget, applies the GNOME settings, and enables the desktop Trash icon. It preserves existing Files bookmarks.

The panel's core appearance and placement are configured automatically. On a different monitor, Dash-to-Panel may need one manual adjustment in its preferences to arrange the taskbar buttons for that display's resolution.

Log out and back in if the shell extensions do not refresh immediately. The resource monitor starts automatically on login.

## Use

- Click **×** on the resource widget to hide it. Click the computer icon to show it again.
- Right-click the desktop Trash icon and choose **Dọn sạch Thùng rác** to empty it.
- The widget reads CPU, memory, disk, and network counters locally; it does not send telemetry.

## License notes

The original setup scripts, widget, and icon overlay are GPL-3.0-or-later. ArcMenu-derived changes are distributed under the bundled ArcMenu GPL-2.0 license. Other bundled third-party components retain their own licenses and notices; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The Fluent base icon theme, Dash-to-Panel, and Bibata cursor theme remain separate dependencies under their upstream licenses.
