# WebOrca

WebOrca brings OrcaSlicer's 3D printing workflow to the browser. It pairs a web interface with OrcaSlicer's C++ slicing engine compiled to WebAssembly, with layouts for desktop and mobile.

- Import STL, OBJ, STEP and 3MF files, arrange models across plates, and edit geometry.
- Configure printer, filament and process presets, including multicolor projects and painting tools.
- Slice in the browser, inspect layers and toolpaths, and export G-code or save a 3MF project.
- Browse a model catalog and connect to supported printers for monitoring and job delivery. Printer integrations depend on the provider and a compatible backend.

WebOrca is under active development. Browser features and printer support vary, and full desktop feature parity is still in progress.

The web interface lives in [wasm/app](wasm/app), with the slicing bridge in [wasm/engine](wasm/engine). The inherited slicing engine is in [src/libslic3r](src/libslic3r).

## Credits

WebOrca builds on [OrcaSlicer](https://github.com/OrcaSlicer/OrcaSlicer) and the work of its contributors. Its slicing heritage runs through [Bambu Studio](https://github.com/bambulab/BambuStudio), [PrusaSlicer](https://github.com/prusa3d/PrusaSlicer) (formerly Slic3r Prusa Edition, or Slic3r PE), and [Slic3r](https://github.com/Slic3r/Slic3r), created by Alessandro Ranellucci and the RepRap community. Thanks to Bambu Lab, Prusa Research, and all the contributors who made these projects possible, as well as [SuperSlicer](https://github.com/supermerill/SuperSlicer) for contributions and ideas carried into OrcaSlicer.

The project also relies on open-source tools and libraries, including React, Three.js, Emscripten, Boost, CGAL and Open CASCADE. Credit belongs to their authors and maintainers, alongside the many dependencies included throughout this repository.

## License

WebOrca is licensed under the [GNU Affero General Public License v3](LICENSE.txt). Bundled third-party components retain their respective licenses and copyright notices.
