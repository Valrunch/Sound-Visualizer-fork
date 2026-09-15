# Sound Visualizer ported to recent GNOME versions

> Supported GNOME versions:~~45~~, ~~46~~, ~~47~~, ~~48~~, ~~49~~, 50

> [!CAUTION]
> **Work In Progress:** This fork is currently under development. It is not yet stable or finished. Expect bugs and frequent updates!

# Sound Visualizer
A Sound Visualizer for GNOME Shell based on GStreamer, specifically for Wayland.

![demo](assets/visualization.gif)

For desktop widgets, I'm using the [Circular Widgets](https://extensions.gnome.org/extension/5530/circular-widgets/) extension.

# Features

- Drag and drop support
- Change audio source from the menu (Right/left click on the visualizer to change)
- Change visualizer size
- Increase or decrease bands
- Choose how many bands will appear on display
- Flip the visualizer
- Keep the visualizer always on top
- Change the visualizer color
- Change the visualizer style from bar to solid color
- Supports GNOME Shell v45, v46, v47, and v50

More features will be added in the future.

# Installation

**Option 1: From ZIP**
1. Download the zip file: https://github.com/Valrunch/Sound-Visualizer-fork/archive/refs/heads/main.zip
2. Extract the zip file and open the extracted folder in your terminal.
3. Run `make install`

**Option 2: From Git**
```bash
git clone
https://github.com/Valrunch/Sound-Visualizer-fork.git
cd Sound-Visualizer-fork
make install
```

# Acknowledgements & Credits

**This project is a patched version of the original [Sound Visualizer](https://gitlab.com/raihan2000/visualizer) created by "raihan2000".**

**Full credit for the original source code goes to the original author.**

This fork was created to update the codebase, add a few new features, ensure full compatibility with recent GNOME releases, and just to enjoy working on it.

This extension is also inspired by [Glava](https://github.com/jarcode-foss/glava).

Licensed under the [GPL-3.0 License](LICENSE) (same as the original project).
