import { createRequire } from 'module';
import { useNuxt, addPluginTemplate, resolvePath, addTemplate, resolveAlias, addWebpackPlugin, addVitePlugin, addPlugin, extendWebpackConfig, resolveFiles, defineNuxtModule, logger, installModule, tryResolveModule, nuxtCtx, checkNuxtCompatibility } from '@nuxt/kit';
import fs, { existsSync, readdirSync, statSync, promises } from 'fs';
import fetch from 'node-fetch';
import fse from 'fs-extra';
import { joinURL, stringifyQuery, withoutTrailingSlash, parseURL, parseQuery } from 'ufo';
import { dirname, join as join$1, resolve, isAbsolute, relative, parse as parse$1, normalize } from 'pathe';
import { createNitro, writeTypes, build, prepare, copyPublicAssets, prerender, createDevServer } from 'nitropack';
import { dynamicEventHandler, toEventHandler } from 'h3';
import { defu } from 'defu';
import { fileURLToPath, pathToFileURL } from 'url';
import { join } from 'path';
import { findStaticImports, resolveImports, findExports } from 'mlly';
import { genDynamicImport, genString } from 'knitwork';
import { generateTypes, resolveSchema } from 'untyped';
import MagicString from 'magic-string';
import { createUnplugin } from 'unplugin';
import crypto from 'crypto';
import { parse } from 'acorn';
import { walk } from 'estree-walker';
import { promisify } from 'util';
import enhancedResolve from 'enhanced-resolve';
import * as CompositionApi from '@vue/composition-api';
import { defineUnimportPreset, createUnimport, toImports } from 'unimport';
import { camelCase } from 'scule';
import scriptSetupPlugin from 'unplugin-vue2-script-setup/nuxt';

class AsyncLoadingPlugin {
  constructor(opts) {
    this.opts = opts;
    const _require = createRequire(import.meta.url);
    const TemplatePath = _require.resolve("webpack/lib/Template", { paths: [...this.opts.modulesDir] });
    this.Template = _require(TemplatePath);
  }
  apply(compiler) {
    compiler.hooks.compilation.tap("AsyncLoading", (compilation) => {
      const mainTemplate = compilation.mainTemplate;
      mainTemplate.hooks.requireEnsure.tap("AsyncLoading", (_source, chunk, hash) => {
        const Template = this.Template;
        const chunkFilename = mainTemplate.outputOptions.chunkFilename;
        const chunkMaps = chunk.getChunkMaps();
        const insertMoreModules = [
          "var moreModules = chunk.modules, chunkIds = chunk.ids;",
          "for(var moduleId in moreModules) {",
          Template.indent(mainTemplate.renderAddModule(hash, chunk, "moduleId", "moreModules[moduleId]")),
          "}"
        ];
        return Template.asString([
          "// Async chunk loading for Nitro",
          "",
          "var installedChunkData = installedChunks[chunkId];",
          'if(installedChunkData !== 0) { // 0 means "already installed".',
          Template.indent([
            '// array of [resolve, reject, promise] means "currently loading"',
            "if(installedChunkData) {",
            Template.indent(["promises.push(installedChunkData[2]);"]),
            "} else {",
            Template.indent([
              "// load the chunk and return promise to it",
              "var promise = new Promise(function(resolve, reject) {",
              Template.indent([
                "installedChunkData = installedChunks[chunkId] = [resolve, reject];",
                "import(" + mainTemplate.getAssetPath(JSON.stringify(`./${chunkFilename}`), {
                  hash: `" + ${mainTemplate.renderCurrentHashCode(hash)} + "`,
                  hashWithLength: (length) => `" + ${mainTemplate.renderCurrentHashCode(hash, length)} + "`,
                  chunk: {
                    id: '" + chunkId + "',
                    hash: `" + ${JSON.stringify(chunkMaps.hash)}[chunkId] + "`,
                    hashWithLength: (length) => {
                      const shortChunkHashMap = {};
                      for (const chunkId of Object.keys(chunkMaps.hash)) {
                        if (typeof chunkMaps.hash[chunkId] === "string") {
                          shortChunkHashMap[chunkId] = chunkMaps.hash[chunkId].substr(0, length);
                        }
                      }
                      return `" + ${JSON.stringify(shortChunkHashMap)}[chunkId] + "`;
                    },
                    contentHash: {
                      javascript: `" + ${JSON.stringify(chunkMaps.contentHash.javascript)}[chunkId] + "`
                    },
                    contentHashWithLength: {
                      javascript: (length) => {
                        const shortContentHashMap = {};
                        const contentHash = chunkMaps.contentHash.javascript;
                        for (const chunkId of Object.keys(contentHash)) {
                          if (typeof contentHash[chunkId] === "string") {
                            shortContentHashMap[chunkId] = contentHash[chunkId].substr(0, length);
                          }
                        }
                        return `" + ${JSON.stringify(shortContentHashMap)}[chunkId] + "`;
                      }
                    },
                    name: `" + (${JSON.stringify(chunkMaps.name)}[chunkId]||chunkId) + "`
                  },
                  contentHashType: "javascript"
                }) + ").then(chunk => {",
                Template.indent(insertMoreModules.concat([
                  "var callbacks = [];",
                  "for(var i = 0; i < chunkIds.length; i++) {",
                  Template.indent([
                    "if(installedChunks[chunkIds[i]])",
                    Template.indent([
                      "callbacks = callbacks.concat(installedChunks[chunkIds[i]][0]);"
                    ]),
                    "installedChunks[chunkIds[i]] = 0;"
                  ]),
                  "}",
                  "for(i = 0; i < callbacks.length; i++)",
                  Template.indent("callbacks[i]();")
                ])),
                "});"
              ]),
              "});",
              "promises.push(installedChunkData[2] = promise);"
            ]),
            "}"
          ]),
          "}"
        ]);
      });
    });
  }
}

let dir = dirname(fileURLToPath(import.meta.url));
while (dir !== "/" && !existsSync(join(dir, "package.json"))) {
  dir = dirname(dir);
}
const pkgDir = dir;
const distDir = join(pkgDir, "dist");

function readDirRecursively(dir) {
  return readdirSync(dir).reduce((files, file) => {
    const name = join$1(dir, file);
    const isDirectory2 = statSync(name).isDirectory();
    return isDirectory2 ? [...files, ...readDirRecursively(name)] : [...files, name];
  }, []);
}
async function isDirectory(path) {
  try {
    return (await promises.stat(path)).isDirectory();
  } catch (_err) {
    return false;
  }
}

