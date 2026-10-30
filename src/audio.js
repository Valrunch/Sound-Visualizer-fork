import GLib from 'gi://GLib';
import Gvc from 'gi://Gvc';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

export function getMixerControl() {
  const quickSettings = Main.panel?.statusArea?.quickSettings;
  return Volume.getMixerControl?.() ??
    quickSettings?._volumeOutput?._control ??
    quickSettings?._volumeInput?._control ??
    quickSettings?._volume?._control ?? null;
}

export const isReady = control =>
  control.get_state() === Gvc.MixerControlState.READY;

// Resolves with the control once it is READY. cancel() rejects the promise and cleans up.
export function whenReady(control, timeoutSeconds = 15) {
  let stateId = 0;
  let timeoutId = 0;
  let rejectPending = null;
  const cleanup = () => {
    if (stateId) {
      control.disconnect(stateId);
      stateId = 0;
    }
    if (timeoutId) {
      GLib.Source.remove(timeoutId);
      timeoutId = 0;
    }
  };
  const promise = new Promise((resolve, reject) => {
    if (isReady(control)) {
      resolve(control);
      return;
    }
    rejectPending = reject;
    stateId = control.connect('state-changed', () => {
      const state = control.get_state();
      if (state === Gvc.MixerControlState.READY) {
        cleanup();
        resolve(control);
      } else if (state === Gvc.MixerControlState.FAILED) {
        cleanup();
        reject(new Error('The GNOME audio control failed to start'));
      }
    });
    timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, timeoutSeconds, () => {
      timeoutId = 0;
      cleanup();
      reject(new Error('Timed out waiting for the GNOME audio control'));
      return GLib.SOURCE_REMOVE;
    });
  });
  return {
    promise,
    cancel() {
      cleanup();
      rejectPending?.(new Error('cancelled'));
    },
  };
}

export function defaultMonitor(control) {
  const sink = control.get_default_sink();
  return sink ? `${sink.get_name()}.monitor` : null;
}
