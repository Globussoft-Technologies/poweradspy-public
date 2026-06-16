const c = require('./coverage/coverage-final.json');
const path = require('path');
const out = [];
for (const f in c) {
  const d = c[f];
  let s = 0, st = 0, b = 0, bt = 0;
  for (const k in d.s) { st++; if (d.s[k] > 0) s++; }
  for (const k in d.b) { (d.b[k] || []).forEach(n => { bt++; if (n > 0) b++; }); }
  const sp = st ? s / st * 100 : 100;
  const rel = path.relative(process.cwd(), f).split(path.sep).join('/');
  out.push({ rel, sp, missS: st - s, missB: bt - b });
}
out.filter(r => r.sp < 100).sort((a, b) => a.sp - b.sp).forEach(r => {
  console.log(String(r.sp.toFixed(0)).padStart(3) + '%  missStmt=' + String(r.missS).padStart(3) + ' missBr=' + String(r.missB).padStart(3) + '  ' + r.rel);
});
