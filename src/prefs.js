import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Adw from 'gi://Adw';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {serializeSettings, applySettings} from './settingsio.js';

class PrefsWindow {
  constructor(window, extension) {
    this._window = window;
    this._metadata = extension.metadata;
    this._settings = extension.getSettings();
    this._handlerIds = [];
    window.connect('close-request', () => {
      for (const id of this._handlerIds)
        this._settings.disconnect(id);
      this._handlerIds = [];
      return false;
    });
  }

  create_page(title, icon) {
    let page = new Adw.PreferencesPage({
      title: title,
      icon_name: icon,
    });
    this._window.add(page);
    return page;
  }

  create_group(page, title) {
    const group = new Adw.PreferencesGroup();
    if (title !== undefined)
      group.title = title;
    page.add(group);
    return group;
  }

  _append(container, row) {
    if (container instanceof Adw.ExpanderRow)
      container.add_row(row);
    else
      container.add(row);
  }

  _watch(key, callback) {
    this._handlerIds.push(this._settings.connect(`changed::${key}`, callback));
    callback();
  }

  switchRow(group, key, title) {
    const row = new Adw.SwitchRow({title: _(title)});
    this._settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    this._append(group, row);
    return row;
  }

  spinRow(group, key, title, min, max, step) {
    const row = new Adw.SpinRow({
      title: _(title),
      adjustment: new Gtk.Adjustment({
        lower: min,
        upper: max,
        step_increment: step,
        page_increment: step * 5,
      }),
    });
    this._settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    this._append(group, row);
    return row;
  }

  scaleRow(group, key, title, subtitle, min, max, step) {
    const scale = new Gtk.Scale({
      adjustment: new Gtk.Adjustment({
        lower: min,
        upper: max,
        step_increment: step,
        page_increment: step * 5,
      }),
      digits: 0,
      draw_value: true,
      hexpand: true,
      width_request: 180,
      valign: Gtk.Align.CENTER,
    });
    const row = new Adw.ActionRow({title: _(title), subtitle: _(subtitle)});
    this._watch(key, () => {
      const value = this._settings.get_int(key);
      if (scale.get_value() !== value)
        scale.set_value(value);
    });
    scale.connect('value-changed', widget => {
      const value = Math.round(widget.get_value());
      if (this._settings.get_int(key) !== value)
        this._settings.set_int(key, value);
    });
    row.add_suffix(scale);
    row.activatable_widget = scale;
    this._append(group, row);
    return row;
  }

  choiceRow(group, key, title, choices) {
    const values = choices.map(c => c[0]);
    const row = new Adw.ComboRow({
      title: _(title),
      model: Gtk.StringList.new(choices.map(c => _(c[1]))),
    });
    this._watch(key, () => {
      const index = values.indexOf(this._settings.get_string(key));
      if (index >= 0 && row.selected !== index)
        row.selected = index;
    });
    row.connect('notify::selected', () => {
      const value = values[row.selected];
      if (value !== undefined && this._settings.get_string(key) !== value)
        this._settings.set_string(key, value);
    });
    this._append(group, row);
    return row;
  }

  colorRow(group, key, title) {
    const button = new Gtk.ColorButton({use_alpha: true, valign: Gtk.Align.CENTER});
    const row = new Adw.ActionRow({title: _(title)});
    this._watch(key, () => {
      const rgba = new Gdk.RGBA();
      if (rgba.parse(this._settings.get_string(key)))
        button.rgba = rgba;
    });
    button.connect('color-set', widget => {
      this._settings.set_string(key, widget.get_rgba().to_string());
    });
    row.add_suffix(button);
    row.activatable_widget = button;
    this._append(group, row);
    return row;
  }

  glowRow(group) {
    const expander = new Adw.ExpanderRow({
      title: _('Glow (experimental)'),
      show_enable_switch: true,
      expanded: this._settings.get_boolean('glow-color-expanded'),
    });
    this._settings.bind('glow-effect', expander, 'enable-expansion', Gio.SettingsBindFlags.DEFAULT);
    this._settings.bind('glow-color-expanded', expander, 'expanded', Gio.SettingsBindFlags.DEFAULT);
    this.colorRow(expander, 'glow-color', 'Glow colour');
    group.add(expander);
    return expander;
  }

