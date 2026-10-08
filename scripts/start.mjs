// `npm start`: compila y sirve la app en http://localhost:4173.
// Si ya hay una en marcha en ese puerto, solo compila (la que está en marcha sirve los archivos nuevos).
import { execSync, spawn } from 'node:child_process';
import net from 'node:net';

const PORT = 4173;
const URL = `http://localhost:${PORT}`;

// Vite puede escuchar en IPv4 (127.0.0.1) o en IPv6 (::1) según el sistema: se prueban las dos.
const listening = (host) => new Promise((resolve) => {
  const socket = net.connect(PORT, host);
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});
const inUse = async () => (await listening('127.0.0.1')) || (await listening('::1'));

execSync('npm run build', { stdio: 'inherit' });

if (await inUse()) {
  console.log(`\n✓ Compilado. La app ya estaba en marcha: recarga ${URL} (dos veces) para ver los cambios.\n`);
} else {
  console.log(`\n✓ Compilado. Abriendo la app en ${URL} (deja esta ventana abierta mientras la uses en el navegador).\n`);
  spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'inherit' });
}
