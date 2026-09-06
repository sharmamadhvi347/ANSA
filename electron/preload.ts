import { contextBridge, ipcRenderer } from 'electron';

/**
 * MeshMend API exposed to the renderer process via contextBridge.
 * All filesystem and dialog access goes through here — the renderer
 * never touches Node.js directly.
 */
contextBridge.exposeInMainWorld('meshmend', {
  // ─── Dialog ─────────────────────────────────────────────────────────────
  openProject: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openProject'),

  // ─── Filesystem ─────────────────────────────────────────────────────────
  readDir: (dirPath: string): Promise<Array<{ name: string; isDirectory: boolean; path: string }>> =>
    ipcRenderer.invoke('fs:readDir', dirPath),

  readFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('fs:readFile', filePath),

  writeFile: (filePath: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),

  stat: (filePath: string): Promise<{ size: number; isDirectory: boolean; modified: string } | null> =>
    ipcRenderer.invoke('fs:stat', filePath),
});
