import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Soup from 'gi://Soup?version=3.0';
import {dominantColors} from './dsp.js';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
const SAMPLE_SIZE = 32;
const MAX_REMOTE_BYTES = 4 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
const REMOTE_TIMEOUT_S = 5;
const DEBOUNCE_MS = 300;

const isCancelled = e => e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);

function dbusCall(connection, cancellable, bus, path, iface, method, params, replyType) {
  return new Promise((resolve, reject) => {
    connection.call(bus, path, iface, method, params, GLib.VariantType.new(replyType),
      Gio.DBusCallFlags.NONE, 1000, cancellable, (conn, res) => {
        try {
          resolve(conn.call_finish(res));
        } catch (e) {
          reject(e);
        }
      });
  });
}

function openFile(file, cancellable) {
  return new Promise((resolve, reject) => {
    file.read_async(GLib.PRIORITY_DEFAULT, cancellable, (f, res) => {
      try {
        resolve(f.read_finish(res));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function sendRequest(session, message, cancellable) {
  return new Promise((resolve, reject) => {
    session.send_async(message, GLib.PRIORITY_DEFAULT, cancellable, (s, res) => {
      try {
        resolve(s.send_finish(res));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function readChunk(stream, cancellable) {
  return new Promise((resolve, reject) => {
    stream.read_bytes_async(CHUNK_BYTES, GLib.PRIORITY_DEFAULT, cancellable, (s, res) => {
      try {
        resolve(s.read_bytes_finish(res));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function decodePixbuf(stream, cancellable) {
  return new Promise((resolve, reject) => {
    GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, SAMPLE_SIZE, SAMPLE_SIZE, true, cancellable, (_o, res) => {
      try {
        resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(res));
      } catch (e) {
        reject(e);
      }
    });
  });
}

export class CoverWatcher {
  constructor(onColors) {
    this._onColors = onColors;
    this._lastUrl = undefined;
    this._subscriptions = [];
  }

  start() {
    if (this._cancellable)
      return;
    this._cancellable = new Gio.Cancellable();
    this._connection = Gio.DBus.session;
    const subscribe = (...args) =>
      this._connection.signal_subscribe(...args, () => this._schedule(DEBOUNCE_MS));
    this._subscriptions = [
      subscribe(null, 'org.freedesktop.DBus.Properties', 'PropertiesChanged', MPRIS_PATH,
        PLAYER_IFACE, Gio.DBusSignalFlags.NONE),
      subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged',
        '/org/freedesktop/DBus', 'org.mpris.MediaPlayer2', Gio.DBusSignalFlags.MATCH_ARG0_NAMESPACE),
    ];
    this._schedule(0);
  }

  stop() {
    if (!this._cancellable)
      return;
    for (const id of this._subscriptions)
      this._connection.signal_unsubscribe(id);
    this._subscriptions = [];
    if (this._debounceId) {
      GLib.Source.remove(this._debounceId);
      this._debounceId = 0;
    }
    this._cancellable.cancel();
    this._cancellable = null;
    this._loading?.cancel();
    this._loading = null;
    this._session?.abort();
    this._session = null;
    this._connection = null;
    this._lastUrl = undefined;
  }

  _schedule(delayMs) {
    if (this._debounceId)
      GLib.Source.remove(this._debounceId);
    this._debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
      this._debounceId = 0;
      this._refresh();
      return GLib.SOURCE_REMOVE;
    });
  }

  async _refresh() {
    const cancellable = this._cancellable;
    try {
      const url = await this._findArtUrl(cancellable);
      if (cancellable.is_cancelled() || url === this._lastUrl)
        return;
      this._lastUrl = url;
      this._loading?.cancel();
      this._loading = null;
      if (!url) {
        this._onColors(null);
        return;
      }
      const loading = new Gio.Cancellable();
      this._loading = loading;
      let colors = null;
      try {
        colors = await this._loadColors(url, loading);
      } catch (e) {
        if (isCancelled(e))
          return;
        console.warn(`Visualizer: cannot read the album cover: ${e.message}`);
      }
      if (!loading.is_cancelled())
        this._onColors(colors);
    } catch (e) {
      if (!isCancelled(e))
        console.warn(`Visualizer: MPRIS lookup failed: ${e.message}`);
    }
  }

  async _findArtUrl(cancellable) {
    const names = (await dbusCall(this._connection, cancellable, 'org.freedesktop.DBus',
      '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames', null, '(as)'))
      .deepUnpack()[0].filter(n => n.startsWith(MPRIS_PREFIX));
    let paused = null;
    for (const name of names) {
      try {
        const props = (await dbusCall(this._connection, cancellable, name, MPRIS_PATH,
          'org.freedesktop.DBus.Properties', 'GetAll', new GLib.Variant('(s)', [PLAYER_IFACE]),
          '(a{sv})')).recursiveUnpack()[0];
        const art = props.Metadata?.['mpris:artUrl'];
        const url = typeof art === 'string' && art !== '' ? art : null;
        if (props.PlaybackStatus === 'Playing')
          return url;
        if (props.PlaybackStatus === 'Paused' && paused === null)
          paused = url;
      } catch (e) {
        if (isCancelled(e))
          throw e;
      }
    }
    return paused;
  }

  async _loadColors(url, cancellable) {
    const scheme = GLib.Uri.parse(url, GLib.UriFlags.NONE).get_scheme();
    let stream;
    if (scheme === 'file')
      stream = await openFile(Gio.File.new_for_uri(url), cancellable);
    else if (scheme === 'http' || scheme === 'https')
      stream = Gio.MemoryInputStream.new_from_bytes(await this._download(url, cancellable));
    else
      return null;
    try {
      const pixbuf = await decodePixbuf(stream, cancellable);
      return dominantColors(pixbuf.get_pixels(), pixbuf.get_width(), pixbuf.get_height(),
        pixbuf.get_rowstride(), pixbuf.get_n_channels());
    } finally {
      try {
        stream.close(null);
      } catch (e) {}
    }
  }

  async _download(url, cancellable) {
    this._session ??= new Soup.Session({timeout: REMOTE_TIMEOUT_S});
    const message = Soup.Message.new('GET', url);
    if (!message)
      throw new Error('invalid URL');
    const stream = await sendRequest(this._session, message, cancellable);
    try {
      if (message.get_status() !== Soup.Status.OK)
        throw new Error(`HTTP ${message.get_status()}`);
      if (message.get_response_headers().get_content_length() > MAX_REMOTE_BYTES)
        throw new Error('image too large');
      const out = Gio.MemoryOutputStream.new_resizable();
      let received = 0;
      for (;;) {
        const chunk = await readChunk(stream, cancellable);
        const size = chunk.get_size();
        if (size === 0)
          break;
        received += size;
        if (received > MAX_REMOTE_BYTES)
          throw new Error('image too large');
        out.write_bytes(chunk, null);
      }
      out.close(null);
      return out.steal_as_bytes();
    } finally {
      try {
        stream.close(null);
      } catch (e) {}
    }
  }
}
