import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      // OneDrive keeps touching these non-app files in the repo root, which
      // triggered full-page dev reloads mid-use. The app never imports them.
      ignored: ['**/*.pdf', '**/*.zip', '**/*.xlsx', '**/Schnider BOM/**', '**/logo/**', '**/SSC Automation*', '**/SSC Order Detail*', '**/Delivery Challan*'],
    },
  },
})
