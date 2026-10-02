const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hotelDesktop", {
  isDesktop: true,
  reconnect: () => ipcRenderer.send("hotel:reconnect"),
  serverUrl: () => ipcRenderer.invoke("hotel:server-url"),
  onStatus: (fn) => {
    const handler = (_e, text) => fn(text);
    ipcRenderer.on("hotel:status", handler);
    return () => ipcRenderer.removeListener("hotel:status", handler);
  },
});