async function setupNitroBridge() {
  const nuxt = useNuxt();
  if (!nuxt.options.dev && nuxt.options.target === "static" && !nuxt.options._prepare && !nuxt.options._export && !nuxt.options._legacyGenerate) {
    throw new Error("[nitro] Please use `nuxt generate` for static target");
  }
  nuxt.options.app.buildAssetsDir = nuxt.options.app.buildAssetsDir || nuxt.options.app.assetsPath;
  nuxt.options.app.assetsPath = nuxt.options.app.buildAssetsDir;
  nuxt.options.app.baseURL = nuxt.options.app.baseURL || nuxt.options.app.basePath;
  nuxt.options.app.cdnURL = nuxt.options.app.cdnURL || "";
  const publicConfig = nuxt.options.publicRuntimeConfig;
  const appConfig = { ...publicConfig._app, ...publicConfig.app };
  delete publicConfig.app;
  delete publicConfig._app;
  nuxt.options.runtimeConfig = defu(nuxt.options.runtimeConfig, {
    ...publicConfig,
    ...nuxt.options.privateRuntimeConfig,
    public: publicConfig,
    app: appConfig
  });
  nuxt.options.build.loadingScreen = false;
  nuxt.options.build.indicator = false;
  if (nuxt.options.build.analyze === true) {
    const { rootDir } = nuxt.options;
    nuxt.options.build.analyze = {
      template: "treemap",
      projectRoot: rootDir,
      filename: join$1(rootDir, ".nuxt/stats", "{name}.html")
    };
  }
  const _nitroConfig = nuxt.options.nitro || {};
  const nitroConfig = defu(_nitroConfig, {
    rootDir: resolve(nuxt.options.rootDir),
    srcDir: resolve(nuxt.options.srcDir, "server"),
    dev: nuxt.options.dev,
    preset: "nitro-dev",
    buildDir: resolve(nuxt.options.buildDir),
    scanDirs: nuxt.options._layers.map((layer) => join$1(layer.config.srcDir, "server")),
    renderer: resolve(distDir, "runtime/nitro/renderer"),
    errorHandler: resolve(distDir, "runtime/nitro/error"),
    nodeModulesDirs: nuxt.options.modulesDir,
    handlers: [],
    devHandlers: [],
    runtimeConfig: {
      ...nuxt.options.runtimeConfig,
      nitro: {
        envPrefix: "NUXT_",
        ...nuxt.options.runtimeConfig.nitro
      }
    },
    typescript: {
      generateTsConfig: false
    },
    publicAssets: [
      {
        baseURL: nuxt.options.app.buildAssetsDir,
        dir: resolve(nuxt.options.buildDir, "dist/client")
      },
      ...nuxt.options._layers.map((layer) => join$1(layer.config.srcDir, layer.config.dir.static)).filter((dir) => existsSync(dir)).map((dir) => ({ dir }))
    ],
    prerender: {
      crawlLinks: nuxt.options.generate.crawler,
      routes: nuxt.options.generate.routes
    },
    externals: {
      inline: [
        ...nuxt.options.dev ? [] : ["vue", "@vue/", "@nuxt/", nuxt.options.buildDir],
        "@nuxt/bridge/dist",
        "@nuxt/bridge-edge/dist"
      ]
    },
    alias: {
      encoding: "unenv/runtime/mock/proxy",
      he: "unenv/runtime/mock/proxy",
      resolve: "unenv/runtime/mock/proxy",
      "source-map": "unenv/runtime/mock/proxy",
      "lodash.template": "unenv/runtime/mock/proxy",
      "serialize-javascript": "unenv/runtime/mock/proxy",
      "#vue-renderer": resolve(distDir, "runtime/nitro/vue2"),
      "#vue2-server-renderer": "vue-server-renderer/" + (nuxt.options.dev ? "build.dev.js" : "build.prod.js"),
      "#nitro/error": resolve(distDir, "runtime/nitro/error"),
      "#paths": resolve(distDir, "runtime/nitro/paths"),
      ...nuxt.options.alias
    },
    replace: {
      "process.env.NUXT_NO_SSR": nuxt.options.ssr === false ? true : void 0
    }
  });
  delete nitroConfig.alias["#build"];
  await nuxt.callHook("nitro:config", nitroConfig);
  const nitro = await createNitro(nitroConfig);
  await nuxt.callHook("nitro:init", nitro);
  nitro.vfs = nuxt.vfs = nitro.vfs || nuxt.vfs || {};
  nuxt.hook("close", () => nitro.hooks.callHook("close"));
  async function updateViteBase() {
    const clientDist = resolve(nuxt.options.buildDir, "dist/client");
    const publicDir = join$1(nuxt.options.srcDir, nuxt.options.dir.static);
    let publicFiles = [];
    if (await isDirectory(publicDir)) {
      publicFiles = readDirRecursively(publicDir).map((r) => r.replace(publicDir, ""));
      for (const file of publicFiles) {
        try {
          fse.rmSync(join$1(clientDist, file));
        } catch {
        }
      }
    }
    if (await isDirectory(clientDist)) {
      const nestedAssetsPath = withoutTrailingSlash(join$1(clientDist, nuxt.options.app.buildAssetsDir));
      if (await isDirectory(nestedAssetsPath)) {
        await fse.copy(nestedAssetsPath, clientDist, { recursive: true });
        await fse.remove(nestedAssetsPath);
      }
    }
  }
  nuxt.hook("generate:before", updateViteBase);
  nuxt.options.extensions.push("ts");
  nuxt.hook("webpack:config", (webpackConfigs) => {
    const serverConfig = webpackConfigs.find((config) => config.name === "server");
    if (serverConfig) {
      serverConfig.devtool = false;
    }
  });
  nuxt.hook("webpack:config", (webpackConfigs) => {
    const serverConfig = webpackConfigs.find((config) => config.name === "server");
    if (serverConfig) {
      serverConfig.plugins = serverConfig.plugins || [];
      serverConfig.plugins.push(new AsyncLoadingPlugin({
        modulesDir: nuxt.options.modulesDir
      }));
    }
  });
  addPluginTemplate({
    filename: "nitro-bridge.client.mjs",
    src: resolve(distDir, "runtime/nitro-bridge.client.mjs")
  });
  addPluginTemplate({
    filename: "nitro-bridge.server.mjs",
    src: resolve(distDir, "runtime/nitro-bridge.server.mjs")
  });
  nuxt.hook("webpack:config", (configs) => {
    for (const config of configs) {
      if (Array.isArray(config.resolve.alias)) {
        return;
      }
      config.resolve.alias.ufo = "ufo/dist/index.mjs";
      config.resolve.alias.ohmyfetch = "ohmyfetch/dist/index.mjs";
    }
  });
  nuxt.hook("build:compiled", async ({ name }) => {
    if (nuxt.options._prepare) {
      return;
    }
    if (name === "server") {
      const jsServerEntry = resolve(nuxt.options.buildDir, "dist/server/server.js");
      await promises.writeFile(jsServerEntry.replace(/.js$/, ".cjs"), 'module.exports = require("./server.js")', "utf8");
      await promises.writeFile(jsServerEntry.replace(/.js$/, ".mjs"), 'export { default } from "./server.cjs"', "utf8");
    } else if (name === "client") {
      const manifest = await promises.readFile(resolve(nuxt.options.buildDir, "dist/server/client.manifest.json"), "utf8");
      await promises.writeFile(resolve(nuxt.options.buildDir, "dist/server/client.manifest.mjs"), "export default " + manifest, "utf8");
    }
  });
  const devMidlewareHandler = dynamicEventHandler();
  nitro.options.devHandlers.unshift({ handler: devMidlewareHandler });
  const { handlers, devHandlers } = await resolveHandlers(nuxt);
  nitro.options.handlers.push(...handlers);
  nitro.options.devHandlers.push(...devHandlers);
  nitro.options.handlers.unshift({
    route: "/__nuxt_error",
    lazy: true,
    handler: resolve(distDir, "runtime/nitro/renderer")
  });
  if (nuxt.server) {
    nuxt.server.__closed = true;
    nuxt.server = createNuxt2DevServer(nitro);
    nuxt.hook("build:resources", () => {
      nuxt.server.reload();
    });
  }
  nuxt.hook("prepare:types", (opts) => {
    opts.references.push({ path: resolve(nuxt.options.buildDir, "types/nitro.d.ts") });
  });
  nuxt.hook("build:done", async () => {
    await writeTypes(nitro);
  });
  nuxt.options.build._minifyServer = false;
  nuxt.options.build.standalone = false;
  const waitUntilCompile = new Promise((resolve2) => nitro.hooks.hook("nitro:compiled", () => resolve2()));
  nuxt.hook("build:done", async () => {
    if (nuxt.options._prepare) {
      return;
    }
    await writeDocumentTemplate(nuxt);
    if (nuxt.options.dev) {
      await build(nitro);
      await waitUntilCompile;
    } else {
      await prepare(nitro);
      await copyPublicAssets(nitro);
      if (nuxt.options._generate || nuxt.options.target === "static") {
        await prerender(nitro);
      }
      await build(nitro);
    }
  });
  if (nuxt.options.dev) {
    nuxt.hook("build:compile", ({ compiler }) => {
      compiler.outputFileSystem = { ...fse, join: join$1 };
    });
    nuxt.hook("server:devMiddleware", (m) => {
      devMidlewareHandler.set(toEventHandler(m));
    });
  }
  nuxt.options.generate.dir = nitro.options.output.publicDir;
  nuxt.options.generate.manifest = false;
  nuxt.hook("generate:cache:ignore", (ignore) => {
    ignore.push(nitro.options.output.dir);
    ignore.push(nitro.options.output.serverDir);
    if (nitro.options.output.publicDir) {
      ignore.push(nitro.options.output.publicDir);
    }
  });
  nuxt.hook("generate:before", async () => {
    console.log("generate:before");
    await prepare(nitro);
  });
  nuxt.hook("generate:extendRoutes", async () => {
    console.log("generate:extendRoutes");
    await build(nitro);
    await nuxt.server.reload();
  });
  nuxt.hook("generate:done", async () => {
    console.log("generate:done");
    await nuxt.server.close();
    await build(nitro);
  });
}
function createNuxt2DevServer(nitro) {
  const server = createDevServer(nitro);
  const listeners = [];
  async function listen(port) {
    const listener = await server.listen(port, {
      showURL: false,
      isProd: true
    });
    listeners.push(listener);
    return listener;
  }
  async function renderRoute(route = "/", renderContext = {}) {
    const [listener] = listeners;
    if (!listener) {
      throw new Error("There is no server listener to call `server.renderRoute()`");
    }
    const res = await fetch(joinURL(listener.url, route), {
      headers: { "nuxt-render-context": stringifyQuery(renderContext) }
    });
    const html = await res.text();
    if (!res.ok) {
      return { html, error: res.statusText };
    }
    return { html };
  }
  return {
    ...server,
    listeners,
    renderRoute,
    listen,
    serverMiddlewarePaths() {
      return [];
    },
    ready() {
    }
  };
}
async function resolveHandlers(nuxt) {
  const handlers = [];
  const devHandlers = [];
  for (let m of nuxt.options.serverMiddleware) {
    if (typeof m === "string" || typeof m === "function") {
      m = { handler: m };
    }
    const route = m.path || m.route || "/";
    const handler = m.handler || m.handle;
    if (typeof handler !== "string" || typeof route !== "string") {
      devHandlers.push({ route, handler });
    } else {
      delete m.handler;
      delete m.path;
      handlers.push({
        ...m,
        route,
        handler: await resolvePath(handler)
      });
    }
  }
  return {
    handlers,
    devHandlers
  };
}
async function writeDocumentTemplate(nuxt) {
  const src = nuxt.options.appTemplatePath || resolve(nuxt.options.buildDir, "views/app.template.html");
  const dst = src.replace(/.html$/, ".mjs").replace("app.template.mjs", "document.template.mjs");
  const contents = nuxt.vfs[src] || await promises.readFile(src, "utf-8").catch(() => "");
  if (contents) {
    const compiled = `export default (params) => \`${contents.replace(/{{ (\w+) }}/g, "${params.$1}")}\``;
    await promises.mkdir(dirname(dst), { recursive: true });
    await promises.writeFile(dst, compiled, "utf8");
  }
}

