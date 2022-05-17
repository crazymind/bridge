import type { Hookable } from 'hookable';
import type { Vue } from 'vue/types/vue';
import type { ComponentOptions } from 'vue';
import { defineComponent } from './composables';
export declare const isVue2 = true;
export declare const isVue3 = false;
export declare const defineNuxtComponent: typeof defineComponent;
export interface VueAppCompat {
    component: Vue['component'];
    config: {
        globalProperties: any;
        [key: string]: any;
    };
    directive: Vue['directive'];
    mixin: Vue['mixin'];
    mount: Vue['mount'];
    provide: (name: string, value: any) => void;
    unmount: Vue['unmount'];
    use: Vue['use'];
    version: string;
}
export interface RuntimeNuxtHooks {
    'vue:setup': () => void;
    'app:mounted': (app: VueAppCompat) => void | Promise<void>;
    'meta:register': (metaRenderers: any[]) => void | Promise<void>;
}
export interface NuxtAppCompat {
    nuxt2Context: Vue;
    vue2App: ComponentOptions<Vue>;
    vueApp: VueAppCompat;
    globalName: string;
    hooks: Hookable<RuntimeNuxtHooks>;
    hook: NuxtAppCompat['hooks']['hook'];
    callHook: NuxtAppCompat['hooks']['callHook'];
    [key: string]: any;
    ssrContext?: Record<string, any>;
    payload: {
        [key: string]: any;
    };
    provide: (name: string, value: any) => void;
}
export interface Context {
    $_nuxtApp: NuxtAppCompat;
}
export declare const setNuxtAppInstance: (nuxt: NuxtAppCompat | null) => void;
/**
 * Ensures that the setup function passed in has access to the Nuxt instance via `useNuxt`.
 *
 * @param nuxt A Nuxt instance
 * @param setup The function to call
 */
export declare function callWithNuxt<T extends (...args: any[]) => any>(nuxt: NuxtAppCompat, setup: T, args?: Parameters<T>): ReturnType<T>;
interface Plugin {
    (nuxt: NuxtAppCompat): Promise<void> | Promise<{
        provide?: Record<string, any>;
    }> | void | {
        provide?: Record<string, any>;
    };
}
export declare function defineNuxtPlugin(plugin: Plugin): (ctx: Context, inject: (id: string, value: any) => void) => void;
export declare const useNuxtApp: () => NuxtAppCompat;
export {};
