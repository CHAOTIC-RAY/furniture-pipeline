import { zip } from 'fflate';

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

export function buildResultsZip(entries: { path: string; dataUrl: string }[]): Promise<Uint8Array> {
  const zippable: Record<string, Uint8Array> = {};
  for (const e of entries) {
    zippable[`processed/${e.path}`] = dataUrlToUint8Array(e.dataUrl);
  }
  return new Promise((resolve, reject) => {
    zip(zippable, { level: 6 }, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}