const componentsTypeTemplate = {
  filename: "components.d.ts",
  getContents: ({ options }) => `// Generated by components discovery
declare module 'vue' {
  export interface GlobalComponents {
${options.components.map((c) => `    '${c.pascalName}': typeof ${genDynamicImport(isAbsolute(c.filePath) ? relative(options.buildDir, c.filePath) : c.filePath, { wrapper: false })}['${c.export}']`).join(",\n")}
${options.components.map((c) => `    'Lazy${c.pascalName}': typeof ${genDynamicImport(isAbsolute(c.filePath) ? relative(options.buildDir, c.filePath) : c.filePath, { wrapper: false })}['${c.export}']`).join(",\n")}
  }
}
${options.components.map((c) => `export const ${c.pascalName}: typeof ${genDynamicImport(isAbsolute(c.filePath) ? relative(options.buildDir, c.filePath) : c.filePath, { wrapper: false })}['${c.export}']`).join("\n")}
${options.components.map((c) => `export const Lazy${c.pascalName}: typeof ${genDynamicImport(isAbsolute(c.filePath) ? relative(options.buildDir, c.filePath) : c.filePath, { wrapper: false })}['${c.export}']`).join("\n")}
export const componentNames: string[]
`
};
const adHocModules = ["router", "pages", "auto-imports", "meta", "components"];
const schemaTemplate = {
  filename: "types/schema.d.ts",
  getContents: ({ nuxt }) => {
    const moduleInfo = nuxt.options._installedModules.map((m) => ({
      ...m.meta || {},
      importName: m.entryPath || m.meta?.name
    })).filter((m) => m.configKey && m.name && !adHocModules.includes(m.name));
    return [
      "import { NuxtModule } from '@nuxt/schema'",
      "declare module '@nuxt/schema' {",
      "  interface NuxtConfig {",
      ...moduleInfo.filter(Boolean).map((meta) => `    [${genString(meta.configKey)}]?: typeof ${genDynamicImport(meta.importName, { wrapper: false })}.default extends NuxtModule<infer O> ? Partial<O> : Record<string, any>`),
      "  }",
      generateTypes(resolveSchema(nuxt.options.runtimeConfig), {
        interfaceName: "RuntimeConfig",
        addExport: false,
        addDefaults: false,
        allowExtraKeys: false,
        indentation: 2
      }),
      "}"
    ].join("\n");
  }
};

