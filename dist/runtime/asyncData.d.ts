import type { Ref, WatchSource } from 'vue';
import { NuxtApp } from '#app';
export declare type _Transform<Input = any, Output = any> = (input: Input) => Output;
export declare type PickFrom<T, K extends Array<string>> = T extends Array<any> ? T : T extends Record<string, any> ? Pick<T, K[number]> : T;
export declare type KeysOf<T> = Array<keyof T extends string ? keyof T : string>;
export declare type KeyOfRes<Transform extends _Transform> = KeysOf<ReturnType<Transform>>;
declare type MultiWatchSources = (WatchSource<unknown> | object)[];
export interface AsyncDataOptions<DataT, Transform extends _Transform<DataT, any> = _Transform<DataT, DataT>, PickKeys extends KeyOfRes<_Transform> = KeyOfRes<Transform>> {
    server?: boolean;
    lazy?: boolean;
    default?: () => DataT;
    transform?: Transform;
    pick?: PickKeys;
    watch?: MultiWatchSources;
    initialCache?: boolean;
}
export interface RefreshOptions {
    _initial?: boolean;
}
export interface _AsyncData<DataT, ErrorT> {
    data: Ref<DataT>;
    pending: Ref<boolean>;
    refresh: (opts?: RefreshOptions) => Promise<void>;
    error: Ref<ErrorT>;
}
export declare type AsyncData<Data, Error> = _AsyncData<Data, Error> & Promise<_AsyncData<Data, Error>>;
export declare function useAsyncData<DataT, DataE = any, Transform extends _Transform<DataT> = _Transform<DataT, DataT>, PickKeys extends KeyOfRes<Transform> = KeyOfRes<Transform>>(key: string, handler: (ctx?: NuxtApp) => Promise<DataT>, options?: AsyncDataOptions<DataT, Transform, PickKeys>): AsyncData<PickFrom<ReturnType<Transform>, PickKeys>, DataE>;
export declare function useLazyAsyncData<DataT, DataE = any, Transform extends _Transform<DataT> = _Transform<DataT, DataT>, PickKeys extends KeyOfRes<Transform> = KeyOfRes<Transform>>(key: string, handler: (ctx?: NuxtApp) => Promise<DataT>, options?: Omit<AsyncDataOptions<DataT, Transform, PickKeys>, 'lazy'>): AsyncData<PickFrom<ReturnType<Transform>, PickKeys>, DataE>;
export declare function refreshNuxtData(keys?: string | string[]): Promise<void>;
export {};
