import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Prevent browser translation extensions (e.g. Google Translate mobile) from crashing
// React DOM reconciliation when they wrap #text nodes in <font> elements.
if (typeof Node === 'function' && Node.prototype) {
  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(child: T): T {
    if (child.parentNode !== this) {
      if (child.parentNode && this.contains(child)) {
        const parent = child.parentNode;
        parent.removeChild(child);
        if (parent !== this && parent.nodeName === 'FONT' && parent.childNodes.length === 0) {
          parent.parentNode?.removeChild(parent);
        }
      }
      return child;
    }
    return originalRemoveChild.apply(this, [child]) as T;
  };

  const originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(
    newNode: T,
    referenceNode: Node | null,
  ): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      let directRef: Node | null = referenceNode;
      while (directRef && directRef.parentNode !== this) {
        directRef = directRef.parentNode;
      }
      return originalInsertBefore.apply(this, [newNode, directRef]) as T;
    }
    return originalInsertBefore.apply(this, [newNode, referenceNode]) as T;
  };
}

createRoot(document.getElementById('root')!).render(<App />);
