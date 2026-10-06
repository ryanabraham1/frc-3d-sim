"""Tessellate a STEP assembly into named, colored GLB occurrences (requires cadquery-ocp 8 and numpy).
Usage: python tools/prepare-step-cad.py <input.stp> <output.glb> [cache.xbf]
Leaves and assembly names are retained so prepare-robot-cad.mjs can group/simplify them.
"""
import json, struct, sys, re
from pathlib import Path
import numpy as np
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ShapeTool, XCAFDoc_ColorTool, XCAFDoc_ColorSurf, XCAFDoc_ColorGen
from OCP.TDF import TDF_Label, TDF_Tool
from OCP.collections import Sequence_TDF_Label
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString, TCollection_AsciiString
from OCP.TDataStd import TDataStd_Name
from OCP.XCAFApp import XCAFApp_Application
from OCP.BinXCAFDrivers import BinXCAFDrivers
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRep import BRep_Tool
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
from OCP.TopoDS import TopoDS
from OCP.TopLoc import TopLoc_Location
from OCP.Quantity import Quantity_Color

source, destination = sys.argv[1:3]
cache = Path(sys.argv[3]) if len(sys.argv)>3 else None
app=XCAFApp_Application.GetApplication_s();BinXCAFDrivers.DefineFormat_s(app)
if 'D' not in globals():
    D=TDocStd_Document(TCollection_ExtendedString('BinXCAF'))
    D=app.NewDocument(TCollection_ExtendedString('BinXCAF'),D)[0]
    if cache and cache.exists():
        print('Loading cached assembly',flush=True);app.Open(TCollection_ExtendedString(str(cache)),D)
    else:
        reader=STEPCAFControl_Reader();reader.SetNameMode(True);reader.SetColorMode(True)
        print('Reading STEP',flush=True);reader.ReadFile(source);reader.Transfer(D)
        if cache:
            D.ChangeStorageFormat(TCollection_ExtendedString('BinXCAF'))
            try: print(app.SaveAs(D,TCollection_ExtendedString(str(cache))),flush=True)
            except Exception as error: print('Cache save skipped:',error,flush=True)
shape_tool=XCAFDoc_DocumentTool.ShapeTool_s(D.Main());color_tool=XCAFDoc_DocumentTool.ColorTool_s(D.Main())
roots=Sequence_TDF_Label();shape_tool.GetFreeShapes(roots)
gltf={'asset':{'version':'2.0','generator':'FRC STEP tessellation'},'scene':0,'scenes':[{'nodes':[]}],'nodes':[],'meshes':[],'materials':[],'accessors':[],'bufferViews':[],'buffers':[]}
binary=bytearray();mesh_cache={};materials={};parts=[];omitted=0

def name(label):
    a=TDataStd_Name();return a.Get().ToExtString() if label.FindAttribute(TDataStd_Name.GetID_s(),a) else ''
def entry(label):
    a=TCollection_AsciiString();TDF_Tool.Entry_s(label,a);return a.ToCString()
def add_array(array,component,type_,target,bounds=False):
    array=np.asarray(array);padding=(-len(binary))%4;binary.extend(b'\x00'*padding);offset=len(binary);binary.extend(array.tobytes())
    view=len(gltf['bufferViews']);gltf['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':array.nbytes,'target':target})
    accessor={'bufferView':view,'componentType':component,'count':len(array),'type':type_}
    if bounds:accessor.update(min=array.min(axis=0).tolist(),max=array.max(axis=0).tolist())
    ix=len(gltf['accessors']);gltf['accessors'].append(accessor);return ix

