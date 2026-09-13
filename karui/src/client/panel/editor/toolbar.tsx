import type { Editor } from '@tiptap/core';
import { render } from 'preact';
import type { ContentFormat } from '../../../content/format.js';
import { t } from '../../i18n.js';

function ToolbarSelect({ title, options, onSelect }: {
  title: string;
  options: [string, string][];
  onSelect: (value: string) => void;
}) {
  return (
    <select aria-label={title} onChange={event => onSelect(event.currentTarget.value)}>
      {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  );
}

function EditorToolbar({ editor, format }: { editor: Editor; format: ContentFormat }) {
  const insertLink = () => {
    const href = prompt(t('Link address (https://… or /subpage)'), editor.getAttributes('link').href ?? '');
    if (href === '') editor.chain().focus().unsetLink().run();
    else if (href && /^(https?:\/\/|mailto:|\/(?!\/)|#)/.test(href)) editor.chain().focus().setLink({ href }).run();
  };
  const insertImage = () => {
    const src = prompt(t('Image address (/media/… or https://…)'));
    if (src && /^(https:\/\/|\/media\/)/.test(src)) editor.chain().focus().setImage({ src }).run();
  };
  const actions: [string, string, () => void][] = [
    ['↶', t('Undo'), () => { editor.chain().focus().undo().run(); }], ['↷', t('Redo'), () => { editor.chain().focus().redo().run(); }],
    ['B', t('Bold'), () => { editor.chain().focus().toggleBold().run(); }], ['I', t('Italic'), () => { editor.chain().focus().toggleItalic().run(); }],
    ['U', t('Underline'), () => { editor.chain().focus().toggleUnderline().run(); }], ['S', t('Strikethrough'), () => { editor.chain().focus().toggleStrike().run(); }],
    ['• List', t('Bulleted list'), () => { editor.chain().focus().toggleBulletList().run(); }], ['1. List', t('Numbered list'), () => { editor.chain().focus().toggleOrderedList().run(); }],
    ['❞', t('Quote'), () => { editor.chain().focus().toggleBlockquote().run(); }], ['—', t('Horizontal rule'), () => { editor.chain().focus().setHorizontalRule().run(); }],
    ['Link', t('Insert link'), insertLink],
    ['Image', t('Insert image from address'), insertImage],
    ['Table', t('Insert table'), () => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); }],
    ['+ row', t('Add table row'), () => { editor.chain().focus().addRowAfter().run(); }], ['+ column', t('Add table column'), () => { editor.chain().focus().addColumnAfter().run(); }],
    ['− table', t('Delete table'), () => { editor.chain().focus().deleteTable().run(); }],
  ];
  return <>
    {actions.filter(([, title]) => format === 'html' || title !== t('Underline')).map(([label, title, action]) => (
      <button key={title} type="button" title={title} aria-label={title} onClick={action}>{label}</button>
    ))}
    <ToolbarSelect title={t('Paragraph style')}
      options={[[ 'p', t('Paragraph') ], [ '1', t('Heading 1') ], [ '2', t('Heading 2') ], [ '3', t('Heading 3') ]]}
      onSelect={value => {
        if (value === 'p') editor.chain().focus().setParagraph().run();
        else editor.chain().focus().setHeading({ level: Number(value) as 1 | 2 | 3 }).run();
      }} />
    {format === 'html' && <>
    <ToolbarSelect title={t('Alignment')}
      options={[[ 'left', t('Left') ], [ 'center', t('Center') ], [ 'right', t('Right') ], [ 'justify', t('Justify') ]]}
      onSelect={value => { editor.chain().focus().setTextAlign(value).run(); }} />
    <ToolbarSelect title={t('Font size')}
      options={['16px', '12px', '20px', '24px', '32px'].map(value => [value, value.replace('px', ' px')])}
      onSelect={value => { editor.chain().focus().setFontSize(value).run(); }} />
    <input type="color" aria-label={t('Text color')}
      onInput={event => { editor.chain().focus().setColor(event.currentTarget.value).run(); }} />
    </>}
  </>;
}

export function mountEditorToolbar(toolbar: HTMLElement, editor: Editor, format: ContentFormat) {
  render(<EditorToolbar editor={editor} format={format} />, toolbar);
}
