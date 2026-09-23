#!/usr/bin/python3
import gi
import os
from pathlib import Path

# Use a small GTK overlay for the live desktop resource panel.
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, Gdk, Gio, GLib

MIB = 1024 * 1024
GIB = 1024 * MIB


def read_text(path):
    try:
        with open(path, 'r', encoding='utf-8') as source:
            return source.read()
    except OSError:
        return ''


def format_rate(value):
    if value < 1024:
        return f'{max(0, value):.0f} B/s'
    if value < MIB:
        return f'{value / 1024:.1f} KB/s'
    return f'{value / MIB:.1f} MB/s'


class SystemStatsWidget:
    def __init__(self):
        self._arc_settings = self._load_arcmenu_settings()
        self._last_cpu = self._read_cpu()
        self._last_net = self._read_net()
        self._last_time = GLib.get_monotonic_time()
        self._rx_rate = 0
        self._tx_rate = 0
        self._visibility_file = Path.home() / '.config/system-stats-widget/visibility'
        self._hidden = self._visibility_file.exists() and self._visibility_file.read_text(encoding='utf-8').strip() == 'hidden'

        self.window = Gtk.Window(type=Gtk.WindowType.TOPLEVEL)
        self.window.set_title('CPU, Memory, Disk, Ethernet')
        self.window.set_decorated(False)
        self.window.set_keep_above(True)
        self.window.set_skip_taskbar_hint(True)
        self.window.set_skip_pager_hint(True)
        self.window.set_type_hint(Gdk.WindowTypeHint.UTILITY)
        self.window.set_resizable(False)
        self.window.set_accept_focus(False)
        self.window.set_app_paintable(True)
        screen = self.window.get_screen()
        visual = screen.get_rgba_visual()
        if visual:
            self.window.set_visual(visual)
        self.window.get_style_context().add_class('system-stats-window')

        outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=1)
        outer.get_style_context().add_class('system-stats-panel')
        self.window.add(outer)

        first_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        outer.pack_start(first_row, False, False, 0)
        self.memory = Gtk.Label(xalign=0)
        self.memory.get_style_context().add_class('system-stats-label-bold')
        first_row.pack_start(self.memory, True, True, 0)

        close = Gtk.Button(label='×')
        close.set_relief(Gtk.ReliefStyle.NONE)
        close.set_focus_on_click(False)
        close.get_style_context().add_class('system-stats-close')
        close.connect('clicked', lambda *_: self._hide_widget())
        first_row.pack_end(close, False, False, 0)

        self.show_window = Gtk.Window(type=Gtk.WindowType.TOPLEVEL)
        self.show_window.set_title('Show system stats')
        self.show_window.set_decorated(False)
        self.show_window.set_keep_above(True)
        self.show_window.set_skip_taskbar_hint(True)
        self.show_window.set_skip_pager_hint(True)
        self.show_window.set_type_hint(Gdk.WindowTypeHint.UTILITY)
        self.show_window.set_resizable(False)
        self.show_window.set_accept_focus(False)
        self.show_window.set_app_paintable(True)
        if visual:
            self.show_window.set_visual(visual)
        self.show_window.get_style_context().add_class('system-stats-window')
        show_button = Gtk.Button()
        show_button.set_image(Gtk.Image.new_from_icon_name('computer-symbolic', Gtk.IconSize.BUTTON))
        show_button.set_tooltip_text('Hiện bảng CPU, Memory, Disk, Ethernet')
        show_button.get_style_context().add_class('system-stats-show-button')
        show_button.connect('clicked', lambda *_: self._show_widget())
        self.show_window.add(show_button)

        self.disk = Gtk.Label(xalign=0)
        self.disk.get_style_context().add_class('system-stats-label')
        outer.pack_start(self.disk, False, False, 0)

        self.ethernet = Gtk.Label(xalign=0)
        self.ethernet.get_style_context().add_class('system-stats-label-secondary')
        outer.pack_start(self.ethernet, False, False, 0)

        self._apply_style()
        self.window.connect('button-press-event', self._drag_window)
        self.window.connect('destroy', lambda *_: Gtk.main_quit())
        self.show_window.connect('destroy', lambda *_: Gtk.main_quit())
        self.window.show_all()
        self.show_window.show_all()
        if self._hidden:
            self.window.hide()
            GLib.idle_add(self._place_show_button)
        else:
            self.show_window.hide()
            GLib.idle_add(self._place_top_right)
        self._refresh()
        GLib.timeout_add_seconds(1, self._refresh)

    def _load_arcmenu_settings(self):
        try:
            data_home = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share'))
            schema_dir = data_home / 'gnome-shell/extensions/arcmenu@arcmenu.com/schemas'
            parent = Gio.SettingsSchemaSource.get_default()
            source = Gio.SettingsSchemaSource.new_from_directory(str(schema_dir), parent, False)
            schema = source.lookup('org.gnome.shell.extensions.arcmenu', False)
            return Gio.Settings.new_full(schema, None, None) if schema else None
        except Exception:
            return None

    def _save_hidden_state(self, hidden):
        try:
            self._visibility_file.parent.mkdir(parents=True, exist_ok=True)
            self._visibility_file.write_text('hidden\n' if hidden else 'visible\n', encoding='utf-8')
        except OSError:
            pass

    def _hide_widget(self):
        self._hidden = True
        self._save_hidden_state(True)
        self.window.hide()
        self.show_window.show_all()
        GLib.idle_add(self._place_show_button)

    def _show_widget(self):
        self._hidden = False
        self._save_hidden_state(False)
        self.show_window.hide()
        self.window.show_all()
        GLib.idle_add(self._place_top_right)

    def _place_show_button(self):
        display = Gdk.Display.get_default()
        monitor = display.get_primary_monitor() if display else None
        if monitor:
            rect = monitor.get_geometry()
            width, _height = self.show_window.get_size()
            self.show_window.move(rect.x + rect.width - width - 20, rect.y + 12)
        return GLib.SOURCE_REMOVE

    def _apply_style(self):
        css = b'''
        .system-stats-window {
            background-color: transparent;
        }
        .system-stats-panel {
            background-color: rgba(24, 27, 36, 0.97);
            border: 1px solid rgba(125, 137, 160, 0.38);
            border-radius: 11px;
            padding: 5px 7px 6px 10px;
        }
        .system-stats-label {
            color: #e7eaf0;
            font-family: sans-serif;
            font-size: 12px;
            font-weight: 700;
        }
        .system-stats-label-bold {
            color: #f2f4f8;
            font-family: sans-serif;
            font-size: 12px;
            font-weight: 700;
        }
        .system-stats-label-secondary {
            color: #dce1ea;
            font-family: sans-serif;
            font-size: 12px;
            font-weight: 700;
        }
        .system-stats-close {
            color: #f1f3f7;
            background: rgba(255,255,255,0.08);
            border: none;
            border-radius: 5px;
            min-width: 21px;
            min-height: 21px;
            padding: 0;
            margin-left: 5px;
            font-size: 16px;
            font-weight: 700;
        }
        .system-stats-close:hover {
            background: rgba(255,255,255,0.18);
        }
        .system-stats-show-button {
            color: #f1f3f7;
            background: rgba(24,27,36,0.97);
            border: 1px solid rgba(125,137,160,0.38);
            border-radius: 7px;
            min-width: 30px;
            min-height: 30px;
            padding: 2px;
        }
        .system-stats-show-button:hover {
            background: rgba(55,60,73,0.98);
        }
        '''
        provider = Gtk.CssProvider()
        provider.load_from_data(css)
        Gtk.StyleContext.add_provider_for_screen(
            Gdk.Screen.get_default(), provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

    def _place_top_right(self):
        display = Gdk.Display.get_default()
        monitor = display.get_primary_monitor() if display else None
        if monitor:
            rect = monitor.get_geometry()
            width, height = self.window.get_size()
            saved = False
            if self._arc_settings:
                try:
                    saved = self._arc_settings.get_boolean('win11-resource-monitor-position-set')
                except Exception:
                    saved = False
            if saved:
                x = self._arc_settings.get_int('win11-resource-monitor-x')
                y = self._arc_settings.get_int('win11-resource-monitor-y')
                x = min(rect.x + rect.width - width - 8, max(rect.x + 8, x))
                y = min(rect.y + rect.height - height - 8, max(rect.y + 8, y))
            else:
                x = rect.x + rect.width - width - 22
                y = rect.y + 22
            self.window.move(x, y)
        return GLib.SOURCE_REMOVE

    def _drag_window(self, _widget, event):
        if event.button == 1:
            self.window.begin_move_drag(
                event.button, int(event.x_root), int(event.y_root), event.time)
            return True
        return False

    def _read_cpu(self):
        line = read_text('/proc/stat').splitlines()
        if not line or not line[0].startswith('cpu '):
            return None
        try:
            values = [int(value) for value in line[0].split()[1:9]]
            if len(values) < 8:
                return None
            return (sum(values), values[3] + values[4])
        except ValueError:
            return None

    def _read_net(self):
        result = {}
        for line in read_text('/proc/net/dev').splitlines()[2:]:
            if ':' not in line:
                continue
            name, values_text = line.split(':', 1)
            name = name.strip()
            if name == 'lo':
                continue
            try:
                values = [int(value) for value in values_text.split()]
                if len(values) >= 9:
                    result[name] = (values[0], values[8])
            except ValueError:
                pass
        return result

    def _default_interface(self, counters):
        for line in read_text('/proc/net/route').splitlines()[1:]:
            fields = line.split()
            if len(fields) > 3 and fields[1] == '00000000':
                try:
                    if int(fields[3], 16) & 1 and fields[0] in counters:
                        return fields[0]
                except ValueError:
                    pass
        for name in counters:
            if read_text(f'/sys/class/net/{name}/operstate').strip() == 'up':
                return name
        return next(iter(counters), None)

    def _refresh(self):
        cpu_now = self._read_cpu()
        cpu_percent = 0
        if cpu_now and self._last_cpu:
            total_delta = cpu_now[0] - self._last_cpu[0]
            idle_delta = cpu_now[1] - self._last_cpu[1]
            if total_delta > 0:
                cpu_percent = max(0, min(100, round(100 * (total_delta - idle_delta) / total_delta)))
        self._last_cpu = cpu_now

        mem = {}
        for line in read_text('/proc/meminfo').splitlines():
            fields = line.split()
            if len(fields) >= 3 and fields[0] in ('MemTotal:', 'MemAvailable:'):
                try:
                    mem[fields[0]] = int(fields[1]) * 1024
                except ValueError:
                    pass
        total_mem = mem.get('MemTotal:', 0)
        used_mem = max(0, total_mem - mem.get('MemAvailable:', total_mem))
        mem_percent = round(used_mem * 100 / total_mem) if total_mem else 0
        self.memory.set_text(
            f'CPU: {cpu_percent}%   •   Memory: {used_mem / GIB:.1f} / {total_mem / GIB:.1f} GB ({mem_percent}%)')

        try:
            stat = os.statvfs('/')
            total_disk = stat.f_blocks * stat.f_frsize
            used_disk = total_disk - stat.f_bfree * stat.f_frsize
            disk_percent = round(used_disk * 100 / total_disk) if total_disk else 0
            self.disk.set_text(
                f'Disk: {used_disk / GIB:.1f} / {total_disk / GIB:.1f} GB ({disk_percent}%)')
        except OSError:
            self.disk.set_text('Disk: unavailable')

        current = self._read_net()
        iface = self._default_interface(current)
        now = GLib.get_monotonic_time()
        elapsed = max(0.1, (now - self._last_time) / 1_000_000)
        if iface and iface in self._last_net:
            previous_rx, previous_tx = self._last_net[iface]
            current_rx, current_tx = current[iface]
            self._rx_rate = max(0, (current_rx - previous_rx) / elapsed)
            self._tx_rate = max(0, (current_tx - previous_tx) / elapsed)
        else:
            self._rx_rate = self._tx_rate = 0
        self._last_net = current
        self._last_time = now
        interface_suffix = f' ({iface})' if iface else ''
        self.ethernet.set_text(
            f'Ethernet{interface_suffix}: ↓ {format_rate(self._rx_rate)}   ↑ {format_rate(self._tx_rate)}')
        return GLib.SOURCE_CONTINUE


if __name__ == '__main__':
    SystemStatsWidget()
    Gtk.main()
