import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { setCameraView } from '../shell/cameraBridge';
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
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [getCameraQuaternion]);

  return (
    <div id="view-cube" style={{ position: 'absolute', top: 56, right: 16, width: HALF * 2 + 20, height: HALF * 2 + 20, perspective: 220, zIndex: 18 }}>
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, transformStyle: 'preserve-3d' }}>
        {FACES.map((face, i) => (
          <div
            key={face.label}
            ref={(el) => { faces.current[i] = el; }}
            id={`view-cube-${face.label.toLowerCase()}`}
            role="button"
            title={`${face.label} view`}
            onClick={() => setCameraView(face.view)}
            style={{
              position: 'absolute', left: -HALF, top: -HALF, width: HALF * 2, height: HALF * 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(60, 66, 76, 0.92)', border: '1px solid rgba(255,255,255,0.35)', color: 'var(--text-color)', fontSize: 11, fontWeight: 600,
              cursor: 'pointer', userSelect: 'none', backfaceVisibility: 'hidden'
            }}
          >
            {face.label}
          </div>
        ))}
      </div>
    </div>
  );
};