const VueCompat = createUnplugin((opts) => {
  return {
    name: "nuxt-legacy-vue-transform",
    enforce: "post",
    transformInclude(id) {
      if (id.includes("vue2-bridge")) {
        return false;
      }
      const { pathname, search } = parseURL(decodeURIComponent(pathToFileURL(id).href));
      const query = parseQuery(search);
      if (pathname.endsWith(".vue") && (query.type === "script" || !search)) {
        return true;
      }
      if (pathname.match(/\.((c|m)?j|t)sx?/g)) {
        return true;
      }
    },
    transform(code, id) {
      if (id.includes("vue2-bridge")) {
        return;
      }
      const s = new MagicString(code);
      const imports = findStaticImports(code).filter((i) => i.type === "static" && vueAliases.includes(i.specifier));
      for (const i of imports) {
        s.overwrite(i.start, i.end, i.code.replace(`"${i.specifier}"`, `"${opts.src}"`).replace(`'${i.specifier}'`, `'${opts.src}'`));
      }
      if (s.hasChanged()) {
        return {
          code: s.toString(),
          map: s.generateMap({ source: id, includeContent: true })
        };
      }
    }
  };
});
const vueAliases = [
  "vue",
  "@vue/shared",
  "@vue/reactivity",
  "@vue/runtime-core",
  "@vue/runtime-dom",
  "vue-demi",
  ...[
    "vue/dist/vue.common.dev",
    "vue/dist/vue.common",
    "vue/dist/vue.common.prod",
    "vue/dist/vue.esm.browser",
    "vue/dist/vue.esm.browser.min",
    "vue/dist/vue.esm",
    "vue/dist/vue",
    "vue/dist/vue.min",
    "vue/dist/vue.runtime.common.dev",
    "vue/dist/vue.runtime.common",
    "vue/dist/vue.runtime.common.prod",
    "vue/dist/vue.runtime.esm",
    "vue/dist/vue.runtime",
    "vue/dist/vue.runtime.min"
  ].flatMap((m) => [m, `${m}.js`])
];

async function setupAppBridge(_options) {
  const nuxt = useNuxt();
  nuxt.options.alias["#app"] = resolve(distDir, "runtime/index");
  nuxt.options.alias["nuxt3/app"] = nuxt.options.alias["#app"];
  nuxt.options.alias["nuxt/app"] = nuxt.options.alias["#app"];
  nuxt.options.alias["#build"] = nuxt.options.buildDir;
  if (nuxt.options._prepare) {
    nuxt.hook("builder:prepared", (builder) => {
      builder.bundleBuilder.build = () => Promise.resolve(builder.bundleBuilder);
    });
  }
  nuxt.options.build.transpile.push("vuex");
  nuxt.options.build.transpile.push("h3");
  nuxt.options.fetch.server = false;
  nuxt.options.fetch.client = false;
  const components = [];
  nuxt.hook("components:extend", (registeredComponents) => {
    components.push(...registeredComponents);
  });
  addTemplate({
    ...componentsTypeTemplate,
    options: { components, buildDir: nuxt.options.buildDir }
  });
  nuxt.hook("prepare:types", ({ references }) => {
    references.push({ path: resolve(nuxt.options.buildDir, "types/components.d.ts") });
  });
  nuxt.hook("modules:done", async (container) => {
    nuxt.options._installedModules = await Promise.all(Object.values(container.requiredModules).map(async (m) => ({
      meta: await m.handler.getMeta?.(),
      entryPath: resolveAlias(m.src, nuxt.options.alias)
    })));
    addTemplate(schemaTemplate);
  });
  nuxt.hook("prepare:types", ({ references }) => {
    references.push({ path: resolve(nuxt.options.buildDir, "types/schema.d.ts") });
  });
  const { dst: vueCompat } = addTemplate({ src: resolve(distDir, "runtime/vue2-bridge.mjs") });
  addWebpackPlugin(VueCompat.webpack({ src: vueCompat }));
  addVitePlugin(VueCompat.vite({ src: vueCompat }));
  nuxt.hook("prepare:types", ({ tsConfig, references }) => {
    references.push({ path: resolve(distDir, "runtime/vue2-bridge.d.ts") });
    tsConfig.vueCompilerOptions = {
      experimentalCompatMode: 2
    };
  });
  if (nuxt.options.globalName !== "nuxt") {
    throw new Error("Custom global name is not supported by @nuxt/bridge.");
  }
  nuxt.options.alias.defu = await resolveImports("defu", { conditions: ["import"] });
  nuxt.hook("webpack:config", (configs) => {
    for (const config of configs.filter((c) => c.module)) {
      const jsRule = config.module.rules.find((rule) => rule.test instanceof RegExp && rule.test.test("index.mjs"));
      jsRule.type = "javascript/auto";
      config.module.rules.unshift({
        test: /\.mjs$/,
        type: "javascript/auto",
        include: [/node_modules/]
      });
    }
  });
  addPlugin({
    src: resolve(distDir, "runtime/error.plugin.server.mjs"),
    mode: "server"
  });
}

