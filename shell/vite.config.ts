import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

export default defineConfig({
  base: '/emulator/retro-station/',
  plugins: [
    react(),
    {
      name: 'file-saver',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.method === 'POST' && req.url === '/api/save-file') {
            try {
              let body = '';
              for await (const chunk of req) {
                body += chunk;
              }
              const { filename, dataUrl, content, savePath } = JSON.parse(body);

              if (!savePath) {
                throw new Error("No save path provided");
              }

              const targetDir = path.resolve(savePath);
              if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
              }

              const targetFilePath = path.join(targetDir, filename);

              if (dataUrl) {
                const base64Data = dataUrl.split(';base64,').pop();
                if (!base64Data) {
                  throw new Error("Invalid base64 data");
                }
                fs.writeFileSync(targetFilePath, base64Data, 'base64');
              } else if (content) {
                fs.writeFileSync(targetFilePath, content, 'utf8');
              }

              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, path: targetFilePath }));
              return;
            } catch (err: any) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: err.message }));
              return;
            }
          }
          next();
        });
      }
    }
  ],
  server: {
    port: 5006,
    host: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    port: 5006,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  resolve: {
    alias: {
      'snes-core': path.resolve(__dirname, '../snes/src/index.ts'),
      'nes-core': path.resolve(__dirname, '../nes/src/index.ts'),
      'gb-core': path.resolve(__dirname, '../gb/src/index.ts'),
      'gba-core': path.resolve(__dirname, '../gba/src/index.ts'),
      'atari-core': path.resolve(__dirname, '../atari/src/index.ts'),
    }
  },
  build: {
    target: 'esnext',
  }
});

