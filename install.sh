#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
USER_HOME="${HOME:?HOME must be set}"
DATA_HOME="${XDG_DATA_HOME:-$USER_HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$USER_HOME/.config}"
PROJECT_PATH="${1:-}"

mkdir -p "$USER_HOME/.themes" "$DATA_HOME/icons" "$USER_HOME/.local/bin" \
  "$CONFIG_HOME/autostart" "$CONFIG_HOME/gtk-3.0" "$USER_HOME/.local/state/win11-ubuntu-desktop/backups"

cp -a "$ROOT_DIR/assets/themes/HoangTuTech-Win11" "$USER_HOME/.themes/"
cp -a "$ROOT_DIR/assets/icons/HoangTuTech-Win11" "$DATA_HOME/icons/"
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f "$DATA_HOME/icons/HoangTuTech-Win11" >/dev/null 2>&1 || true
fi
install -m 644 "$ROOT_DIR/assets/icons/windows11-start.svg" "$DATA_HOME/icons/windows11-start.svg"
install -m 644 "$ROOT_DIR/assets/icons/windows11-search.svg" "$DATA_HOME/icons/windows11-search.svg"
install -m 755 "$ROOT_DIR/src/system_stats_widget.py" "$USER_HOME/.local/bin/system_stats_widget.py"

ARC_ID="arcmenu@arcmenu.com"
ARC_SOURCE="$ROOT_DIR/extensions/hoangtutech-menu"
ARC_DEST="$DATA_HOME/gnome-shell/extensions/$ARC_ID"
ARC_BACKUP="$USER_HOME/.local/state/win11-ubuntu-desktop/backups/$ARC_ID-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$(dirname -- "$ARC_DEST")"
if command -v gnome-extensions >/dev/null 2>&1; then
  gnome-extensions disable "$ARC_ID" >/dev/null 2>&1 || true
fi
if [[ -d "$ARC_DEST" ]]; then
  mv "$ARC_DEST" "$ARC_BACKUP"
  printf 'Backed up existing ArcMenu to %s\n' "$ARC_BACKUP"
fi
cp -a "$ARC_SOURCE" "$ARC_DEST"
if command -v glib-compile-schemas >/dev/null 2>&1; then
  glib-compile-schemas "$ARC_DEST/schemas"
fi

install -m 755 "$ROOT_DIR/scripts/apply_win11_on_login.sh" "$USER_HOME/.local/bin/apply_win11_on_login.sh"

cat > "$CONFIG_HOME/autostart/win11-theme.desktop" <<DESKTOP_THEME
[Desktop Entry]
Type=Application
Name=Windows 11 Theme Activator
Exec=/bin/bash "$USER_HOME/.local/bin/apply_win11_on_login.sh"
Terminal=false
X-GNOME-Autostart-enabled=true
DESKTOP_THEME

cat > "$CONFIG_HOME/autostart/system-stats-widget.desktop" <<DESKTOP_WIDGET
[Desktop Entry]
Type=Application
Name=CPU, Memory, Disk, Ethernet
Comment=Show CPU, memory, disk and Ethernet usage on the desktop
Exec=env GDK_BACKEND=x11 /usr/bin/python3 "$USER_HOME/.local/bin/system_stats_widget.py"
Terminal=false
X-GNOME-Autostart-enabled=true
DESKTOP_WIDGET

gsettings set org.gnome.desktop.interface gtk-theme 'HoangTuTech-Win11'
gsettings set org.gnome.desktop.interface icon-theme 'HoangTuTech-Win11'
if [[ -d /usr/share/icons/Bibata-Modern-Classic || -d "$DATA_HOME/icons/Bibata-Modern-Classic" ]]; then
  gsettings set org.gnome.desktop.interface cursor-theme 'Bibata-Modern-Classic'
else
  printf 'Bibata-Modern-Classic cursor theme not found; keeping the current cursor.\n'
fi
if gsettings list-schemas | grep -Fxq 'org.gnome.shell.extensions.ding'; then
  gsettings set org.gnome.shell.extensions.ding show-trash true
fi

if gnome-extensions list 2>/dev/null | grep -Fxq 'dash-to-panel@jderose9.github.com'; then
  gnome-extensions enable dash-to-panel@jderose9.github.com || true
else
  printf 'Install Dash-to-Panel to get the bottom taskbar.\n'
fi
if gnome-extensions list 2>/dev/null | grep -Fxq "$ARC_ID"; then
  gnome-extensions disable "$ARC_ID" >/dev/null 2>&1 || true
  sleep 2
  gnome-extensions enable "$ARC_ID" || true
else
  gnome-extensions enable "$ARC_ID" || true
fi
if gnome-extensions list 2>/dev/null | grep -Fxq 'ubuntu-dock@ubuntu.com'; then
  gnome-extensions disable ubuntu-dock@ubuntu.com || true
fi

GSETTINGS_SCHEMA_DIR="$ARC_DEST/schemas" gsettings set org.gnome.shell.extensions.arcmenu menu-layout '11'
GSETTINGS_SCHEMA_DIR="$ARC_DEST/schemas" gsettings set org.gnome.shell.extensions.arcmenu menu-button-appearance 'Icon'
GSETTINGS_SCHEMA_DIR="$ARC_DEST/schemas" gsettings set org.gnome.shell.extensions.arcmenu menu-button-icon "$DATA_HOME/icons/windows11-start.svg"
GSETTINGS_SCHEMA_DIR="$ARC_DEST/schemas" gsettings set org.gnome.shell.extensions.arcmenu menu-button-icon-size 22
GSETTINGS_SCHEMA_DIR="$ARC_DEST/schemas" gsettings set org.gnome.shell.extensions.arcmenu win11-resource-monitor-visible false

if command -v gsettings >/dev/null 2>&1 && gsettings list-schemas | grep -Fxq 'org.gnome.shell.extensions.dash-to-panel'; then
  gsettings set org.gnome.shell.extensions.dash-to-panel panel-position 'BOTTOM'
  gsettings set org.gnome.shell.extensions.dash-to-panel show-activities-button false
  gsettings set org.gnome.shell.extensions.dash-to-panel show-favorites true
  gsettings set org.gnome.shell.extensions.dash-to-panel show-running-apps true
  gsettings set org.gnome.shell.extensions.dash-to-panel show-apps-icon-file "$DATA_HOME/icons/windows11-search.svg"
  gsettings set org.gnome.shell.extensions.dash-to-panel trans-use-custom-opacity true
  gsettings set org.gnome.shell.extensions.dash-to-panel trans-panel-opacity 0.85
  gsettings set org.gnome.shell.extensions.dash-to-panel appicon-margin 4
  gsettings set org.gnome.shell.extensions.dash-to-panel appicon-padding 6
fi

BOOKMARKS_FILE="$CONFIG_HOME/gtk-3.0/bookmarks"
touch "$BOOKMARKS_FILE"
grep -Fxq 'file:/// Ubuntu' "$BOOKMARKS_FILE" || printf 'file:/// Ubuntu\n' >> "$BOOKMARKS_FILE"
if [[ -n "$PROJECT_PATH" && -d "$PROJECT_PATH" ]]; then
  PROJECT_URI="$(python3 -c 'from pathlib import Path; import sys; print(Path(sys.argv[1]).resolve().as_uri())' "$PROJECT_PATH")"
  grep -Fq "$PROJECT_URI Laravel" "$BOOKMARKS_FILE" || printf '%s Laravel\n' "$PROJECT_URI" >> "$BOOKMARKS_FILE"
fi

printf '\nInstalled Windows 11 style GNOME setup. Review README.md for dependencies and notes.\n'
