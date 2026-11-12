// `npm start`: compila y arranca el servidor del equipo (app + API) en http://localhost:4173.
// Si ya hay uno en marcha en ese puerto y es el nuestro (node servidor/index.ts), lo para y arranca el nuevo, así
// también se cogen los cambios de servidor/. Si el puerto lo ocupa otro programa, no lo toca y avisa.
import { execSync, spawn } from 'node:child_process';
import net from 'node:net';

const PORT = 4173;
const URL = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// El servidor puede escuchar en IPv4 (127.0.0.1) o en IPv6 (::1) según el sistema: se prueban las dos.
const listening = (host) => new Promise((resolve) => {
  const socket = net.connect(PORT, host);
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});
const inUse = async () => (await listening('127.0.0.1')) || (await listening('::1'));

/** Procesos de nuestro servidor que escuchan en el puerto (con lsof, en macOS y Linux). */
function ourServers() {
  let pids = [];
  try {
    pids = execSync(`lsof -tiTCP:${PORT} -sTCP:LISTEN`, { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return [];
  }
  return [...new Set(pids)].filter((pid) => {
    try {
      return execSync(`ps -o command= -p ${pid}`, { encoding: 'utf8' }).includes('servidor/index.ts');
    } catch {
      return false;
    }
  }).map(Number);
}

execSync('npm run build', { stdio: 'inherit' });

if (await inUse()) {
  const pids = ourServers();
  if (!pids.length) {
    console.log(`\n✗ Compilado, pero el puerto ${PORT} lo está usando otro programa: ciérralo y vuelve a ejecutar npm start.\n`);
    process.exit(1);
  }
  console.log('\n↻ Parando el servidor que estaba en marcha…');
  for (const pid of pids) process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 50 && (await inUse()); i++) await sleep(100);
  if (await inUse()) {
    console.log(`✗ El servidor anterior no se ha parado: ciérralo (Ctrl+C en su terminal) y vuelve a ejecutar npm start.\n`);
    process.exit(1);
  }
}

console.log(`\n✓ Compilado. Arrancando el servidor del equipo… (recarga ${URL} dos veces si ya lo tenías abierto)`);
spawn(process.execPath, ['servidor/index.ts'], { stdio: 'inherit' });
