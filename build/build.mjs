import { PACKAGE_ID, PATHS } from "./util.mjs"
import { analyzeMetafile, context, formatMessages } from "esbuild"
import { argv, platform } from "node:process"
import { isEmpty, kebabCase } from "lodash-es"
import { copy } from "esbuild-plugin-copy"
import cssEscape from "css.escape"
import esbuildCompress from "esbuild-compress"
import esbuildSvelte from "esbuild-svelte"
import { nodeExternalsPlugin } from "esbuild-node-externals"
import shq from "shq"
import { spawn } from "node:child_process"
import { sveltePreprocess } from "svelte-preprocess"
import which from "which"
import { writeFile } from "node:fs/promises"

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
		entryPoints: [
			"src/index.ts",
			"src/inject/index.ts",
			"src/style.css",
		],
		external: ["node:*"],
		footer: { js: COMMENT },
		format: "esm",
		jsx: "transform",
		legalComments: "inline",
		loader: {},
		logLevel: "info",
		logLimit: 0,
		metafile: true,
		minify: false,
		outdir: PATHS.outDir,
		platform: "browser",
		plugins: [
			nodeExternalsPlugin({}),
			copy({
				assets: [
					{
						from: ["src/**/*.d.svelte.ts", "src/**/*.svelte"],
						to: ["src/"],
					},
				],
			}),
			esbuildCompress({
				compressors: [
					{
						filter: /\.json$/, // eslint-disable-line require-unicode-regexp
						loader: "json",
					},
				],
			}),
			esbuildSvelte({
				cache: true,
				compilerOptions: {
					css: "injected",
					cssHash({ name }) {
						return cssEscape(`${PACKAGE_ID0}-svelte-${kebabCase(name)}`)
							.replace(/\\./gu, "_")
					},
				},
				include: /\.svelte$/, // eslint-disable-line require-unicode-regexp
				moduleCompilerOptions: {
					dev: DEV,
					generate: "client",
				},
				preprocess: [
					sveltePreprocess({
						aliases: [],
						globalStyle: {
							sourceMap: DEV,
						},
						preserve: [],
						replace: [],
						sourceMap: DEV,
						typescript: {
							compilerOptions: {
								module: "ESNext",
								moduleResolution: "node10",
								verbatimModuleSyntax: true,
							},
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

async function tsc() {
	const npx = await which("npx", {})
	return new Promise((resolve, reject) => {
		spawn(
			platform === "win32" ? `"${npx}"` : shq(npx),
			[
				"--package",
				"typescript",
				"--",
				"tsc",
				"--emitDeclarationOnly",
				...DEV ? ["--watch"] : [],
			],
			{
				// https://github.com/nodejs/node/issues/52554
				shell: true,
				stdio: "inherit",
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
	if (DEV) {
		await BUILD.watch({})
	} else {
		try {
			// Await https://github.com/evanw/esbuild/issues/2886
			const { errors, warnings, metafile } = await BUILD.rebuild()
			await Promise.all([
				(async () => {
					if (metafile) {
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
				...metafile
					? [
						writeFile(
							PATHS.metafile,
							JSON.stringify(metafile, null, "\t"),
							{ encoding: "utf-8" },
						),
					]
					: [],
			])
		} finally {
			await BUILD.dispose()
		}
	}
}
await Promise.all([tsc(), esbuild()])
