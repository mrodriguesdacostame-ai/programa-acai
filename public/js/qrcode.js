/* QR mini — gerador self-contained (byte mode, versões 1-4, correção L, melhor máscara).
   Suficiente pra um payload curto (ex.: "acaipedido:<id>:<num>"). Só GERA (Fase 28);
   a leitura fica pra depois. Expõe window.qrMatriz(texto) -> { size, dark[r][c] } ou null. */
(function (global) {
  // ── GF(256) com primitivo 0x11d ──
  var EXP = new Array(512), LOG = new Array(256);
  (function () { var x = 1; for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255]; })();
  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }
  function genPoly(n) { var g = [1]; for (var i = 0; i < n; i++) { var ng = new Array(g.length + 1); for (var k = 0; k < ng.length; k++) ng[k] = 0; for (var j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= gmul(g[j], EXP[i]); } g = ng; } return g; }
  function rsEC(data, ecCount) { var gen = genPoly(ecCount), res = data.concat(new Array(ecCount).fill(0)); for (var i = 0; i < data.length; i++) { var c = res[i]; if (c) for (var j = 0; j < gen.length; j++) res[i + j] ^= gmul(gen[j], c); } return res.slice(data.length); }
  // versão → [dataCodewords, ecCodewords, posiçãoDoAlinhamento|null]
  var VER = { 1: [19, 7, null], 2: [34, 10, 18], 3: [55, 15, 22], 4: [80, 20, 26] };

  function escolherVersao(len) { for (var v = 1; v <= 4; v++) if (len + 2 <= VER[v][0]) return v; return null; } // +2 = modo/tamanho aprox.

  function bits(bytes, ver) {
    var buf = [], put = function (val, n) { for (var i = n - 1; i >= 0; i--) buf.push((val >> i) & 1); };
    put(0x4, 4);                 // modo byte
    put(bytes.length, 8);        // contador (8 bits p/ v1-9)
    for (var i = 0; i < bytes.length; i++) put(bytes[i], 8);
    var cap = VER[ver][0] * 8;
    if (buf.length + 4 <= cap) put(0, 4); // terminador
    while (buf.length % 8) buf.push(0);
    var cw = [];
    for (i = 0; i < buf.length; i += 8) { var b = 0; for (var j = 0; j < 8; j++) b = (b << 1) | buf[i + j]; cw.push(b); }
    var pad = [0xEC, 0x11], p = 0;
    while (cw.length < VER[ver][0]) cw.push(pad[p++ % 2]);
    return cw;
  }

  function novaMatriz(size) { var m = []; for (var r = 0; r < size; r++) { m.push([]); for (var c = 0; c < size; c++) m[r].push(null); } return m; }
  function porFinder(m, r, c) {
    for (var dr = -1; dr <= 7; dr++) for (var dc = -1; dc <= 7; dc++) {
      var rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
      var dark = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) || (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
      m[rr][cc] = dark ? 1 : 0;
    }
  }
  function porAlinhamento(m, pos) {
    if (pos == null) return; var r = pos, c = pos;
    for (var dr = -2; dr <= 2; dr++) for (var dc = -2; dc <= 2; dc++) m[r + dr][c + dc] = (Math.max(Math.abs(dr), Math.abs(dc)) !== 1) ? 1 : 0;
  }
  function reservado(m, size, r, c) { // é módulo de função (não recebe dado)?
    if (r < 9 && c < 9) return true;                 // finder TL + formato
    if (r < 9 && c >= size - 8) return true;          // finder TR
    if (r >= size - 8 && c < 9) return true;          // finder BL
    if (r === 6 || c === 6) return true;              // timing
    var pos = VER[verAtual][2];
    if (pos != null && r >= pos - 2 && r <= pos + 2 && c >= pos - 2 && c <= pos + 2) return true; // alinhamento
    return false;
  }
  var verAtual = 1;

  function maskFn(k, r, c) {
    switch (k) {
      case 0: return (r + c) % 2 === 0; case 1: return r % 2 === 0; case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0; case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return (r * c) % 2 + (r * c) % 3 === 0; case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0;
      default: return ((r + c) % 2 + (r * c) % 3) % 2 === 0;
    }
  }
  function formatBits(mask) { // EC nível L = 01 (BCH 15,5 — método de referência)
    var data = (0x01 << 3) | mask, rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >> 9) & 1) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }
  function porFormato(m, size, mask) { // colocação canônica (Nayuki): m[linha][coluna]
    var f = formatBits(mask), gb = function (i) { return (f >> i) & 1; }, i;
    for (i = 0; i <= 5; i++) m[8][i] = gb(i);
    m[8][7] = gb(6); m[8][8] = gb(7); m[7][8] = gb(8);
    for (i = 9; i < 15; i++) m[14 - i][8] = gb(i);
    for (i = 0; i < 8; i++) m[size - 1 - i][8] = gb(i);
    for (i = 8; i < 15; i++) m[8][size - 15 + i] = gb(i);
    m[size - 8][8] = 1; // módulo escuro fixo
  }
  function penalidade(m) {
    var size = m.length, p = 0, r, c, i;
    for (r = 0; r < size; r++) for (c = 0; c < size - 4; c++) { var run = 1; for (i = 1; c + i < size && m[r][c + i] === m[r][c]; i++) run++; if (run >= 5) { p += 3 + (run - 5); c += run - 1; } }
    for (c = 0; c < size; c++) for (r = 0; r < size - 4; r++) { var rn = 1; for (i = 1; r + i < size && m[r + i][c] === m[r][c]; i++) rn++; if (rn >= 5) { p += 3 + (rn - 5); r += rn - 1; } }
    return p;
  }

  global.qrMatriz = function (texto) {
    try {
      var bytes = []; for (var i = 0; i < texto.length; i++) { var cc = texto.charCodeAt(i); if (cc < 128) bytes.push(cc); else { bytes.push(63); } }
      var ver = escolherVersao(bytes.length); if (!ver) return null;
      verAtual = ver;
      var size = 17 + ver * 4;
      var data = bits(bytes, ver), ec = rsEC(data, VER[ver][1]), all = data.concat(ec);
      // stream de bits dos codewords
      var stream = []; for (i = 0; i < all.length; i++) for (var b = 7; b >= 0; b--) stream.push((all[i] >> b) & 1);

      var melhor = null, melhorP = Infinity;
      for (var mask = 0; mask < 8; mask++) {
        var m = novaMatriz(size);
        porFinder(m, 0, 0); porFinder(m, 0, size - 7); porFinder(m, size - 7, 0);
        for (var t = 8; t < size - 8; t++) { if (m[6][t] == null) m[6][t] = t % 2 === 0 ? 1 : 0; if (m[t][6] == null) m[t][6] = t % 2 === 0 ? 1 : 0; }
        porAlinhamento(m, VER[ver][2]);
        porFormato(m, size, mask);
        // mapeia os bits em zigue-zague (de baixo pra cima), pulando a coluna 6
        var idx = 0, up = true;
        for (var col = size - 1; col > 0; col -= 2) {
          if (col === 6) col--;
          for (var row = 0; row < size; row++) {
            var rr = up ? size - 1 - row : row;
            for (var dc = 0; dc < 2; dc++) {
              var cc2 = col - dc;
              if (m[rr][cc2] != null) continue;
              var bit = idx < stream.length ? stream[idx++] : 0;
              if (maskFn(mask, rr, cc2)) bit ^= 1;
              m[rr][cc2] = bit;
            }
          }
          up = !up;
        }
        var pen = penalidade(m);
        if (pen < melhorP) { melhorP = pen; melhor = m; }
      }
      return { size: size, dark: melhor };
    } catch (e) { return null; }
  };
})(window);
