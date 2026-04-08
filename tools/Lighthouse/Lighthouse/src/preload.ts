import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('api', {
  // Add APIs here
});
