import { describe, expect, it } from 'vitest';
import { docToMarkdown, markdownToHtml } from '../src/features/notes/richText';

describe('editor de notas con formato', () => {
  it('convierte el Markdown en HTML del editor (listas anidadas, acciones y enlaces a tareas)', () => {
    const html = markdownToHtml('## Reunión\n\nque **tienen**, que no\n- uno\n  - [ ] acción @Diana [[t:abc]]\n- dos\n1. primero\n> cita\n---', (id) => id === 'abc');
    expect(html).toBe(
      '<h2>Reunión</h2><p></p><p>que <strong>tienen</strong>, que no</p>'
      + '<ul><li><p>uno</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>acción @Diana<span data-task-link="abc"></span></p></li></ul></li><li><p>dos</p></li></ul>'
      + '<ol><li><p>primero</p></li></ol><blockquote><p>cita</p></blockquote><hr>',
    );
    expect(markdownToHtml('<script>')).toBe('<p>&lt;script&gt;</p>');
  });

  it('convierte lo escrito en el editor en Markdown', () => {
    const p = (...content: object[]) => ({ type: 'paragraph', content });
    const t = (text: string, ...marks: string[]) => ({ type: 'text', text, marks: marks.map((type) => ({ type })) });
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [t('Reunión paso 2')] },
        p(t('que '), t('tienen', 'bold'), t(', que no')),
        { type: 'paragraph' },
        { type: 'bulletList', content: [
          { type: 'listItem', content: [p(t('uno')), { type: 'taskList', content: [
            { type: 'taskItem', attrs: { checked: true }, content: [p(t('acción @Diana'), { type: 'taskLink', attrs: { id: 'abc' } })] },
          ] }] },
        ] },
        { type: 'orderedList', attrs: { start: 1 }, content: [{ type: 'listItem', content: [p(t('primero'))] }, { type: 'listItem', content: [p(t('segundo'))] }] },
        p(t('ver '), { type: 'text', text: 'enlace', marks: [{ type: 'link', attrs: { href: 'https://x.test' } }] }, t(' y '), t('cursiva', 'italic')),
      ],
    };
    expect(docToMarkdown(doc)).toBe(
      '## Reunión paso 2\nque **tienen**, que no\n\n- uno\n  - [x] acción @Diana [[t:abc]]\n1. primero\n2. segundo\nver [enlace](https://x.test) y *cursiva*',
    );
  });
});
