import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import Adw from 'gi://Adw';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

class PrefsWindow {
  constructor(window, extension) {
    this._window = window;
    this._metadata = extension.metadata;
    this._settings = extension.getSettings();
  }

  create_page(title, icon) {
    let page = new Adw.PreferencesPage({
      title: title,
      icon_name: icon,
    });
    this._window.add(page);
    return page;
  }

  // create a new Adw.PreferencesGroup and add it to a prefsPage
  create_group(page, title) {
    let group;
    if (title !== undefined) {
      group = new Adw.PreferencesGroup({
        title: title,
        //margin_top: 5,
        //margin_bottom: 5,
      });
    } else {
      group = new Adw.PreferencesGroup();
    }
    page.add(group);
    return group;
  }

  append_row(group, title, widget) {
    let row = new Adw.ActionRow({
      title: title,
    });
    group.add(row);
    row.add_suffix(widget);
    row.activatable_widget = widget;
  }

  append_expander_row(group, titleEx, title, key, key1) {
    let expand_row = new Adw.ExpanderRow({
      title: titleEx,
      show_enable_switch: true,
      expanded: this._settings.get_boolean(key),
      enable_expansion: this._settings.get_boolean(key)
    });
    let row = new Adw.ActionRow({
      title: title,
    });
    expand_row.connect("notify::enable-expansion", (widget) => {
      this._settings.set_value(key, new GLib.Variant('b', widget.enable_expansion));
    });
    row.add_suffix(key1);
    expand_row.add_row(row);
    group.add(expand_row);
  };

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

  _exportSettings() {
    const keys = this._settings.settings_schema.list_keys();
    const data = {};
    for (const key of keys) {
      data[key] = this._settings.get_value(key).print(true);
    }
    const chooser = new Gtk.FileChooserNative({
      title: _('Export Visualizer Settings'),
      action: Gtk.FileChooserAction.SAVE,
      transient_for: this._window,
      accept_label: _('Export'),
    });
    chooser.set_current_name('visualizer-settings.json');
    chooser.connect('response', (dlg, response) => {
      if (response === Gtk.ResponseType.ACCEPT) {
        try {
          const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
          dlg.get_file().replace_contents(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
          logError(e, 'Visualizer: export failed');
        }
      }
      dlg.destroy();
    });
    chooser.show();
  }

  _importSettings() {
    const chooser = new Gtk.FileChooserNative({
      title: _('Import Visualizer Settings'),
      action: Gtk.FileChooserAction.OPEN,
      transient_for: this._window,
      accept_label: _('Import'),
    });
    chooser.connect('response', (dlg, response) => {
      if (response === Gtk.ResponseType.ACCEPT) {
        try {
          const [ok, contents] = dlg.get_file().load_contents(null);
          if (ok) {
            const data = JSON.parse(new TextDecoder().decode(contents));
            for (const [key, value] of Object.entries(data)) {
              try {
                this._settings.set_value(key, GLib.Variant.parse(null, value, null, null));
              } catch (e) {
                logError(e, `Visualizer: skipping invalid key "${key}"`);
              }
            }
          }
        } catch (e) {
          logError(e, 'Visualizer: import failed');
        }
      }
      dlg.destroy();
    });
    chooser.show();
  }

  fillPrefsWindow() {
    let visualWidget = this.create_page('Visualizer', 'emblem-system-symbolic'); {
      let groupVisual = this.create_group(visualWidget);
      this.append_row(groupVisual, 'Flip the Visualizer', getSwitch('flip-visualizer', this._settings));
      this.append_row(groupVisual, 'Fill the Visualizer', getSwitch('fill-visualizer', this._settings));
      this.append_row(groupVisual, 'Always On Top', getSwitch('always-on-top', this._settings));
      this.append_row(groupVisual, 'Visualizer Height', getSpinButton(false, 'visualizer-height', 1, 200, 1, this._settings));
      this.append_row(groupVisual, 'Visualizer Width', getSpinButton(false, 'visualizer-width', 1, 1920, 1, this._settings));
      this.append_row(groupVisual, 'Spects Line Width', getSpinButton(false, 'spects-line-width', 1, 20, 1, this._settings));
      this.append_row(groupVisual, 'Change Spects Band to Get', getSpinButton(false, 'total-spects-band', 1, 256, 1, this._settings));
      this.append_expander_row(groupVisual, 'Override Spect Value', 'Set Spects Value', 'spect-over-ride-bool', getSpinButton(false, 'spect-over-ride', 1, 256, 1, this._settings));
      this.append_row(groupVisual, 'Pick color for Visualiser', getColorButton('visualizer-color', this._settings));

      let groupBackup = this.create_group(visualWidget, 'Backup');
      this.append_row(groupBackup, 'Export Settings', this._createButton('Export…', () => this._exportSettings()));
      this.append_row(groupBackup, 'Import Settings', this._createButton('Import…', () => this._importSettings()));
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

        // Extension Info and Links Group------------------------------------------------
        const infoGroup = new Adw.PreferencesGroup();

        const projectVersionRow = new Adw.ActionRow({
            title: _('Sound Visualizer fork Version'),
        });
        projectVersionRow.add_suffix(new Gtk.Label({
            label: this._metadata.version.toString(),
        }));
        infoGroup.add(projectVersionRow);
        const gitlabRow = this._createLinkRow(_('Sound Visualizer fork Github'), this._metadata.url);
        infoGroup.add(gitlabRow);

        const donateRow = this._createLinkRow(_('Donate to raihan1999v via Buy Me a Coffee'), BMC_LINK);
        infoGroup.add(donateRow);
        groupAbout.add(infoGroup);
    }
  }
}

function getSwitch(key, settings) {
    let button = new Gtk.Switch({ valign: Gtk.Align.CENTER });
    settings.bind(key, button, 'active', Gio.SettingsBindFlags.DEFAULT);
    return button
}

function getSpinButton(is_double, key, min, max, step, settings) {
    let spin = Gtk.SpinButton.new_with_range(min, max, step);
    settings.bind(key, spin, 'value', Gio.SettingsBindFlags.DEFAULT);
    return spin;
}

function getColorButton(key, settings) {
    let rgba = new Gdk.RGBA();
    rgba.parse(settings.get_string(key));
    let colorButton = new Gtk.ColorButton({
        rgba,
        use_alpha: true,
        valign: Gtk.Align.CENTER
    });
    colorButton.connect('color-set', (widget) => {
        settings.set_string(key, widget.get_rgba().to_string());
    });
    return colorButton;
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
