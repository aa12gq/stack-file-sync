const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");
const minify = process.argv.includes("--minify");

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ["./src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node16",
  sourcemap: !minify,
  minify: minify,
};

async function build() {
  try {
    if (watch) {
      // 使用 context 来处理监视模式
      const context = await esbuild.context(buildOptions);
      await context.watch();
      console.log("Watching for changes...");
    } else {
      // 普通构建模式
      await esbuild.build(buildOptions);
      console.log("Build completed");
    }
  } catch (err) {
    console.error("Build failed:", err);
    process.exit(1);
  }
}

build();
