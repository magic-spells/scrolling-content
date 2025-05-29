import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import serve from 'rollup-plugin-serve';
import copy from 'rollup-plugin-copy';

const production = !process.env.ROLLUP_WATCH;
const name = 'scrolling-content';

export default [
  // ESM build
  {
    input: 'src/scrolling-content.js',
    output: {
      file: `dist/${name}.esm.js`,
      format: 'es',
      sourcemap: !production,
    },
    plugins: [
      resolve(),
    ],
  },
  // CommonJS build
  {
    input: 'src/scrolling-content.js',
    output: {
      file: `dist/${name}.cjs.js`,
      format: 'cjs',
      sourcemap: !production,
      exports: 'named',
    },
    plugins: [resolve()],
  },
  // UMD build
  {
    input: 'src/scrolling-content.js',
    output: {
      file: `dist/${name}.js`,
      format: 'umd',
      name: 'ScrollingContent',
      sourcemap: !production,
    },
    plugins: [resolve()],
  },
  // Minified UMD for browsers
  {
    input: 'src/scrolling-content.js',
    output: {
      file: `dist/${name}.min.js`,
      format: 'umd',
      name: 'ScrollingContent',
      sourcemap: !production,
    },
    plugins: [
      resolve(),
      terser({
        keep_classnames: true,
        format: {
          comments: false,
        },
      }),
      // Copy files to demo folder
      copy({
        targets: [
          { src: `dist/${name}.esm.js`, dest: 'demo' },
          { src: `dist/${name}.esm.js.map`, dest: 'demo' }
        ],
        hook: 'writeBundle'
      }),
    ],
  },
  // Development server
  ...(!production
    ? [
        {
          input: 'src/scrolling-content.js',
          output: {
            file: `dist/${name}.esm.js`,
            format: 'es',
            sourcemap: true,
          },
          plugins: [
            resolve(),
            serve({
              contentBase: ['dist', 'demo'],
              open: true,
              port: 3000,
            }),
            copy({
              targets: [
                { src: `dist/${name}.esm.js`, dest: 'demo' },
                { src: `dist/${name}.esm.js.map`, dest: 'demo' }
              ],
              hook: 'writeBundle',
            }),
          ],
        },
      ]
    : []),
];
