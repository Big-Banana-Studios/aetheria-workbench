// IndexedDB: the project files and their chunks (text plus, when the
// embedder ran, a vector). Everything else - conversations, the memory jar,
// settings - is small enough for localStorage. Nothing leaves the browser.

const DB = "workbench";
const VERSION = 2; // 2: the audio cache (one Kokoro clip per line of a set, keyed by text hash)
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("files")) {
        const f = db.createObjectStore("files", { keyPath: "id" });
        f.createIndex("desk", "desk");
      }
      if (!db.objectStoreNames.contains("chunks")) {
        const c = db.createObjectStore("chunks", { keyPath: "id" });
        c.createIndex("desk", "desk");
        c.createIndex("fileId", "fileId");
      }
      if (!db.objectStoreNames.contains("audio")) db.createObjectStore("audio", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    try {
      result = fn(s);
    } catch (e) {
      reject(e);
      return;
    }
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function all(index, key) {
  return new Promise((resolve, reject) => {
    const req = key == null ? index.getAll() : index.getAll(key);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export const store = {
  async putFile(file) {
    const db = await open();
    return tx(db, "files", "readwrite", (s) => s.put(file));
  },
  async listFiles(desk) {
    const db = await open();
    const t = db.transaction("files", "readonly");
    return all(t.objectStore("files").index("desk"), desk);
  },
  async deleteFile(id) {
    const db = await open();
    await tx(db, "files", "readwrite", (s) => s.delete(id));
    const chunks = await this.chunksOfFile(id);
    await tx(db, "chunks", "readwrite", (s) => {
      for (const c of chunks) s.delete(c.id);
    });
  },
  async putChunks(chunks) {
    const db = await open();
    return tx(db, "chunks", "readwrite", (s) => {
      for (const c of chunks) s.put(c);
    });
  },
  async chunksOfDesk(desk) {
    const db = await open();
    const t = db.transaction("chunks", "readonly");
    return all(t.objectStore("chunks").index("desk"), desk);
  },
  async chunksOfFile(fileId) {
    const db = await open();
    const t = db.transaction("chunks", "readonly");
    return all(t.objectStore("chunks").index("fileId"), fileId);
  },
  // the audio cache: a synthesized line never has to be synthesized twice
  async getAudio(key) {
    const db = await open();
    return tx(db, "audio", "readonly", (s) => s.get(key));
  },
  async putAudio(key, samples, rate, text = "") {
    const db = await open();
    return tx(db, "audio", "readwrite", (s) => s.put({ key, samples, rate, text: text.slice(0, 120), t: Date.now() }));
  },
  async audioCount() {
    const db = await open();
    return tx(db, "audio", "readonly", (s) => s.count());
  },
  async wipeAudio() {
    const db = await open();
    return tx(db, "audio", "readwrite", (s) => s.clear());
  },
  async wipe() {
    if (dbp) {
      try {
        (await dbp).close();
      } catch {
        /* ignore */
      }
      dbp = null;
    }
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(DB);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  },
  async usage() {
    try {
      const est = await navigator.storage.estimate();
      return { usage: est.usage || 0, quota: est.quota || 0, persisted: await navigator.storage.persisted?.() };
    } catch {
      return null;
    }
  },
};
