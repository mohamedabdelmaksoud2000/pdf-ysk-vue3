import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig(({ command }) => {
  const isDevServer = command === 'serve'

  return {
    plugins: [
      vue(),
    ],
    // Serve the local demo app at "/" when running `npm run dev`.
    ...(isDevServer
      ? { root: path.resolve(__dirname, 'example') }
      : {
        build: {
          lib: {
            entry: path.resolve(__dirname, 'src/index.ts'),
            name: 'pdf-ysk-vue3',
            formats: ['es'],
            fileName: (format) => `pdf-ysk-vue3.${format}.js`,
          },
          rollupOptions: {
            external: ['vue'],
            output: {
              globals: {
                vue: 'Vue',
              },
            },
          },
        },
      }),
  }
})
