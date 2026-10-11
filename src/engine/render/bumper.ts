import * as THREE from 'three';

/** Fine woven nylon relief. Shared by all four bumper faces, with no extra meshes or lights. */
export function bumperFabric(color:number): THREE.MeshStandardMaterial {
  const size=64,data=new Uint8Array(size*size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const warp=(x%4<2)===(y%4<2);
    data[y*size+x]=warp?155:104;
  }
  const texture=new THREE.DataTexture(data,size,size,THREE.RedFormat);
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(12,3);
  texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps=true;texture.needsUpdate=true;
  return new THREE.MeshStandardMaterial({color,roughness:.96,bumpMap:texture,bumpScale:.0007});
}

/** Tight glyph bounds preserve the printed numeral proportions instead of stretching a padded canvas. */
export function bumperNumber(team: number, bumperHeight: number, availableWidth: number, italic = false): THREE.Mesh {
  const text=String(team), font=`${italic ? 'italic ' : ''}900 192px "Arial Black", Arial, sans-serif`;
  let texture=new THREE.Texture(), aspect=text.length*.78;
  if(typeof document !== 'undefined') {
    const canvas=document.createElement('canvas'), ctx=canvas.getContext('2d')!;
    ctx.font=font;
    const metrics=ctx.measureText(text);
    const left=metrics.actualBoundingBoxLeft, right=metrics.actualBoundingBoxRight;
    const ascent=metrics.actualBoundingBoxAscent, descent=metrics.actualBoundingBoxDescent;
    const pad=5;
    canvas.width=Math.ceil(left+right)+pad*2;
    canvas.height=Math.ceil(ascent+descent)+pad*2;
    ctx.font=font;ctx.fillStyle='#fafaf7';ctx.textAlign='left';ctx.textBaseline='alphabetic';
    ctx.fillText(text,pad+left,pad+ascent);
    texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;
    aspect=canvas.width/canvas.height;
  }
  const height=Math.min(bumperHeight*.87,.108,availableWidth/aspect);
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(height*aspect,height),new THREE.MeshStandardMaterial({map:texture,transparent:true,roughness:.96,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}));
  mesh.name='bumper-team-number';mesh.userData.noShadow=true;
  return mesh;
}
