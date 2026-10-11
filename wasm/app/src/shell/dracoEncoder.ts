import draco3d from 'draco3d';
import encoderWasmUrl from 'draco3d/draco_encoder.wasm?url';

let encoderModule: ReturnType<typeof draco3d.createEncoderModule> | undefined;

/** Encodes the transformed native binary STL as a Draco triangular mesh. */
export async function encodeStlToDraco(bytes: Uint8Array): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 84) throw new Error('Invalid binary STL');
  const faces = view.getUint32(80, true);
  if (!faces || bytes.length !== 84 + faces * 50) throw new Error('Invalid binary STL triangles');
  const positions = new Float32Array(faces * 9);
  const indices = new Uint32Array(faces * 3);
  for (let face = 0; face < faces; face++) {
    for (let coordinate = 0; coordinate < 9; coordinate++)
      positions[face * 9 + coordinate] = view.getFloat32(84 + face * 50 + 12 + coordinate * 4, true);
    indices.set([face * 3, face * 3 + 1, face * 3 + 2], face * 3);
  }
  encoderModule ??= (async () => {
    const response = await fetch(encoderWasmUrl);
    if (!response.ok) throw new Error('Could not load Draco encoder');
    return draco3d.createEncoderModule({ wasmBinary: await response.arrayBuffer() });
  })();
  const draco = await encoderModule;
  const mesh = new draco.Mesh();
  const builder = new draco.MeshBuilder();
  const encoder = new draco.Encoder();
  const encoded = new draco.DracoInt8Array();
  try {
    builder.AddFacesToMesh(mesh, faces, indices);
    builder.AddFloatAttribute(mesh, draco.POSITION, faces * 3, 3, positions);
    encoder.SetSpeedOptions(5, 5);
    encoder.SetAttributeQuantization(draco.POSITION, 14);
    const length = encoder.EncodeMeshToDracoBuffer(mesh, encoded);
    if (length <= 0) throw new Error('Draco encoding failed');
    return Uint8Array.from({ length }, (_, index) => encoded.GetValue(index));
  } finally {
    draco.destroy(encoded);
    draco.destroy(encoder);
    draco.destroy(builder);
    draco.destroy(mesh);
  }
}
