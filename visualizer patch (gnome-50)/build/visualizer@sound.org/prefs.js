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

    // get the headerbar
    if (!this.headerbar) {
      let pages_stack = page.get_parent(); // AdwViewStack
      let content_stack = pages_stack.get_parent().get_parent(); // GtkStack
      let preferences = content_stack.get_parent(); // GtkBox
      this.headerbar = preferences.get_first_child(); // AdwHeaderBar
    }

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
      let settingArray = this._settings.get_boolean(key);
      settingArray = widget.enable_expansion;
      this._settings.set_value(key, new GLib.Variant('b', settingArray));
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
            label: _('Sound Visualizer'),
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
            title: _('Sound Visualizer Version'),
        });
        projectVersionRow.add_suffix(new Gtk.Label({
            label: this._metadata.version.toString(),
        }));
        infoGroup.add(projectVersionRow);
        const gitlabRow = this._createLinkRow(_('Sound Visualizer GitLab'), this._metadata.url);
        infoGroup.add(gitlabRow);

        const donateRow = this._createLinkRow(_('Donate via Buy Me a Coffee'), BMC_LINK);
        infoGroup.add(donateRow);
        groupAbout.add(infoGroup);
    }
  }
}

function getSwitch(key, settings) {
    let button = new Gtk.Switch({ active: key, valign: Gtk.Align.CENTER });
    settings.bind(key, button, 'active', Gio.SettingsBindFlags.DEFAULT);
    return button
}

function getSpinButton(is_double, key, min, max, step, settings) {
    let v = 0;
    (is_double) ? v = settings.get_double(key) : v = settings.get_int(key);
    let spin = Gtk.SpinButton.new_with_range(min, max, step);
    spin.set_value(v);
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
