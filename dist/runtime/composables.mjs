import { getCurrentInstance, onBeforeUnmount, isRef, watch, reactive, toRef, isReactive, set } from "@vue/composition-api";
import { sendRedirect } from "h3";
import { defu } from "defu";
import { useNuxtApp } from "./app.mjs";
export { useLazyAsyncData, refreshNuxtData } from "./asyncData.mjs";
export { useLazyFetch } from "./fetch.mjs";
export { useCookie } from "./cookie.mjs";
export { useRequestHeaders } from "./ssr.mjs";
export * from "@vue/composition-api";
const mock = () => () => {
  throw new Error("not implemented");
};
export const useAsyncData = mock();
export const useFetch = mock();
export const useHydration = mock();
export const useRuntimeConfig = () => {
  const nuxtApp = useNuxtApp();
  if (nuxtApp._config) {
    return nuxtApp._config;
  }
  const config = reactive(nuxtApp.$config);
  nuxtApp._config = new Proxy(config, {
    get(target, prop) {
      if (prop === "public") {
        return target.public;
      }
      return target[prop] ?? target.public[prop];
    },
    set(target, prop, value) {
      if (prop === "public" || prop === "app") {
        return false;
      }
      target[prop] = value;
      target.public[prop] = value;
      return true;
    }
  });
  return nuxtApp._config;
};
export const useRouter = () => {
  return useNuxtApp()?.nuxt2Context.app.router;
};
export const useRoute = () => {
  const nuxtApp = useNuxtApp();
  if (!nuxtApp._route) {
    Object.defineProperty(nuxtApp, "__route", {
      get: () => nuxtApp.nuxt2Context.app.context.route
    });
    nuxtApp._route = reactive(nuxtApp.__route);
    const router = useRouter();
    router.afterEach((route) => Object.assign(nuxtApp._route, route));
  }
  return nuxtApp._route;
};
export const useState = (key, init) => {
  const nuxtApp = useNuxtApp();
  if (!nuxtApp.payload.useState) {
    nuxtApp.payload.useState = {};
  }
  if (!isReactive(nuxtApp.payload.useState)) {
    nuxtApp.payload.useState = reactive(nuxtApp.payload.useState);
  }
  if (!(key in nuxtApp.payload.useState)) {
    set(nuxtApp.payload.useState, key, void 0);
  }
  const state = toRef(nuxtApp.payload.useState, key);
  if (state.value === void 0 && init) {
    state.value = init();
  }
  return state;
};
function unwrap(value) {
  if (!value || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((i) => unwrap(i));
  }
  if (isRef(value)) {
    return unwrap(value.value);
  }
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, value2]) => [key, unwrap(value2)]));
  }
  return value;
}
function metaInfoFromOptions(metaOptions) {
  return metaOptions instanceof Function ? metaOptions : () => metaOptions;
}
export const useNuxt2Meta = (metaOptions) => {
  let vm = null;
  try {
    vm = getCurrentInstance().proxy;
    const meta = vm.$meta();
    const $root = vm.$root;
    if (!vm._vueMeta) {
      vm._vueMeta = true;
      let parent = vm.$parent;
      while (parent && parent !== $root) {
        if (parent._vueMeta === void 0) {
          parent._vueMeta = false;
        }
        parent = parent.$parent;
      }
    }
    vm.$options.head = vm.$options.head || {};
    const unwatch = watch(metaInfoFromOptions(metaOptions), (metaInfo) => {
      vm.$metaInfo = {
        ...vm.$metaInfo || {},
        ...unwrap(metaInfo)
      };
      if (process.client) {
        meta.refresh();
      }
    }, { immediate: true, deep: true });
    onBeforeUnmount(unwatch);
  } catch {
    const app = useNuxtApp().nuxt2Context.app;
    if (typeof app.head === "function") {
      const originalHead = app.head;
      app.head = function() {
        const head = originalHead.call(this) || {};
        return defu(unwrap(metaInfoFromOptions(metaOptions)()), head);
      };
    } else {
      app.head = defu(unwrap(metaInfoFromOptions(metaOptions)()), app.head);
    }
  }
};
function convertToLegacyMiddleware(middleware) {
  return async (ctx) => {
    const result = await middleware(ctx.route, ctx.from);
    if (result instanceof Error) {
      return ctx.error(result);
    }
    if (result) {
      return ctx.redirect(result);
    }
    return result;
  };
}
const isProcessingMiddleware = () => {
  try {
    if (useNuxtApp()._processingMiddleware) {
      return true;
    }
  } catch {
    return true;
  }
  return false;
};
export const navigateTo = (to, options = {}) => {
  if (isProcessingMiddleware()) {
    return to;
  }
  const router = useRouter();
  if (process.server && useNuxtApp().ssrContext) {
    const res = useNuxtApp().ssrContext?.res;
    const redirectLocation = router.resolve(to).route.fullPath;
    return sendRedirect(res, redirectLocation);
  }
  return options.replace ? router.replace(to) : router.push(to);
};
export const abortNavigation = (err) => {
  if (process.dev && !isProcessingMiddleware()) {
    throw new Error("abortNavigation() is only usable inside a route middleware handler.");
  }
  if (err) {
    throw err instanceof Error ? err : new Error(err);
  }
  return false;
};
export const defineNuxtRouteMiddleware = (middleware) => middleware;
export const addRouteMiddleware = (name, middleware, options = {}) => {
  const nuxtApp = useNuxtApp();
  if (options.global || typeof name === "function") {
    nuxtApp._middleware.global.push(typeof name === "function" ? name : middleware);
  } else {
    nuxtApp._middleware.named[name] = convertToLegacyMiddleware(middleware);
  }
};
