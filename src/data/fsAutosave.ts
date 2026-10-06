import { backupFileName, serializeBackup } from './backup';
import type { Repository } from './repository';

/**
 * Copia automática en un archivo elegido por el usuario (File System Access API,
 * solo Chrome/Edge). El handle se guarda en la tabla `meta` de IndexedDB.
 * Tras recargar, el navegador exige un clic para volver a conceder permiso.
 */

const HANDLE_KEY = 'autosave_file_handle';
const DEBOUNCE_MS = 2000;

export type AutosaveState =
  | { status: 'unsupported' }
  | { status: 'unlinked' }
  | { status: 'needs-permission'; fileName: string }
  | { status: 'active'; fileName: string; lastSavedAt: Date | null }
  | { status: 'error'; fileName: string; message: string };

export const supportsFileAutosave = () =>
  typeof window !== 'undefined' && 'showSaveFilePicker' in window;

export class FileAutosave {
  private handle: FileSystemFileHandle | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(s: AutosaveState) => void>();
  private state: AutosaveState = { status: 'unsupported' };
  private readonly repo: Repository;

  constructor(repo: Repository) {
    this.repo = repo;
  }

  getState() {
    return this.state;
  }

  subscribe(l: (s: AutosaveState) => void) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }

  private set(state: AutosaveState) {
    this.state = state;
    for (const l of this.listeners) l(state);
  }

  async init() {
    if (!supportsFileAutosave()) return this.set({ status: 'unsupported' });
    this.repo.onChange(() => this.schedule());
    this.handle = (await this.repo.getMeta<FileSystemFileHandle>(HANDLE_KEY)) ?? null;
    if (!this.handle) return this.set({ status: 'unlinked' });
    const perm = await this.handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') this.set({ status: 'active', fileName: this.handle.name, lastSavedAt: null });
    else this.set({ status: 'needs-permission', fileName: this.handle.name });
  }

  /** Debe llamarse desde un clic del usuario. */
  async link() {
    const handle = await window.showSaveFilePicker({
      suggestedName: backupFileName().replace(/-\d{4}-\d{2}-\d{2}/, '-autosave'),
      types: [{ description: 'Copia JSON', accept: { 'application/json': ['.json'] } }],
    });
    this.handle = handle;
    await this.repo.setMeta(HANDLE_KEY, handle);
    this.set({ status: 'active', fileName: handle.name, lastSavedAt: null });
    await this.write();
  }

  /** Debe llamarse desde un clic del usuario. */
  async reactivate() {
    if (!this.handle) return;
    const perm = await this.handle.requestPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      this.set({ status: 'active', fileName: this.handle.name, lastSavedAt: null });
      await this.write();
    }
  }

  async unlink() {
    this.handle = null;
    await this.repo.setMeta(HANDLE_KEY, null);
    this.set({ status: 'unlinked' });
  }

  private schedule() {
    if (this.state.status !== 'active') return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.write(), DEBOUNCE_MS);
  }

  private async write() {
    if (!this.handle) return;
    try {
      const writable = await this.handle.createWritable();
      await writable.write(await serializeBackup(this.repo));
      await writable.close();
      const at = new Date();
      await this.repo.markBackup(at);
      this.set({ status: 'active', fileName: this.handle.name, lastSavedAt: at });
    } catch (e) {
      this.set({
        status: 'error',
        fileName: this.handle.name,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
