# Submitted build sources

The plugin ships its readable hooks, UI, types, vendored decoder and frame sheets unchanged. This folder also includes the exact packaging/encoding scripts, upstream decoder input and original Buddy Blender model. None of these review files is registered as a runtime hook. See `fflate/README.md` to reproduce the decoder byte for byte.

`source-manifest.json` records the source commit and SHA-256 of every copied input. `sourceHasChanges` identifies a local preview; release staging rejects those previews. The original 574 rendered PNG frames are inventoried with their exact hashes; they remain in the source repository at the recorded commit rather than being duplicated in the compact distribution. The build checks every decoded animation pixel against them.

To rebuild the complete distribution, check out that commit, install the pinned Pillow 12.3.0 and NumPy 2.3.5 build dependencies, and run `python mods/sth-usage/tools/build_directory_bundle.py --source mods/sth-usage --output /tmp/buddy-review-build --include-tests`. Run `python mods/sth-usage/tools/test_directory_packaging.py` to check packaging. The output directory must be new. These are manually invoked build tools, not commands launched by the installed plugin.
