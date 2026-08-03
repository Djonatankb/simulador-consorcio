const http = require('http');
const fs = require('fs');
const path = require('path');

// Carrega variáveis do arquivo .env local
if (fs.existsSync(path.join(__dirname, '.env'))) {
  const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [key, ...vals] = trimmed.split('=');
      process.env[key.trim()] = vals.join('=').trim();
    }
  });
}

const apiHandler = require('./api/simulador');
const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Rota da Serverless Function /api/simulador
  if (pathname.startsWith('/api/simulador')) {
    let bodyChunks = [];
    req.on('data', chunk => bodyChunks.push(chunk));
    req.on('end', async () => {
      const rawBody = Buffer.concat(bodyChunks).toString('utf8');
      try {
        req.body = rawBody ? JSON.parse(rawBody) : {};
      } catch (e) {
        req.body = rawBody;
      }

      // Polyfill dos helpers da Vercel (res.status e res.json)
      if (!res.status) {
        res.status = function(code) {
          res.statusCode = code;
          return res;
        };
      }
      if (!res.json) {
        res.json = function(data) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(data));
          return res;
        };
      }

      await apiHandler(req, res);
    });
    return;
  }

  // Roteamento de Arquivos Estáticos (/ e /simulador-consorcio)
  const isRoot = pathname === '/' || pathname === '/simulador-consorcio' || pathname === '/simulador-consorcio/';
  let filePath = path.join(__dirname, isRoot ? 'simulador-consorcio.html' : pathname);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(__dirname, 'simulador-consorcio.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500);
      res.end('Erro interno ao ler arquivo');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 Simulador de Consórcio rodando em Localhost!`);
  console.log(`👉 Abra no seu navegador: http://localhost:${PORT}/simulador-consorcio`);
  console.log(`⚡ Modo Bypass SMS Ativado (SKIP_SMS_VERIFICATION=true)`);
  console.log(`==================================================\n`);
});
