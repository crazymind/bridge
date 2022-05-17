import { resolve, join } from 'pathe';
import * as vite from 'vite';
import { logger, isIgnored } from '@nuxt/kit';
import { findExports, sanitizeFilePath } from 'mlly';
import { getPort } from 'get-port-please';
import { joinURL, withoutLeadingSlash } from 'ufo';
import { d as distDir } from './module.mjs';
import { createUnplugin } from 'unplugin';
import escapeRE from 'escape-string-regexp';
import MagicString from 'magic-string';
import { createVuePlugin } from 'vite-plugin-vue2';
import PluginLegacy from '@vitejs/plugin-legacy';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import fse from 'fs-extra';
import { debounce } from 'perfect-debounce';
import { pathToFileURL } from 'url';
import { builtinModules } from 'module';
import { isExternal as isExternal$1, ExternalsDefaults } from 'externality';
import { genObjectFromRawEntries, genDynamicImport } from 'knitwork';
import createResolver from 'postcss-import-resolver';
import { defu } from 'defu';
import 'node-fetch';
import 'nitropack';
import 'h3';
import 'path';
import 'untyped';
import 'acorn';
import 'estree-walker';
import 'util';
import 'enhanced-resolve';
import '@vue/composition-api';
import 'unimport';
import 'scule';
import 'unplugin-vue2-script-setup/nuxt';

async function warmupViteServer(server, entries) {
  const warmedUrls = /* @__PURE__ */ new Set();
  const warmup = async (url) => {
    if (warmedUrls.has(url)) {
      return;
    }
    warmedUrls.add(url);
    try {
      await server.transformRequest(url);
    } catch (e) {
      logger.debug("Warmup for %s failed with: %s", url, e);
    }
    const mod = await server.moduleGraph.getModuleByUrl(url);
    const deps = Array.from(mod?.importedModules || []);
    await Promise.all(deps.map((m) => warmup(m.url.replace("/@id/__x00__", "\0"))));
  };
  await Promise.all(entries.map((entry) => warmup(entry)));
}