function createKey(source, method = "base64") {
  const hash = crypto.createHash("md5");
  hash.update(source);
  return hash.digest(method).toString();
}
const keyedFunctions = /(useStatic|shallowSsrRef|ssrPromise|ssrRef|reqSsrRef|useAsync)/;
const KeyPlugin = createUnplugin(() => {
  return {
    name: "nuxt-legacy-capi-key-transform",
    enforce: "pre",
    transformInclude(id) {
      const { pathname, search } = parseURL(decodeURIComponent(pathToFileURL(id).href));
      const query = parseQuery(search);
      if (id.includes("node_modules")) {
        return false;
      }
      if (pathname.endsWith(".vue") && (query.type === "script" || !search)) {
        return true;
      }
      if (pathname.match(/\.((c|m)?j|t)sx?/g)) {
        return true;
      }
    },
    transform(code, id) {
      if (!keyedFunctions.test(code)) {
        return null;
      }
      try {
        const { 0: script = code, index: codeIndex = 0 } = code.match(/(?<=<script[^>]*>)[\S\s.]*?(?=<\/script>)/) || [];
        const ast = parse(script, { ecmaVersion: 2020, sourceType: "module" });
        const s = new MagicString(code);
        walk(ast, {
          enter(node) {
            const { end } = node;
            const { callee, arguments: args = [] } = node;
            if (callee?.type === "Identifier" || callee?.property?.type === "Identifier") {
              let method = "base64";
              switch (callee.name || callee.property?.name) {
                case "useStatic":
                  if (args.length > 2) {
                    return;
                  }
                  if (args.length === 2) {
                    s.prependLeft(codeIndex + end - 1, ", undefined");
                  }
                  method = "hex";
                  break;
                case "shallowSsrRef":
                case "ssrPromise":
                case "ssrRef":
                case "reqSsrRef":
                case "useAsync":
                  if (args.length > 1) {
                    return;
                  }
                  break;
                default:
                  return;
              }
              s.appendLeft(codeIndex + end - 1, ", '" + createKey(`${id}-${end}`, method) + "'");
            }
          }
        });
        return s.toString();
      } catch {
      }
    }
  };
});

function setupCAPIBridge(options) {
  const nuxt = useNuxt();
  if (nuxt.options.buildModules.find((m) => m === "@nuxtjs/composition-api" || m === "@nuxtjs/composition-api/module")) {
    throw new Error("Please remove `@nuxtjs/composition-api` from `buildModules` to avoid conflict with bridge.");
  }
  const _require = createRequire(import.meta.url);
  const vueCapiEntry = _require.resolve("@vue/composition-api/dist/vue-composition-api.mjs");
  nuxt.options.alias["@vue/composition-api/dist/vue-composition-api.common.js"] = vueCapiEntry;
  nuxt.options.alias["@vue/composition-api/dist/vue-composition-api.common.prod.js"] = vueCapiEntry;
  nuxt.options.alias["@vue/composition-api/dist/vue-composition-api.esm.js"] = vueCapiEntry;
  nuxt.options.alias["@vue/composition-api/dist/vue-composition-api.js"] = vueCapiEntry;
  nuxt.options.alias["@vue/composition-api/dist/vue-composition-api.mjs"] = vueCapiEntry;
  nuxt.options.alias["@vue/composition-api"] = vueCapiEntry;
  const capiPluginPath = resolve(distDir, "runtime/capi.plugin.mjs");
  addPluginTemplate({ filename: "capi.plugin.mjs", src: capiPluginPath });
  const appPlugin = addPluginTemplate(resolve(distDir, "runtime/app.plugin.mjs"));
  nuxt.hook("modules:done", () => {
    nuxt.options.plugins.unshift(appPlugin);
  });
  nuxt.hook("webpack:config", (configs) => {
    configs.forEach((config) => config.entry.app.unshift(capiPluginPath));
  });
  if (options.legacy === false) {
    return;
  }
  nuxt.options.alias["@nuxtjs/composition-api"] = resolve(distDir, "runtime/capi.legacy.mjs");
  nuxt.options.build.transpile.push("@nuxtjs/composition-api", "@vue/composition-api");
  addVitePlugin(KeyPlugin.vite());
  addWebpackPlugin(KeyPlugin.webpack());
}

const DEFAULTS = {
  fileSystem: new enhancedResolve.CachedInputFileSystem(fs, 4e3),
  extensions: [".ts", ".tsx", ".mjs", ".cjs", ".js", ".jsx", ".json", ".vue"]
};
const createResolver = (resolveOptions) => {
  const options = defu(resolveOptions, DEFAULTS);
  const resolver = enhancedResolve.ResolverFactory.createResolver(options);
  const root = options.roots?.[0] || ".";
  const promisifiedResolve = promisify(resolver.resolve.bind(resolver));
  const resolve = (id, importer) => promisifiedResolve({}, importer || root, id, {});
  return { resolve, resolver };
};
class EnhancedResolverPlugin {
  constructor(options) {
    this.resolver = createResolver(options);
  }
  apply(defaultResolver) {
    const enhancedResolver = this.resolver;
    defaultResolver.getHook("resolve").tapPromise("EnhancedResolverPlugin", async (request) => {
      const id = request.request;
      if (!id || !defaultResolver.isModule(id)) {
        return;
      }
      if (id.includes("@babel/")) {
        return;
      }
      const importer = request.context?.issuer;
      try {
        const result = await enhancedResolver.resolve(id, importer);
        if (!result) {
          return;
        }
        request.path = result;
        return request;
      } catch {
      }
    });
  }
}
function setupBetterResolve() {
  const nuxt = useNuxt();
  extendWebpackConfig((config) => {
    const isServer = config.name === "server";
    config.resolve = config.resolve || {};
    config.resolve.plugins = config.resolve.plugins || [];
    config.resolve.plugins.push(new EnhancedResolverPlugin({
      conditionNames: ["import", ...isServer ? ["node"] : []],
      mainFields: ["module", ...isServer ? [] : ["browser"], "main"],
      alias: config.resolve.alias,
      modules: config.resolve.modules,
      plugins: config.resolve.plugins,
      roots: config.resolve.roots || [nuxt.options.rootDir]
    }));
  });
}

