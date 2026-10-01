import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins:[react()], base:'./', build:{outDir:'dist/extension',emptyOutDir:true,rollupOptions:{input:{workspace:'workspace.html',feature:'feature.html'}}},test:{include:['tests/**/*.test.ts','plugins/**/*.test.ts','apps/ui/**/*.test.ts']} } as any);
