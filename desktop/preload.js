// Puente mínimo entre el Blackbox (la página) y la app de escritorio: repartir las ventanas en las
// pantallas y saber que se está dentro de la app. Nada más llega a la página.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bbDesktop', {
  app: true,
  spread: () => ipcRenderer.invoke('spread'),
  version: () => ipcRenderer.invoke('version'),
})
