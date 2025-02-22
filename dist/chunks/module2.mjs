import { defineNuxtModule, logger, addPluginTemplate, addTemplate } from '@nuxt/kit';
import hash from 'hash-sum';
import { resolve } from 'pathe';
import { genImport, genObjectFromRawEntries } from 'knitwork';

const version = "3.0.0";

const middlewareTemplate = {
  filename: "middleware.js",
  getContents(ctx) {
    const { dir, router: { middleware }, srcDir } = ctx.nuxt.options;
    const _middleware = (typeof middleware !== "undefined" && middleware || []).map((m) => {
      if (typeof m === "string") {
        m = { src: m };
      }
      return {
        filePath: resolve(srcDir, dir.middleware, m.src),
        id: m.name || m.src.replace(/[\\/]/g, "/").replace(/\.(js|ts)$/, "")
      };
    });
    return `${_middleware.map((m) => genImport(m.filePath, `$${hash(m.id)}`)).join("\n")}
const middleware = ${genObjectFromRawEntries(_middleware.map((m) => [m.id, `$${hash(m.id)}`]))}
export default middleware`;
  }
};
const storeTemplate = {
  filename: "store.js",
  getContents(ctx) {
    const { dir, srcDir } = ctx.nuxt.options;
    const { templateVars: { storeModules = [] } } = ctx.app;
    const _storeModules = storeModules.map((s) => ({
      filePath: resolve(srcDir, dir.store, s.src),
      id: s.src.replace(/\.(js|ts)$/, "").replace(/[\\/]/g, "/").replace(/index/, "") || "root"
    }));
    return `import Vue from 'vue'
import Vuex from 'vuex'
${_storeModules.map((s) => genImport(s.filePath, { name: "*", as: `$${hash(s.id)}` })).join("\n")}
Vue.use(Vuex)

const VUEX_PROPERTIES = ['state', 'getters', 'actions', 'mutations']

const storeModules = ${genObjectFromRawEntries(_storeModules.map((m) => [m.id, `$${hash(m.id)}`]))}

export function createStore() {
  let store = normalizeRoot(storeModules.root || {})
  delete storeModules.root
  for (const id in storeModules) {
    resolveStoreModules(store, storeModules[id], id)
  }
  if (typeof store === 'function') {
    return store
  }
  return new Vuex.Store(Object.assign({
    strict: (process.env.NODE_ENV !== 'production')
  }, store))
}

function normalizeRoot (moduleData, id) {
  moduleData = moduleData.default || moduleData
  if (moduleData.commit) {
    throw new Error(\`[nuxt] \${id} should export a method that returns a Vuex instance.\`)
  }
  if (typeof moduleData !== 'function') {
    // Avoid TypeError: setting a property that has only a getter when overwriting top level keys
    moduleData = { ...moduleData }
  }
  moduleData.modules = moduleData.modules || {}
  return moduleData
}

function resolveStoreModules (store, moduleData, id) {
  moduleData = moduleData.default || moduleData

  const namespaces = id.split('/').filter(Boolean)
  let moduleName = namespaces[namespaces.length - 1]

  // If src is a known Vuex property
  if (VUEX_PROPERTIES.includes(moduleName)) {
    const property = moduleName
    const propertyStoreModule = getStoreModule(store, namespaces, { isProperty: true })
    // Replace state since it's a function
    mergeProperty(propertyStoreModule, moduleData, property)
    return
  }

  const storeModule = getStoreModule(store, namespaces)

  for (const property of VUEX_PROPERTIES) {
    mergeProperty(storeModule, moduleData[property], property)
  }

  if (moduleData.namespaced === false) {
    delete storeModule.namespaced
  }
}


function getStoreModule (storeModule, namespaces, { isProperty = false } = {}) {
  // If ./mutations.js
  if (!namespaces.length || (isProperty && namespaces.length === 1)) {
    return storeModule
  }

  const namespace = namespaces.shift()

  storeModule.modules[namespace] = storeModule.modules[namespace] || {}
  storeModule.modules[namespace].namespaced = true
  storeModule.modules[namespace].modules = storeModule.modules[namespace].modules || {}

  return getStoreModule(storeModule.modules[namespace], namespaces, { isProperty })
}

function mergeProperty (storeModule, moduleData, property) {
  if (!moduleData) {
    return
  }
  if (property === 'state') {
    storeModule.state = moduleData || storeModule.state
  } else {
    storeModule[property] = { ...storeModule[property], ...moduleData }
  }
}`;
  }
};
const clientConfigTemplate = {
  filename: "nitro.client.mjs",
  getContents: () => `
export const useRuntimeConfig = () => window?.__NUXT__?.config || {}
`
};
const publicPathTemplate = {
  filename: "paths.mjs",
  getContents({ nuxt }) {
    return [
      "import { joinURL } from 'ufo'",
      !nuxt.options.dev && "import { useRuntimeConfig } from '#nitro'",
      nuxt.options.dev ? `const appConfig = ${JSON.stringify(nuxt.options.app)}` : "const appConfig = useRuntimeConfig().app",
      "export const baseURL = () => appConfig.baseURL",
      "export const buildAssetsDir = () => appConfig.buildAssetsDir",
      "export const buildAssetsURL = (...path) => joinURL(publicAssetsURL(), buildAssetsDir(), ...path)",
      "export const publicAssetsURL = (...path) => {",
      "  const publicBase = appConfig.cdnURL || appConfig.baseURL",
      "  return path.length ? joinURL(publicBase, ...path) : publicBase",
      "}"
    ].filter(Boolean).join("\n");
  }
};

