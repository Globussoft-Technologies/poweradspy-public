import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')
    const apiBaseUrl = env.VITE_PAS_API_BASE_URL || 'https://stagingtest-api.poweradspy.com'
    const host = new URL(apiBaseUrl).host

    return {
        plugins: [react()],
        server: {
            host: true,
            allowedHosts: [host],
            proxy: {
                '/api': {
                    target: apiBaseUrl,
                    changeOrigin: true,
                    secure: false,
                },
                '/logout': {
                    target: apiBaseUrl,
                    changeOrigin: true,
                },
            },
        },
    }
})
