import { createElement, Fragment, type ReactNode } from 'react';

interface MinimalNode {
  nodeType: number;
  textContent: string | null;
  localName?: string;
  childNodes?: ArrayLike<MinimalNode>;
  getAttribute?: (name: string) => string | null;
}

const droppedTags = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'noscript', 'template', 'head', 'meta', 'link']);
const allowedTags = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'hr', 'a', 'div', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td']);

export function renderSafeDescriptionNodes(nodes: ArrayLike<MinimalNode>, baseUrl?: string): ReactNode {
  let visible = false;
  const render = (node: MinimalNode, key: number): ReactNode => {
    if (node.nodeType === 3) {
      const text = node.textContent || '';
      if (text.trim()) visible = true;
      return text;
    }
    if (node.nodeType !== 1) return null;
    const tag = node.localName || '';
    if (droppedTags.has(tag)) return null;
    if (tag === 'img') {
      const alt = node.getAttribute?.('alt')?.trim();
      if (!alt) return null;
      visible = true;
      return <span key={key} className="model-modal-img-alt">[{alt}]</span>;
    }
    const children = Array.from(node.childNodes || [], render);
    if (tag === 'a') {
      try {
        const rawHref = node.getAttribute?.('href') || '';
        const resolved = baseUrl === undefined ? new URL(rawHref) : new URL(rawHref, baseUrl);
        if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
          return <a key={key} href={resolved.href} target="_blank" rel="noopener noreferrer">{children}</a>;
        }
      } catch { /* Missing or unsafe links retain only their text. */ }
      return <Fragment key={key}>{children}</Fragment>;
    }
    if (!allowedTags.has(tag)) return <Fragment key={key}>{children}</Fragment>;
    if (tag === 'hr') visible = true;
    return createElement(tag, { key }, ...(tag === 'br' || tag === 'hr' ? [] : children));
  };
  const content = Array.from(nodes, render);
  return visible ? content : null;
}

export function renderSafeDescriptionHtml(html: string, baseUrl?: string): ReactNode {
  const document = new DOMParser().parseFromString(html, 'text/html');
  return renderSafeDescriptionNodes(document.body.childNodes, baseUrl);
}
