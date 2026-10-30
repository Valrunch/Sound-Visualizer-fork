import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Gst from 'gi://Gst';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
const majorVersion = Number(Config.PACKAGE_VERSION.split('.')[0]);
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Audio from './audio.js';
import {CoverWatcher} from './cover.js';
import {drawVisualizer} from './draw.js';
import * as Dsp from './dsp.js';

const SILENCE_DELAY_MS = 1500;
const IDLE_INTERVAL_NS = 250 * 1000000;
const RETRY_DELAYS_S = [2, 5, 10, 30];
const BLOCKED_POLL_S = 1;

export const Visualizer = GObject.registerClass(
  class musicVisualizer extends St.BoxLayout {
    _init(extension) {
      super._init({
        reactive: true,
        track_hover: true,
        can_focus: true
      });
      this._extension = extension;
      this._settings = this._extension.getSettings();
      this._migrateSettings();
      this._control = null;
      this._controlHandlerIds = [];
      this._visualMenuManager = new PopupMenu.PopupMenuManager(this);
      this._db = new Float64Array(Dsp.ANALYSIS_BANDS);
      this._isSilent = true;
      this._isFullscreen = false;
      this._maximizedWindowBlocked = false;
      this._pipelineFailed = false;
      this._audioSourceReady = false;
      this._sourceToken = 0;
      this._retryCount = 0;
      this._cover = null;
      this._bars = [];
      this.visible = false;
      this._actor = new St.DrawingArea();
      this.add_child(this._actor);
      this._connectSettings();
      this._draggable = DND.makeDraggable(this);
      this._draggable._animateDragEnd = (eventTime) => {
        [this._dropX, this._dropY] = this.get_transformed_position();
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
      this._applyAudioSettings();
      this._cacheDrawSettings();
      this._actor.connect('repaint', (area) => this.drawStuff(area));
      this._setParent();
      this.setPosition();
      this._fullscreenChangedId = global.display.connect('in-fullscreen-changed',
        () => this._refreshBlockedState());
      this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
        this.setPosition();
        this._refreshBlockedState();
      });
      this._blockedPollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, BLOCKED_POLL_S, () => {
        this._refreshBlockedState();
        return GLib.SOURCE_CONTINUE;
      });
      this._refreshBlockedState();
      this._startupTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 3, () => {
        this._startupTimeoutId = 0;
        this._startupReady = true;
        if (!this._isBlocked())
          this.setupGst();
        return GLib.SOURCE_REMOVE;
      });
    }

    _migrateSettings() {
      const s = this._settings;
      if (s.get_boolean('spect-over-ride-bool')) {
        s.set_int('total-spects-band', Math.max(8, s.get_int('spect-over-ride')));
        s.set_boolean('spect-over-ride-bool', false);
      }
      if (s.get_boolean('fill-visualizer')) {
        s.set_string('visualizer-style', 'area');
        s.set_boolean('fill-visualizer', false);
      }
    }

    _connectSettings() {
      const s = this._settings;
      this._settingsHandlerIds = [];
      const on = (keys, callback) => {
        for (const key of keys)
          this._settingsHandlerIds.push(s.connect(`changed::${key}`, callback));
      };
      on(['visualizer-location'], () => this.setPosition());
      on(['total-spects-band', 'mirror', 'frequency-scale', 'fps', 'smoothing', 'decay',
        'sensitivity', 'silence-threshold'], () => this._applyAudioSettings());
      on(['visualizer-height', 'visualizer-width', 'visualizer-orientation'],
        () => this._applyGeometrySettings());
      on(['visualizer-style', 'spects-line-width', 'glow-effect', 'glow-color', 'visualizer-color',
        'visualizer-color2', 'color-mode'], () => this._applyDrawSettings());
      on(['always-on-top'], () => this._setParent());
    }

    _applyAudioSettings() {
      const s = this._settings;
      const mirror = s.get_boolean('mirror');
      const scale = s.get_string('frequency-scale');
      const distinct = Dsp.distinctBands(s.get_int('total-spects-band'), mirror);
      if (!this._map || this._map.distinct !== distinct || this._map.scale !== scale) {
        this._map = Dsp.buildBandMap(distinct, scale);
        this._rawDb = new Float64Array(distinct);
        this._targets = new Float64Array(distinct);
        this._smoother = new Dsp.LevelSmoother(distinct);
        this._mirrorBuffer = new Float64Array(distinct * 2);
        this._bars = [];
      }
      this._mirror = mirror;
      this._fps = s.get_int('fps');
      this._smoothing = s.get_int('smoothing');
      this._decay = s.get_int('decay');
      this._gain = Dsp.gainDb(s.get_int('sensitivity'));
      this._silenceDb = s.get_int('silence-threshold');
      this._applyInterval();
      this._actor.queue_repaint();
    }

    actorInit() {
      this._spectHeight = this._settings.get_int('visualizer-height');
      this._spectWidth = this._settings.get_int('visualizer-width');
      const orientation = this._settings.get_string('visualizer-orientation');
      let width;
      let height;
      if (orientation === 'left' || orientation === 'right') {
        width = this._spectHeight;
        height = this._spectWidth;
      } else {
        width = this._spectWidth;
        height = this._spectHeight;
      }
      this._actorWidth = width;
      this._actorHeight = height;
      this._actor.set_size(width, height);
      this.set_size(width, height);
      this.queue_relayout();
    }

    _applyGeometrySettings() {
      this.actorInit();
      this._cacheDrawSettings();
      this.setPosition();
      this._refreshBlockedState();
      this._actor.queue_repaint();
    }

    _applyDrawSettings() {
      this._cacheDrawSettings();
      this._actor.queue_repaint();
    }

    _cacheDrawSettings() {
      const s = this._settings;
      this._colorMode = s.get_string('color-mode');
      this._baseColor = this._parseColor(s.get_string('visualizer-color'));
      this._baseColor2 = this._parseColor(s.get_string('visualizer-color2'));
      this._drawOptions = {
        style: s.get_string('visualizer-style'),
        orientation: s.get_string('visualizer-orientation'),
        lineWidth: s.get_int('spects-line-width'),
        color: this._baseColor,
        color2: null,
        glow: s.get_boolean('glow-effect') ? this._parseColor(s.get_string('glow-color')) : null,
      };
      this._updateCoverWatcher();
      this._resolveColors();
    }

    _resolveColors() {
      const o = this._drawOptions;
      const base = this._baseColor;
      if (this._colorMode === 'cover' && this._cover) {
        const rgb = c => ({red: c[0] / 255, green: c[1] / 255, blue: c[2] / 255, alpha: base.alpha});
        o.color = rgb(this._cover.c1);
        o.color2 = rgb(this._cover.c2);
      } else {
        o.color = base;
        o.color2 = this._colorMode === 'solid' ? null : this._baseColor2;
      }
    }

    _updateCoverWatcher() {
      if (this._colorMode === 'cover') {
        this._coverWatcher ??= new CoverWatcher(colors => {
          this._cover = colors;
          this._resolveColors();
          this._actor.queue_repaint();
        });
        this._coverWatcher.start();
      } else if (this._coverWatcher) {
        this._coverWatcher.stop();
        this._cover = null;
      }
    }

    _parseColor(string) {
      let ok, color;
      if (majorVersion <= 46) {
        [ok, color] = Clutter.Color.from_string(string);
      } else {
        [ok, color] = Cogl.Color.from_string(string);
      }

      if (!ok) {
        return {red: 0, green: 0, blue: 0, alpha: 1};
      }
      return {
        red: color.red / 255,
        green: color.green / 255,
        blue: color.blue / 255,
        alpha: color.alpha / 255
      };
    }

    drawStuff(area) {
      const [width, height] = area.get_surface_size();
      const cr = area.get_context();
      try {
        drawVisualizer(cr, width, height, this._bars, this._drawOptions);
      } catch (e) {
        logError(e, 'Visualizer: drawing failed');
      } finally {
        cr.$dispose();
      }
    }

    _isBlocked() {
      return this._isFullscreen || this._maximizedWindowBlocked;
    }

    _refreshBlockedState() {
      const monitor = this._monitorIndex();
      const fullscreen = global.display.get_monitor_in_fullscreen(monitor);
      const maximized = !fullscreen && !this._alwaysOnTop && this._hasMaximizedWindowOn(monitor);
      if (fullscreen === this._isFullscreen && maximized === this._maximizedWindowBlocked)
        return;

      const wasBlocked = this._isBlocked();
      this._isFullscreen = fullscreen;
      this._maximizedWindowBlocked = maximized;
      if (this._isBlocked() && !wasBlocked) {
        this._isSilent = true;
        this._smoother.reset();
        this._removeSilenceTimeout();
      } else if (!this._isBlocked() && this._startupReady && !this._pipeline) {
        this.setupGst();
        return;
      }
      this._syncVisualizerState();
    }

    _hasMaximizedWindowOn(monitor) {
      const workspace = global.workspace_manager.get_active_workspace();
      return workspace.list_windows().some(window =>
        !window.minimized &&
        window.maximized_horizontally &&
        window.maximized_vertically &&
        window.get_monitor() === monitor
      );
    }

    _syncVisualizerState() {
      this.visible = !this._isBlocked() && !this._isSilent;
      if (!this._pipeline)
        return;
      const run = !this._isBlocked() && this._audioSourceReady && !this._pipelineFailed;
      const target = run ? Gst.State.PLAYING : Gst.State.NULL;
      if (target !== this._pipelineTarget) {
        this._pipelineTarget = target;
        this._pipeline.set_state(target);
      }
      this._applyInterval();
    }

    _applyInterval() {
      if (!this._spectrum)
        return;
      const interval = this.visible ? Dsp.intervalNs(this._fps) : IDLE_INTERVAL_NS;
      if (interval !== this._intervalNs) {
        this._intervalNs = interval;
        this._spectrum.set_property('interval', interval);
      }
    }

    _removeSilenceTimeout() {
      this._clearSource('_silenceTimeoutId');
    }

    _clearSource(property) {
      if (this[property]) {
        GLib.Source.remove(this[property]);
        this[property] = 0;
      }
    }

    setupGst() {
      if (this._pipeline)
        return;

      try {
        Gst.init(null);
      } catch (e) {
        logError(e, 'Visualizer: GStreamer is unavailable');
        return;
      }
      const pipeline = Gst.Pipeline.new("bin");
      const src = Gst.ElementFactory.make("pulsesrc", "src");
      const spectrum = Gst.ElementFactory.make("spectrum", "spectrum");
      const sink = Gst.ElementFactory.make("fakesink", "sink");
      if (!pipeline || !src || !spectrum || !sink) {
        logError(new Error('Visualizer: unable to create the GStreamer pipeline elements'));
        return;
      }

      spectrum.set_property("bands", Dsp.ANALYSIS_BANDS);
      spectrum.set_property("threshold", Dsp.DB_FLOOR);
      spectrum.set_property("post-messages", true);
      pipeline.add(src);
      pipeline.add(spectrum);
      pipeline.add(sink);
      if (!src.link(spectrum) || !spectrum.link(sink)) {
        pipeline.set_state(Gst.State.NULL);
        logError(new Error('Visualizer: unable to link the GStreamer pipeline elements'));
        return;
      }

      this._pipeline = pipeline;
      this._src = src;
      this._spectrum = spectrum;
      this._pipelineTarget = Gst.State.NULL;
      this._pipelineFailed = false;
      this._audioSourceReady = false;
      this._intervalNs = 0;
      this._lastMessageUs = 0;
      this._bus = pipeline.get_bus();
      this._bus.add_signal_watch();
      this._busHandlerIds = [
        this._bus.connect('message::element', (bus, msg) => this.onMessage(bus, msg)),
        this._bus.connect('message::error', (bus, msg) => this._onPipelineError(msg)),
      ];
      this._resolveSource();
      this._syncVisualizerState();
    }

    _teardownGst() {
      if (!this._pipeline)
        return;
      for (const id of this._busHandlerIds)
        this._bus.disconnect(id);
      this._busHandlerIds = [];
      this._bus.remove_signal_watch();
      this._pipeline.set_state(Gst.State.NULL);
      this._bus = null;
      this._pipeline = null;
      this._src = null;
      this._spectrum = null;
      this._pipelineTarget = null;
      this._audioSourceReady = false;
      this._currentSource = null;
      this._sourceToken++;
    }

    _onPipelineError(msg) {
      const [err, debug] = msg.get_error();
      logError(err, `Visualizer: GStreamer pipeline error (${debug})`);
      this._smoother.reset();
      this._isSilent = true;
      this._removeSilenceTimeout();
      this._pipelineFailed = true;
      this._syncVisualizerState();
      this._scheduleRetry();
    }

    _scheduleRetry() {
      if (this._retryId)
        return;
      const delay = RETRY_DELAYS_S[Math.min(this._retryCount, RETRY_DELAYS_S.length - 1)];
      this._retryCount++;
      this._retryId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delay, () => {
        this._retryId = 0;
        this._teardownGst();
        if (!this._isBlocked())
          this.setupGst();
        return GLib.SOURCE_REMOVE;
      });
    }

    onMessage(bus, msg) {
      const struct = msg.get_structure();
      if (!struct || struct.get_name() !== 'spectrum')
        return;
      const [ok, magnitudes] = struct.get_list("magnitude");
      if (!ok || !magnitudes)
        return;
      const needed = this._map.maxBin + 1;
      if (magnitudes.n_values < needed)
        return;
      for (let i = 0; i < needed; i++) {
        const value = magnitudes.get_nth(i);
        this._db[i] = typeof value === 'number' && Number.isFinite(value) ? value : Dsp.DB_FLOOR;
      }
      this._retryCount = 0;

      const now = GLib.get_monotonic_time();
      const dt = this._lastMessageUs
        ? Dsp.clamp((now - this._lastMessageUs) / 1000000, 0.001, 0.25)
        : 1 / this._fps;
      this._lastMessageUs = now;

      Dsp.mapSpectrum(this._db, this._map, this._rawDb);
      Dsp.toTargets(this._rawDb, this._map, this._gain, this._targets);
      const levels = this._smoother.update(this._targets, dt, this._smoothing, this._decay);
      this._bars = this._mirror ? Dsp.mirrorLevels(levels, this._mirrorBuffer) : levels;

      if (Dsp.isAudible(this._rawDb, this._map.distinct, this._silenceDb)) {
        this._removeSilenceTimeout();
        if (this._isSilent) {
          this._isSilent = false;
          this._syncVisualizerState();
        }
      } else if (!this._isSilent && !this._silenceTimeoutId) {
        this._silenceTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SILENCE_DELAY_MS, () => {
          this._silenceTimeoutId = 0;
          this._isSilent = true;
          this._smoother.reset();
          this._syncVisualizerState();
          return GLib.SOURCE_REMOVE;
        });
      }
      if (this.visible)
        this._actor.queue_repaint();
    }

    async _ensureControl() {
      if (!this._control) {
        this._control = Audio.getMixerControl();
        if (!this._control)
          throw new Error('GNOME audio control is unavailable');
        this._controlHandlerIds = [
          this._control.connect('default-sink-changed', () => this._queueSourceCheck()),
        ];
      }
      this._readyWait?.cancel();
      const wait = Audio.whenReady(this._control);
      this._readyWait = wait;
      try {
        await wait.promise;
      } finally {
        if (this._readyWait === wait)
          this._readyWait = null;
      }
      return this._control;
    }

    async _resolveSource() {
      const token = ++this._sourceToken;
      this._audioSourceReady = false;
      this._syncVisualizerState();
      try {
        const control = await this._ensureControl();
        if (token !== this._sourceToken || !this._pipeline)
          return;
        const device = Audio.defaultMonitor(control);
        if (!device)
          throw new Error('No audio output is available');
        this._src.set_property('device', device);
        this._currentSource = device;
        this._audioSourceReady = true;
        this._pipelineFailed = false;
        this._syncVisualizerState();
      } catch (e) {
        if (token !== this._sourceToken)
          return;
        logError(e, 'Visualizer: unable to select an audio source, retrying');
        this._scheduleRetry();
      }
    }

    _queueSourceCheck() {
      this._clearSource('_sourceCheckId');
      this._sourceCheckId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
        this._sourceCheckId = 0;
        this._checkSource();
        return GLib.SOURCE_REMOVE;
      });
    }

    _checkSource() {
      if (!this._pipeline || !this._control || !Audio.isReady(this._control))
        return;
      const desired = Audio.defaultMonitor(this._control);
      if (desired && desired !== this._currentSource)
        this._resolveSource();
    }

    _getRectForCoords(x, y) {
      return {x, y, width: this._actorWidth, height: this._actorHeight};
    }

    _monitorIndexForRect(rect) {
      const monitors = Main.layoutManager.monitors;
      if (monitors.length === 0)
        throw new Error('Visualizer: no monitors are available');

      const rectRight = rect.x + rect.width;
      const rectBottom = rect.y + rect.height;
      let monitorIndex = 0;
      let largestOverlap = 0;
      for (let i = 0; i < monitors.length; i++) {
        const monitor = monitors[i];
        const overlapWidth = Math.max(0, Math.min(rectRight, monitor.x + monitor.width) - Math.max(rect.x, monitor.x));
        const overlapHeight = Math.max(0, Math.min(rectBottom, monitor.y + monitor.height) - Math.max(rect.y, monitor.y));
        const overlap = overlapWidth * overlapHeight;
        if (overlap > largestOverlap) {
          largestOverlap = overlap;
          monitorIndex = i;
        }
      }

      if (largestOverlap === 0) {
        const centerX = rect.x + rect.width / 2;
        const centerY = rect.y + rect.height / 2;
        let nearestDistance = Infinity;
        for (let i = 0; i < monitors.length; i++) {
          const monitor = monitors[i];
          const dx = Math.max(monitor.x - centerX, 0, centerX - (monitor.x + monitor.width));
          const dy = Math.max(monitor.y - centerY, 0, centerY - (monitor.y + monitor.height));
          const distance = dx * dx + dy * dy;
          if (distance < nearestDistance) {
            nearestDistance = distance;
            monitorIndex = i;
          }
        }
      }
      return monitorIndex;
    }

    _monitorIndex() {
      return this._monitorIndexForRect(this._getRectForCoords(this.x, this.y));
    }

    _getWorkAreaForRect(rect) {
      return Main.layoutManager.getWorkAreaForMonitor(this._monitorIndexForRect(rect));
    }

    _isOnScreen(x, y) {
      let rect = this._getRectForCoords(x, y);
      let monitorWorkArea = this._getWorkAreaForRect(rect);
      return rect.x >= monitorWorkArea.x &&
        rect.y >= monitorWorkArea.y &&
        rect.x + rect.width <= monitorWorkArea.x + monitorWorkArea.width &&
        rect.y + rect.height <= monitorWorkArea.y + monitorWorkArea.height;
    }

    _keepOnScreen(x, y) {
      let rect = this._getRectForCoords(x, y);
      let monitorWorkArea = this._getWorkAreaForRect(rect);
      let monitorRight = monitorWorkArea.x + monitorWorkArea.width;
      let monitorBottom = monitorWorkArea.y + monitorWorkArea.height;
      x = Math.min(Math.max(monitorWorkArea.x, x), monitorRight - rect.width);
      y = Math.min(Math.max(monitorWorkArea.y, y), monitorBottom - rect.height);
      return [x, y];
    }

    _saveLocation(x, y) {
      this._ignorePositionUpdate = true;
      this._settings.set_value('visualizer-location', new GLib.Variant('(ii)', [x, y]));
      this._ignorePositionUpdate = false;
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
        this._saveLocation(x, y);
      }
    }

    _onDragBegin() {
      this._removeMenuTimeout();
      this._dropX = null;
      this._dropY = null;
    }

    _onDragEnd() {
      if (this._dropX === null || this._dropX === undefined)
        return;
      const [x, y] = this._keepOnScreen(Math.round(this._dropX), Math.round(this._dropY));
      this._dropX = null;
      this._dropY = null;
      this.set_position(x, y);
      this._saveLocation(x, y);
      this._refreshBlockedState();
    }

    _setParent() {
        const parent = this.get_parent();
        if (parent === Main.layoutManager.uiGroup)
            Main.layoutManager.removeChrome(this);
        else if (parent === Main.layoutManager._backgroundGroup)
            Main.layoutManager._backgroundGroup.remove_child(this);

        this._alwaysOnTop = this._settings.get_boolean('always-on-top');
        if (this._alwaysOnTop)
            Main.layoutManager.addTopChrome(this);
        else
            Main.layoutManager._backgroundGroup.add_child(this);
        this._refreshBlockedState();
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
      this._clearSource('_menuTimeoutId');
    }

    _setPopupTimeout() {
      this._removeMenuTimeout();
      this._menuTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
        this._menuTimeoutId = 0;
        this._popupMenu();
        return GLib.SOURCE_REMOVE;
      });
      GLib.Source.set_name_by_id(this._menuTimeoutId, '[visualizer] this.popupMenu');
    }

    _popupMenu() {
      try {
        this._removeMenuTimeout();
        if (!this._menu) {
          this._menu = new PopupMenu.PopupMenu(this, 0.5, St.Side.TOP);
          this._menu.addAction(_('Visualizer Settings'), () => {
            this._extension.openPreferences();
          });
          Main.uiGroup.add_child(this._menu.actor);
          this._visualMenuManager.addMenu(this._menu);
        }
        this._menu.open();
      } catch (e) {
        logError(e, 'Visualizer: unable to open the menu');
      }
    }

    destroy() {
      this._sourceToken++;
      this._readyWait?.cancel();
      this._readyWait = null;
      for (const property of ['_startupTimeoutId', '_blockedPollId', '_silenceTimeoutId',
        '_menuTimeoutId', '_retryId', '_sourceCheckId'])
        this._clearSource(property);
      if (this._fullscreenChangedId) {
        global.display.disconnect(this._fullscreenChangedId);
        this._fullscreenChangedId = null;
      }
      if (this._monitorsChangedId) {
        Main.layoutManager.disconnect(this._monitorsChangedId);
        this._monitorsChangedId = null;
      }
      if (this._settingsHandlerIds) {
        for (let id of this._settingsHandlerIds) {
          this._settings.disconnect(id);
        }
        this._settingsHandlerIds = null;
      }
      if (this._control) {
        for (const id of this._controlHandlerIds)
          this._control.disconnect(id);
        this._controlHandlerIds = [];
        this._control = null;
      }
      this._coverWatcher?.stop();
      this._coverWatcher = null;
      this._teardownGst();
      if (this._menu) {
        this._visualMenuManager.removeMenu(this._menu);
        this._menu.destroy();
        this._menu = null;
      }
      const parent = this.get_parent();
      if (parent === Main.layoutManager.uiGroup)
        Main.layoutManager.removeChrome(this);
      else if (parent === Main.layoutManager._backgroundGroup)
        Main.layoutManager._backgroundGroup.remove_child(this);
      super.destroy();
      this._settings = null;
    }
  });
