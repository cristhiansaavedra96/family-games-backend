// Lógica de bingo (JS) - 75 bolas clásico (1..75), 5x5, columnas BINGO por rango, centro libre

function range(n) { return Array.from({ length: n }, (_, i) => i + 1); }

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffleBag() { return shuffle(range(75)); }

function generateCard() {
  // Genera cartón clásico por rangos de columna:
  // B:1-15, I:16-30, N:31-45 (centro libre), G:46-60, O:61-75
  const pickUnique = (start, end, count) => {
    const nums = [];
    const used = new Set();
    while (nums.length < count) {
      const n = Math.floor(Math.random() * (end - start + 1)) + start;
      if (!used.has(n)) { used.add(n); nums.push(n); }
    }
  // No ordenar: mantener el orden aleatorio dentro de la columna
  return nums;
  };

  const grid = Array.from({ length: 5 }, () => Array(5).fill(null));
  // B (col 0)
  const B = pickUnique(1, 15, 5);
  for (let r = 0; r < 5; r++) grid[r][0] = B[r];
  // I (col 1)
  const I = pickUnique(16, 30, 5);
  for (let r = 0; r < 5; r++) grid[r][1] = I[r];
  // N (col 2) con centro libre
  const N = pickUnique(31, 45, 4);
  grid[0][2] = N[0];
  grid[1][2] = N[1];
  grid[2][2] = null; // free
  grid[3][2] = N[2];
  grid[4][2] = N[3];
  // G (col 3)
  const G = pickUnique(46, 60, 5);
  for (let r = 0; r < 5; r++) grid[r][3] = G[r];
  // O (col 4)
  const O = pickUnique(61, 75, 5);
  for (let r = 0; r < 5; r++) grid[r][4] = O[r];

  return grid;
}

function buildMarkedMatrix(card, drawn) {
  const set = new Set(drawn);
  const marked = Array.from({ length: 5 }, () => Array(5).fill(false));
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (r === 2 && c === 2) { marked[r][c] = true; continue; }
      marked[r][c] = set.has(card[r][c]);
    }
  }
  return marked;
}

function allTrue(list) { return list.every(Boolean); }

function checkCorners(m) { return m[0][0] && m[0][4] && m[4][0] && m[4][4]; }
function checkAnyRow(m) { return m.some(row => allTrue(row)); }
function checkAnyCol(m) { return [0,1,2,3,4].some(c => allTrue([m[0][c],m[1][c],m[2][c],m[3][c],m[4][c]])); }
function checkAnyDiagonal(m) {
  const d1 = allTrue([m[0][0], m[1][1], m[2][2], m[3][3], m[4][4]]);
  const d2 = allTrue([m[0][4], m[1][3], m[2][2], m[3][1], m[4][0]]);
  return d1 || d2;
}
function checkBorder(m) {
  // contorno: fila 0 y 4 completas, y col 0 y 4 completas
  const top = allTrue(m[0]);
  const bottom = allTrue(m[4]);
  const left = allTrue([m[0][0],m[1][0],m[2][0],m[3][0],m[4][0]]);
  const right = allTrue([m[0][4],m[1][4],m[2][4],m[3][4],m[4][4]]);
  return top && bottom && left && right;
}
function checkFull(m) { return m.flat().every(Boolean); }

function checkFigures(marked) {
  return {
    corners: checkCorners(marked),
    row: checkAnyRow(marked),
    column: checkAnyCol(marked),
    diagonal: checkAnyDiagonal(marked),
    border: checkBorder(marked),
    full: checkFull(marked),
  };
}

function toWordsEs(n) {
  // Simplificado: "siete cinco, setenta y cinco"; sólo formatea dígitos + número
  const digits = String(n).split('').map(d => [
    'cero','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve'
  ][Number(d)]).join(' ');
  // Número en palabras (simple para 1..75)
  const unidades = ['','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve'];
  const especiales = ['diez','once','doce','trece','catorce','quince','dieciséis','diecisiete','dieciocho','diecinueve'];
  const decenas = ['','','veinte','treinta','cuarenta','cincuenta','sesenta','setenta'];
  let palabras = '';
  if (n < 10) palabras = unidades[n];
  else if (n < 20) palabras = especiales[n-10];
  else {
    const d = Math.floor(n/10), u = n%10;
    if (n === 20) palabras = 'veinte';
    else if (d === 2) palabras = u ? `veinti${unidades[u]}` : 'veinte';
    else palabras = u ? `${decenas[d]} y ${unidades[u]}` : decenas[d];
  }
  return `${digits}, ${palabras}`;
}

module.exports = {
  shuffleBag,
  generateCard,
  buildMarkedMatrix,
  checkFigures,
  toWordsEs,
};
