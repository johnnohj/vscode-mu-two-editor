import { render } from 'preact';
import { App } from './components/App';
import './main.module.css';

// VS Code webview global API
declare global {
  interface Window {
    vscode?: any;
    MonacoEnvironment?: any;
  }
}

// Configure Monaco Editor environment for web workers
self.MonacoEnvironment = {
  getWorkerUrl: function (moduleId: string, label: string) {
    if (label === 'json') {
      return './jsonMode.js';
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return './cssMode.js';
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return './htmlMode.js';
    }
    if (label === 'typescript' || label === 'javascript') {
      return './tsMode.js';
    }
    return './editor.worker.js';
  }
};

// VS Code API is already initialized by the HTML script
// No need to call acquireVsCodeApi() again here

render(<App />, document.getElementById('root')!);