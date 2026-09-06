"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
/**
 * MeshMend API exposed to the renderer process via contextBridge.
 * All filesystem and dialog access goes through here — the renderer
 * never touches Node.js directly.
 */
electron_1.contextBridge.exposeInMainWorld('meshmend', {
    // ─── Dialog ─────────────────────────────────────────────────────────────
    openProject: () => electron_1.ipcRenderer.invoke('dialog:openProject'),
    // ─── Filesystem ─────────────────────────────────────────────────────────
    readDir: (dirPath) => electron_1.ipcRenderer.invoke('fs:readDir', dirPath),
    readFile: (filePath) => electron_1.ipcRenderer.invoke('fs:readFile', filePath),
    writeFile: (filePath, content) => electron_1.ipcRenderer.invoke('fs:writeFile', filePath, content),
    stat: (filePath) => electron_1.ipcRenderer.invoke('fs:stat', filePath),
});
//# sourceMappingURL=preload.js.map