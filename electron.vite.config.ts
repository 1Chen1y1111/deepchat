import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    server: {
      host: '0.0.0.0' // 防止代理干扰，导致 vite-electron 之间 ws://localhost:5713 和 http://localhost:5713 通信失败、页面组件无法加载
    },
    plugins: [tailwindcss(), vue()]
  }
})
