/// <reference types="nitropack" />
import { NuxtModule } from '@nuxt/schema';
import { PluginOptions } from 'unplugin-vue2-script-setup/dist';

type ScriptSetupOptions = PluginOptions

interface BridgeConfig {
  nitro: boolean
  vite: boolean
  app: boolean | {}
  capi: boolean | {
    legacy?: boolean
  }
  scriptSetup: boolean | ScriptSetupOptions
  autoImports: boolean
  transpile: boolean
  compatibility: boolean
  postcss8: boolean
  resolve: boolean
  typescript: boolean
  meta: boolean | null
}

declare module '@nuxt/schema' {
  interface NuxtConfig {
    bridge?: Partial<BridgeConfig> | false
  }
}

declare const _default: NuxtModule<BridgeConfig>;

export { _default as default };
