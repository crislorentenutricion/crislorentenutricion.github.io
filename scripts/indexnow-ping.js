#!/usr/bin/env node
// Notifica a IndexNow (Bing, Yandex, Seznam, Naver) las URLs cambiadas tras un deploy.
// Se ejecuta en el workflow de GitHub Actions después del deploy a Pages.

const https = require('https');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOST = 'www.crislorentenutricion.com';
const KEY = 'a2ed8653990925208a58dc703ed7ed39';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const ENDPOINT = 'https://api.indexnow.org/indexnow';

const CORE_PAGES = ['/', '/servicios/', '/sobre-mi/', '/blog/'];

function changedFiles() {
  try {
    const out = execSync('git diff --name-only HEAD~1 HEAD', { encoding: 'utf8' });
    return out.split('\n').map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function postUrlFromFile(file, blog) {
  const m = file.match(/^src\/blog\/posts\/(.+)\.njk$/);
  if (!m) return null;
  const slug = m[1];
  const post = blog.find(p => p.slug === slug);
  return post ? `/blog/${post.category}/${post.slug}/` : null;
}

function resolveUrls(files) {
  const urls = new Set();
  const blog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', '_data', 'blog.json'), 'utf8'));

  let globalChange = false;

  for (const f of files) {
    if (f === 'src/index.njk') urls.add('/');
    else if (f === 'src/servicios.njk') urls.add('/servicios/');
    else if (f === 'src/sobre-mi.njk') urls.add('/sobre-mi/');
    else if (f === 'src/blog/index.njk') urls.add('/blog/');
    else if (f === 'src/_data/blog.json') urls.add('/blog/');
    else if (f.startsWith('src/blog/posts/')) {
      const u = postUrlFromFile(f, blog);
      if (u) urls.add(u);
    } else if (
      f.startsWith('src/_includes/') ||
      f.startsWith('src/css/') ||
      f === '.eleventy.js'
    ) {
      globalChange = true;
    }
  }

  if (globalChange) CORE_PAGES.forEach(u => urls.add(u));
  return [...urls].slice(0, 50);
}

function submit(urls) {
  const payload = JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: KEY_LOCATION,
    urlList: urls.map(u => `https://${HOST}${u}`)
  });

  return new Promise((resolve, reject) => {
    const req = https.request(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

(async () => {
  const files = changedFiles();
  if (!files.length) {
    console.log('IndexNow: sin cambios detectados, nada que enviar.');
    return;
  }
  const urls = resolveUrls(files);
  if (!urls.length) {
    console.log('IndexNow: ningún fichero cambiado mapea a una URL pública.');
    return;
  }
  console.log(`IndexNow: enviando ${urls.length} URL(s):`);
  urls.forEach(u => console.log('  ', u));

  const res = await submit(urls);
  console.log(`IndexNow: HTTP ${res.status}${res.body ? ' — ' + res.body : ''}`);
  if (res.status >= 400) process.exit(1);
})();
