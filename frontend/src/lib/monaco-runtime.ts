import { loader } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';

type MonacoWindow = Window & {
  UniExamMonaco?: typeof Monaco;
  MonacoEnvironment?: { getWorker: (moduleId: string, label: string) => Worker };
};
let pending: Promise<void> | undefined;

/** Load only the locally rebuilt editor and its same-origin language workers. */
export function prepareMonaco(): Promise<void> {
  if (pending) return pending;
  pending = new Promise<void>((resolve, reject) => {
    const host = window as MonacoWindow;
    host.MonacoEnvironment = {
      getWorker(_moduleId, label) {
        const kind = ['json', 'css', 'html'].includes(label) ? label
          : ['scss', 'less'].includes(label) ? 'css'
          : ['handlebars', 'razor'].includes(label) ? 'html'
          : ['typescript', 'javascript'].includes(label) ? 'ts' : 'editor';
        return new Worker(`/monaco/${kind}.worker.js`, { name: `uniexam-${kind}` });
      },
    };
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/monaco/editor.css';
    document.head.append(css);
    const script = document.createElement('script');
    script.src = '/monaco/editor.js';
    script.async = true;
    script.onload = () => {
      if (!host.UniExamMonaco?.editor) return reject(new Error('Le module de l’éditeur est indisponible.'));
      loader.config({ monaco: host.UniExamMonaco });
      resolve();
    };
    script.onerror = () => reject(new Error('Impossible de charger l’éditeur local. Rechargez la page.'));
    document.head.append(script);
  });
  return pending;
}
