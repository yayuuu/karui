import type { Photo } from '../../../content.js';
import { t } from '../../i18n.js';
export type PhotoResponse = { revision: string; gallery: Photo[] };

/** AJAX transfer progress, followed by server-side image processing. */
export function uploadPhoto(url: string, csrf: string, file: File, progress: (percent: number) => void): Promise<PhotoResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url); xhr.timeout = 120000; xhr.setRequestHeader('X-CSRF-Token', csrf);
    xhr.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
    xhr.onerror = () => reject(new Error(t('Network error while uploading the photo.')));
    xhr.ontimeout = () => reject(new Error(t('The upload timed out. Check the gallery before trying again.')));
    xhr.onabort = () => reject(new Error(t('Upload cancelled.')));
    xhr.onload = () => {
      if (xhr.status === 401) {
        location.assign('/panel');
        return;
      }
      try {
        const result = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300) throw new Error(result.error ?? t('The photo could not be uploaded.'));
        resolve(result);
      } catch (error) { reject(error); }
    };
    const body = new FormData(); body.append('image', file); xhr.send(body);
  });
}
