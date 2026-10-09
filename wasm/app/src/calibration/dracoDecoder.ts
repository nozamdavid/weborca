import draco3d from 'draco3d';
// @ts-ignore
import dracoWasmUrl from 'draco3d/draco_decoder.wasm?url';


export async function decodeDracoToStlBuffer(drcBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  const draco = await draco3d.createDecoderModule({
    wasmBinary: await (await fetch(dracoWasmUrl)).arrayBuffer()
  });
  const decoder = new draco.Decoder();
  const decoderBuffer = new draco.DecoderBuffer();
  decoderBuffer.Init(new Int8Array(drcBuffer), drcBuffer.byteLength);
  
  const geometryType = decoder.GetEncodedGeometryType(decoderBuffer);
  if (geometryType !== draco.TRIANGULAR_MESH) {
    throw new Error('Not a triangular mesh');
  }
  
  const mesh = new draco.Mesh();
  const status = decoder.DecodeBufferToMesh(decoderBuffer, mesh);
  if (!status.ok() || mesh.ptr === 0) {
    throw new Error('Failed to decode Draco mesh');
  }
  
  const numFaces = mesh.num_faces();
  const posAttrib = decoder.GetAttributeByUniqueId(mesh, draco.POSITION);
  const posArray = new draco.DracoFloat32Array();
  decoder.GetAttributeFloatForAllPoints(mesh, posAttrib, posArray);
  
  const stlBuffer = new ArrayBuffer(84 + numFaces * 50);
  const stlView = new DataView(stlBuffer);
  
  stlView.setUint32(80, numFaces, true);
  
  let offset = 84;
  const faceIndices = new draco.DracoInt32Array();
  
  for (let i = 0; i < numFaces; i++) {
    decoder.GetFaceFromMesh(mesh, i, faceIndices);
    const i0 = faceIndices.GetValue(0);
    const i1 = faceIndices.GetValue(1);
    const i2 = faceIndices.GetValue(2);
    
    offset += 12; // skip normal
    
    stlView.setFloat32(offset, posArray.GetValue(i0 * 3), true); offset += 4;
    stlView.setFloat32(offset, posArray.GetValue(i0 * 3 + 1), true); offset += 4;
    stlView.setFloat32(offset, posArray.GetValue(i0 * 3 + 2), true); offset += 4;
    
    stlView.setFloat32(offset, posArray.GetValue(i1 * 3), true); offset += 4;
    stlView.setFloat32(offset, posArray.GetValue(i1 * 3 + 1), true); offset += 4;
    stlView.setFloat32(offset, posArray.GetValue(i1 * 3 + 2), true); offset += 4;
    
    stlView.setFloat32(offset, posArray.GetValue(i2 * 3), true); offset += 4;
    stlView.setFloat32(offset, posArray.GetValue(i2 * 3 + 1), true); offset += 4;
    stlView.setFloat32(offset, posArray.GetValue(i2 * 3 + 2), true); offset += 4;
    
    offset += 2; // attr byte count
  }
  
  draco.destroy(faceIndices);
  draco.destroy(posArray);
  draco.destroy(mesh);
  draco.destroy(decoder);
  draco.destroy(decoderBuffer);
  
  return stlBuffer;
}
