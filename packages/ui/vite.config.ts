import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
	base: './',
	plugins: [react()],
	server: {
		proxy: {
			'/api': {
				target: 'http://localhost:5391',
				changeOrigin: true,
			},
		},
	},
	build: {
		outDir: '../cli/dist/ui/client',
		emptyOutDir: true,
	},
})
