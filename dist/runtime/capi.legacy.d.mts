export { ref };
export function defineNuxtMiddleware(): never;
export function defineNuxtPlugin(): never;
export function setMetaPlugin(): never;
export function setSSRContext(): never;
export function globalPlugin(): never;
export function withContext(): never;
export function useStatic(): never;
export function reqRef(): never;
export function reqSsrRef(): never;
export function ssrRef(value: any, key: any): import("@vue/composition-api").Ref<any>;
export function shallowSsrRef(value: any, key: any): any;
export function ssrPromise(value: any, key: any): Promise<any>;
export function onGlobalSetup(fn: any): void;
export function useAsync(cb: any, key: any): import("@vue/composition-api").Ref<any>;
export function useContext(): {
    route: import("@vue/composition-api").ComputedRef<import("@vue/composition-api").ComputedRef<import("vue-router").Route>>;
    query: import("@vue/composition-api").ComputedRef<import("vue-router/types/router").Dictionary<string | string[]>>;
    from: import("@vue/composition-api").ComputedRef<any>;
    params: import("@vue/composition-api").ComputedRef<import("vue-router/types/router").Dictionary<string>>;
    $el: Element;
    $options: import("vue").ComponentOptions<import("vue").default, import("vue/types/options").DefaultData<import("vue").default>, import("vue/types/options").DefaultMethods<import("vue").default>, import("vue/types/options").DefaultComputed, import("vue/types/options").PropsDefinition<import("vue/types/options").DefaultProps>, import("vue/types/options").DefaultProps>;
    $parent: import("vue").default;
    $root: import("vue").default;
    $children: import("vue").default[];
    $refs: {
        [key: string]: Element | import("vue").default | (Element | import("vue").default)[];
    };
    $slots: {
        [key: string]: import("vue").VNode[];
    };
    $scopedSlots: {
        [key: string]: import("vue/types/vnode").NormalizedScopedSlot;
    };
    $isServer: boolean;
    $data: Record<string, any>;
    $props: Record<string, any>;
    $ssrContext: any;
    $vnode: import("vue").VNode;
    $attrs: Record<string, string>;
    $listeners: Record<string, Function | Function[]>;
    $mount(elementOrSelector?: string | Element, hydrating?: boolean): import("vue").default;
    $forceUpdate(): void;
    $destroy(): void;
    $set: {
        <T>(object: object, key: string | number, value: T): T;
        <T_1>(array: T_1[], key: number, value: T_1): T_1;
    };
    $delete: {
        (object: object, key: string | number): void;
        <T_2>(array: T_2[], key: number): void;
    };
    $watch(expOrFn: string, callback: (this: import("vue").default, n: any, o: any) => void, options?: import("vue").WatchOptions): () => void;
    $watch<T_3>(expOrFn: (this: import("vue").default) => T_3, callback: (this: import("vue").default, n: T_3, o: T_3) => void, options?: import("vue").WatchOptions): () => void;
    $on(event: string | string[], callback: Function): import("vue").default;
    $once(event: string | string[], callback: Function): import("vue").default;
    $off(event?: string | string[], callback?: Function): import("vue").default;
    $emit(event: string, ...args: any[]): import("vue").default;
    $nextTick(callback: (this: import("vue").default) => void): void;
    $nextTick(): Promise<void>;
    $createElement: import("vue").CreateElement;
    $meta(): import("vue-meta").VueMetaPlugin;
    $router: import("vue-router").default;
    $route: import("vue-router").Route;
};
export function defineComponent(options: any): any;
export function useMeta(init: any): any;
export function wrapProperty(property: any, makeComputed?: boolean): () => any;
export function useRouter(): import("vue-router").default;
export function useRoute(): import("@vue/composition-api").ComputedRef<import("vue-router").Route>;
export function useStore(): any;
export function useFetch(callback: any): {
    fetch: any;
    fetchState: any;
};
import { ref } from "@vue/composition-api";
export { computed, createApp, createRef, customRef, defineAsyncComponent, del, effectScope, getCurrentInstance, getCurrentScope, h, inject, isRaw, isReactive, isReadonly, isRef, markRaw, nextTick, onActivated, onBeforeMount, onBeforeUnmount, onBeforeUpdate, onDeactivated, onErrorCaptured, onMounted, onScopeDispose, onServerPrefetch, onUnmounted, onUpdated, provide, proxyRefs, reactive, readonly, set, shallowReactive, shallowReadonly, shallowRef, toRaw, toRef, toRefs, triggerRef, unref, useAttrs, useCssModule, useCSSModule, useSlots, version, warn, watch, watchEffect, watchPostEffect, watchSyncEffect } from "@vue/composition-api";