const RelativeAssetPlugin = function() {
  return {
    name: "nuxt:vite-relative-asset",
    generateBundle(_, bundle) {
      const generatedAssets = Object.entries(bundle).filter(([_2, asset]) => asset.type === "asset").map(([key]) => escapeRE(key));
      const assetRE = new RegExp(`\\/__NUXT_BASE__\\/(${generatedAssets.join("|")})`, "g");
      for (const file in bundle) {
        const asset = bundle[file];
        if (asset.fileName.includes("legacy") && asset.type === "chunk" && asset.code.includes("innerHTML")) {
          for (const delimiter of ["`", '"', "'"]) {
            asset.code = asset.code.replace(new RegExp(`(?<=innerHTML=)${delimiter}([^${delimiter}]*)\\/__NUXT_BASE__\\/([^${delimiter}]*)${delimiter}`, "g"), "`$1${(window?.__NUXT__?.config.app.cdnURL || window?.__NUXT__?.config.app.baseURL) + window?.__NUXT__?.config.app.buildAssetsDir.slice(1)}$2`");
          }
        }
        if (asset.type === "asset" && typeof asset.source === "string" && asset.fileName.endsWith(".css")) {
          const depth = file.split("/").length - 1;
          const assetBase = depth === 0 ? "." : Array.from({ length: depth }).map(() => "..").join("/");
          const publicBase = Array.from({ length: depth + 1 }).map(() => "..").join("/");
          asset.source = asset.source.replace(assetRE, (r) => r.replace(/\/__NUXT_BASE__/g, assetBase)).replace(/\/__NUXT_BASE__/g, publicBase);
        }
        if (asset.type === "chunk" && typeof asset.code === "string") {
          asset.code = asset.code.replace(/`\$\{(_?_?publicAssetsURL|buildAssetsURL|)\(\)\}([^`]*)`/g, "$1(`$2`)").replace(/"\/__NUXT_BASE__\/([^"]*)"\.replace\("\/__NUXT_BASE__", ""\)/g, '"$1"').replace(/'\/__NUXT_BASE__\/([^']*)'\.replace\("\/__NUXT_BASE__", ""\)/g, '"$1"');
        }
      }
    }
  };
};
const VITE_ASSET_RE = /^export default ["'](__VITE_ASSET.*)["']$/;
const DynamicBasePlugin = createUnplugin(function(options = {}) {
  return {
    name: "nuxt:dynamic-base-path",
    resolveId(id) {
      if (id.startsWith("/__NUXT_BASE__")) {
        return id.replace("/__NUXT_BASE__", "");
      }
      if (id === "#nitro") {
        return "#nitro";
      }
      return null;
    },
    enforce: "post",
    transform(code, id) {
      const s = new MagicString(code);
      if (options.globalPublicPath && id.includes("paths.mjs") && code.includes("const appConfig = ")) {
        s.append(`${options.globalPublicPath} = buildAssetsURL();
`);
      }
      const assetId = code.match(VITE_ASSET_RE);
      if (assetId) {
        s.overwrite(0, code.length, [
          "import { buildAssetsURL } from '#build/paths.mjs';",
          `export default buildAssetsURL("${assetId[1]}".replace("/__NUXT_BASE__", ""));`
        ].join("\n"));
      }
      if (!id.includes("paths.mjs") && code.includes("NUXT_BASE") && !code.includes("import { publicAssetsURL as __publicAssetsURL }")) {
        s.prepend("import { publicAssetsURL as __publicAssetsURL } from '#build/paths.mjs';\n");
      }
      if (id === "vite/preload-helper") {
        s.prepend("import { buildAssetsDir } from '#build/paths.mjs';\n");
        s.replace(/const base = ['"]\/__NUXT_BASE__\/['"]/, "const base = buildAssetsDir()");
      }
      s.replace(/from *['"]\/__NUXT_BASE__(\/[^'"]*)['"]/g, 'from "$1"');
      for (const delimiter of ["`", "'", '"']) {
        const delimiterRE = new RegExp(`(?<!(const base = |from *))${delimiter}([^${delimiter}]*)\\/__NUXT_BASE__\\/([^${delimiter}]*)${delimiter}`, "g");
        s.replace(delimiterRE, (r) => "`" + r.replace(/\/__NUXT_BASE__\//g, "${__publicAssetsURL()}").slice(1, -1) + "`");
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

function uniq(arr) {
  return Array.from(new Set(arr));
}
const IS_JS_RE = /\.[cm]?js(\?[^.]+)?$/;
const HAS_EXT_RE = /[^./]+\.[^./]+$/;
const IS_CSS_RE = /\.(?:css|scss|sass|postcss|less|stylus|styl)(\?[^.]+)?$/;
function isJS(file) {
  return IS_JS_RE.test(file) || !HAS_EXT_RE.test(file);
}
function isCSS(file) {
  return IS_CSS_RE.test(file);
}
function hashId(id) {
  return "$id_" + hash(id);
}
function hash(input, length = 8) {
  return createHash("sha256").update(input).digest("hex").slice(0, length);
}

function devStyleSSRPlugin(options) {
  return {
    name: "nuxt:dev-style-ssr",
    apply: "serve",
    enforce: "post",
    transform(code, id) {
      if (!isCSS(id) || !code.includes("import.meta.hot")) {
        return;
      }
      let moduleId = id;
      if (moduleId.startsWith(options.rootDir)) {
        moduleId = moduleId.slice(options.rootDir.length);
      }
      const selector = joinURL(options.buildAssetsURL, moduleId);
      return code + `
document.querySelectorAll(\`link[href="${selector}"]\`).forEach(i=>i.remove())`;
    }
  };
}

const needsJsxProcessing = (id = "") => !id.includes("node_modules") && [".vue", ".jsx", ".tsx"].some((extension) => id.includes(extension));
function jsxPlugin() {
  return {
    name: "nuxt:jsx",
    transform(code, id) {
      if (!needsJsxProcessing(id)) {
        return null;
      }
      return {
        code: code.replace(/render\s*\(\s*\)\s*\{/g, "render(h){"),
        map: null
      };
    }
  };
}

async function buildClient(ctx) {
  const alias = {
    "#nitro": resolve(ctx.nuxt.options.buildDir, "nitro.client.mjs")
  };
  for (const p of ctx.builder.plugins) {
    alias[p.name] = p.mode === "server" ? `defaultexport:${resolve(ctx.nuxt.options.buildDir, "empty.js")}` : `defaultexport:${p.src}`;
  }
  const clientConfig = vite.mergeConfig(ctx.config, {
    define: {
      "process.client": true,
      "process.server": false,
      "process.static": false,
      "module.hot": false
    },
    cacheDir: resolve(ctx.nuxt.options.rootDir, "node_modules/.cache/vite/client"),
    resolve: {
      alias
    },
    build: {
      rollupOptions: {
        input: resolve(ctx.nuxt.options.buildDir, "client.js")
      },
      manifest: true,
      outDir: resolve(ctx.nuxt.options.buildDir, "dist/client")
    },
    plugins: [
      jsxPlugin(),
      createVuePlugin(ctx.config.vue),
      PluginLegacy(),
      RelativeAssetPlugin(),
      devStyleSSRPlugin({
        rootDir: ctx.nuxt.options.rootDir,
        buildAssetsURL: joinURL(ctx.nuxt.options.app.baseURL, ctx.nuxt.options.app.buildAssetsDir)
      })
    ],
    server: {
      middlewareMode: true
    }
  });
  await ctx.nuxt.callHook("vite:extendConfig", clientConfig, { isClient: true, isServer: false });
  if (!ctx.nuxt.options.dev) {
    const start = Date.now();
    logger.info("Building client...");
    await vite.build(clientConfig);
    logger.success(`Client built in ${Date.now() - start}ms`);
    return;
  }
  const viteServer = await vite.createServer(clientConfig);
  await ctx.nuxt.callHook("vite:serverCreated", viteServer);
  const viteMiddleware = (req, res, next) => {
    const originalURL = req.url;
    viteServer.middlewares.handle(req, res, (err) => {
      req.url = originalURL;
      next(err);
    });
  };
  await ctx.nuxt.callHook("server:devMiddleware", viteMiddleware);
  ctx.nuxt.hook("close", async () => {
    await viteServer.close();
  });
}

function isExternal(opts, id) {
  const ssrConfig = opts.viteServer.config.ssr;
  const externalOpts = {
    inline: [
      /virtual:/,
      /\.ts$/,
      ...ExternalsDefaults.inline,
      ...ssrConfig.noExternal
    ],
    external: [
      ...ssrConfig.external,
      /node_modules/
    ],
    resolve: {
      type: "module",
      extensions: [".ts", ".js", ".json", ".vue", ".mjs", ".jsx", ".tsx", ".wasm"]
    }
  };
  return isExternal$1(id, opts.viteServer.config.root, externalOpts);
}
async function transformRequest(opts, id) {
  if (id && id.startsWith("/@id/__x00__")) {
    id = "\0" + id.slice("/@id/__x00__".length);
  }
  if (id && id.startsWith("/@id/")) {
    id = id.slice("/@id/".length);
  }
  if (id && id.startsWith("/@fs/")) {
    id = id.slice("/@fs".length);
    if (id.match(/^\/\w:/)) {
      id = id.slice(1);
    }
  } else if (!id.includes("entry") && id.startsWith("/")) {
    const resolvedPath = resolve(opts.viteServer.config.root, "." + id);
    if (existsSync(resolvedPath)) {
      id = resolvedPath;
    }
  }
  const withoutVersionQuery = id.replace(/\?v=\w+$/, "");
  if (await isExternal(opts, withoutVersionQuery)) {
    const path = builtinModules.includes(withoutVersionQuery.split("node:").pop()) ? withoutVersionQuery : pathToFileURL(withoutVersionQuery).href;
    return {
      code: `(global, exports, importMeta, ssrImport, ssrDynamicImport, ssrExportAll) => ${genDynamicImport(path, { wrapper: false })}.then(r => { exports.default = r.default; ssrExportAll(r) }).catch(e => { console.error(e); throw new Error(${JSON.stringify(`[vite dev] Error loading external "${id}".`)}) })`,
      deps: [],
      dynamicDeps: []
    };
  }
  const res = await opts.viteServer.transformRequest(id, { ssr: true }).catch((err) => {
    console.warn(`[SSR] Error transforming ${id}:`, err);
  }) || { code: "", map: {}, deps: [], dynamicDeps: [] };
  const code = `async function (global, __vite_ssr_exports__, __vite_ssr_import_meta__, __vite_ssr_import__, __vite_ssr_dynamic_import__, __vite_ssr_exportAll__) {
${res.code || "/* empty */"};
}`;
  return { code, deps: res.deps || [], dynamicDeps: res.dynamicDeps || [] };
}
async function transformRequestRecursive(opts, id, parent = "<entry>", chunks = {}) {
  if (chunks[id]) {
    chunks[id].parents.push(parent);
    return;
  }
  const res = await transformRequest(opts, id);
  const deps = uniq([...res.deps, ...res.dynamicDeps]);
  chunks[id] = {
    id,
    code: res.code,
    deps,
    parents: [parent]
  };
  for (const dep of deps) {
    await transformRequestRecursive(opts, dep, id, chunks);
  }
  return Object.values(chunks);
}
async function bundleRequest(opts, entryURL) {
  const chunks = await transformRequestRecursive(opts, entryURL);
  const listIds = (ids) => ids.map((id) => `// - ${id} (${hashId(id)})`).join("\n");
  const chunksCode = chunks.map((chunk) => `
// --------------------
// Request: ${chunk.id}
// Parents: 
${listIds(chunk.parents)}
// Dependencies: 
${listIds(chunk.deps)}
// --------------------
const ${hashId(chunk.id)} = ${chunk.code}
`).join("\n");
  const manifestCode = `const __modules__ = ${genObjectFromRawEntries(chunks.map((chunk) => [chunk.id, hashId(chunk.id)]))}`;
  const ssrModuleLoader = `
const __pendingModules__ = new Map()
const __pendingImports__ = new Map()
const __ssrContext__ = { global: globalThis }

function __ssrLoadModule__(url, urlStack = []) {
  const pendingModule = __pendingModules__.get(url)
  if (pendingModule) { return pendingModule }
  const modulePromise = __instantiateModule__(url, urlStack)
  __pendingModules__.set(url, modulePromise)
  modulePromise.catch(() => { __pendingModules__.delete(url) })
         .finally(() => { __pendingModules__.delete(url) })
  return modulePromise
}

async function __instantiateModule__(url, urlStack) {
  const mod = __modules__[url]
  if (mod.stubModule) { return mod.stubModule }
  const stubModule = { [Symbol.toStringTag]: 'Module' }
  Object.defineProperty(stubModule, '__esModule', { value: true })
  mod.stubModule = stubModule
  // https://vitejs.dev/guide/api-hmr.html
  const importMeta = { url, hot: { accept() {}, prune() {}, dispose() {}, invalidate() {}, decline() {}, on() {} } }
  urlStack = urlStack.concat(url)
  const isCircular = url => urlStack.includes(url)
  const pendingDeps = []
  const ssrImport = async (dep) => {
    // TODO: Handle externals if dep[0] !== '.' | '/'
    if (!isCircular(dep) && !__pendingImports__.get(dep)?.some(isCircular)) {
      pendingDeps.push(dep)
      if (pendingDeps.length === 1) {
        __pendingImports__.set(url, pendingDeps)
      }
      await __ssrLoadModule__(dep, urlStack)
      if (pendingDeps.length === 1) {
        __pendingImports__.delete(url)
      } else {
        pendingDeps.splice(pendingDeps.indexOf(dep), 1)
      }
    }
    return __modules__[dep].stubModule
  }
  function ssrDynamicImport (dep) {
    // TODO: Handle dynamic import starting with . relative to url
    return ssrImport(dep)
  }

  function ssrExportAll(sourceModule) {
    for (const key in sourceModule) {
      if (key !== 'default') {
        try {
          Object.defineProperty(stubModule, key, {
            enumerable: true,
            configurable: true,
            get() { return sourceModule[key] }
          })
        } catch (_err) { }
      }
    }
  }

  await mod(
    __ssrContext__.global,
    stubModule,
    importMeta,
    ssrImport,
    ssrDynamicImport,
    ssrExportAll
  )

  return stubModule
}
`;
  const code = [
    chunksCode,
    manifestCode,
    ssrModuleLoader,
    `export default await __ssrLoadModule__(${JSON.stringify(entryURL)})`
  ].join("\n\n");
  return {
    code,
    ids: chunks.map((i) => i.id)
  };
}

const wpfs = {
  ...fse,
  join
};

const DEFAULT_APP_TEMPLATE = `
<!DOCTYPE html>
<html {{ HTML_ATTRS }}>
<head {{ HEAD_ATTRS }}>
  {{ HEAD }}
</head>
<body {{ BODY_ATTRS }}>
  {{ APP }}
</body>
</html>
`;
async function prepareManifests(ctx) {
  const rDist = (...args) => resolve(ctx.nuxt.options.buildDir, "dist", ...args);
  await fse.mkdirp(rDist("server"));
  const customAppTemplateFile = resolve(ctx.nuxt.options.srcDir, "app.html");
  const APP_TEMPLATE = fse.existsSync(customAppTemplateFile) ? await fse.readFile(customAppTemplateFile, "utf-8") : DEFAULT_APP_TEMPLATE;
  const DEV_TEMPLATE = APP_TEMPLATE.replace("</body>", '<script type="module" src="/@vite/client"><\/script><script type="module" src="/.nuxt/client.js"><\/script></body>');
  const SPA_TEMPLATE = ctx.nuxt.options.dev ? DEV_TEMPLATE : APP_TEMPLATE;
  const SSR_TEMPLATE = ctx.nuxt.options.dev ? DEV_TEMPLATE : APP_TEMPLATE;
  await fse.writeFile(rDist("server/index.ssr.html"), SSR_TEMPLATE);
  await fse.writeFile(rDist("server/index.spa.html"), SPA_TEMPLATE);
  if (ctx.nuxt.options.dev) {
    await stubManifest(ctx);
  } else {
    await generateBuildManifest(ctx);
  }
}
async function generateBuildManifest(ctx) {
  const rDist = (...args) => resolve(ctx.nuxt.options.buildDir, "dist", ...args);
  const viteClientManifest = await fse.readJSON(rDist("client/manifest.json"));
  const clientEntries = Object.entries(viteClientManifest);
  const asyncEntries = uniq(clientEntries.filter((id) => id[1].isDynamicEntry).flatMap(getModuleIds)).filter(Boolean);
  const initialEntries = uniq(clientEntries.filter((id) => !id[1].isDynamicEntry).flatMap(getModuleIds)).filter(Boolean);
  const initialJs = initialEntries.filter(isJS);
  const initialAssets = initialEntries.filter(isCSS);
  const polyfillName = initialEntries.find((id) => id.startsWith("polyfills-legacy."));
  const polyfill = await fse.readFile(rDist("client/" + polyfillName), "utf-8");
  const clientImports = initialJs.filter((id) => id !== polyfillName);
  const clientEntryCode = [
    polyfill,
    "var appConfig = window?.__NUXT__?.config.app || {}",
    'var publicBase = appConfig.cdnURL || ("." + appConfig.baseURL)',
    `var imports = ${JSON.stringify(clientImports)};`,
    "imports.reduce((p, id) => p.then(() => System.import(publicBase + appConfig.buildAssetsDir.slice(1) + id)), Promise.resolve())"
  ].join("\n");
  const clientEntryName = "entry-legacy." + hash(clientEntryCode) + ".js";
  const clientManifest = {
    publicPath: ctx.nuxt.options.app.buildAssetsDir,
    all: uniq([
      clientEntryName,
      ...clientEntries.flatMap(getModuleIds)
    ]).filter(Boolean),
    initial: [
      clientEntryName,
      ...initialAssets
    ].filter(Boolean),
    async: [
      ...initialJs,
      ...asyncEntries
    ].filter(Boolean),
    modules: {},
    assetsMapping: {}
  };
  const serverManifest = {
    entry: "server.js",
    files: {
      "server.js": "server.js",
      ...Object.fromEntries(clientEntries.map(([id, entry]) => [id, entry.file]))
    },
    maps: {}
  };
  await fse.writeFile(rDist("client", clientEntryName), clientEntryCode, "utf-8");
  await writeClientManifest(clientManifest, ctx.nuxt.options.buildDir);
  await writeServerManifest(serverManifest, ctx.nuxt.options.buildDir);
  await fse.remove(rDist("client/manifest.json"));
  await fse.remove(rDist("client/ssr-manifest.json"));
}
async function stubManifest(ctx) {
  const clientManifest = {
    publicPath: "",
    all: [
      "empty.js"
    ],
    initial: [
      "empty.js"
    ],
    async: [],
    modules: {},
    assetsMapping: {}
  };
  const serverManifest = {
    entry: "server.js",
    files: {
      "server.js": "server.js"
    },
    maps: {}
  };
  await writeClientManifest(clientManifest, ctx.nuxt.options.buildDir);
  await writeServerManifest(serverManifest, ctx.nuxt.options.buildDir);
}
async function generateDevSSRManifest(ctx, extraEntries = []) {
  const entires = [
    "@vite/client",
    "entry.mjs",
    ...extraEntries
  ];
  const clientManifest = {
    publicPath: "",
    all: entires,
    initial: entires,
    async: [],
    modules: {},
    assetsMapping: {}
  };
  await writeClientManifest(clientManifest, ctx.nuxt.options.buildDir);
}
async function writeServerManifest(serverManifest, buildDir) {
  const serverManifestJSON = JSON.stringify(serverManifest, null, 2);
  await fse.writeFile(resolve(buildDir, "dist/server/server.manifest.json"), serverManifestJSON, "utf-8");
  await fse.writeFile(resolve(buildDir, "dist/server/server.manifest.mjs"), `export default ${serverManifestJSON}`, "utf-8");
}
async function writeClientManifest(clientManifest, buildDir) {
  const clientManifestJSON = JSON.stringify(clientManifest, null, 2);
  await fse.writeFile(resolve(buildDir, "dist/server/client.manifest.json"), clientManifestJSON, "utf-8");
  await fse.writeFile(resolve(buildDir, "dist/server/client.manifest.mjs"), `export default ${clientManifestJSON}`, "utf-8");
}
function getModuleIds([, value]) {
  if (!value) {
    return [];
  }
  return [value.file, ...value.css || []].filter((id) => isCSS(id) || id.match(/-legacy\./));
}

async function buildServer(ctx) {
  const _env = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const vuePlugin = createVuePlugin(ctx.config.vue);
  process.env.NODE_ENV = _env;
  const alias = {};
  for (const p of ctx.builder.plugins) {
    alias[p.name] = p.mode === "client" ? `defaultexport:${resolve(ctx.nuxt.options.buildDir, "empty.js")}` : `defaultexport:${p.src}`;
  }
  const serverConfig = vite.mergeConfig(ctx.config, {
    define: {
      "process.server": true,
      "process.client": false,
      "process.static": false,
      "typeof window": '"undefined"',
      "typeof document": '"undefined"',
      "typeof navigator": '"undefined"',
      "typeof location": '"undefined"',
      "typeof XMLHttpRequest": '"undefined"'
    },
    cacheDir: resolve(ctx.nuxt.options.rootDir, "node_modules/.cache/vite/server"),
    resolve: {
      alias
    },
    ssr: {
      external: [
        "axios"
      ],
      noExternal: [
        /\/esm\/.*\.js$/,
        /\.(es|esm|esm-browser|esm-bundler).js$/,
        "#app",
        /@nuxt\/nitro\/(dist|src)/,
        ...ctx.nuxt.options.build.transpile.filter((i) => typeof i === "string")
      ]
    },
    build: {
      outDir: resolve(ctx.nuxt.options.buildDir, "dist/server"),
      ssr: ctx.nuxt.options.ssr ?? true,
      ssrManifest: true,
      rollupOptions: {
        external: ["#nitro"],
        input: resolve(ctx.nuxt.options.buildDir, "server.js"),
        output: {
          entryFileNames: "server.mjs",
          chunkFileNames: "chunks/[name].mjs",
          preferConst: true,
          format: "module"
        },
        onwarn(warning, rollupWarn) {
          if (!["UNUSED_EXTERNAL_IMPORT"].includes(warning.code)) {
            rollupWarn(warning);
          }
        }
      }
    },
    server: {
      preTransformRequests: false
    },
    plugins: [
      jsxPlugin(),
      vuePlugin
    ]
  });
  await ctx.nuxt.callHook("vite:extendConfig", serverConfig, { isClient: false, isServer: true });
  const onBuild = () => ctx.nuxt.callHook("build:resources", wpfs);
  if (!ctx.nuxt.options.dev) {
    const start = Date.now();
    logger.info("Building server...");
    await vite.build(serverConfig);
    await onBuild();
    logger.success(`Server built in ${Date.now() - start}ms`);
    return;
  }
  const viteServer = await vite.createServer(serverConfig);
  ctx.nuxt.hook("close", () => viteServer.close());
  ctx.nuxt.hook("app:templatesGenerated", () => {
    for (const [id, mod] of viteServer.moduleGraph.idToModuleMap) {
      if (id.startsWith("\0virtual:")) {
        viteServer.moduleGraph.invalidateModule(mod);
      }
    }
  });
  await viteServer.pluginContainer.buildStart({});
  await fse.writeFile(resolve(ctx.nuxt.options.buildDir, "dist/server/ssr-manifest.json"), JSON.stringify({}, null, 2), "utf-8");
  await generateDevSSRManifest(ctx);
  const _doBuild = async () => {
    const start = Date.now();
    const { code, ids } = await bundleRequest({ viteServer }, "/.nuxt/server.js");
    await generateDevSSRManifest(ctx, ids.filter(isCSS).map((i) => "../" + i.slice(1)));
    await fse.writeFile(resolve(ctx.nuxt.options.buildDir, "dist/server/server.mjs"), code, "utf-8");
    const time = Date.now() - start;
    consola.info(`Server built in ${time}ms`);
    await onBuild();
  };
  const doBuild = debounce(_doBuild);
  await _doBuild();
  viteServer.watcher.on("all", (_event, file) => {
    if (file.indexOf(ctx.nuxt.options.buildDir) === 0) {
      return;
    }
    doBuild();
  });
}

const PREFIX = "defaultexport:";
const hasPrefix = (id = "") => id.startsWith(PREFIX);
const removePrefix = (id = "") => hasPrefix(id) ? id.substr(PREFIX.length) : id;
function defaultExportPlugin() {
  return {
    name: "nuxt:default-export",
    enforce: "pre",
    resolveId(id, importer) {
      if (hasPrefix(id)) {
        return id;
      }
      if (importer && hasPrefix(importer)) {
        return this.resolve(id, removePrefix(importer));
      }
      return null;
    },
    async load(id) {
      if (!hasPrefix(id)) {
        return null;
      }
      const code = await fse.readFile(removePrefix(id), "utf8");
      const s = new MagicString(code);
      const exports = findExports(code);
      if (!exports.find((i) => i.names.includes("default"))) {
        s.append("\n\nexport default () => {}");
      }
      return {
        code: s.toString(),
        map: s.generateMap({ source: removePrefix(id), includeContent: true })
      };
    }
  };
}

function replace(replacements) {
  return {
    name: "nuxt:replace",
    transform(code) {
      Object.entries(replacements).forEach(([key, value]) => {
        const escapedKey = key.replace(/\./g, "\\.");
        code = code.replace(new RegExp(escapedKey, "g"), value);
      });
      return {
        code,
        map: null
      };
    }
  };
}

function resolveCSSOptions(nuxt) {
  const css = {
    postcss: {
      plugins: []
    }
  };
  const plugins = defu(nuxt.options.build.postcss.plugins, {
    "postcss-import": {
      resolve: createResolver({
        alias: { ...nuxt.options.alias },
        modules: [
          nuxt.options.srcDir,
          nuxt.options.rootDir,
          ...nuxt.options.modulesDir
        ]
      })
    },
    "postcss-url": {},
    "postcss-preset-env": nuxt.options.build.postcss.preset || {}
  });
  for (const name in plugins) {
    const opts = plugins[name];
    if (!opts) {
      continue;
    }
    const plugin = nuxt.resolver.requireModule(name);
    css.postcss.plugins.push(plugin(opts));
  }
  return css;
}

async function bundle(nuxt, builder) {
  for (const p of builder.plugins) {
    p.src = nuxt.resolver.resolvePath(resolve(nuxt.options.buildDir, p.src));
  }
  const hmrPortDefault = 24678;
  const hmrPort = await getPort({
    port: hmrPortDefault,
    ports: Array.from({ length: 20 }, (_, i) => hmrPortDefault + 1 + i)
  });
  const ctx = {
    nuxt,
    builder,
    config: vite.mergeConfig({
      root: nuxt.options.srcDir,
      mode: nuxt.options.dev ? "development" : "production",
      logLevel: "warn",
      base: nuxt.options.dev ? joinURL(nuxt.options.app.baseURL, nuxt.options.app.buildAssetsDir) : "/__NUXT_BASE__/",
      publicDir: resolve(nuxt.options.rootDir, nuxt.options.srcDir, nuxt.options.dir.static),
      vue: {
        isProduction: !nuxt.options.dev,
        template: {
          compilerOptions: nuxt.options.vue.compilerOptions
        }
      },
      esbuild: {
        jsxFactory: "h",
        jsxFragment: "Fragment",
        tsconfigRaw: "{}"
      },
      clearScreen: false,
      define: {
        "process.dev": nuxt.options.dev,
        "process.static": nuxt.options.target === "static",
        "process.env.NODE_ENV": JSON.stringify(nuxt.options.dev ? "development" : "production"),
        "process.mode": JSON.stringify(nuxt.options.dev ? "development" : "production"),
        "process.target": JSON.stringify(nuxt.options.target)
      },
      resolve: {
        extensions: [".mjs", ".js", ".ts", ".jsx", ".tsx", ".json", ".vue"],
        alias: {
          ...nuxt.options.alias,
          "#build": nuxt.options.buildDir,
          ".nuxt": nuxt.options.buildDir,
          "/entry.mjs": resolve(nuxt.options.buildDir, "client.js"),
          "web-streams-polyfill/ponyfill/es2018": resolve(distDir, "runtime/vite/mock/web-streams-polyfill.mjs"),
          "whatwg-url": resolve(distDir, "runtime/vite/mock/whatwg-url.mjs"),
          "abort-controller": resolve(distDir, "runtime/vite/mock/abort-controller.mjs")
        }
      },
      optimizeDeps: {
        exclude: [
          ...nuxt.options.build.transpile.filter((i) => typeof i === "string"),
          "vue-demi",
          "ufo",
          "date-fns",
          "nanoid",
          "vue"
        ]
      },
      css: resolveCSSOptions(nuxt),
      build: {
        assetsDir: nuxt.options.dev ? withoutLeadingSlash(nuxt.options.app.buildAssetsDir) : ".",
        emptyOutDir: false,
        rollupOptions: {
          output: { sanitizeFileName: sanitizeFilePath }
        }
      },
      plugins: [
        replace({
          __webpack_public_path__: "globalThis.__webpack_public_path__"
        }),
        jsxPlugin(),
        DynamicBasePlugin.vite(),
        defaultExportPlugin()
      ],
      server: {
        watch: {
          ignored: isIgnored
        },
        hmr: {
          protocol: "ws",
          clientPort: hmrPort,
          port: hmrPort
        },
        fs: {
          strict: false,
          allow: [
            nuxt.options.buildDir,
            nuxt.options.srcDir,
            nuxt.options.rootDir,
            ...nuxt.options.modulesDir
          ]
        }
      }
    }, nuxt.options.vite)
  };
  await ctx.nuxt.callHook("vite:extend", ctx);
  if (nuxt.options.dev) {
    ctx.nuxt.hook("vite:serverCreated", (server) => {
      const start = Date.now();
      warmupViteServer(server, ["/.nuxt/entry.mjs"]).then(() => {
        logger.info(`Vite warmed up in ${Date.now() - start}ms`);
      }).catch(logger.error);
    });
  }
  await buildClient(ctx);
  await prepareManifests(ctx);
  await buildServer(ctx);
}
class ViteBuilder {
  constructor(builder) {
    this.builder = builder;
    this.nuxt = builder.nuxt;
  }
  build() {
    return bundle(this.nuxt, this.builder);
  }
}

export { ViteBuilder };
