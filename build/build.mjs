import { PACKAGE_ID, PATHS } from "./util.mjs"
import { analyzeMetafile, context, formatMessages } from "esbuild"
import {
	constant,
	escapeRegExp,
	isEmpty,
	isUndefined,
	kebabCase,
} from "lodash-es"
import { readFile, writeFile } from "node:fs/promises"
import { argv } from "node:process"
import { copy } from "esbuild-plugin-copy"
import esbuildSvelte from "esbuild-svelte"
import lzString from "lz-string"
import { nodeExternalsPlugin } from "esbuild-node-externals"
import { spawn } from "node:child_process"
import sveltePreprocess from "svelte-preprocess"

const ARGV_PRODUCTION = 2,
	COMMENT = "// repository: https://github.com/polyipseity/obsidian-plugin-library",
	DEV = argv[ARGV_PRODUCTION] === "dev",
	PACKAGE_ID0 = await PACKAGE_ID,
	BUILD = await context({
		alias: {},
		banner: { js: COMMENT },
		bundle: true,
		color: true,
		drop: [],
		entryPoints: ["sources/index.ts", "sources/style.css"],
		external: [],
		footer: { js: COMMENT },
		format: "esm",
		jsx: "transform",
		legalComments: "inline",
		loader: {
			".json": "compressed-json",
		},
		logLevel: "info",
		logLimit: 0,
		metafile: true,
		minify: !DEV,
		outdir: PATHS.outDir,
		platform: "browser",
		plugins: [
			nodeExternalsPlugin({}),
			copy({
				assets: [
					{
						from: ["sources/**/*.svelte"],
						to: ["sources"],
					},
				],
			}),
			{
				name: "compress",
				setup(build) {
					function str(string) {
						if (typeof string !== "string") {
							throw new TypeError(string)
						}
						return `\`${string.replace(/(?<char>`|\\|\$)/ug, "\\$<char>")}\``
					}
					const loaders = build.initialOptions.loader ?? {}
					for (const [ext, loader] of Object.entries(loaders)) {
						const filter = () => new RegExp(`${escapeRegExp(ext)}$`, "u")
						if (loader === "compressed-text") {
							build.onLoad({ filter: filter() }, async ({ path }) => {
								const data = await readFile(path, { encoding: "utf-8" })
								return {
									contents: `
import PLazy from "p-lazy"
import { decompressFromBase64 as decompress } from "lz-string"
export default PLazy.from(() =>
	decompress(${str(lzString.compressToBase64(data))}))
`,
									loader: "js",
								}
							})
						} else if (loader === "compressed-json") {
							build.onLoad({ filter: filter() }, async ({ path }) => {
								const data = await readFile(path, { encoding: "utf-8" })
								JSON.parse(data)
								return {
									contents: `
import { decompressFromBase64 as decompress } from "lz-string"
export default JSON.parse(decompress(${str(lzString.compressToBase64(data))}))
`,
									loader: "js",
								}
							})
						} else {
							continue
						}
						loaders[ext] = "empty"
					}
				},
			},
			esbuildSvelte({
				cache: "overzealous",
				compilerOptions: {
					accessors: false,
					css: "injected",
					cssHash({ name }) {
						return `${PACKAGE_ID0}-svelte-${kebabCase(name)}`
					},
					customElement: false,
					dev: DEV,
					enableSourcemap: {
						css: DEV,
						js: true,
					},
					errorMode: "throw",
					format: "esm",
					generate: "dom",
					hydratable: false,
					immutable: true,
					legacy: false,
					loopGuardTimeout: 0,
					preserveComments: false,
					preserveWhitespace: false,
					varsReport: "full",
				},
				filterWarnings: constant(true),
				fromEntryFile: false,
				include: /\.svelte$/u,
				preprocess: [
					sveltePreprocess({
						aliases: [],
						globalStyle: {
							sourceMap: DEV,
						},
						preserve: [],
						replace: [],
						sourceMap: false,
						typescript: {
							compilerOptions: {},
							handleMixedImports: true,
							reportDiagnostics: true,
							tsconfigDirectory: "./",
							tsconfigFile: "./tsconfig.json",
						},
					}),
				],
			}),
		],
		sourcemap: "linked",
		sourcesContent: true,
		target: "ES2022",
		treeShaking: true,
	})

function tsc() {
	return new Promise((resolve, reject) => {
		spawn(
			"npx",
			["tsc", "--emitDeclarationOnly", ...DEV ? ["--watch"] : []],
			{
				shell: true,
			},
		)
			.once("error", reject)
			.once("exit", (code, signal) => {
				if (code === 0) {
					resolve()
					return
				}
				reject(code ?? signal)
			})
	})
}
async function esbuild() {
	try {
		if (DEV) {
			await BUILD.watch({})
		} else {
			// Await https://github.com/evanw/esbuild/issues/2886
			const { errors, warnings, metafile } = await BUILD.rebuild()
			await Promise.all([
				(async () => {
					if (!isUndefined(metafile)) {
						console.log(await analyzeMetafile(metafile, {
							color: true,
							verbose: true,
						}))
					}
					for await (const logging of [
						{
							data: warnings,
							kind: "warning",
							log: console.warn.bind(console),
						},
						{
							data: errors,
							kind: "error",
							log: console.error.bind(console),
						},
					]
						.filter(({ data }) => !isEmpty(data))
						.map(async ({ data, kind, log }) => {
							const message = (await formatMessages(data, {
								color: true,
								kind,
							})).join("\n")
							return () => log(message)
						})) {
						logging()
					}
				})(),
				isUndefined(metafile)
					? null
					: writeFile(
						PATHS.metafile,
						JSON.stringify(metafile, null, "\t"),
						{ encoding: "utf-8" },
					),
			])
		}
	} finally {
		await BUILD.dispose()
	}
}
await Promise.all([tsc(), esbuild()])
