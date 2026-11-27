import { defineConfig } from 'vite'
import { cp, copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const runtimeScripts = [
  'lighting.js',
  'hitbox-visuals.js',
  'scene.js',
  'auto-furniture.js',
  'furniture-system.js',
  'ergonomics.js',
  'start-menu.js'
]

const copyRuntimeAssets = {
  name: 'copy-runtime-assets',
  apply: 'build',
  async closeBundle() {
    const outputDirectory = resolve('dist')
    const scriptsDirectory = resolve(outputDirectory, 'js')
    const vendorDirectory = resolve(outputDirectory, 'vendor')
    const modelsDirectory = resolve(outputDirectory, 'models')
    await Promise.all([
      mkdir(scriptsDirectory, {recursive: true}),
      cp(resolve('public/vendor'), vendorDirectory, {recursive: true}),
      mkdir(modelsDirectory, {recursive: true})
    ])
    await Promise.all([
      ...runtimeScripts.map(file =>
        copyFile(resolve('js', file), resolve(scriptsDirectory, file))
      ),
      copyFile(
        resolve('public/models/living_room_interior_free.glb'),
        resolve(modelsDirectory, 'living_room_interior_free.glb')
      )
    ])
  }
}

export default defineConfig({
  root: '.',
  publicDir: false,
  plugins: [copyRuntimeAssets],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'index.html'
    }
  },
  resolve: {
    alias: {
      '@': '/src'
    }
  }
})