import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import { Markdown } from '@tiptap/markdown';
import { renderContent, type ContentFormat } from '../../../content/format.js';
import { editableHtml, editorHtml, PreservedHtml, PreservedInlineHtml } from './html.js';
import { mountEditorToolbar } from './toolbar.js';
import { t } from '../../i18n.js';

export function initEditor(root: HTMLElement, dirty: () => void) {
  const source = root.querySelector<HTMLTextAreaElement>('[data-source]')!;
  const rich = root.querySelector<HTMLElement>('[data-rich-editor]')!;
  const preview = root.querySelector<HTMLIFrameElement>('[data-editor-preview]')!;
  const selector = root.querySelector<HTMLSelectElement>('[data-content-format]')!;
  const toolbar = root.querySelector<HTMLElement>('[data-editor-toolbar]')!;
  let format = selector.value as ContentFormat;
  let visualChanged = false, synchronizing = false, mode = 'visual';
  const createEditor = () => new Editor({
    element: root.querySelector<HTMLElement>('[data-editor-content]')!,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false }, underline: format === 'html' ? {} : false }),
      Image, TableKit, Markdown, PreservedHtml, PreservedInlineHtml,
      ...(format === 'html' ? [TextStyleKit, TextAlign.configure({ types: ['heading', 'paragraph'] })] : []),
    ],
    content: editableHtml(source.value, format),
    editorProps: { attributes: { role: 'textbox', 'aria-label': t('Page content — visual editor'), 'aria-multiline': 'true' } },
    onUpdate: () => { if (!synchronizing) { visualChanged = true; dirty(); } },
  });
  let editor = createEditor();
  const sync = () => {
    if (!visualChanged) return;
    source.value = format === 'markdown' ? editor.getMarkdown() : editorHtml(editor);
    visualChanged = false;
  };
  const refreshView = () => {
    rich.hidden = mode !== 'visual';
    root.querySelector<HTMLElement>('[data-source-label]')!.hidden = mode !== 'source';
    preview.hidden = mode !== 'preview';
    root.querySelector<HTMLElement>('[data-editor-mode="source"]')!.textContent = `${t('Source')} ${format === 'html' ? 'HTML' : 'Markdown'}`;
    if (mode === 'preview') preview.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${location.origin} data:; style-src 'unsafe-inline'"><base href="${location.origin}/"><style>body{font:16px/1.6 sans-serif;padding:16px}img{max-width:100%}</style>` + renderContent(source.value, format);
    for (const tab of root.querySelectorAll<HTMLElement>('[data-editor-mode]')) tab.setAttribute('aria-pressed', String(tab.dataset.editorMode === mode));
  };
  mountEditorToolbar(toolbar, editor, format);
  selector.addEventListener('change', () => {
    if (mode === 'visual') sync();
    const next = selector.value as ContentFormat;
    if (next === format) return;
    synchronizing = true;
    if (next === 'html') source.value = renderContent(source.value, 'markdown');
    else {
      editor.commands.setContent(editableHtml(source.value, 'html', true));
      source.value = editor.getMarkdown();
    }
    editor.destroy(); format = next; editor = createEditor();
    synchronizing = false; visualChanged = false;
    mountEditorToolbar(toolbar, editor, format); refreshView(); dirty();
  });
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-editor-mode]')) button.addEventListener('click', () => {
    if (mode === 'visual') sync();
    mode = button.dataset.editorMode!;
    if (mode === 'visual') {
      synchronizing = true; editor.commands.setContent(editableHtml(source.value, format));
      synchronizing = false; visualChanged = false;
    }
    refreshView();
  });
  return {
    source: () => { if (mode === 'visual') sync(); return source.value; },
    insertImage: (src: string) => {
      if (mode === 'visual') editor.chain().focus().setImage({ src }).run();
      else {
        const image = document.createElement('img'); image.setAttribute('src', src); image.alt = '';
        source.value += format === 'markdown' ? `\n\n![](${src})\n` : `\n${image.outerHTML}\n`;
        dirty(); refreshView();
      }
    },
  };
}
