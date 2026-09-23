#!/usr/bin/env bash
sleep 5
if command -v gnome-extensions >/dev/null 2>&1; then
  gnome-extensions enable dash-to-panel@jderose9.github.com >/dev/null 2>&1 || true
  gnome-extensions enable arcmenu@arcmenu.com >/dev/null 2>&1 || true
  gnome-extensions disable ubuntu-dock@ubuntu.com >/dev/null 2>&1 || true
fi
