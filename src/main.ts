import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { initSession } from './lms/session'
import './styles/lms.css'

async function bootstrap(): Promise<void> {
  // Restore the session before the first route resolves so guards are accurate.
  await initSession()
  createApp(App).use(router).mount('#app')
}

void bootstrap()
