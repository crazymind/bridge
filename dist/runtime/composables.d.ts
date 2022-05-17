import { Ref } from '@vue/composition-api';
import type { MetaInfo } from 'vue-meta';
import type VueRouter from 'vue-router';
import type { Location, Route } from 'vue-router';
import type { RuntimeConfig } from '@nuxt/schema';
export { useLazyAsyncData, refreshNuxtData } from './asyncData';
export { useLazyFetch } from './fetch';
export { useCookie } from './cookie';
export { useRequestHeaders } from './ssr';
export * from '@vue/composition-api';
export declare const useAsyncData: () => never;
export declare const useFetch: () => never;
export declare const useHydration: () => never;
export declare const useRuntimeConfig: () => RuntimeConfig;
export declare const useRouter: () => VueRouter;
export declare const useRoute: () => Route;
export declare const useState: <T>(key: string, init?: () => T) => Ref<T>;
declare type Reffed<T extends Record<string, any>> = {
    [P in keyof T]: T[P] extends Array<infer A> ? Ref<Array<Reffed<A>>> | Array<Reffed<A>> : T[P] extends Record<string, any> ? Reffed<T[P]> | Ref<Reffed<T[P]>> : T[P] | Ref<T[P]>;
};
export declare const useNuxt2Meta: (metaOptions: Reffed<MetaInfo> | (() => Reffed<MetaInfo>)) => void;
export interface AddRouteMiddlewareOptions {
    global?: boolean;
}
export interface NavigateToOptions {
    replace?: boolean;
}
export declare const navigateTo: (to: Route, options?: NavigateToOptions) => Promise<Route | void> | Route;
/** This will abort navigation within a Nuxt route middleware handler. */
export declare const abortNavigation: (err?: Error | string) => boolean;
declare type RouteMiddlewareReturn = void | Error | string | Location | boolean;
export interface RouteMiddleware {
    (to: Route, from: Route): RouteMiddlewareReturn | Promise<RouteMiddlewareReturn>;
}
export declare const defineNuxtRouteMiddleware: (middleware: RouteMiddleware) => RouteMiddleware;
interface AddRouteMiddleware {
    (name: string, middleware: RouteMiddleware, options?: AddRouteMiddlewareOptions): void;
    (middleware: RouteMiddleware): void;
}
export declare const addRouteMiddleware: AddRouteMiddleware;