const TransformPlugin = createUnplugin(({ ctx, options }) => {
  return {
    name: "nuxt:auto-imports-transform",
    enforce: "post",
    transformInclude(id) {
      const { pathname, search } = parseURL(decodeURIComponent(pathToFileURL(id).href));
      const { type, macro } = parseQuery(search);
      const exclude = options.transform?.exclude || [/[\\/]node_modules[\\/]/];
      if (exclude.some((pattern) => id.match(pattern))) {
        return false;
      }
      if (pathname.endsWith(".vue") && (type === "template" || type === "script" || macro || !search)) {
        return true;
      }
      if (pathname.match(/\.((c|m)?j|t)sx?$/g)) {
        return true;
      }
    },
    async transform(_code, id) {
      const { code, s } = await ctx.injectImports(_code);
      if (code === _code) {
        return;
      }
      return {
        code,
        map: s.generateMap({ source: id, includeContent: true })
      };
    }
  };
});

const commonPresets = [
  defineUnimportPreset({
    from: "#head",
    imports: [
      "useHead",
      "useMeta"
    ]
  }),
  defineUnimportPreset({
    from: "vue-demi",
    imports: [
      "isVue2",
      "isVue3"
    ]
  })
];
const appPreset = defineUnimportPreset({
  from: "#app",
  imports: [
    "useAsyncData",
    "useLazyAsyncData",
    "refreshNuxtData",
    "defineNuxtComponent",
    "useNuxtApp",
    "defineNuxtPlugin",
    "useRuntimeConfig",
    "useState",
    "useFetch",
    "useLazyFetch",
    "useCookie",
    "useRequestHeaders",
    "useRequestEvent",
    "useRouter",
    "useRoute",
    "useActiveRoute",
    "defineNuxtRouteMiddleware",
    "navigateTo",
    "abortNavigation",
    "addRouteMiddleware",
    "throwError",
    "clearError",
    "useError",
    "defineNuxtLink"
  ]
});
const vuePreset = defineUnimportPreset({
  from: "vue",
  imports: [
    "withCtx",
    "withDirectives",
    "withKeys",
    "withMemo",
    "withModifiers",
    "withScopeId",
    "onActivated",
    "onBeforeMount",
    "onBeforeUnmount",
    "onBeforeUpdate",
    "onDeactivated",
    "onErrorCaptured",
    "onMounted",
    "onRenderTracked",
    "onRenderTriggered",
    "onServerPrefetch",
    "onUnmounted",
    "onUpdated",
    "computed",
    "customRef",
    "isProxy",
    "isReactive",
    "isReadonly",
    "isRef",
    "markRaw",
    "proxyRefs",
    "reactive",
    "readonly",
    "ref",
    "shallowReactive",
    "shallowReadonly",
    "shallowRef",
    "toRaw",
    "toRef",
    "toRefs",
    "triggerRef",
    "unref",
    "watch",
    "watchEffect",
    "isShallow",
    "effect",
    "effectScope",
    "getCurrentScope",
    "onScopeDispose",
    "defineComponent",
    "defineAsyncComponent",
    "resolveComponent",
    "getCurrentInstance",
    "h",
    "inject",
    "nextTick",
    "provide",
    "useAttrs",
    "useCssModule",
    "useCssVars",
    "useSlots",
    "useTransitionState"
  ]
});
const defaultPresets = [
  ...commonPresets,
  appPreset,
  vuePreset
];

async function scanForComposables(dir, ctx) {
  const performScan = async (entry) => {
    const files = await resolveFiles(entry, [
      "*.{ts,js,mjs,cjs,mts,cts}",
      "*/index.{ts,js,mjs,cjs,mts,cts}"
    ]);
    await ctx.modifyDynamicImports(async (dynamicImports) => {
      await Promise.all(files.map(async (path) => {
        filterInPlace(dynamicImports, (i) => i.from !== path);
        const code = await promises.readFile(path, "utf-8");
        const exports = findExports(code);
        const defaultExport = exports.find((i) => i.type === "default");
        if (defaultExport) {
          let name = parse$1(path).name;
          if (name === "index") {
            name = parse$1(path.split("/").slice(0, -1).join("/")).name;
          }
          dynamicImports.push({ name: "default", as: camelCase(name), from: path });
        }
        for (const exp of exports) {
          if (exp.type === "named") {
            for (const name of exp.names) {
              dynamicImports.push({ name, as: name, from: path });
            }
          } else if (exp.type === "declaration") {
            dynamicImports.push({ name: exp.name, as: exp.name, from: path });
          }
        }
      }));
    });
  };
  for (const entry of Array.isArray(dir) ? dir : [dir]) {
    if (!existsSync(entry)) {
      continue;
    }
    await performScan(entry);
  }
}
function filterInPlace(arr, predicate) {
  let i = arr.length;
  while (i--) {
    if (!predicate(arr[i])) {
      arr.splice(i, 1);
    }
  }
}

