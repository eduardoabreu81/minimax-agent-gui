import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MarkdownRenderer from './MarkdownRenderer.jsx';

describe('MarkdownRenderer — artifact integration', () => {
  it('renders plain text unchanged', () => {
    render(<MarkdownRenderer content="hello" />);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('renders ```python blocks as <pre><code> (regression)', () => {
    render(<MarkdownRenderer content={'```python\nprint(1)\n```'} />);
    expect(screen.getByText('print(1)')).toBeInTheDocument();
    expect(screen.queryByText(/Open Preview/)).toBeNull();
  });

  it('renders ```html blocks as inline artifact card', () => {
    render(<MarkdownRenderer content={'```html\n<p>hi</p>\n```'} />);
    expect(screen.getByText(/HTML preview/)).toBeInTheDocument();
    expect(screen.getByText('Open Preview')).toBeInTheDocument();
  });

  it('renders ```mermaid blocks as inline artifact card (4-lang default)', () => {
    render(<MarkdownRenderer content={'```mermaid\ngraph TD; A-->B\n```'} />);
    expect(screen.getByText(/Mermaid diagram/)).toBeInTheDocument();
    expect(screen.getByText('Open Preview')).toBeInTheDocument();
  });

  it('preserves inline backticks as inline code', () => {
    render(<MarkdownRenderer content={'`x`'}/>);
    expect(screen.getByText('x').tagName).toBe('CODE');
  });
});
