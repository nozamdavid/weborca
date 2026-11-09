import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { orbitCamera, setCameraView } from '../shell/cameraBridge';
import './viewCube.css';
import type { CameraView } from '../shell/cameraBridge';

const HALF = 30;

/** Each face: the world axes of its normal, its right and its up, and the camera view a click on it selects. */
const FACES: { label: string; n: [number, number, number]; u: [number, number, number]; v: [number, number, number]; view: CameraView }[] = [
  { label: "Top", n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], view: 1 },
  { label: "Bottom", n: [0, 0, -1], u: [1, 0, 0], v: [0, -1, 0], view: 2 },
  { label: "Front", n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], view: 3 },
  { label: "Rear", n: [0, 1, 0], u: [-1, 0, 0], v: [0, 0, 1], view: 4 },
  { label: "Left", n: [-1, 0, 0], u: [0, -1, 0], v: [0, 0, 1], view: 5 },
  { label: "Right", n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], view: 6 }
];

/** CSS matrix placing a face of the cube, given the rotation that takes world vectors into the camera's frame. */
export function faceMatrix(rotation: THREE.Matrix4, face: (typeof FACES)[number]): string {
  const toCss = (v: [number, number, number], scale = 1) => {
    const w = new THREE.Vector3(...v).applyMatrix4(rotation).multiplyScalar(scale);
    return [w.x, -w.y, w.z]; // CSS has y pointing down
  };
  const x = toCss(face.u);
  const y = toCss(face.v, -1);
  const z = toCss(face.n);
  const c = toCss(face.n, HALF);
  return `matrix3d(${x[0]},${x[1]},${x[2]},0,${y[0]},${y[1]},${y[2]},0,${z[0]},${z[1]},${z[2]},0,${c[0]},${c[1]},${c[2]},1)`;
}

/** A cube that turns with the camera; clicking a face looks at the model from that side. */
export const ViewCube: React.FC<{ getCameraQuaternion: () => THREE.Quaternion | undefined }> = ({ getCameraQuaternion }) => {
  const faces = useRef<(HTMLDivElement | null)[]>([]);
  const axes = useRef<SVGSVGElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number; startX: number; startY: number; dragged: boolean } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    let frame = 0;
    const rotation = new THREE.Matrix4();
    const tick = () => {
      const q = getCameraQuaternion();
      if (q) {
        rotation.makeRotationFromQuaternion(q.clone().invert());
        FACES.forEach((face, i) => {
          const el = faces.current[i];
          if (el) el.style.transform = faceMatrix(rotation, face);
        });
        const origin = new THREE.Vector3(-40, -40, -40).applyMatrix4(rotation);
        const labels = ['X', 'Y', 'Z'].map((axis, i) => {
          const point = new THREE.Vector3(i === 0 ? 40 : -40, i === 1 ? 40 : -40, i === 2 ? 40 : -40).applyMatrix4(rotation);
          const line = axes.current?.querySelector(`[data-axis="${axis}"] line`);
          line?.setAttribute('x1', String(80 + origin.x));
          line?.setAttribute('y1', String(80 - origin.y));
          line?.setAttribute('x2', String(80 + point.x));
          line?.setAttribute('y2', String(80 - point.y));
          const length = Math.hypot(point.x, point.y) || 1;
          return { axis, x: 80 + point.x + point.x / length * 10, y: 80 - point.y - point.y / length * 10 };
        });
        // Separate only labels; projected edge directions always remain exact.
        for (let pass = 0; pass < 3; pass++) {
          for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
            if (Math.abs(labels[i].x - labels[j].x) < 14 && Math.abs(labels[i].y - labels[j].y) < 14) {
              labels[i].y -= 7;
              labels[j].y += 7;
            }
          }
        }
        labels.forEach(({ axis, x, y }) => {
          const label = axes.current?.querySelector(`[data-axis="${axis}"] text`);
          label?.setAttribute('x', String(x));
          label?.setAttribute('y', String(y));
        });
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [getCameraQuaternion]);

  return (
    <div id="view-cube" onPointerDown={(event) => {
      event.stopPropagation();
      if (event.button !== 0 || gesture.current) return;
      suppressClick.current = false;
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, dragged: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={(event) => {
      event.stopPropagation();
      const g = gesture.current;
      if (!g || g.id !== event.pointerId) return;
      if (!g.dragged && Math.hypot(event.clientX - g.startX, event.clientY - g.startY) < 4) return;
      g.dragged = true;
      suppressClick.current = true;
      orbitCamera(event.clientX - g.x, event.clientY - g.y);
      g.x = event.clientX; g.y = event.clientY;
    }} onPointerUp={(event) => {
      event.stopPropagation();
      if (gesture.current?.id !== event.pointerId) return;
      // Capture retargets click to the container: select the original face explicitly.
      if (!gesture.current.dragged) {
        const face = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-view]');
        if (face) setCameraView(Number(face.getAttribute('data-view')) as CameraView);
      }
      suppressClick.current = true;
      gesture.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }} onPointerCancel={(event) => { event.stopPropagation(); gesture.current = null; suppressClick.current = true; }}
      onLostPointerCapture={() => { gesture.current = null; suppressClick.current = true; }} onClick={(event) => event.stopPropagation()} onClickCapture={(event) => {
        if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); }
      }}>
      <svg className="view-cube-axes" viewBox="0 0 160 160" ref={axes} aria-hidden="true">
        {['X', 'Y', 'Z'].map(axis => <g key={axis} data-axis={axis}><line x1="44" y1="44" x2="44" y2="44" /><text>{axis}</text></g>)}
      </svg>
      <div className="view-cube-faces">
        {FACES.map((face, i) => (
          <div
            key={face.label}
            ref={(el) => { faces.current[i] = el; }}
            id={`view-cube-${face.label.toLowerCase()}`}
            role="button"
            tabIndex={0}
            data-view={face.view}
            title={`${face.label} view`}
            onClick={(event) => { if (!suppressClick.current || event.detail === 0) setCameraView(face.view); }}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setCameraView(face.view); } }}
            className="view-cube-face"
          >
            {face.label}
          </div>
        ))}
      </div>
    </div>
  );
};