const autoImports = defineNuxtModule({
  meta: {
    name: "auto-imports",
    configKey: "autoImports"
  },
  defaults: {
    presets: defaultPresets,
    global: false,
    imports: [],
    dirs: [],
    transform: {
      exclude: void 0
    }
  },
  async setup(options, nuxt) {
    await nuxt.callHook("autoImports:sources", options.presets);
    options.presets.forEach((i) => {
      if (typeof i !== "string" && i.names && !i.imports) {
        i.imports = i.names;
        logger.warn("auto-imports: presets.names is deprecated, use presets.imports instead");
      }
    });
    const ctx = createUnimport({
      presets: options.presets,
      imports: options.imports
    });
    let composablesDirs = [];
    for (const layer of nuxt.options._layers) {
      composablesDirs.push(resolve(layer.config.srcDir, "composables"));
      for (const dir of layer.config.autoImports?.dirs ?? []) {
        composablesDirs.push(resolve(layer.config.srcDir, dir));
      }
    }
    await nuxt.callHook("autoImports:dirs", composablesDirs);
    composablesDirs = composablesDirs.map((dir) => normalize(dir));
    addTemplate({
      filename: "imports.mjs",
      getContents: () => ctx.toExports()
    });
    nuxt.options.alias["#imports"] = join$1(nuxt.options.buildDir, "imports");
    if (nuxt.options.dev && options.global) {
      addPluginTemplate({
        filename: "auto-imports.mjs",
        getContents: () => {
          const imports = ctx.getImports();
          const importStatement = toImports(imports);
          const globalThisSet = imports.map((i) => `globalThis.${i.as} = ${i.as};`).join("\n");
          return `${importStatement}

${globalThisSet}

export default () => {};`;
        }
      });
    } else {
      addVitePlugin(TransformPlugin.vite({ ctx, options }));
      addWebpackPlugin(TransformPlugin.webpack({ ctx, options }));
    }
    const regenerateAutoImports = async () => {
      await scanForComposables(composablesDirs, ctx);
      await ctx.modifyDynamicImports(async (imports) => {
        await nuxt.callHook("autoImports:extend", imports);
      });
    };
    await regenerateAutoImports();
    addDeclarationTemplates(ctx);
    nuxt.hook("prepare:types", ({ references }) => {
      references.push({ path: resolve(nuxt.options.buildDir, "types/auto-imports.d.ts") });
      references.push({ path: resolve(nuxt.options.buildDir, "imports.d.ts") });
    });
    nuxt.hook("builder:watch", async (_, path) => {
      const _resolved = resolve(nuxt.options.srcDir, path);
      if (composablesDirs.find((dir) => _resolved.startsWith(dir))) {
        await nuxt.callHook("builder:generateApp");
      }
    });
    nuxt.hook("builder:generateApp", async () => {
      await regenerateAutoImports();
    });
  }
});
function addDeclarationTemplates(ctx) {
  const nuxt = useNuxt();
  const stripExtension = (path) => path.replace(/\.[a-z]+$/, "");
  const resolved = {};
  const r = ({ from }) => {
    if (resolved[from]) {
      return resolved[from];
    }
    let path = resolveAlias(from);
    if (isAbsolute(path)) {
      path = relative(join$1(nuxt.options.buildDir, "types"), path);
    }
    path = stripExtension(path);
    resolved[from] = path;
    return path;
  };
  addTemplate({
    filename: "imports.d.ts",
    getContents: () => ctx.toExports()
  });
  addTemplate({
    filename: "types/auto-imports.d.ts",
    getContents: () => "// Generated by auto imports\n" + ctx.generateTypeDecarations({ resolvePath: r })
  });
}

const UnsupportedImports = /* @__PURE__ */ new Set(["useAsyncData", "useFetch", "useError", "throwError", "clearError", "defineNuxtLink", "useActiveRoute"]);
const CapiHelpers = new Set(Object.keys(CompositionApi));
function setupAutoImports() {
  const nuxt = useNuxt();
  const bridgePresets = [{
    from: "@vue/composition-api",
    imports: vue3Keys.filter((i) => CapiHelpers.has(i))
  }];
  nuxt.hook("autoImports:sources", (presets) => {
    const vuePreset = presets.find((p) => p.from === "vue");
    if (vuePreset) {
      vuePreset.disabled = true;
    }
    const appPreset = presets.find((p) => p.from === "#app");
    if (!appPreset) {
      return;
    }
    for (const [index, i] of Object.entries(appPreset.imports).reverse()) {
      if (typeof i === "string" && UnsupportedImports.has(i)) {
        appPreset.imports.splice(Number(index), 1);
      }
    }
    appPreset.imports.push("useNuxt2Meta");
  });
  nuxt.hook("modules:done", () => installModule(autoImports, { presets: bridgePresets }));
}
const vue3Keys = [
  "withCtx",
  "withDirectives",
  "withKeys",
  "withMemo",
  "withModifiers",
  "withScopeId",
  "onActivated",
  "onBeforeMount",
  "onBeforeUnmount",
  "onBeforeUpdate",
  "onDeactivated",
  "onErrorCaptured",
  "onMounted",
  "onRenderTracked",
  "onRenderTriggered",
  "onServerPrefetch",
  "onUnmounted",
  "onUpdated",
  "computed",
  "customRef",
  "isProxy",
  "isReactive",
  "isReadonly",
  "isRef",
  "markRaw",
  "proxyRefs",
  "reactive",
  "readonly",
  "ref",
  "shallowReactive",
  "shallowReadonly",
  "shallowRef",
  "toRaw",
  "toRef",
  "toRefs",
  "triggerRef",
  "unref",
  "watch",
  "watchEffect",
  "isShallow",
  "effect",
  "effectScope",
  "getCurrentScope",
  "onScopeDispose",
  "defineComponent",
  "defineAsyncComponent",
  "resolveComponent",
  "getCurrentInstance",
  "h",
  "inject",
  "nextTick",
  "provide",
  "useAttrs",
  "useCssModule",
  "useCssVars",
  "useSlots",
  "useTransitionState"
];

const extensions = ["ts", "tsx", "cts", "mts"];
const typescriptRE = /\.[cm]?tsx?$/;
function setupTypescript() {
  const nuxt = useNuxt();
  nuxt.options.extensions.push(...extensions);
  nuxt.options.build.additionalExtensions.push(...extensions);
  nuxt.options.build.babel.plugins = nuxt.options.build.babel.plugins || [];
  if (nuxt.options.buildModules.includes("@nuxt/typescript-build")) {
    throw new Error("Please remove `@nuxt/typescript-build` from `buildModules` or set `bridge.typescript: false` to avoid conflict with bridge.");
  }
  const _require = createRequire(import.meta.url);
  nuxt.options.build.babel.plugins.unshift(_require.resolve("@babel/plugin-proposal-optional-chaining"), _require.resolve("@babel/plugin-proposal-nullish-coalescing-operator"), _require.resolve("@babel/plugin-transform-typescript"));
  extendWebpackConfig((config) => {
    config.resolve.extensions.push(...extensions.map((e) => `.${e}`));
    const babelRule = config.module.rules.find((rule) => rule.test?.test("test.js"));
    config.module.rules.unshift({
      ...babelRule,
      test: typescriptRE
    });
  });
}

