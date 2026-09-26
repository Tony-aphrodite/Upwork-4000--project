/**
 * Payment screenshots.
 *
 * On a hosted project they go to a private Supabase Storage bucket, named <tenant>/<receipt>.jpg,
 * with policies that mirror the receipts table; the database keeps the same name and a SHA-256 of
 * the image, so the same screenshot cannot be used twice. In the in-browser demo, and whenever the
 * phone has no connection, the image is kept here in IndexedDB and uploaded when it can be.
 *
 * The copy in IndexedDB is not a cache to be tidied away: it is what makes a receipt recorded in a
 * dead spot survive until the connection comes back.
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


// ------------------------------------------------------------------ hosted storage

const BUCKET = "proofs";
const PENDING = "qirsh.proofs.pending";

function pendingList(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function setPending(paths: string[]) {
  try {
    localStorage.setItem(PENDING, JSON.stringify([...new Set(paths)]));
  } catch {
    /* storage disabled: the blob is still in IndexedDB, it just will not be retried automatically */
  }
}

/**
 * Keeps the image on the phone, then puts it in the bucket if it can. A failure is not an error
 * here: the receipt is what matters, and the photo follows when there is a connection.
 */
export async function saveProof(path: string, blob: Blob, hosted: boolean): Promise<"uploaded" | "waiting" | "local"> {
  await putProof(path, blob);
  if (!hosted) return "local";
  const done = await uploadProof(path, blob);
  if (done) return "uploaded";
  setPending([...pendingList(), path]);
  return "waiting";
}

async function uploadProof(path: string, blob: Blob): Promise<boolean> {
  try {
    const { hostedClient } = await import("./hosted");
    const { error } = await hostedClient().storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
    // Already there: the same receipt saved twice is the same photo, which is not a failure.
    return !error || /exists/i.test(error.message);
  } catch {
    return false;
  }
}

/** Sends whatever is waiting. Called when the connection comes back, beside the order outbox. */
export async function flushProofs(): Promise<number> {
  const waiting = pendingList();
  if (waiting.length === 0) return 0;
  const left: string[] = [];
  let sent = 0;
  for (const path of waiting) {
    const blob = await getProof(path);
    if (!blob) continue; // nothing to send: the phone was cleared
    if (await uploadProof(path, blob)) sent += 1;
    else left.push(path);
  }
  setPending(left);
  return sent;
}

export const proofsWaiting = () => pendingList().length;

/** What to show: the copy on this phone if it is here, otherwise a short-lived link from the bucket. */
export async function proofSource(path: string, hosted: boolean): Promise<{ blob?: Blob; url?: string } | null> {
  const local = await getProof(path);
  if (local) return { blob: local };
  if (!hosted) return null;
  try {
    const { hostedClient } = await import("./hosted");
    const { data } = await hostedClient().storage.from(BUCKET).createSignedUrl(path, 300);
    return data?.signedUrl ? { url: data.signedUrl } : null;
  } catch {
    return null;
  }
}
