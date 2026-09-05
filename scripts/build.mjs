import { build, createServer } from 'vite';
import { rm, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import liveReload from '@magic-spells/vite-plugin-live-reload';

const isDev = process.env.NODE_ENV === 'development';
const outDir = isDev ? 'demo/dist' : 'dist';

function sharedBuild(overrides = {}) {
	return {
		configFile: false,
		logLevel: isDev ? 'warn' : 'info',
		css: { transformer: 'lightningcss' },
		build: {
			outDir,
			emptyOutDir: false,
			sourcemap: isDev,
			target: 'es2022',
			reportCompressedSize: !isDev,
			watch: isDev ? {} : null,
			...overrides.build,
		},
		...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== 'build')),
	};
}

function esmConfig() {
	return sharedBuild({
		build: {
			lib: {
				entry: 'src/scrolling-content.js',
				fileName: () => 'scrolling-content.esm.js',
				formats: ['es'],
			},
			minify: false,
			rolldownOptions: {
				output: { exports: 'named' },
			},
		},
	});
}

function umdMinConfig() {
	return sharedBuild({
		build: {
			lib: {
				entry: 'src/scrolling-content.js',
				name: 'ScrollingContent',
				fileName: () => 'scrolling-content.min.js',
				formats: ['umd'],
			},
			minify: 'terser',
			terserOptions: {
				mangle: { keep_classnames: true, keep_fnames: false },
			},
			rolldownOptions: {
				output: { exports: 'named' },
			},
		},
	});
}

// Unminified UMD — dev only. The demo can reference `dist/scrolling-content.js`
// for readable stack traces without shipping it in the published `dist/`.
function umdDevConfig() {
	return sharedBuild({
		build: {
			lib: {
				entry: 'src/scrolling-content.js',
				name: 'ScrollingContent',
				fileName: () => 'scrolling-content.js',
				formats: ['umd'],
			},
			minify: false,
			rolldownOptions: {
				output: { exports: 'named' },
			},
		},
	});
}

// The `./css` export. The JS bundles still carry the same rules inline (they
// inject them when nothing else has), so this file exists for bundler users who
// want the stylesheet in their own build — a Tailwind app importing it into
// `layer(components)`, say. It is wrapped in the SAME `@layer
// scrolling-content` the runtime injection uses, so the two delivery paths
// cascade identically; keep the wrapper in sync with injectStyles() in src/.
async function writeStylesheet() {
	const css = await readFile('src/scrolling-content.css', 'utf8');
	await writeFile('dist/scrolling-content.css', `@layer scrolling-content {\n${css}\n}\n`);
}

async function main() {
	if (!isDev) {
		await rm(outDir, { recursive: true, force: true });
		await mkdir(outDir, { recursive: true });
	} else if (!existsSync(outDir)) {
		await mkdir(outDir, { recursive: true });
	}

	const configs = [esmConfig(), umdMinConfig()];
	if (isDev) configs.push(umdDevConfig());

	if (isDev) {
		// Watch builds don't resolve until the watcher closes — fire and forget.
		for (const cfg of configs) {
			build(cfg).catch((e) => {
				console.error('build error:', e);
			});
		}

		const server = await createServer({
			configFile: false,
			root: 'demo',
			server: { port: 3080, open: true, strictPort: false },
			plugins: [liveReload('demo/dist')],
		});
		await server.listen();
		server.printUrls();
	} else {
		// Sequential for deterministic output ordering and a smaller memory footprint.
		for (const cfg of configs) {
			await build(cfg);
		}
		// Hand-maintained declarations ship alongside the bundles.
		await copyFile('src/scrolling-content.d.ts', 'dist/scrolling-content.d.ts');
		await writeStylesheet();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
