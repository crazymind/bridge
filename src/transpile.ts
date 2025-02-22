import { useNuxt } from '@nuxt/kit'

export const setupTranspile = () => {
  const nuxt = useNuxt()

  nuxt.hook('modules:done', () => {
    const modules = [
      '@nuxt/bridge-edge',
      ...nuxt.options.buildModules,
      ...nuxt.options.modules,
      ...nuxt.options._modules
    ]
      .map(m => typeof m === 'string' ? m : Array.isArray(m) ? m[0] : m.src)
      .filter(m => typeof m === 'string')
      .map(m => m.split('node_modules/').pop())

    // Try to sanitize modules to better match imports
    nuxt.options.build.transpile =
      nuxt.options.build.transpile.map(m => typeof m === 'string' ? m.split('node_modules/').pop()! : m)

    function isTranspilePresent (mod: string) {
      return nuxt.options.build.transpile.some(t => !(t instanceof Function) && (t instanceof RegExp ? t.test(mod) : new RegExp(t).test(mod)))
    }

    // Automatically add used modules to the transpile
    for (const module of modules) {
      if (!isTranspilePresent(module)) {
        nuxt.options.build.transpile.push(module)
      }
    }
  })
}
