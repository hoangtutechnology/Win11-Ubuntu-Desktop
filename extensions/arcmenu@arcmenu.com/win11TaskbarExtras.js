import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ShellEntry from 'resource:///org/gnome/shell/ui/shellEntry.js';

function normalizeSearchText(value) {
    return String(value ?? '').toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

export const Win11SearchBox = GObject.registerClass({
    GTypeName: 'Win11SearchBox_' + GLib.get_monotonic_time()
}, class Win11SearchBox extends PanelMenu.Button {
    _init(menuController) {
        super._init(0.5, 'Tìm kiếm', true);
        const previousSearchBox = global.__win11SearchBox;
        if (previousSearchBox && previousSearchBox !== this) {
            try { previousSearchBox.destroy(); } catch (_error) {}
        }
        global.__win11SearchBox = this;
        this._menuController = menuController;
        this._modalGrab = null;
        this._selectedResult = null;
        this._activeCategory = 'all';
        this._fileResults = [];
        this._fileSearchTimer = 0;
        this._fileSearchGeneration = 0;
        this._fileSearchProcess = null;
        this._apps = this._loadApps();

        this.add_style_class_name('win11-search-button');
        this.can_focus = false;
        this.track_hover = false;
        this.reactive = true;
        this.accessible_name = 'Tìm kiếm';

        const box = new St.BoxLayout({
            style_class: 'win11-search-box-container',
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });

        this._entry = new St.Entry({
            name: 'win11-search-entry',
            style_class: 'win11-search-entry',
            hint_text: 'Tìm kiếm',
            can_focus: false,
            track_hover: true,
            accessible_name: 'Tìm kiếm',
        });
        ShellEntry.addContextMenu(this._entry);
        if (this._entry.clutter_text)
            this._entry.clutter_text.accessible_name = 'Tìm kiếm';
        this._searchIcon = new St.Icon({
            style_class: 'search-entry-icon',
            icon_name: 'system-search-symbolic',
            icon_size: 16,
            accessible_name: 'Tìm kiếm',
        });
        this._entry.set_primary_icon(this._searchIcon);
        box.add_child(this._entry);
        this.add_child(box);

        this._buildSearchPanel();
        this._entry.connect('button-press-event', () => {
            this._openSearchPanel();
            return Clutter.EVENT_STOP;
        });
        box.connect('button-press-event', () => {
            this._openSearchPanel();
            return Clutter.EVENT_STOP;
        });
        this.connect('button-press-event', () => {
            this._openSearchPanel();
            return Clutter.EVENT_STOP;
        });
    }

    _loadApps() {
        try {
            return Gio.AppInfo.get_all()
                .filter(app => {
                    try {
                        return app.should_show() && Boolean(app.get_name());
                    } catch (error) {
                        return false;
                    }
                })
                .sort((a, b) => a.get_name().localeCompare(b.get_name()));
        } catch (error) {
            console.error('Win11SearchBox: cannot load installed apps:', error);
            return [];
        }
    }

    _buildSearchPanel() {
        this._overlay = new St.Widget({
            name: 'win11-search-overlay',
            style_class: 'win11-search-overlay',
            reactive: true,
            visible: false,
            layout_manager: new Clutter.BinLayout(),
        });
        this._panel = new St.BoxLayout({
            name: 'win11-search-panel',
            style_class: 'win11-search-panel',
            vertical: true,
            reactive: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
            x_expand: false,
            y_expand: false,
        });

        const searchRow = new St.BoxLayout({style_class: 'win11-search-panel-header'});
        const panelIcon = new St.Icon({
            icon_name: 'system-search-symbolic',
            icon_size: 18,
            style_class: 'win11-search-panel-icon',
        });
        this._panelEntry = new St.Entry({
            name: 'win11-search-panel-entry',
            style_class: 'win11-search-panel-entry',
            hint_text: 'Tìm kiếm ứng dụng, tệp hoặc web',
            can_focus: true,
            accessible_name: 'Tìm kiếm ứng dụng, tệp hoặc web',
        });
        this._panelEntry.set_primary_icon(panelIcon);
        ShellEntry.addContextMenu(this._panelEntry);
        searchRow.add_child(this._panelEntry);
        this._panel.add_child(searchRow);

        const tabs = new St.BoxLayout({style_class: 'win11-search-tabs'});
        this._categoryButtons = new Map();
        for (const [category, label] of [
            ['all', 'Tất cả'], ['apps', 'Ứng dụng'], ['files', 'Tệp'], ['web', 'Web'],
        ]) {
            const tab = new St.Button({
                label,
                style_class: 'win11-search-tab-button',
                can_focus: true,
                reactive: true,
                accessible_name: `Tìm ${label.toLowerCase()}`,
            });
            this._categoryButtons.set(category, tab);
            tab.connect('clicked', () => this._setSearchCategory(category));
            tabs.add_child(tab);
        }
        this._updateCategoryButtons();
        this._panel.add_child(tabs);

        const body = new St.BoxLayout({
            style_class: 'win11-search-panel-body',
            x_expand: true,
            y_expand: true,
        });
        const resultSide = new St.BoxLayout({
            style_class: 'win11-search-result-side',
            vertical: true,
            x_expand: true,
            y_expand: true,
        });
        this._resultHeading = new St.Label({
            text: 'Ứng dụng',
            style_class: 'win11-search-section-title',
            x_align: Clutter.ActorAlign.START,
        });
        resultSide.add_child(this._resultHeading);
        this._results = new St.BoxLayout({
            style_class: 'win11-search-results',
            vertical: true,
            x_expand: true,
        });
        resultSide.add_child(this._results);
        this._status = new St.Label({
            text: '',
            style_class: 'win11-search-status',
            x_align: Clutter.ActorAlign.START,
        });
        resultSide.add_child(this._status);
        body.add_child(resultSide);

        this._details = new St.BoxLayout({
            style_class: 'win11-search-details',
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._detailIcon = new St.Icon({
            icon_size: 80,
            style_class: 'win11-search-detail-icon',
        });
        this._detailName = new St.Label({
            text: 'Bắt đầu tìm kiếm',
            style_class: 'win11-search-detail-name',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._detailDescription = new St.Label({
            text: 'Ứng dụng phù hợp sẽ xuất hiện tại đây',
            style_class: 'win11-search-detail-description',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._openButton = new St.Button({
            label: 'Mở',
            style_class: 'win11-search-open-button',
            can_focus: true,
            reactive: true,
        });
        this._openButton.connect('clicked', () => this._launchSelectedResult());
        this._details.add_child(this._detailIcon);
        this._details.add_child(this._detailName);
        this._details.add_child(this._detailDescription);
        this._details.add_child(this._openButton);
        body.add_child(this._details);
        this._panel.add_child(body);

        this._overlay.add_child(this._panel);
        Main.layoutManager.addChrome(this._overlay, {affectsStruts: false});
        this._updatePanelGeometry();
        global.stage.connectObject('notify::allocation', () => this._updatePanelGeometry(), this);
        this._monitorSignal = Main.layoutManager.connect('monitors-changed', () => this._updatePanelGeometry());

        this._panelEntry.clutter_text.connect('text-changed', () => {
            const query = this._panelEntry.get_text();
            this._entry.set_text(query);
            this._scheduleFileSearch(query);
            this._renderResults(query);
        });
        this._panelEntry.clutter_text.connect('activate', () => this._launchSelectedResult());
        this._panelEntry.connect('captured-event', (actor, event) => {
            if (event.type() === Clutter.EventType.KEY_PRESS &&
                event.get_key_symbol() === Clutter.KEY_Escape) {
                this._closeSearchPanel();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._overlay.connect('captured-event', (actor, event) => {
            if (event.type() === Clutter.EventType.KEY_PRESS &&
                event.get_key_symbol() === Clutter.KEY_Escape) {
                this._closeSearchPanel();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._overlay.connect('button-press-event', (actor, event) => {
            const [x, y] = event.get_coords();
            const [panelX, panelY] = this._panel.get_transformed_position();
            const [panelW, panelH] = this._panel.get_transformed_size();
            if (x < panelX || x > panelX + panelW || y < panelY || y > panelY + panelH) {
                this._closeSearchPanel();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _setSearchCategory(category) {
        this._activeCategory = category;
        this._updateCategoryButtons();
        if (category === 'all' || category === 'files')
            this._scheduleFileSearch(this._panelEntry.get_text());
        else
            this._cancelFileSearch();
        this._renderResults(this._panelEntry.get_text());
    }

    _updateCategoryButtons() {
        for (const [category, button] of this._categoryButtons ?? []) {
            button.set_style_class_name(category === this._activeCategory
                ? 'win11-search-tab-button selected'
                : 'win11-search-tab-button');
        }
    }

    _scheduleFileSearch(query) {
        this._fileSearchGeneration++;
        const generation = this._fileSearchGeneration;
        if (this._fileSearchTimer) {
            GLib.Source.remove(this._fileSearchTimer);
            this._fileSearchTimer = 0;
        }
        if (this._fileSearchProcess) {
            try { this._fileSearchProcess.force_exit(); } catch (_error) {}
            this._fileSearchProcess = null;
        }
        this._fileResults = [];

        const trimmedQuery = query.trim();
        if (!trimmedQuery || !GLib.find_program_in_path('localsearch') ||
            !['all', 'files'].includes(this._activeCategory))
            return;

        this._fileSearchTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._fileSearchTimer = 0;
            if (generation !== this._fileSearchGeneration)
                return GLib.SOURCE_REMOVE;

            try {
                const process = Gio.Subprocess.new([
                    'localsearch', 'search', '--files', '--limit=8', trimmedQuery,
                ], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
                this._fileSearchProcess = process;
                process.communicate_utf8_async(null, null, (subprocess, result) => {
                    try {
                        const [ok, stdout] = subprocess.communicate_utf8_finish(result);
                        if (generation !== this._fileSearchGeneration)
                            return;
                        this._fileSearchProcess = null;
                        this._fileResults = ok
                            ? String(stdout ?? '').split(/\r?\n/)
                                .map(line => line.trim())
                                .filter(line => line.startsWith('file://'))
                                .slice(0, 8)
                            : [];
                        this._renderResults(this._panelEntry.get_text());
                    } catch (error) {
                        if (generation === this._fileSearchGeneration) {
                            this._fileSearchProcess = null;
                            console.error('Win11SearchBox: local file search failed:', error);
                            this._renderResults(this._panelEntry.get_text());
                        }
                    }
                });
            } catch (error) {
                console.error('Win11SearchBox: cannot start local file search:', error);
                this._fileSearchProcess = null;
                this._renderResults(this._panelEntry.get_text());
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelFileSearch() {
        this._fileSearchGeneration++;
        if (this._fileSearchTimer) {
            GLib.Source.remove(this._fileSearchTimer);
            this._fileSearchTimer = 0;
        }
        if (this._fileSearchProcess) {
            try { this._fileSearchProcess.force_exit(); } catch (_error) {}
            this._fileSearchProcess = null;
        }
        this._fileResults = [];
    }

    _updatePanelGeometry() {
        if (!this._overlay || !global.stage)
            return;
        const stageWidth = global.stage.width;
        const stageHeight = global.stage.height;
        const [anchorX, anchorY] = this.get_transformed_position();
        const monitors = Main.layoutManager.monitors ?? [];
        const monitor = monitors.find(item =>
            anchorX >= item.x && anchorX < item.x + item.width &&
            anchorY >= item.y && anchorY < item.y + item.height) ??
            Main.layoutManager.primaryMonitor;
        const bounds = monitor && Number.isFinite(monitor.width) && Number.isFinite(monitor.height)
            ? monitor
            : {x: 0, y: 0, width: stageWidth, height: stageHeight};
        const panelWidth = Math.max(320, Math.min(860, bounds.width - 32));
        const panelHeight = Math.max(240, Math.min(860, bounds.height - 80));
        const minX = bounds.x + 16;
        const maxX = Math.max(minX, bounds.x + bounds.width - panelWidth - 16);
        const panelX = Math.min(maxX, Math.max(minX, anchorX - 8));
        this._overlay.set_position(0, 0);
        this._overlay.set_size(stageWidth, stageHeight);
        this._panel.set_size(panelWidth, panelHeight);
        // Keep the search surface at the upper-left, aligned with the taskbar
        // search button like Windows, instead of floating in the screen center.
        this._panel.set_position(Math.round(panelX), Math.round(bounds.y + 16));
    }

    _openSearchPanel() {
        if (this._overlay.visible) {
            this._panelEntry.clutter_text.grab_key_focus();
            return;
        }
        this._apps = this._loadApps();
        this._panelEntry.set_text(this._entry.get_text());
        this._renderResults(this._panelEntry.get_text());
        this._updatePanelGeometry();
        this._overlay.show();
        try {
            this._modalGrab = Main.pushModal(this._overlay, {
                actionMode: Shell.ActionMode.NORMAL,
            });
        } catch (error) {
            console.error('Win11SearchBox: cannot grab search panel:', error);
        }
        this._panelEntry.clutter_text.grab_key_focus();
        this._entry.add_style_pseudo_class('focus');
    }

    _closeSearchPanel() {
        if (!this._overlay?.visible)
            return;
        if (this._modalGrab) {
            try {
                Main.popModal(this._modalGrab);
            } catch (error) {
                console.error('Win11SearchBox: cannot release search panel:', error);
            }
            this._modalGrab = null;
        }
        this._overlay.hide();
        this._cancelFileSearch();
        this._panelEntry.set_text('');
        this._entry.set_text('');
        this._entry.remove_style_pseudo_class('focus');
        if (global.stage.get_key_focus() === this._panelEntry.clutter_text)
            global.stage.set_key_focus(null);
    }

    _renderResults(query) {
        while (this._results.get_n_children() > 0)
            this._results.get_first_child().destroy();

        const normalized = normalizeSearchText(query.trim());
        const matchingApps = normalized
            ? this._apps.map(app => {
                const name = app.get_display_name() || app.get_name() || '';
                const description = app.get_description() || '';
                const searchable = normalizeSearchText([
                    name,
                    app.get_name(),
                    app.get_executable(),
                    app.get_id(),
                    description,
                ].join(' '));
                const score = searchable.startsWith(normalized) ? 0 :
                    normalizeSearchText(name).includes(normalized) ? 1 : 2;
                return {app, name, description, searchable, score};
            }).filter(item => item.searchable.includes(normalized))
                .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
                .slice(0, 8)
            : this._apps.slice(0, 8).map(app => ({
                app,
                name: app.get_display_name() || app.get_name() || '',
                description: app.get_description() || '',
            }));

        const matchingFiles = normalized
            ? this._fileResults.map(uri => {
                const file = Gio.File.new_for_uri(uri);
                return {
                    type: 'file',
                    uri,
                    name: file.get_basename() || uri,
                    description: file.get_parent()?.get_parse_name() || 'Tệp trên máy tính',
                };
            })
            : [];
        const appResults = matchingApps.map(item => ({type: 'app', ...item}));
        const webResult = normalized ? [{
            type: 'web',
            name: `Tìm “${query.trim()}” trên web`,
            description: 'Mở kết quả bằng trình duyệt mặc định',
            query: query.trim(),
        }] : [];

        let visibleResults = [];
        switch (this._activeCategory) {
        case 'apps':
            visibleResults = appResults;
            this._resultHeading.set_text(normalized ? 'Ứng dụng phù hợp' : 'Ứng dụng');
            break;
        case 'files':
            visibleResults = matchingFiles;
            this._resultHeading.set_text('Tệp đã được lập chỉ mục');
            break;
        case 'web':
            visibleResults = webResult;
            this._resultHeading.set_text('Tìm kiếm trên web');
            break;
        default:
            visibleResults = [...appResults, ...matchingFiles].slice(0, 8);
            this._resultHeading.set_text(normalized ? 'Kết quả phù hợp nhất' : 'Ứng dụng');
            break;
        }

        if (!normalized && this._activeCategory === 'files')
            this._status.set_text('Nhập tên tệp để tìm trong nội dung đã lập chỉ mục');
        else if (!normalized && this._activeCategory === 'web')
            this._status.set_text('Nhập từ khóa để tìm trên web khi bạn chọn kết quả');
        else if (normalized && this._activeCategory === 'files' &&
            !GLib.find_program_in_path('localsearch'))
            this._status.set_text('Tìm tệp yêu cầu GNOME LocalSearch; không bật lập chỉ mục mới');
        else if (normalized && this._activeCategory === 'files' && !this._fileResults.length)
            this._status.set_text('Không tìm thấy tệp đã được lập chỉ mục');
        else if (normalized)
            this._status.set_text(`${visibleResults.length} kết quả`);
        else
            this._status.set_text('Nhập tên ứng dụng để tìm kiếm');

        if (visibleResults.length === 0) {
            this._selectedResult = null;
            this._detailIcon.gicon = null;
            this._detailIcon.icon_name = null;
            this._detailName.set_text(normalized ? 'Không tìm thấy kết quả' : 'Bắt đầu tìm kiếm');
            this._detailDescription.set_text(this._activeCategory === 'files'
                ? 'Chỉ tìm trong các thư mục đã được lập chỉ mục'
                : 'Thử từ khóa khác hoặc chọn mục Web');
            this._openButton.reactive = false;
            this._openButton.opacity = 128;
            return;
        }

        this._openButton.reactive = true;
        this._openButton.opacity = 255;
        for (const item of visibleResults) {
            const result = new St.Button({
                style_class: 'win11-search-result',
                can_focus: true,
                reactive: true,
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL,
            });
            const row = new St.BoxLayout({
                style_class: 'win11-search-result-row',
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL,
            });
            const icon = item.type === 'app'
                ? new St.Icon({
                    gicon: item.app.get_icon(),
                    icon_size: 32,
                    style_class: 'win11-search-result-icon',
                })
                : new St.Icon({
                    icon_name: item.type === 'file' ? 'text-x-generic-symbolic' : 'web-browser-symbolic',
                    icon_size: 32,
                    style_class: 'win11-search-result-icon',
                });
            const labels = new St.BoxLayout({
                vertical: true,
                style_class: 'win11-search-result-labels',
                x_expand: true,
            });
            labels.add_child(new St.Label({
                text: item.name,
                style_class: 'win11-search-result-name',
                x_align: Clutter.ActorAlign.START,
            }));
            if (item.description) {
                labels.add_child(new St.Label({
                    text: item.description,
                    style_class: 'win11-search-result-description',
                    x_align: Clutter.ActorAlign.START,
                }));
            }
            row.add_child(icon);
            row.add_child(labels);
            result.set_child(row);
            result.connect('clicked', () => this._selectResult(item));
            this._results.add_child(result);
        }
        this._selectResult(visibleResults[0]);
    }

    _selectResult(item) {
        this._selectedResult = item;
        if (item.type === 'app') {
            this._detailIcon.icon_name = null;
            this._detailIcon.gicon = item.app.get_icon();
        } else {
            this._detailIcon.gicon = null;
            this._detailIcon.icon_name = item.type === 'file'
                ? 'text-x-generic-symbolic'
                : 'web-browser-symbolic';
        }
        this._detailName.set_text(item.type === 'app'
            ? item.app.get_display_name() || item.app.get_name() || 'Ứng dụng'
            : item.name);
        this._detailDescription.set_text(item.description || 'Ứng dụng trên máy tính');
    }

    _launchSelectedResult() {
        if (!this._selectedResult)
            return;
        const item = this._selectedResult;
        this._closeSearchPanel();
        try {
            if (item.type === 'app') {
                item.app.launch([], global.create_app_launch_context(global.get_current_time(), -1));
            } else if (item.type === 'file') {
                Gio.AppInfo.launch_default_for_uri(item.uri,
                    global.create_app_launch_context(global.get_current_time(), -1));
            } else if (item.type === 'web') {
                const encodedQuery = encodeURIComponent(item.query);
                Gio.AppInfo.launch_default_for_uri(`https://www.bing.com/search?q=${encodedQuery}`,
                    global.create_app_launch_context(global.get_current_time(), -1));
            }
        } catch (error) {
            console.error('Win11SearchBox: cannot open selected search result:', error);
        }
    }

    destroy() {
        this._closeSearchPanel();
        const panel = this._menuController?.panel;
        if (panel?.statusArea?.ArcMenuSearch === this)
            panel.statusArea.ArcMenuSearch = null;
        if (global.__win11SearchBox === this)
            delete global.__win11SearchBox;
        if (this._overlay) {
            global.stage.disconnectObject(this);
            if (this._monitorSignal) {
                Main.layoutManager.disconnect(this._monitorSignal);
                this._monitorSignal = 0;
            }
            Main.layoutManager.removeChrome(this._overlay);
            this._overlay.destroy();
            this._overlay = null;
        }
        super.destroy();
    }
});

export const Win11TaskViewButton = GObject.registerClass({
    GTypeName: 'Win11TaskViewButton_' + GLib.get_monotonic_time()
}, class Win11TaskViewButton extends PanelMenu.Button {
    _init(menuController) {
        super._init(0.5, 'Chế độ xem tác vụ', true);
        this._menuController = menuController;
        this.add_style_class_name('win11-task-view-button');
        this.accessible_name = 'Chế độ xem tác vụ';
        this.set({x_expand: false, y_expand: false});

        const icon = new St.Icon({
            icon_name: 'windows-task-view',
            icon_size: 20,
            style_class: 'win11-task-view-icon',
            accessible_name: 'Chế độ xem tác vụ',
        });
        this.add_child(icon);
        this.connect('button-press-event', () => {
            if (Main.overview.visible)
                Main.overview.hide();
            else
                Main.overview.show();
            return Clutter.EVENT_STOP;
        });
    }
});

export const Win11TrayOverflowButton = GObject.registerClass({
    GTypeName: 'Win11TrayOverflowButton_' + GLib.get_monotonic_time()
}, class Win11TrayOverflowButton extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Biểu tượng ứng dụng nền', false);
        this.add_style_class_name('win11-tray-overflow-button');
        this.accessible_name = 'Biểu tượng ứng dụng nền';
        this._hiddenIndicators = new Map();
        this._entryIds = [];

        const icon = new St.Icon({
            icon_name: 'pan-down-symbolic',
            icon_size: 16,
            style_class: 'win11-tray-overflow-icon',
        });
        this.add_child(icon);
        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            icon.icon_name = isOpen ? 'pan-up-symbolic' : 'pan-down-symbolic';
        });

        this._refreshIndicators();
        this._refreshTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 8, () => {
            this._refreshIndicators();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _getIndicators() {
        const statusArea = Main.panel?.statusArea ?? {};
        return Object.entries(statusArea)
            .filter(([name, indicator]) => name.startsWith('appindicator-') &&
                indicator?.visible && indicator?.container && indicator?.menu)
            .sort(([nameA], [nameB]) => nameA.localeCompare(nameB));
    }

    _refreshIndicators() {
        const indicators = this._getIndicators();
        const ids = indicators.map(([name]) => name);
        if (ids.join('\n') === this._entryIds.join('\n'))
            return;

        const activeIds = new Set(ids);
        for (const [name, indicator] of this._hiddenIndicators) {
            if (!activeIds.has(name)) {
                try {
                    const currentIndicator = Main.panel?.statusArea?.[name];
                    if (currentIndicator === indicator && currentIndicator.container)
                        currentIndicator.container.visible = currentIndicator.visible;
                } catch (_error) {
                    // Indicators may be destroyed between tray refreshes.
                }
            }
        }

        this.menu.removeAll();
        this._hiddenIndicators.clear();
        this._entryIds = ids;

        for (const [name, indicator] of indicators) {
            const row = new PopupMenu.PopupBaseMenuItem();
            const sourceIcon = indicator._icon ?? indicator.icon;
            if (sourceIcon) {
                const iconBox = new St.Widget({
                    style_class: 'win11-tray-overflow-item-icon',
                    layout_manager: new Clutter.BinLayout(),
                    width: 18,
                    height: 18,
                });
                iconBox.add_child(new Clutter.Clone({source: sourceIcon, width: 18, height: 18}));
                row.add_child(iconBox);
            }

            const labelText = indicator.accessible_name ||
                indicator._indicator?.id || 'Ứng dụng nền';
            row.add_child(new St.Label({text: labelText, x_expand: true}));
            row.connect('activate', () => this._openIndicatorMenu(indicator));
            this.menu.addMenuItem(row);

            this._hiddenIndicators.set(name, indicator);
            indicator.container.hide();
        }
    }

    _openIndicatorMenu(indicator) {
        try {
            if (!indicator?.menu || !indicator.container)
                return;

            this.menu.close();
            indicator.container.show();
            let closeId = 0;
            closeId = indicator.menu.connect('open-state-changed', (_menu, isOpen) => {
                if (isOpen)
                    return;
                indicator.menu.disconnect(closeId);
                if (indicator.container)
                    indicator.container.hide();
            });
            indicator.menu.open();
        } catch (error) {
            console.warn(`Win11 tray overflow: cannot open indicator menu: ${error.message}`);
        }
    }

    destroy() {
        if (this._refreshTimer) {
            GLib.Source.remove(this._refreshTimer);
            this._refreshTimer = 0;
        }
        for (const [name, indicator] of this._hiddenIndicators) {
            try {
                const currentIndicator = Main.panel?.statusArea?.[name];
                if (currentIndicator === indicator && currentIndicator.container)
                    currentIndicator.container.visible = currentIndicator.visible;
            } catch (_error) {
                // The owning indicator may already be disposed.
            }
        }
        this._hiddenIndicators.clear();
        super.destroy();
    }
});

export const Win11ResourceMonitor = GObject.registerClass({
    GTypeName: 'Win11ResourceMonitor_' + GLib.get_monotonic_time()
}, class Win11ResourceMonitor extends St.BoxLayout {
    _init(settings) {
        super._init({style_class: 'win11-resource-monitor', reactive: true});
        this._previousCpu = null;
        this._diskUsage = null;
        this._lastDiskRead = 0;
        this._monitorWidth = 332;
        this._monitorHeight = 56;
        this._settings = settings;
        if (!this._settings)
            throw new Error('ArcMenu settings are required for the resource monitor');
        this._settingsSignal = this._settings.connect(
            'changed::win11-resource-monitor-visible', () => this._syncVisibility());
        this._dragSignal = 0;
        this._dragOrigin = null;
        this._sampleTimer = 0;

        this._label = new St.Label({
            text: 'CPU: đang đo…  ·  RAM: đang đọc…\nỔ đĩa: đang đọc…',
            style_class: 'win11-resource-label',
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._label);
        this._hideButton = new St.Button({
            style_class: 'win11-resource-hide-button',
            can_focus: true,
            reactive: true,
            track_hover: true,
            accessible_name: 'Ẩn tài nguyên hệ thống',
            child: new St.Icon({icon_name: 'window-close-symbolic', icon_size: 12}),
        });
        this._hideButton.connect('clicked', () =>
            this._settings.set_boolean('win11-resource-monitor-visible', false));
        this._hideButton.connect('button-press-event', (_button, event) => {
            if (event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;

            this._settings.set_boolean('win11-resource-monitor-visible', false);
            return Clutter.EVENT_STOP;
        });
        this.add_child(this._hideButton);
        this.accessible_name = 'Mức sử dụng tài nguyên hệ thống';

        this._showButton = new St.Button({
            style_class: 'win11-resource-show-button',
            can_focus: true,
            accessible_name: 'Hiện mức sử dụng tài nguyên hệ thống',
            child: new St.Icon({
                icon_name: 'computer-symbolic',
                icon_size: 17,
                style_class: 'win11-resource-show-icon',
            }),
        });
        this._showButton.connect('clicked', () =>
            this._settings.set_boolean('win11-resource-monitor-visible', true));
        Main.layoutManager.addChrome(this._showButton, {trackFullscreen: false});

        // Read RAM and disk immediately so their values are visible even if
        // shell chrome positioning is still waiting for monitor allocation.
        this._sample();
        // GNOME Shell 50 removed the affectsInputRegion chrome option. Passing
        // it throws during construction, leaving the widget at its default
        // top-left position and preventing its sampling timers from starting.
        Main.layoutManager.addChrome(this, {trackFullscreen: false});
        this.set_size(this._monitorWidth, this._monitorHeight);
        this._restorePosition();
        this._positionShowButton();
        this._syncVisibility();
        this.connect('button-press-event', (_actor, event) => this._beginDrag(event));
        this._positionTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            if (this._restorePosition()) {
                this._positionShowButton();
                this._positionTimer = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        this._monitorSignal = Main.layoutManager.connect('monitors-changed', () => {
            this._restorePosition();
            this._positionShowButton();
        });
        Main.overview.connectObject('showing', () => this._syncVisibility(), this);
        Main.overview.connectObject('hiding', () => this._syncVisibility(), this);

    }

    _monitorAt(x, y) {
        const monitors = Main.layoutManager.monitors ?? [];
        return monitors.find(monitor => x >= monitor.x && x < monitor.x + monitor.width &&
            y >= monitor.y && y < monitor.y + monitor.height) ??
            Main.layoutManager.primaryMonitor ?? monitors[0] ?? null;
    }

    _restorePosition() {
        const monitor = Main.layoutManager.primaryMonitor ?? Main.layoutManager.monitors?.[0];
        if (!monitor || !Number.isFinite(monitor.width) || monitor.width <= 0)
            return false;

        this.set_size(this._monitorWidth, this._monitorHeight);
        if (this._settings.get_boolean('win11-resource-monitor-position-set')) {
            this._placeAt(
                this._settings.get_int('win11-resource-monitor-x'),
                this._settings.get_int('win11-resource-monitor-y'));
        } else {
            this._placeAt(monitor.x + monitor.width - this._monitorWidth - 12, monitor.y + 12);
        }
        return true;
    }

    _placeAt(x, y) {
        const monitor = this._monitorAt(x + this._monitorWidth / 2, y + this._monitorHeight / 2);
        if (!monitor)
            return;
        const minX = monitor.x + 8;
        const minY = monitor.y + 8;
        const maxX = Math.max(minX, monitor.x + monitor.width - this._monitorWidth - 8);
        const maxY = Math.max(minY, monitor.y + monitor.height - this._monitorHeight - 8);
        this.set_position(
            Math.round(Math.min(maxX, Math.max(minX, x))),
            Math.round(Math.min(maxY, Math.max(minY, y))));
    }

    _savePosition() {
        const [x, y] = this.get_position();
        this._settings.set_int('win11-resource-monitor-x', Math.round(x));
        this._settings.set_int('win11-resource-monitor-y', Math.round(y));
        this._settings.set_boolean('win11-resource-monitor-position-set', true);
    }

    _positionShowButton() {
        const monitor = Main.layoutManager.primaryMonitor ?? Main.layoutManager.monitors?.[0];
        if (!monitor)
            return;
        this._showButton.set_position(
            Math.round(monitor.x + monitor.width - 44),
            Math.round(monitor.y + 12));
    }

    _syncVisibility() {
        if (!this._showButton)
            return;
        const visible = this._settings.get_boolean('win11-resource-monitor-visible');
        const overviewVisible = Main.overview.visible;
        const shouldSample = visible && !overviewVisible;
        this.visible = shouldSample;
        this._showButton.visible = !visible && !overviewVisible;

        if (shouldSample && !this._sampleTimer) {
            this._sample();
            this._sampleTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
                this._sample();
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!shouldSample && this._sampleTimer) {
            GLib.Source.remove(this._sampleTimer);
            this._sampleTimer = 0;
        }
    }

    _beginDrag(event) {
        if (event.get_button() !== 1)
            return Clutter.EVENT_PROPAGATE;

        const [pointerX, pointerY] = event.get_coords();
        const [hideX, hideY] = this._hideButton.get_transformed_position();
        const [hideWidth, hideHeight] = this._hideButton.get_transformed_size();
        if (pointerX >= hideX && pointerX <= hideX + hideWidth &&
            pointerY >= hideY && pointerY <= hideY + hideHeight) {
            // The panel's drag handler can receive the event before St.Button
            // on some GNOME Shell builds. Handle the close hit-area directly.
            this._settings.set_boolean('win11-resource-monitor-visible', false);
            return Clutter.EVENT_STOP;
        }

        let source = event.get_source();
        while (source && source !== this) {
            if (source === this._hideButton)
                return Clutter.EVENT_PROPAGATE;
            source = source.get_parent?.();
        }

        const [actorX, actorY] = this.get_position();
        this._dragOrigin = {pointerX, pointerY, actorX, actorY};
        if (this._dragSignal)
            global.stage.disconnect(this._dragSignal);
        this._dragSignal = global.stage.connect('captured-event', (_stage, dragEvent) => {
            const type = dragEvent.type();
            if (type === Clutter.EventType.MOTION) {
                const [nextX, nextY] = dragEvent.get_coords();
                this._placeAt(
                    this._dragOrigin.actorX + nextX - this._dragOrigin.pointerX,
                    this._dragOrigin.actorY + nextY - this._dragOrigin.pointerY);
                return Clutter.EVENT_STOP;
            }
            if (type === Clutter.EventType.BUTTON_RELEASE && dragEvent.get_button() === 1) {
                global.stage.disconnect(this._dragSignal);
                this._dragSignal = 0;
                this._dragOrigin = null;
                this._savePosition();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        return Clutter.EVENT_STOP;
    }

    _stopDrag() {
        if (!this._dragSignal)
            return;
        global.stage.disconnect(this._dragSignal);
        this._dragSignal = 0;
        this._dragOrigin = null;
        this._savePosition();
    }

    _readProcFile(path) {
        try {
            const [, bytes] = GLib.file_get_contents(path);
            return new TextDecoder().decode(bytes);
        } catch (_error) {
            return '';
        }
    }

    _sampleCpu() {
        const line = this._readProcFile('/proc/stat').split('\n').find(value => value.startsWith('cpu '));
        if (!line)
            return null;
        const values = line.trim().split(/\s+/).slice(1).map(Number);
        const total = values.reduce((sum, value) => sum + value, 0);
        const idle = (values[3] ?? 0) + (values[4] ?? 0);
        const current = {total, idle};
        const previous = this._previousCpu;
        this._previousCpu = current;
        if (!previous || current.total <= previous.total)
            return null;
        return Math.max(0, Math.min(100,
            Math.round(100 * (1 - (current.idle - previous.idle) / (current.total - previous.total)))));
    }

    _sampleMemory() {
        const data = this._readProcFile('/proc/meminfo');
        const totalKiB = Number(data.match(/^MemTotal:\s+(\d+)/m)?.[1]);
        const availableKiB = Number(data.match(/^MemAvailable:\s+(\d+)/m)?.[1]);
        if (!totalKiB || !Number.isFinite(availableKiB))
            return null;
        const usedGiB = (totalKiB - availableKiB) / 1024 / 1024;
        const totalGiB = totalKiB / 1024 / 1024;
        return {
            usedGiB,
            totalGiB,
            percent: Math.round(100 * (totalKiB - availableKiB) / totalKiB),
        };
    }

    _sampleDisk() {
        const now = GLib.get_monotonic_time() / 1000000;
        if (this._diskUsage !== null && now - this._lastDiskRead < 60)
            return this._diskUsage;
        this._lastDiskRead = now;
        try {
            const info = Gio.File.new_for_path(GLib.get_home_dir())
                .query_filesystem_info('filesystem::size,filesystem::free', null);
            const total = info.get_attribute_uint64('filesystem::size');
            const free = info.get_attribute_uint64('filesystem::free');
            this._diskUsage = total > 0 ? {
                usedGiB: (total - free) / 1024 ** 3,
                totalGiB: total / 1024 ** 3,
                percent: Math.round(100 * (total - free) / total),
            } : null;
        } catch (_error) {
            this._diskUsage = null;
        }
        return this._diskUsage;
    }

    _sample() {
        try {
            const cpu = this._sampleCpu();
            const memory = this._sampleMemory();
            const disk = this._sampleDisk();
            const cpuText = cpu === null ? 'đang đo' : `${cpu}%`;
            const memoryText = memory
                ? `${memory.usedGiB.toFixed(1)} / ${memory.totalGiB.toFixed(1)} GB (${memory.percent}%)`
                : 'không khả dụng';
            const diskText = disk
                ? `${disk.usedGiB.toFixed(1)} / ${disk.totalGiB.toFixed(1)} GB (${disk.percent}%)`
                : 'không khả dụng';

            this._label.set_text(`CPU: ${cpuText}  ·  RAM: ${memoryText}\nỔ đĩa: ${diskText}`);
            this.accessible_name = `CPU ${cpuText}; RAM ${memoryText}; Ổ đĩa ${diskText}`;
        } catch (error) {
            console.error('Win11ResourceMonitor: cannot update resource readings:', error);
            this._label.set_text('Không thể đọc thông tin tài nguyên');
        }
    }

    destroy() {
        this._stopDrag();
        if (this._positionTimer) {
            GLib.Source.remove(this._positionTimer);
            this._positionTimer = 0;
        }
        if (this._sampleTimer) {
            GLib.Source.remove(this._sampleTimer);
            this._sampleTimer = 0;
        }
        if (this._monitorSignal) {
            Main.layoutManager.disconnect(this._monitorSignal);
            this._monitorSignal = 0;
        }
        if (this._settingsSignal) {
            this._settings.disconnect(this._settingsSignal);
            this._settingsSignal = 0;
        }
        Main.overview.disconnectObject(this);
        Main.layoutManager.removeChrome(this._showButton);
        this._showButton?.destroy();
        Main.layoutManager.removeChrome(this);
        super.destroy();
    }
});
