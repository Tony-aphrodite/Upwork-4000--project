/**
 * Payment screenshots. In production they go to a private Supabase Storage bucket
 * (proofs/<tenant>/<receipt>.jpg) with a policy mirroring the receipts table; the database keeps
 * the path and a SHA-256 of the image so the same screenshot can't be used twice. In the demo
 * the image stays in this browser (IndexedDB).
 */
const DB = "qirsh-proofs";
const STORE = "files";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function putProof(path: string, blob: Blob) {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, path);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getProof(path: string): Promise<Blob | null> {
  const db = await open();
  return new Promise((resolve) => {
    const r = db.transaction(STORE).objectStore(STORE).get(path);
    r.onsuccess = () => resolve((r.result as Blob) ?? null);
    r.onerror = () => resolve(null);
  });
}

/** Shrinks a phone photo to at most 1280 px (a screenshot stays readable, the upload stays small on 3G). */
export async function compress(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.8));
}

export async function sha256(blob: Blob) {
  const buf = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
