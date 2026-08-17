import { defineConfig } from 'tsdown'

const packageId = '@udaho/deepseek-harness-remote'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    clean: false,
    format: ['esm'],
    outDir: 'lib',
    dts: false,
    sourcemap: true,
    deps: { neverBundle: [/^@deepseek-ai\//, 'schemastery', 'cloudflared'] },
    outExtensions: () => ({ js: '.js' }),
  },
  {
    entry: { client: 'src/client/index.ts' },
    clean: false,
    format: ['cjs'],
    outDir: 'lib',
    dts: false,
    sourcemap: true,
    deps: {
      neverBundle: [/^@deepseek-ai\//, 'react', 'react-dom', 'react/jsx-runtime'],
      alwaysBundle: ['qrcode.react'],
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageId)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
    outExtensions: () => ({ js: '.js' }),
  },
  {
    entry: { mobile: 'src/mobile/index.tsx' },
    clean: false,
    format: ['iife'],
    outDir: 'lib',
    dts: false,
    sourcemap: true,
    deps: { alwaysBundle: () => true },
    outputOptions: { entryFileNames: 'mobile.js' },
  },
])
