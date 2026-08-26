import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import { elementLocale, i18n } from './i18n'
import { router } from './router'
import './styles.css'

createApp(App)
  .use(router)
  .use(i18n)
  .use(ElementPlus, { locale: elementLocale })
  .mount('#app')
