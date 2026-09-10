import type { Node } from '@xyflow/react';
import { getNodesBounds, getViewportForBounds } from '@xyflow/react';
import { toPng } from 'html-to-image';

const IMAGE_WIDTH = 1920;
const IMAGE_HEIGHT = 1080;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;
const PADDING = 0.15;

/**
 * Rasterizes the current canvas to a PNG and triggers a browser download. Renders the
 * `.react-flow__viewport` DOM node (nodes, edges, boundary containers - everything the
 * student sees) rather than reading from any data model, so the export always matches
 * what's on screen, including its current health/failure visual state.
 */
export async function downloadCanvasAsPng(
  nodes: Node<any>[],
  filename = 'aws-architecture-diagram.png'
): Promise<void> {
  const viewportEl = document.querySelector('.react-flow__viewport') as HTMLElement | null;
  if (!viewportEl || nodes.length === 0) {
    throw new Error('Canvas is empty - add some services before downloading an image.');
  }

  const bounds = getNodesBounds(nodes);
  const viewport = getViewportForBounds(bounds, IMAGE_WIDTH, IMAGE_HEIGHT, MIN_ZOOM, MAX_ZOOM, PADDING);

  const dataUrl = await toPng(viewportEl, {
    backgroundColor: '#ffffff',
    width: IMAGE_WIDTH,
    height: IMAGE_HEIGHT,
    pixelRatio: 2,
    style: {
      width: `${IMAGE_WIDTH}px`,
      height: `${IMAGE_HEIGHT}px`,
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`
    }
  });

  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.click();
}
