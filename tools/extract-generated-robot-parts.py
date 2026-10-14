"""Extract user-supplied image reconstructions into independently riggable visual parts.
No collider, capacity, rate, or shot parameters are generated from these meshes.
"""
import json,struct,math
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent

def read(name):
    f=open(ROOT/'public/robots/2026'/name,'rb');f.read(12)
    size,_=struct.unpack('<II',f.read(8));doc=json.loads(f.read(size));size,_=struct.unpack('<II',f.read(8));data=f.read(size)
    primitive=doc['meshes'][0]['primitives'][0]
    def accessor(index):
        a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']];fmt={5123:'H',5125:'I',5126:'f'}[a['componentType']];n={'SCALAR':1,'VEC3':3}[a['type']]
        start=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',struct.calcsize('<'+fmt*n))
        return [struct.unpack_from('<'+fmt*n,data,start+i*stride) for i in range(a['count'])]
    return accessor(primitive['attributes']['POSITION']),[x[0] for x in accessor(primitive['indices'])]

def extract(vertices,indices,predicate,transform):
    used={};out=[];idx=[]
    for j in range(0,len(indices),3):
        triangle=indices[j:j+3];center=tuple(sum(vertices[i][k] for i in triangle)/3 for k in range(3))
        if not predicate(center):continue
        for i in triangle:
            if i not in used:used[i]=len(out);out.append(transform(vertices[i]))
            idx.append(used[i])
    return out,idx

def planar_plate(part,axis,z,pocket=False):
    """Fit the supplied surface silhouette to clean manufactured sheet, retaining its outer profile."""
    vertices,_=part
    points=sorted(set((round(p[0],5),round(p[1],5)) for p in vertices))
    def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    lower=[];upper=[]
    for sequence,out in [(points,lower),(reversed(points),upper)]:
        for p in sequence:
            while len(out)>1 and cross(out[-2],out[-1],p)<=0:out.pop()
            out.append(p)
    hull=lower[:-1]+upper[:-1]
    # Nearly collinear image-reconstruction noise is removed from straight sheet edges.
    changed=True
    while changed and len(hull)>5:
        changed=False
        for i,b in enumerate(hull):
            a=hull[i-1];c=hull[(i+1)%len(hull)]
            distance=abs(cross(a,c,b))/max(1e-9,math.dist(a,c))
            if distance<.002:del hull[i];changed=True;break
    n=len(hull);out=[];idx=[];thickness=.005
    if pocket:
        cx=sum(p[0] for p in hull)/n;cy=sum(p[1] for p in hull)/n
        inner=[(cx+(x-cx)*.70,cy+(y-cy)*.65) for x,y in hull]
        for zz in [z-thickness/2,z+thickness/2]:
            out.extend((x,y,zz) for x,y in hull+inner)
        for j in range(n):
            k=(j+1)%n
            for base in [0,2*n]:idx.extend([base+j,base+k,base+n+k,base+j,base+n+k,base+n+j])
            idx.extend([j,k,2*n+k,j,2*n+k,2*n+j,n+j,n+k,3*n+k,n+j,3*n+k,3*n+j])
    else:
        for zz in [z-thickness/2,z+thickness/2]:out.extend((x,y,zz) for x,y in hull)
        for j in range(1,n-1):idx.extend([0,j,j+1,n,n+j+1,n+j])
        for j in range(n):
            k=(j+1)%n;idx.extend([j,k,n+k,j,n+k,n+j])
    return out,idx

