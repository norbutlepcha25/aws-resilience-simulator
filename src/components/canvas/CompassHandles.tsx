import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { COMPASS_POINTS } from '../../utils/compassHandles.ts';
import { MoveGlyph } from './MoveGlyph.tsx';

export function CompassHandles() {
  return <>{COMPASS_POINTS.map(point => {
    const top = point.id.startsWith('top');
    const bottom = point.id.startsWith('bottom');
    const position = top ? Position.Top : bottom ? Position.Bottom
      : point.id === 'left' ? Position.Left : Position.Right;
    const corner = point.id.includes('-');
    const style = corner ? { left: point.id.endsWith('left') ? '0%' : '100%' } : undefined;
    return <Handle key={point.id} id={point.id} type="source" position={position}
      style={style} title={`${point.label}: drag to connect, or drop a connection here`}
      aria-label={`${point.label} connection`} className="compass-handle">
      <svg viewBox="0 0 24 24" aria-hidden="true"><MoveGlyph /></svg>
    </Handle>;
  })}</>;
}