const module = defineNuxtModule({
  meta: {
    name: "nuxt-bridge:vite",
    configKey: "vite"
  },
  defaults: {},
  setup(viteOptions, nuxt) {
    nuxt.options.cli.badgeMessages.push(`\u26A1  Vite Mode Enabled (v${version})`);
    if (viteOptions.experimentWarning !== false && !nuxt.options.test) {
      logger.log("\u{1F9EA}  Vite mode is experimental and some nuxt modules might be incompatible\n", "   If you find a bug, please report via https://github.com/nuxt/bridge/issues with a minimal reproduction.");
    }
    nuxt.options.build.loadingScreen = false;
    nuxt.options.build.indicator = false;
    nuxt.options._modules = nuxt.options._modules.filter((m) => !(Array.isArray(m) && m[0] === "@nuxt/loading-screen"));
    const getModuleName = (m) => {
      if (Array.isArray(m)) {
        m = m[0];
      }
      return m.meta ? m.meta.name : m;
    };
    const filterModule = (modules) => modules.filter((m) => getModuleName(m) !== "nuxt-bridge:vite");
    nuxt.options.modules = filterModule(nuxt.options.modules);
    nuxt.options.buildModules = filterModule(nuxt.options.buildModules);
    if (nuxt.options.store) {
      addPluginTemplate(storeTemplate);
    }
    addPluginTemplate(middlewareTemplate);
    addTemplate(clientConfigTemplate);
    addTemplate({
      ...publicPathTemplate,
      options: { nuxt }
    });
    nuxt.hook("builder:prepared", async (builder) => {
      if (nuxt.options._prepare) {
        return;
      }
      builder.bundleBuilder.close();
      delete builder.bundleBuilder;
      const { ViteBuilder } = await import('./vite.mjs');
      builder.bundleBuilder = new ViteBuilder(builder);
    });
    nuxt.hook("build:templates", (templates) => {
      const templatesFiles = templates.templatesFiles.filter((template) => {
        return !["store.js", "middleware.js"].includes(template.dst);
      });
      templates.templatesFiles.length = 0;
      templates.templatesFiles.push(...templatesFiles);
    });
  }
});

export { module as default };
