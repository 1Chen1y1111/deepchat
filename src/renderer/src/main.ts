import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'

import { createI18n } from 'vue-i18n'
import locales from './i18n'

const i18n = createI18n({
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  legacy: false,
  messages: locales
})

const app = createApp(App)

app.use(i18n)
app.mount('#app')
