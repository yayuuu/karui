import { render } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { Photo } from '../../../content.js';
import type { PhotoResponse } from './upload.js';
import { t } from '../../i18n.js';
type Action = 'up' | 'down' | 'alt' | 'delete';
type Job = { id: string; file: File; alt: string; progress: number; state: 'queued' | 'uploading' | 'processing' | 'done' | 'error'; error?: string };
type GallerySource = { language: string; photos: number };
type Services = {
  upload: (file: File, alt: string, progress: (percent: number) => void) => Promise<PhotoResponse>;
  change: (index: number, action: Action, alt: string) => Promise<PhotoResponse>;
  copy: (sourceLanguage: string) => Promise<PhotoResponse>;
  committed: (result: PhotoResponse) => void;
  busy: (value: boolean) => void;
  insert: (photo: Photo) => void;
  error: (error: unknown) => void;
};

function PhotoCard({ photo, index, busy, services, change }: { photo: Photo; index: number; busy: boolean; services: Services; change: (index: number, action: Action, alt: string) => void }) {
  const [alt, setAlt] = useState(photo.alt);
  return <div class="panel-photo" data-photo-index={index}>
    <a href={photo.src} target="_blank" rel="noopener"><img src={photo.thumbnail} alt={photo.alt} loading="lazy" /></a>
    <label>{t('Photo description')}<input type="text" data-photo-alt value={alt} maxLength={500} onInput={event => setAlt(event.currentTarget.value)} /></label>
    <div class="panel-photo-actions">
      <button type="button" disabled={busy} aria-label={t('Move photo earlier')} onClick={() => change(index, 'up', alt)}>←</button>
      <button type="button" disabled={busy} aria-label={t('Move photo later')} onClick={() => change(index, 'down', alt)}>→</button>
      <button type="button" disabled={busy} onClick={() => change(index, 'alt', alt)}>{t('Save description')}</button>
      <button type="button" disabled={busy} class="danger" onClick={() => change(index, 'delete', alt)}>{t('Delete')}</button>
    </div>
    <button type="button" class="quiet" onClick={() => services.insert(photo)}>{t('Insert into content')}</button>
  </div>;
}

function Photos({ initial, sources, services }: { initial: Photo[]; sources: GallerySource[]; services: Services }) {
  const [photos, setPhotos] = useState(initial), [jobs, setJobs] = useState<Job[]>([]), [busy, setBusy] = useState(false);
  const active = useRef(false), input = useRef<HTMLInputElement>(null), description = useRef<HTMLInputElement>(null);
  const update = (id: string, patch: Partial<Job>) => setJobs(previous => previous.map(job => job.id === id ? { ...job, ...patch } : job));
  const commit = (result: PhotoResponse) => { services.committed(result); setPhotos(result.gallery); };
  const run = async (action: () => Promise<void>) => {
    if (active.current) return;
    active.current = true; setBusy(true); services.busy(true);
    try { await action(); } catch (error) { services.error(error); }
    finally { active.current = false; setBusy(false); services.busy(false); }
  };
  const send = (batch: Job[]) => void run(async () => {
    for (const job of batch) {
      update(job.id, { state: 'uploading', progress: 0, error: undefined });
      try {
        if (job.file.size > 10 * 1024 * 1024) throw new Error(t('The maximum photo size is 10 MB.'));
        const result = await services.upload(job.file, job.alt, progress => update(job.id, { progress, state: progress === 100 ? 'processing' : 'uploading' }));
        commit(result); update(job.id, { state: 'done', progress: 100 });
      } catch (error) { update(job.id, { state: 'error', error: (error as Error).message }); }
    }
  });
  const change = (index: number, action: Action, alt: string) => {
    if (action === 'delete' && !confirm(t('Remove the photo from this gallery? The file will be retained.'))) return;
    void run(async () => { commit(await services.change(index, action, alt)); });
  };
  return <>
    <div class="panel-photo-grid">{photos.map((photo, index) => <PhotoCard key={photo.src} photo={photo} index={index} busy={busy} services={services} change={change} />)}</div>
    {!!sources.length && <details class="panel-gallery-copy">
      <summary>{t('Copy gallery from another language')}</summary>
      <form onSubmit={event => {
        event.preventDefault();
        const sourceLanguage = new FormData(event.currentTarget).get('sourceLanguage');
        if (typeof sourceLanguage !== 'string') return;
        void run(async () => { commit(await services.copy(sourceLanguage)); });
      }}>
        <label>{t('Copy gallery from')}<select name="sourceLanguage" disabled={busy}>
          {sources.map(source => <option key={source.language} value={source.language}>{source.language.toUpperCase()} ({t('{count} photos', { count: source.photos })})</option>)}
        </select></label>
        <button type="submit" disabled={busy}>{t('Copy gallery')}</button>
      </form>
      <small>{t('Copying replaces this language version’s gallery. The image files are shared, not duplicated.')}</small>
    </details>}
    <form class="panel-upload" data-upload-photo onSubmit={event => {
      event.preventDefault(); if (active.current) return;
      const batch = [...(input.current?.files ?? [])].map(file => ({ id: crypto.randomUUID(), file, alt: description.current?.value ?? '', progress: 0, state: 'queued' as const }));
      if (!batch.length) return;
      setJobs(previous => [...previous.filter(job => job.state !== 'done'), ...batch]);
      input.current!.value = ''; send(batch);
    }}>
      <label>{t('Photo files')}<input ref={input} type="file" name="image" multiple required disabled={busy} accept="image/png,image/jpeg,image/webp,image/gif,image/avif" /></label>
      <label>{t('Photo descriptions')}<input ref={description} type="text" name="alt" maxLength={500} /></label>
      <small>{t('Up to 10 MB and 25 megapixels per photo. Uploads run in the background, so you can keep editing.')}</small>
      <button type="submit" class="primary" disabled={busy}>{t(busy ? 'Uploading…' : 'Add photo')}</button>
    </form>
    <div class="panel-upload-jobs" aria-live="polite">{jobs.map(job => <div key={job.id} class="panel-upload-job" data-upload-state={job.state}>
      <span>{job.file.name}</span><progress max={100} value={job.progress} aria-label={t('Uploading {file}', { file: job.file.name })} />
      <span>{job.state === 'done' ? t('Done') : job.state === 'error' ? job.error : job.state === 'processing' ? t('Creating thumbnails…') : job.state === 'queued' ? t('Queued') : `${job.progress}%`}</span>
      {job.state === 'error' && <button type="button" disabled={busy} onClick={() => send([job])}>{t('Retry')}</button>}
    </div>)}</div>
  </>;
}
export function mountPhotos(root: HTMLElement, services: Services) {
  render(<Photos initial={JSON.parse(root.dataset.photos!)} sources={JSON.parse(root.dataset.gallerySources ?? '[]')} services={services} />, root);
}