const metaModule = defineNuxtModule({
  meta: {
    name: "meta"
  },
  defaults: {
    charset: "utf-8",
    viewport: "width=device-width, initial-scale=1"
  },
  setup(options, nuxt) {
    const runtimeDir = nuxt.options.alias["#head"] || resolve(distDir, "head/runtime");
    nuxt.options.build.transpile.push("@vueuse/head");
    nuxt.options.alias["#head"] = runtimeDir;
    const globalMeta = defu(nuxt.options.app.head, {
      charset: options.charset,
      viewport: options.viewport
    });
    addTemplate({
      filename: "meta.config.mjs",
      getContents: () => "export default " + JSON.stringify({ globalMeta, mixinKey: "setup" })
    });
    if (!tryResolveModule("@vueuse/head")) {
      console.warn("[bridge] Could not find `@vueuse/head`. You may need to install it.");
    }
    addPlugin({ src: resolve(runtimeDir, "plugin") });
    addPlugin({ src: resolve(runtimeDir, "vueuse-head.plugin") });
  }
});

const checkDocsMsg = "Please see https://v3.nuxtjs.org for more information.";
const msgPrefix = "[bridge] [meta]";
const setupMeta = async (opts) => {
  const nuxt = useNuxt();
  if (opts.needsExplicitEnable) {
    const metaPath = addTemplate({
      filename: "meta.mjs",
      getContents: () => `export const useHead = () => console.warn('${msgPrefix} To enable experimental \`useHead\` support, set \`bridge.meta\` to \`true\` in your \`nuxt.config\`. ${checkDocsMsg}')`
    });
    nuxt.options.alias["#head"] = metaPath.dst;
    return;
  }
  if (nuxt.options.head && typeof nuxt.options.head === "function") {
    throw new TypeError(`${msgPrefix} The head() function in \`nuxt.config\` has been deprecated and in Nuxt 3 will need to be moved to \`app.vue\`. ${checkDocsMsg}`);
  }
  const runtimeDir = resolve(distDir, "runtime/head");
  nuxt.options.alias["#head"] = runtimeDir;
  await installModule(metaModule);
};

const setupTranspile = () => {
  const nuxt = useNuxt();
  nuxt.hook("modules:done", () => {
    const modules = [
      "@nuxt/bridge-edge",
      ...nuxt.options.buildModules,
      ...nuxt.options.modules,
      ...nuxt.options._modules
    ].map((m) => typeof m === "string" ? m : Array.isArray(m) ? m[0] : m.src).filter((m) => typeof m === "string").map((m) => m.split("node_modules/").pop());
    nuxt.options.build.transpile = nuxt.options.build.transpile.map((m) => typeof m === "string" ? m.split("node_modules/").pop() : m);
    function isTranspilePresent(mod) {
      return nuxt.options.build.transpile.some((t) => !(t instanceof Function) && (t instanceof RegExp ? t.test(mod) : new RegExp(t).test(mod)));
    }
    for (const module of modules) {
      if (!isTranspilePresent(module)) {
        nuxt.options.build.transpile.push(module);
      }
    }
  });
};

const setupScriptSetup = async (options) => {
  const nuxt = useNuxt();
  const config = options === true ? {} : options;
  nuxt.hook("prepare:types", ({ references }) => {
    references.push({
      types: "unplugin-vue2-script-setup/types"
    });
  });
  await installModule(scriptSetupPlugin, config);
};

const module = defineNuxtModule({
  meta: {
    name: "nuxt-bridge",
    configKey: "bridge"
  },
  defaults: {
    nitro: true,
    vite: false,
    app: {},
    capi: {},
    transpile: true,
    scriptSetup: true,
    autoImports: true,
    compatibility: true,
    meta: null,
    postcss8: true,
    typescript: true,
    resolve: true
  },
  async setup(opts, nuxt) {
    const _require = createRequire(import.meta.url);
    if (!nuxtCtx.use()) {
      nuxtCtx.set(nuxt);
    }
    nuxt.options._layers = nuxt.options._layers || [{
      config: nuxt.options,
      cwd: nuxt.options.rootDir,
      configFile: nuxt.options._nuxtConfigFile
    }];
    if (opts.nitro) {
      nuxt.hook("modules:done", async () => {
        await setupNitroBridge();
      });
    }
    if (opts.app) {
      await setupAppBridge(opts.app);
    }
    if (opts.capi) {
      if (!opts.app) {
        throw new Error("[bridge] Cannot enable composition-api with app disabled!");
      }
      await setupCAPIBridge(opts.capi === true ? {} : opts.capi);
    }
    if (opts.scriptSetup) {
      await setupScriptSetup(opts.scriptSetup);
    }
    if (opts.autoImports) {
      await setupAutoImports();
    }
    if (opts.vite) {
      const viteModule = await import('./module2.mjs').then((r) => r.default || r);
      nuxt.hook("modules:done", () => installModule(viteModule));
    }
    if (opts.postcss8) {
      await installModule(_require.resolve("@nuxt/postcss8"));
    }
    if (opts.typescript) {
      await setupTypescript();
    }
    if (opts.resolve) {
      setupBetterResolve();
    }
    if (opts.transpile) {
      setupTranspile();
    }
    if (opts.compatibility) {
      nuxt.hook("modules:done", async (moduleContainer) => {
        for (const [name, m] of Object.entries(moduleContainer.requiredModules || {})) {
          const compat = m?.handler?.meta?.compatibility || {};
          if (compat) {
            const issues = await checkNuxtCompatibility(compat, nuxt);
            if (issues.length) {
              console.warn(`[bridge] Detected module incompatibility issues for \`${name}\`:
` + issues.toString());
            }
          }
        }
      });
    }
    if (opts.meta !== false && opts.capi) {
      await setupMeta({ needsExplicitEnable: opts.meta === null });
    }
  }
});

export { distDir as d, module as m };
