# Third-party notices

`hooks/vendor/inflate.js` contains the synchronous zlib decoder from **fflate
0.8.3**, by Arjun Barrett, distributed under the MIT license. Its license is
included in [`hooks/vendor/LICENSE.fflate`](hooks/vendor/LICENSE.fflate).

Source: <https://github.com/101arrowz/fflate/tree/v0.8.3>

The bundled module is the tree-shaken `unzlibSync` export from
`fflate/esm/browser.js`. It uses no network access or platform dependencies.