def mesh(label):
    key=entry(label)
    if key in mesh_cache:return mesh_cache[key]
    shape=shape_tool.GetShape_s(label)
    if shape.IsNull():return None
    BRepMesh_IncrementalMesh(shape,.65,False,.32,False)
    vertices=[];indices=[];explorer=TopExp_Explorer(shape,TopAbs_FACE)
    while explorer.More():
        face=TopoDS.Face(explorer.Current());loc=TopLoc_Location();tri=BRep_Tool.Triangulation_s(face,loc)
        if tri and tri.NbTriangles():
            base=len(vertices);xf=loc.Transformation()
            for i in range(1,tri.NbNodes()+1):
                p=tri.Node(i).Transformed(xf);vertices.append([p.X()*.001,p.Y()*.001,p.Z()*.001])
            reverse=face.Orientation()==TopAbs_REVERSED
            for i in range(1,tri.NbTriangles()+1):
                a,b,c=tri.Triangle(i).Get()
                if reverse:b,c=c,b
                indices.append([base+a-1,base+b-1,base+c-1])
        explorer.Next()
    if not indices:mesh_cache[key]=None;return None
    vertices=np.array(vertices,dtype='<f4');indices=np.array(indices,dtype='<u4');normals=np.zeros_like(vertices)
    crosses=np.cross(vertices[indices[:,1]]-vertices[indices[:,0]],vertices[indices[:,2]]-vertices[indices[:,0]])
    for col in range(3):np.add.at(normals,indices[:,col],crosses)
    normals/=np.maximum(np.linalg.norm(normals,axis=1)[:,None],1e-15)
    col=Quantity_Color();rgb=[.72,.74,.77]
    if color_tool.GetColor_s(label,XCAFDoc_ColorSurf,col) or color_tool.GetColor_s(label,XCAFDoc_ColorGen,col) or color_tool.GetColor(shape,XCAFDoc_ColorSurf,col):rgb=[col.Red(),col.Green(),col.Blue()]
    mk=tuple(round(v,4) for v in rgb)
    if mk not in materials:
        materials[mk]=len(gltf['materials']);gltf['materials'].append({'name':'STEP color','pbrMetallicRoughness':{'baseColorFactor':rgb+[1],'metallicFactor':.25,'roughnessFactor':.6},'doubleSided':False})
    primitive={'attributes':{'POSITION':add_array(vertices,5126,'VEC3',34962,True),'NORMAL':add_array(normals,5126,'VEC3',34962)},'indices':add_array(indices.reshape(-1),5125,'SCALAR',34963),'material':materials[mk]}
    ix=len(gltf['meshes']);gltf['meshes'].append({'name':name(label),'primitives':[primitive]});mesh_cache[key]=ix
    return ix

def walk(label,parent=None,path=()):
    global omitted
    target=label;ref=TDF_Label()
    if shape_tool.IsReference_s(label):shape_tool.GetReferredShape_s(label,ref);target=ref
    n=name(target);full='/'.join(path+(n,))
    if re.search(r'BUMPERS|AVIONICS|BATTERY_WITH|PDP_2|CANIVORE|SCREW|WASHER|BEARING|NYLOC|LOCKNUT|NUTSTRIP|(?:^|_)SHCS(?:_|$)|(?:^|_)FHCS(?:_|$)|(?:^|_)NUT(?:_|$)|(?:^|_)BOLT(?:_|$)',full,re.I):omitted+=1;return
    location=shape_tool.GetLocation_s(label).Transformation();matrix=np.eye(4)
    for i in range(3):
        for j in range(4):matrix[i,j]=location.Value(i+1,j+1)*( .001 if j==3 else 1)
    node={'name':n,'matrix':matrix.T.reshape(-1).tolist()};ix=len(gltf['nodes']);gltf['nodes'].append(node)
    if parent is None:gltf['scenes'][0]['nodes'].append(ix)
    else:gltf['nodes'][parent].setdefault('children',[]).append(ix)
    children=Sequence_TDF_Label();shape_tool.GetComponents_s(target,children)
    if children.Length():
        for i in range(1,children.Length()+1):walk(children.Value(i),ix,path+(n,))
    else:
        m=mesh(target)
        if m is not None:node['mesh']=m
        parts.append({'name':full,'mesh':m,'matrix':node['matrix']})
        if len(parts)%100==0:print(f'Tessellated {len(parts)} occurrences, {len(mesh_cache)} unique parts',flush=True)
for i in range(1,roots.Length()+1):walk(roots.Value(i))
gltf['buffers']=[{'byteLength':len(binary)}]
j=json.dumps(gltf,separators=(',',':')).encode();j+=b' '*((-len(j))%4);binary.extend(b'\x00'*((-len(binary))%4))
with open(destination,'wb') as f:
    f.write(struct.pack('<III',0x46546c67,2,12+8+len(j)+8+len(binary)));f.write(struct.pack('<II',len(j),0x4e4f534a));f.write(j);f.write(struct.pack('<II',len(binary),0x004e4942));f.write(binary)
Path(destination+'.parts.json').write_text(json.dumps(parts))
print(json.dumps({'output':destination,'bytes':Path(destination).stat().st_size,'occurrences':len(parts),'uniqueParts':len(mesh_cache),'omittedBranches':omitted}),flush=True)