def write(name,parts):
    binary=bytearray();views=[];accessors=[];meshes=[];nodes=[]
    for part,(vertices,indices) in parts.items():
        if not vertices:raise RuntimeError('Empty extraction '+part)
        for values,fmt,kind,component in [(vertices,'fff','VEC3',5126),(indices,'I','SCALAR',5125)]:
            start=len(binary)
            for value in values:binary.extend(struct.pack('<'+fmt,*(value if isinstance(value,tuple) else (value,))))
            views.append({'buffer':0,'byteOffset':start,'byteLength':len(binary)-start})
            access={'bufferView':len(views)-1,'componentType':component,'count':len(values),'type':kind}
            if kind=='VEC3':access.update(min=[min(p[k] for p in vertices) for k in range(3)],max=[max(p[k] for p in vertices) for k in range(3)])
            accessors.append(access)
        meshes.append({'name':part,'primitives':[{'attributes':{'POSITION':len(accessors)-2},'indices':len(accessors)-1}]});nodes.append({'name':part,'mesh':len(meshes)-1})
        print(name,part,len(vertices),'vertices',len(indices)//3,'triangles')
    doc={'asset':{'version':'2.0','generator':'FRC sim supplied-mesh part extraction'},'scene':0,'scenes':[{'nodes':list(range(len(nodes)))}],'nodes':nodes,'meshes':meshes,'buffers':[{'byteLength':len(binary)}],'bufferViews':views,'accessors':accessors}
    js=json.dumps(doc,separators=(',',':')).encode();js+=b' '*((-len(js))%4);binary+=b'\0'*((-len(binary))%4)
    out=struct.pack('<III',0x46546c67,2,12+8+len(js)+8+len(binary))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(binary),0x004e4942)+binary
    (ROOT/'public/models/robots/2026'/name).write_bytes(out)

v,i=read('orbit-generated-reference.glb')
# Source +Z is the intake face, +X the adjacent pocketed side. Normalized units allow fitting to config dimensions.
parts={'intake-lattice':extract(v,i,lambda p:p[2]>.64 and -.61<p[1]<.045 and abs(p[0])<.76,lambda p:(-.003*(p[2]-.8), (p[1]+.61)/.655, p[0]/1.52))}
write('kepler-supplied-parts.glb',parts)
v,i=read('hightide-generated-reference.glb')
parts={}
for sign,name in [(-1,'hood-cheek-left'),(1,'hood-cheek-right')]:
    parts[name]=extract(v,i,lambda p,sign=sign:.16<p[0]<.57 and p[1]>.435 and sign*p[2]>.080 and sign*p[2]<.19,
        lambda p,sign=sign:(.027-(p[0]-.16)/.41*.195, -.021+(p[1]-.435)/.147*.082,sign*.107+(p[2]-sign*.12)*.04))
    parts['intake-lead-'+('left' if sign<0 else 'right')]=extract(v,i,
        lambda p,sign=sign:p[0]<-.53 and -.31<p[1]<.18 and .56<sign*p[2]<.87,
        lambda p,sign=sign:((p[0]+.99)/.46*.26, .020+(p[1]+.31)/.49*.255, sign*.5+(p[2]-sign*.715)*.018))
# The source's upper shooter envelope supplies the bent hood guide profile between its side cheeks.
hood_points=[(.027-(x-.16)/.41*.195,-.021+(y-.435)/.147*.082) for x,y,z in v if .16<x<.57 and y>.435 and abs(z)<.19]
profile=[]
for j in range(13):
    x=-.15+j*.17/12
    nearby=sorted(y for px,y in hood_points if abs(px-x)<.014)
    if nearby:profile.append((x,max(.037,min(.064,nearby[int((len(nearby)-1)*.85)]))))
verts=[];indices=[]
for x,y in profile:
    verts.extend([(x,y,-.091),(x,y,.091),(x,y-.003,-.091),(x,y-.003,.091)])
for j in range(len(profile)-1):
    a=j*4;b=a+4
    indices.extend([a,b,b+1,a,b+1,a+1,a+2,b+3,b+2,a+2,a+3,b+3])
parts['hood-guide']=(verts,indices)
# Preserve the source's feed-column surface detail, fitted wholly inside the rotor/turret clearance.
parts['feed-column']=extract(v,i,lambda p:-.20<p[1]<.335 and math.hypot(p[0]-.30,p[2])<.26,
    lambda p:((p[0]-.30)*.26,-.225+(p[1]+.20)/.535*.19,p[2]*.26))
for name in list(parts):
    if name in ['hood-guide','feed-column']:continue
    sign=-1 if name.endswith('left') else 1
    parts[name]=planar_plate(parts[name],2,sign*(.107 if name.startswith('hood') else .5),pocket=name.startswith('hood'))
write('hightide-supplied-parts.glb',parts)
