export interface SavedRom {
  data: ArrayBuffer;
  name: string;
  size: string;
  title: string;
  mapper: string;
  version: string;
  checksum: string;
}

export class RetroStationDB {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('RetroStationDB', 2);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      
      request.onupgradeneeded = (e: any) => {
        const db = request.result;
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
        if (!db.objectStoreNames.contains('roms')) {
          db.createObjectStore('roms');
        }
        if (!db.objectStoreNames.contains('autosave')) {
          db.createObjectStore('autosave');
        }
        if (!db.objectStoreNames.contains('saveslots')) {
          db.createObjectStore('saveslots');
        }
      };
    });
  }

  private async getDB(): Promise<IDBDatabase> {
    if (!this.db) {
      await this.init();
    }
    return this.db!;
  }

  async setSetting(key: string, value: any): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getSetting(key: string): Promise<any> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async saveRom(coreId: string, rom: SavedRom): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('roms', 'readwrite');
      const store = tx.objectStore('roms');
      const req = store.put(rom, coreId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getRom(coreId: string): Promise<SavedRom | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('roms', 'readonly');
      const store = tx.objectStore('roms');
      const req = store.get(coreId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async saveAutosave(coreId: string, state: Uint8Array): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('autosave', 'readwrite');
      const store = tx.objectStore('autosave');
      const req = store.put({ state, timestamp: Date.now() }, coreId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getAutosave(coreId: string): Promise<Uint8Array | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('autosave', 'readonly');
      const store = tx.objectStore('autosave');
      const req = store.get(coreId);
      req.onsuccess = () => resolve(req.result ? req.result.state : null);
      req.onerror = () => reject(req.error);
    });
  }

  async clearAutosave(coreId: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('autosave', 'readwrite');
      const store = tx.objectStore('autosave');
      const req = store.delete(coreId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async saveSlot(coreId: string, slotIdx: number, state: Uint8Array): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('saveslots', 'readwrite');
      const store = tx.objectStore('saveslots');
      const req = store.put({ state, timestamp: Date.now() }, `${coreId}_${slotIdx}`);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getSlot(coreId: string, slotIdx: number): Promise<Uint8Array | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('saveslots', 'readonly');
      const store = tx.objectStore('saveslots');
      const req = store.get(`${coreId}_${slotIdx}`);
      req.onsuccess = () => resolve(req.result ? req.result.state : null);
      req.onerror = () => reject(req.error);
    });
  }

  async clearAllData(): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['settings', 'roms', 'autosave', 'saveslots'], 'readwrite');
      tx.objectStore('settings').clear();
      tx.objectStore('roms').clear();
      tx.objectStore('autosave').clear();
      tx.objectStore('saveslots').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
