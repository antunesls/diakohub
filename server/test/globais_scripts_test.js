const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '../web');

/** Nomes declarados no topo do script (função, classe, const/let/var), sem olhar dentro de blocos. */
function globaisDoScript(codigo) {
  const nomes = [];
  const re = /^(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of codigo.matchAll(re)) nomes.push(m[1]);
  return nomes;
}

// Scripts clássicos de uma página dividem o mesmo escopo global: uma função com o nome de outra
// substitui a primeira sem erro (roteiros.js tinha um mover() que quebrava as setas dos recados).
test('scripts de uma mesma página não declaram o mesmo nome global', () => {
  for (const pagina of fs.readdirSync(WEB).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(WEB, pagina), 'utf8');
    const scripts = [...html.matchAll(/<script src="\/([\w.-]+\.js)(?:\?[^"]*)?"/g)].map((m) => m[1])
      .filter((s) => fs.existsSync(path.join(WEB, s)));
    const donos = new Map();
    for (const script of scripts) {
      for (const nome of new Set(globaisDoScript(fs.readFileSync(path.join(WEB, script), 'utf8')))) {
        const anterior = donos.get(nome);
        assert.equal(anterior, undefined, `${pagina}: "${nome}" declarado em ${anterior} e em ${script}`);
        donos.set(nome, script);
      }
    }
  }
});