  _createLinkRow(title, uri) {
    const image = new Gtk.Image({
      icon_name: 'adw-external-link-symbolic',
      valign: Gtk.Align.CENTER,
    });
    const linkRow = new Adw.ActionRow({
      title: _(title),
      activatable: true,
    });
    linkRow.connect('activated', () => {
      Gtk.show_uri(this._window.get_root(), uri, Gdk.CURRENT_TIME);
    });
    linkRow.add_suffix(image);

    return linkRow;
  }

  _createButton(label, callback) {
    let button = new Gtk.Button({ label: _(label), valign: Gtk.Align.CENTER });
    button.connect('clicked', callback);
    return button;
  }

  _toast(message) {
    this._window.add_toast(new Adw.Toast({title: message}));
  }

  _exportSettings() {
    const dialog = new Gtk.FileDialog({
      title: _('Export Visualizer Settings'),
      initial_name: 'visualizer-settings.json',
      modal: true,
    });
    this._dialog = dialog;
    dialog.save(this._window, null, (dlg, res) => {
      this._dialog = null;
      try {
        const file = dlg.save_finish(res);
        const bytes = new TextEncoder().encode(serializeSettings(this._settings));
        file.replace_contents(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        this._toast(_('Settings exported'));
      } catch (e) {
        if (!e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED) &&
            !e.matches?.(Gtk.DialogError, Gtk.DialogError.CANCELLED)) {
          logError(e, 'Visualizer: export failed');
          this._toast(_('Export failed'));
        }
      }
    });
  }

