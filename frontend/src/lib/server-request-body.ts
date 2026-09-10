export class RequestBodyError extends Error {
  constructor(readonly status: 400 | 408 | 413, message: string) { super(message); }
}

/** Bound bytes while reading, including chunked bodies without Content-Length. */
export async function readLimitedText(request: Request, maximumBytes = 65_536, deadlineMs = 10_000): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) {
    throw new RequestBodyError(400, 'Taille de demande invalide.');
  }
  if (declared !== null && Number(declared) > maximumBytes) {
    void request.body?.cancel().catch(() => {});
    throw new RequestBodyError(413, 'Demande trop volumineuse.');
  }
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new RequestBodyError(408, 'Délai de réception dépassé.'));
      void reader.cancel().catch(() => {});
    }, deadlineMs);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        void reader.cancel().catch(() => {});
        throw new RequestBodyError(413, 'Demande trop volumineuse.');
      }
      chunks.push(value);
    }
    const combined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(combined); }
    catch { throw new RequestBodyError(400, 'Encodage de demande invalide.'); }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
