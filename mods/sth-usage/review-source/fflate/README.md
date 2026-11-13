# Decoder source for review

`browser.js` is the unmodified `package/esm/browser.js` from the npm **fflate
0.8.3** archive. `entry.js` selects only its `unzlibSync` export. These files
are build inputs for `hooks/vendor/inflate.js`; Claude does not import them.
The upstream file includes other library APIs that are removed by tree shaking
and are not available to the running plugin. The MIT license is bundled at
`hooks/vendor/LICENSE.fflate`.

Source archive: <https://registry.npmjs.org/fflate/-/fflate-0.8.3.tgz>

- Archive SHA-256: `38c2cd824402407b43153c782274aec2ea83ea688e4aa0b743c5f2c305857d92`
- `browser.js` SHA-256: `b7ca4450b19559a1d50eb381adcee94b82449674be4cd17789d9beba7e6122a1`
- Decoder SHA-256: `4ffe109ba11ddff2fac004d7b14706621124dcbc3d588905a7a39a41d8663d28`

From the plugin root, with an existing local **esbuild 0.27.0** executable:

```sh
python3 review-source/fflate/rebuild.py --esbuild /path/to/esbuild --compare hooks/vendor/inflate.js
```

This manually invoked review script runs the supplied esbuild executable with
`--version`, then `entry.js --bundle --format=esm --tree-shaking=true` in this
directory. It replaces the generated source-location comment with the existing
two-line attribution and compares every output byte. It does not write the
decoder, execute it, install dependencies, or contact a host.