  _importSettings() {
    const dialog = new Gtk.FileDialog({
      title: _('Import Visualizer Settings'),
      modal: true,
    });
    this._dialog = dialog;
    dialog.open(this._window, null, (dlg, res) => {
      this._dialog = null;
      try {
        const file = dlg.open_finish(res);
        const [ok, contents] = file.load_contents(null);
        if (!ok)
          throw new Error('The file could not be read');
        const {imported, skipped} = applySettings(this._settings, new TextDecoder().decode(contents));
        if (skipped.length > 0)
          log(`Visualizer: ignored settings: ${skipped.join(', ')}`);
        this._toast(skipped.length > 0
          ? `${_('Settings imported')}: ${imported}, ${_('ignored')}: ${skipped.length}`
          : `${_('Settings imported')}: ${imported}`);
      } catch (e) {
        if (!e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED) &&
            !e.matches?.(Gtk.DialogError, Gtk.DialogError.CANCELLED)) {
          logError(e, 'Visualizer: import failed');
          this._toast(e.message);
        }
      }
    });
  }

  fillPrefsWindow() {
    const visualPage = this.create_page(_('Visualizer'), 'emblem-system-symbolic');
    {
      const appearance = this.create_group(visualPage, _('Appearance'));
      this.choiceRow(appearance, 'visualizer-style', 'Style',
        [['bars', 'Bars'], ['area', 'Filled curve'], ['line', 'Line']]);
      this.switchRow(appearance, 'mirror', 'Symmetric');
      this.choiceRow(appearance, 'visualizer-orientation', 'Orientation',
        [['bottom', 'Bottom'], ['top', 'Top'], ['left', 'Left'], ['right', 'Right']]);
      this.choiceRow(appearance, 'color-mode', 'Colour (experimental)',
        [['solid', 'Single colour'], ['gradient', 'Gradient'], ['cover', 'Album cover']]);
      this.colorRow(appearance, 'visualizer-color', 'First colour');
      const color2 = this.colorRow(appearance, 'visualizer-color2', 'Second colour');
      const thickness = this.spinRow(appearance, 'spects-line-width', 'Thickness', 1, 40, 1);
      this.glowRow(appearance);
      this._watch('color-mode', () => {
        color2.visible = this._settings.get_string('color-mode') !== 'solid';
      });
      this._watch('visualizer-style', () => {
        thickness.visible = this._settings.get_string('visualizer-style') !== 'area';
      });

      const layout = this.create_group(visualPage, _('Size and position'));
      this.spinRow(layout, 'visualizer-height', 'Height', 1, 1000, 1);
      this.spinRow(layout, 'visualizer-width', 'Width', 1, 7680, 1);
      this.spinRow(layout, 'total-spects-band', 'Number of bars', 8, 256, 1);
      this.switchRow(layout, 'always-on-top', 'Always on top');
    }

    const audioPage = this.create_page(_('Audio'), 'audio-volume-high-symbolic');
    {
      const response = this.create_group(audioPage, _('Response'));
      this.spinRow(response, 'fps', 'Refresh rate', 10, 60, 5);
      this.scaleRow(response, 'smoothing', 'Smoothing', 'Reduces rapid movement in the bars', 0, 100, 5);
      this.scaleRow(response, 'decay', 'Fall speed', 'Controls how quickly the bars fall', 0, 100, 5);
      this.choiceRow(response, 'frequency-scale', 'Frequency scale (experimental)',
        [['linear', 'Linear'], ['log', 'Logarithmic']]);

      const detection = new Adw.ExpanderRow({
        title: _('Advanced signal settings'),
        expanded: false,
      });
      this.spinRow(detection, 'sensitivity', 'Sensitivity', 0, 100, 5);
      this.spinRow(detection, 'silence-threshold', 'Silence threshold', -80, -40, 1);
      response.add(detection);
    }

    let aboutPage = this.create_page('About', 'emblem-important-symbolic'); {
      const BMC_LINK = `https://buymeacoffee.com/raihan1999v`;
      const PROJECT_DESCRIPTION = _('Add Real Time Sound Visualiser to Desktop');
      const PROJECT_IMAGE = 'visualiser-logo';
      let groupAbout = this.create_group(aboutPage);
      let headerGroup = new Adw.PreferencesGroup();
      const projectHeaderBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            hexpand: false,
            vexpand: false,
        });

        const projectImage = new Gtk.Image({
            margin_bottom: 5,
            icon_name: PROJECT_IMAGE,
            pixel_size: 100,
        });

        const projectTitleLabel = new Gtk.Label({
            label: _('Sound Visualizer fork'),
            vexpand: true,
            valign: Gtk.Align.FILL,
        });

        const projectDescriptionLabel = new Gtk.Label({
            label: _(PROJECT_DESCRIPTION),
            hexpand: false,
            vexpand: false,
            margin_bottom: 5,
        });
        projectHeaderBox.append(projectImage);
        projectHeaderBox.append(projectTitleLabel);
        projectHeaderBox.append(projectDescriptionLabel);
        headerGroup.add(projectHeaderBox);
        groupAbout.add(headerGroup);

        const infoGroup = new Adw.PreferencesGroup();

        const projectVersionRow = new Adw.ActionRow({
            title: _('Sound Visualizer fork Version'),
        });
        projectVersionRow.add_suffix(new Gtk.Label({
            label: this._metadata.version.toString(),
        }));
        infoGroup.add(projectVersionRow);
        const githubRow = this._createLinkRow('Sound Visualizer fork Github', this._metadata.url);
        infoGroup.add(githubRow);

        const donateRow = this._createLinkRow('Donate to raihan1999v via Buy Me a Coffee', BMC_LINK);
        infoGroup.add(donateRow);
        groupAbout.add(infoGroup);

        const backupBox = new Gtk.Box({
          orientation: Gtk.Orientation.HORIZONTAL,
          spacing: 12,
          halign: Gtk.Align.CENTER,
          margin_top: 6,
        });
        backupBox.append(this._createButton('Export…', () => this._exportSettings()));
        backupBox.append(this._createButton('Import…', () => this._importSettings()));
        groupAbout.add(backupBox);
    }
  }
}

export default class VisualiserPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
        if (!iconTheme.get_search_path().includes(`${this.path}/media`))
            iconTheme.add_search_path(`${this.path}/media`);
        this.prefs = new PrefsWindow(window, this);
        this.prefs.fillPrefsWindow();
    }
}
