import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

function demoApi(): Plugin {
  return {
    name: 'local-data-sync-api',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = new URL(request.url ?? '/', 'http://localhost')
        if (requestUrl.pathname !== '/api/jobs') {
          next()
          return
        }
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (request.method === 'GET') {
          response.statusCode = 200
          response.end(JSON.stringify({
            items: [
              { id: 'job-1042', name: 'customer-daily-sync', environment: 'production', status: 'running' },
              { id: 'job-1038', name: 'inventory-hourly', environment: 'staging', status: 'completed' },
            ],
          }))
          return
        }
        if (request.method !== 'POST') {
          response.statusCode = 405
          response.end(JSON.stringify({ code: 'METHOD_NOT_ALLOWED' }))
          return
        }

        let body = ''
        request.on('data', (chunk) => { body += chunk })
        request.on('end', () => {
          JSON.parse(body || '{}')
          const environment = requestUrl.searchParams.get('environment')
          if (environment === 'production') {
            response.statusCode = 422
            response.end(JSON.stringify({ code: 'QUOTA_EXCEEDED', requestId: 'req-demo-422' }))
            return
          }
          response.statusCode = 201
          response.end(JSON.stringify({ id: 'job-demo-001' }))
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [vue(), demoApi()],
  server: { port: 5173, strictPort: true },
})
