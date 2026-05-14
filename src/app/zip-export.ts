import { zip } from 'fflate';

export type ZipLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export function buildResultsZip(
  entries: { path: string; dataUrl: string }[],
  level: ZipLevel = 6,
): Promise<Uint8Array> {
  const zippable: Record<string, Uint8Array> = {};
  for (const e of entries) {
    zippable[`processed/${e.path}`] = dataUrlToUint8Array(e.dataUrl);
  }
  return new Promise((resolve, reject) => {
    zip(zippable, { level }, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}
