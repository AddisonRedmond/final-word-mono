import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: [
      { find: /^types\/(.*)\.js$/, replacement: resolve(__dirname, '../../packages/types/src/$1.ts') },
      { find: 'types', replacement: resolve(__dirname, '../../packages/types/src/index.ts') },
      { find: 'words/five_letter_words.js', replacement: resolve(__dirname, '../../packages/words/five_letter_words.ts') },
    ],
  },
})
