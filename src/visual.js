import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Gst from 'gi://Gst';
import Gvc from 'gi://Gvc';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Cairo from 'gi://cairo';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
const [majorVersion, minorVersion] = Config.PACKAGE_VERSION.split('.').map(s => Number(s));
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

export const Visualizer = GObject.registerClass(
  class musicVisualizer extends St.BoxLayout {
    _init(extension) {
      super._init({
        reactive: true,
        track_hover: true,
        can_focus: true
      });
      this._extension = extension;
      this._control;
      this._visualMenuManager = new PopupMenu.PopupMenuManager(this);
      this._sources = [];
      this._freq = [];
      this._dupFreq = [];
      this._actor = new St.DrawingArea();
      this.add_child(this._actor);
      this._settings = this._extension.getSettings();
      this.settingsChanged();
      this._draggable = DND.makeDraggable(this);
      this._draggable._animateDragEnd = (eventTime) => {
        this._draggable._animationInProgress = true;
        if (majorVersion >= 49) {
          this._draggable._onAnimationComplete(eventTime);
        } else {
          this._draggable._onAnimationComplete(this._draggable._dragActor, eventTime);
        }
      };
      this._draggable.connect('drag-begin', this._onDragBegin.bind(this));
      this._draggable.connect('drag-end', this._onDragEnd.bind(this));
      this.connect('notify::hover', () => this._onHover());
      this.actorInit();
      this.getSpectBands();
      this._cacheDrawSettings();
      this._actor.connect('repaint', (area) => this.drawStuff(area));
      this.setupGst();
      this.setPosition();
      this._setParent();
    }

    setupGst() {
      Gst.init(null);
      this._pipeline = Gst.Pipeline.new("bin");
      this._src = Gst.ElementFactory.make("pulsesrc", "src");
      this.setDefaultSrc();
      this._spectrum = Gst.ElementFactory.make("spectrum", "spectrum");
      this._spectrum.set_property("bands", this._spectBands);
      this._spectrum.set_property("threshold", -80);
      this._spectrum.set_property("post-messages", true);
      let _sink = Gst.ElementFactory.make("fakesink", "sink");
      this._pipeline.add(this._src);
      this._pipeline.add(this._spectrum);
      this._pipeline.add(_sink);
      if (!this._src.link(this._spectrum) || !this._spectrum.link(_sink)) {
        console.log('can not link elements');
      }
      let bus = this._pipeline.get_bus();
      bus.add_signal_watch();
      bus.connect('message::element', (bus, msg) => this.onMessage(bus, msg));
      this._pipeline.set_state(Gst.State.PLAYING);
    }

    onMessage(bus, msg) {
      let struct = msg.get_structure();
      let [magbool, magnitudes] = struct.get_list("magnitude");
      if (!magbool) {
        return;
      }
      let limit = Math.floor(this._spectBands * 2 / 3);
      for (let j = 0; j < limit; j++) {
        this._freq[j] = Math.abs(magnitudes.get_nth(j));
      }
      if (this._freq.length > 1){
          this._createdup(this._freq,this._dupFreq, this._freq.length * 2);
      }
      this._actor.queue_repaint();
    }

    actorInit() {
      this._spectHeight = this._settings.get_int('visualizer-height');
      this._spectWidth = this._settings.get_int('visualizer-width');
      const orientation = this._settings.get_string('visualizer-orientation');
      if (orientation === 'left' || orientation === 'right') {
        this._actor.width = this._spectHeight;
        this._actor.height = this._spectWidth;
      } else {
        this._actor.width = this._spectWidth;
        this._actor.height = this._spectHeight;
      }
    }

    _applyBandSettings() {
      this.getSpectBands();
      this._spectrum.set_property("bands", this._spectBands);
      this._resetFreq();
      this._actor.queue_repaint();
    }

    _cacheDrawSettings() {
      this._lineWidth = this._settings.get_int('spects-line-width');
      this._orientation = this._settings.get_string('visualizer-orientation');
      this._fill = this._settings.get_boolean('fill-visualizer');
      this._color = this._parseColor(this._settings.get_string('visualizer-color'));
    }

    drawStuff(area) {
      let values = this._dupFreq.length;
      let [width, height] = area.get_surface_size();
      let cr = area.get_context();
      let lineW = this._lineWidth;
      let fill = this._fill;
      let color = this._color;

      cr.save();

      let w = width;
      let h = height;

      switch (this._orientation) {
        case 'top':
          cr.translate(0, height);
          cr.scale(1, -1);
          break;
        case 'left':
          cr.translate(width, 0);
          cr.rotate(Math.PI / 2);
          w = height;
          h = width;
          break;
        case 'right':
          cr.rotate(-Math.PI / 2);
          cr.scale(-1, 1);
          w = height;
          h = width;
          break;
        default:
          break;
      }

      cr.setLineWidth(lineW);
      cr.setSourceRGBA(color.red, color.green, color.blue, color.alpha);

      if (fill) {
        cr.moveTo(0, h);
      }

      for (let i = 0; i < values; i++) {
        let startX = fill ? i * w / values : lineW / 2 + i * w / values;
        let magnitude = this._dupFreq[i] ?? 0;
        let endY = h * magnitude / 80;

        if (!fill) {
          cr.moveTo(startX, h);
          cr.lineTo(startX, endY);
          cr.lineTo(startX, h - 1);
        } else {
          cr.lineTo(startX, endY);
        }
      }

      if (fill) {
        cr.lineTo(w, h);
      }

      fill ? cr.fill() : cr.stroke();
      cr.restore();
      cr.$dispose();
    }

    // make the visualiser look like glava
    _createdup(freq, dupfreq, bands){
        for (let i=0;i< bands;i++){
            if(i < freq.length){
                dupfreq[i] = freq[freq.length-1-i];
            } else {
                dupfreq[i] = freq[i-freq.length];
            }
        }
    }

    _parseColor(string)
    {
        let ok, color;
        if(majorVersion <= 46) {
            [ok, color] = Clutter.Color.from_string(string);
        } else {
            [ok, color] = Cogl.Color.from_string(string);
        }

        if (!ok) {
            return { red: 0, green: 0, blue: 0, alpha: 1 };
        }
        return {
            red: color.red/255,
            green: color.green/255,
            blue: color.blue/255,
            alpha: color.alpha/255
        };
    }

    getSpectBands() {
      let override = this._settings.get_boolean('spect-over-ride-bool');
      this._spectBands = override
        ? this._settings.get_int('spect-over-ride')
        : this._settings.get_int('total-spects-band');
      return this._spectBands;
    }

    _getMetaRectForCoords(x, y) {
      this.get_allocation_box();
      let rect = new Meta.Rectangle();
      [rect.x, rect.y] = [x, y];
      [rect.width, rect.height] = this.get_transformed_size();
      return rect;
    }

    _getWorkAreaForRect(rect) {
      let monitorIndex = global.display.get_monitor_index_for_rect(rect);
      return Main.layoutManager.getWorkAreaForMonitor(monitorIndex);
    }

    _isOnScreen(x, y) {
      let rect = this._getMetaRectForCoords(x, y);
      let monitorWorkArea = this._getWorkAreaForRect(rect);
      return monitorWorkArea.contains_rect(rect);
    }

    _keepOnScreen(x, y) {
      let rect = this._getMetaRectForCoords(x, y);
      let monitorWorkArea = this._getWorkAreaForRect(rect);
      let monitorRight = monitorWorkArea.x + monitorWorkArea.width;
      let monitorBottom = monitorWorkArea.y + monitorWorkArea.height;
      x = Math.min(Math.max(monitorWorkArea.x, x), monitorRight - rect.width);
      y = Math.min(Math.max(monitorWorkArea.y, y), monitorBottom - rect.height);
      return [x, y];
    }

    setPosition() {
      if (this._ignorePositionUpdate)
        return;
      let [x, y] = this._settings.get_value('visualizer-location').deep_unpack();
      this.set_position(x, y);
      if (!this.get_parent())
        return;
      if (!this._isOnScreen(x, y)) {
        [x, y] = this._keepOnScreen(x, y);
        this.ease({
          x,
          y,
          duration: 150,
          mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
        this._ignorePositionUpdate = true;
        this._settings.set_value('visualizer-location', new GLib.Variant('(ii)', [x, y]));
        this._ignorePositionUpdate = false;
      }
    }

    _onDragBegin() {
      this.isDragging = true;
      this._dragMonitor = {
        dragMotion: this._onDragMotion.bind(this)
      };
      DND.addDragMonitor(this._dragMonitor);
      let p = this.get_transformed_position();
      this.startX = this.oldX = p[0];
      this.startY = this.oldY = p[1];
      this.get_allocation_box();
      this.rowHeight = this.height;
      this.rowWidth = this.width;
    }

    _onDragMotion(dragEvent) {
      this.deltaX = dragEvent.x - (dragEvent.x - this.oldX);
      this.deltaY = dragEvent.y - (dragEvent.y - this.oldY);
      let p = this.get_transformed_position();
      this.oldX = p[0];
      this.oldY = p[1];
      return DND.DragMotionResult.CONTINUE;
    }

    _onDragEnd() {
      if (this._dragMonitor) {
        DND.removeDragMonitor(this._dragMonitor);
        this._dragMonitor = null;
      }
      this.set_position(this.deltaX, this.deltaY);
      this._ignorePositionUpdate = true;
      this._settings.set_value('visualizer-location', new GLib.Variant('(ii)', [this.deltaX, this.deltaY]));
      this._ignorePositionUpdate = false;
    }

    async setDefaultSrc() {
      try {
        this._defaultSrc = await this.getDefaultSrc();
        this._src.set_property('device', this._defaultSrc);
      } catch (e) {
        logError(e);
      }
    }

    getDefaultSrc() {
      return new Promise((resolve, reject) => {
        if (this._defaultSrcId) {
          GLib.Source.remove(this._defaultSrcId);
          this._defaultSrcId = null;
        }
        this._defaultSrcId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
          this._control = Main.panel.statusArea.quickSettings._volumeInput._control;
          if (!this._controlHandlerId) {
            this._controlHandlerId = this._control.connect('default-sink-changed', () => this.setDefaultSrc());
          }
          let stream = this._control.get_default_sink();
          (stream !== null) ? resolve(stream.get_name() + '.monitor'): reject(Error('failure'));
          this._defaultSrcId = null;
          return GLib.SOURCE_REMOVE;
        });
        this._sources.push(this._defaultSrcId);
      });
    }

    getStreams() {
      return new Promise((resolve, reject) => {
        if (this._streamId) {
          GLib.Source.remove(this._streamId);
          this._streamId = null;
        }
        this._streamId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
          if (this._control.get_state() == Gvc.MixerControlState.READY) {
            let streams = this._control.get_streams();
            (streams.length > 0) ? resolve(streams): reject(Error('failure'))
          }
          this._streamId = null;
          return GLib.SOURCE_REMOVE;
        });
        this._sources.push(this._streamId);
      });
    }

    _resetFreq() {
        this._freq.length = 0;
        this._dupFreq.length = 0;
    }

    _setParent() {
        const parent = this.get_parent();
        if (parent === Main.layoutManager.uiGroup)
            Main.layoutManager.removeChrome(this);
        else if (parent === Main.layoutManager._backgroundGroup)
            Main.layoutManager._backgroundGroup.remove_child(this);

        const alwaysOnTop = this._settings.get_boolean('always-on-top');
        if (alwaysOnTop)
            Main.layoutManager.addTopChrome(this);
        else
            Main.layoutManager._backgroundGroup.add_child(this);
    }

    vfunc_button_press_event() {
      let event = Clutter.get_current_event();
      if (event.get_button() === 1)
        this._setPopupTimeout();
      else if (event.get_button() === 3) {
        this._popupMenu();
        return Clutter.EVENT_STOP;
      }
      return Clutter.EVENT_PROPAGATE;
    }

    _onHover() {
      if (!this.hover)
        this._removeMenuTimeout();
    }

    _removeMenuTimeout() {
      if (this._menuTimeoutId) {
        GLib.Source.remove(this._menuTimeoutId);
        this._menuTimeoutId = null;
      }
    }

    _setPopupTimeout() {
      this._removeMenuTimeout();
      this._menuTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
        this._menuTimeoutId = 0;
        this._popupMenu();
        return GLib.SOURCE_REMOVE;
      });
      GLib.Source.set_name_by_id(this._menuTimeoutId, '[visualizer] this.popupMenu');
      this._sources.push(this._menuTimeoutId);
    }

    async _popupMenu() {
      try {
        this._removeMenuTimeout();
        if (!this._menu) {
          this._menuItems = [];
          let stream = await this.getStreams();
          for (let i = 0; i < stream.length; i++) {
            if (stream[i] instanceof Gvc.MixerSink) {
              this._menuItems.push(stream[i].get_name() + '.monitor');
            } else if (stream[i] instanceof Gvc.MixerSource) {
              this._menuItems.push(stream[i].get_name());
            }
          }
          this._subMenuItem = [];
          this._menu = new PopupMenu.PopupMenu(this, 0.5, St.Side.TOP);
          let srcDevice = new PopupMenu.PopupSubMenuMenuItem('Change Audio Source');
          this._menu.addMenuItem(srcDevice);
          for (let i = 0; i < this._menuItems.length; i++) {
            let item = new PopupMenu.PopupMenuItem(this._menuItems[i]);
            item.connect('activate', () => {
              for (let k = 0; k < this._menuItems.length; k++) {
                this._subMenuItem[k].setOrnament(this._menuItems[i] == this._menuItems[k] ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
              }
              this._src.set_property("device", this._menuItems[i]);
            });
            srcDevice.menu.addMenuItem(item, i);
            this._subMenuItem.push(item);
          }
          for (let k = 0; k < this._menuItems.length; k++) {
            this._subMenuItem[k].setOrnament(this._defaultSrc == this._menuItems[k] ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
          }
          this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
          this._menu.addAction("Visualizer Settings", () => {
            this._extension.openPreferences();
          });
          Main.uiGroup.add_child(this._menu);
          this._visualMenuManager.addMenu(this._menu);
        }
        this._menu.open();
        return false;
      } catch (e) {
        logError(e);
      }
    }

    destroy() {
      this._removeSources(this._sources);
      if (this._settingsHandlerIds) {
        for (let id of this._settingsHandlerIds) {
          this._settings.disconnect(id);
        }
        this._settingsHandlerIds = null;
      }
      if (this._control && this._controlHandlerId) {
        this._control.disconnect(this._controlHandlerId);
        this._controlHandlerId = null;
      }
      this._pipeline.get_bus().remove_signal_watch();
      this._pipeline.set_state(Gst.State.NULL);
      const parent = this.get_parent();
        if (parent === Main.layoutManager.uiGroup)
            Main.layoutManager.removeChrome(this);
        else if (parent === Main.layoutManager._backgroundGroup)
            Main.layoutManager._backgroundGroup.remove_child(this);
      super.destroy();
    }

    settingsChanged() {
      this._settingsHandlerIds = [
        this._settings.connect('changed::visualizer-location', () => this.setPosition()),
        this._settings.connect('changed::total-spects-band', () => this._applyBandSettings()),
        this._settings.connect('changed::spect-over-ride', () => this._applyBandSettings()),
        this._settings.connect('changed::spect-over-ride-bool', () => this._applyBandSettings()),
        this._settings.connect('changed::visualizer-height', () => {
          this.actorInit();
          this._actor.queue_repaint();
        }),
        this._settings.connect('changed::visualizer-width', () => {
          this.actorInit();
          this._actor.queue_repaint();
        }),
        this._settings.connect('changed::spects-line-width', () => {
          this._cacheDrawSettings();
          this._actor.queue_repaint();
        }),
        this._settings.connect('changed::visualizer-orientation', () => {
          this.actorInit();
          this._cacheDrawSettings();
          this._actor.queue_repaint();
        }),
        this._settings.connect('changed::fill-visualizer', () => {
          this._cacheDrawSettings();
          this._actor.queue_repaint();
        }),
        this._settings.connect('changed::visualizer-color', () => {
          this._cacheDrawSettings();
          this._actor.queue_repaint();
        }),
        this._settings.connect('changed::always-on-top', () => this._setParent()),
      ];
    }

    _removeSources(src) {
      for(let i=0; i<src.length; i++) {
        if (src[i]) {
            GLib.Source.remove(src[i]);
            src[i] = null;
        }
      }
    }
  });
