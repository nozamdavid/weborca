import React from 'react';
import { MeshBooleanDialog } from './MeshBooleanDialog';
import { SimplifyDialog } from './SimplifyDialog';
import { SvgDialog } from './SvgDialog';
import { TextureDialog } from './TextureDialog';

export const EditOpsDialogs: React.FC = () => {
  return (
    <>
      <MeshBooleanDialog />
      <SimplifyDialog />
      <SvgDialog />
      <TextureDialog />
    </>
  );
};
