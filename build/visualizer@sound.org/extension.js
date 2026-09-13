import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Visual from './visual.js';

export default class Visualiser extends Extension {
    enable() {
        this.visualiser = new Visual.Visualizer(this);
    }

    disable() {
        this.visualiser.destroy();
        this.visualiser = null;
    }
}
