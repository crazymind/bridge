import { defineComponent, getCurrentInstance } from "./composables.mjs";
export const isVue2 = true;
export const isVue3 = false;
export const defineNuxtComponent = defineComponent;
let currentNuxtAppInstance;
export const setNuxtAppInstance = (nuxt) => {
  currentNuxtAppInstance = nuxt;
};
export function callWithNuxt(nuxt, setup, args) {
  setNuxtAppInstance(nuxt);
  const p = args ? setup(...args) : setup();
  if (process.server) {
    setNuxtAppInstance(null);
  }
  return p;
}
export function defineNuxtPlugin(plugin) {
  return async (ctx, inject) => {
    const result = await callWithNuxt(ctx.$_nuxtApp, plugin, [ctx.$_nuxtApp]);
    if (result && result.provide) {
      for (const key in result.provide) {
        inject(key, result.provide[key]);
      }
    }
    return result;
  };
}
export const useNuxtApp = () => {
  const vm = getCurrentInstance();
  if (!vm) {
    if (!currentNuxtAppInstance) {
      throw new Error("nuxt app instance unavailable");
    }
    return currentNuxtAppInstance;
  }
  return vm.proxy.$_nuxtApp;
};
