# Repaint the Jan Juc cliff layer (cliffs-warm / cliffs-am, 1520x780) from its silhouette and the ink paths.
import numpy as np, re, sys
from PIL import Image, ImageFilter
SS=2; W,H=1520,780; w,h=W*SS,H*SS
rng=np.random.default_rng(7)
src=np.asarray(Image.open(sys.argv[1]).convert('RGBA')).astype(float)/255   # original warm, for the top outline
html=open(sys.argv[2]).read()
seg=html[html.find('ly ly-cliffs'):]; seg=seg[:seg.find('<div class="ly ly-scrub')]
paths=re.findall(r'<path[^>]*d="([^"]+)"',seg)
OX,OY=880,380
def noise(sh,cell,oct=4,seed=0):
    r=np.random.default_rng(seed);out=np.zeros(sh);amp=1;tot=0
    for o in range(oct):
        gy=max(2,int(sh[0]/cell)+2);gx=max(2,int(sh[1]/cell)+2)
        g=r.random((gy,gx))
        im=Image.fromarray((g*255).astype(np.uint8)).resize((sh[1],sh[0]),Image.BICUBIC)
        out+=amp*(np.asarray(im)/255-.5);tot+=amp;amp*=.5;cell/=2
    return out/tot
def hexc(s): s=s.lstrip('#');return np.array([int(s[i:i+2],16)/255 for i in (0,2,4)])
X,Y=np.meshgrid(np.arange(w)/SS,np.arange(h)/SS)
# top outline from original alpha (first opaque row per column), smoothed lightly
T=np.full(W,np.nan)
for x in range(W):
    op=np.where(src[:,x,3]>.5)[0]
    if len(op): T[x]=op[0]
xs=np.arange(W); good=~np.isnan(T); T=np.interp(xs,xs[good],T[good])
xt=xs[good][0]
# base line from the ink: (376,491.6)-(1519,709.7), extended left to the tip
def B(x): return 491.6+(x-376)*(709.7-491.6)/(1519-376)
ip=[tuple(map(float,p)) for p in re.findall(r'([\d.]+) ([\d.]+)',paths[0])]
ip=sorted({round(px-OX,2):py-OY for px,py in ip}.items())
ix=np.array([p[0] for p in ip]); iy=np.array([p[1] for p in ip])
I1=np.interp(xs,ix,iy,left=1e9)          # near cliff top (ink), none left of 376
Tn=np.minimum(np.maximum(I1,T),I1+0)     # follow the ink
far_only=I1>B(xs)-0.5
TT=np.where(far_only,T,np.minimum(T,I1))  # silhouette: union of far headland and near cliff
Tx=np.interp(X,xs,TT); Bx=B(X); Ix=np.interp(X,xs,np.minimum(I1,1e4))
near=(Y>=Ix)&(X>=376)
inside=(Y>=Tx)&(Y<=Bx)&(X>=xt)
# perspective strata: h=0 at base, 1 on the line from vanishing point to the top-right corner
VPx,VPy=160.0,452.0
Ref=VPy+(X-VPx)*(0-VPy)/(1519-VPx)
hh=(Bx-Y)/np.maximum(Bx-Ref,1)
hh=hh+noise((h,w),260,3,1)*0.035+noise((h,w),40,2,2)*0.006
depth=np.clip((X-VPx)/(1519-VPx),0,1)   # 0 far tip, 1 near
d1=depth[0]
# band colours (warm sunset version), bottom to top
bands=[(0.00,'#7B5A44'),(0.06,'#94704F'),(0.13,'#A9825A'),(0.19,'#A06B55'),(0.24,'#B48A62'),(0.285,'#E8CFA2'),(0.31,'#B8693F'),
       (0.42,'#C27546'),(0.53,'#A9603D'),(0.56,'#CC8550'),(0.70,'#D8955B'),(0.84,'#E0A465'),(1.0,'#E6B276')]
hs=np.array([b[0] for b in bands]);cs=np.array([hexc(b[1]) for b in bands])
hc=np.clip(hh,0,1)
col=np.stack([np.interp(hc,hs,cs[:,i]) for i in range(3)],-1)
# thin strata lines (dark and light), wavy
ph=hh*58+noise((h,w),180,2,3)*1.2
lines=np.exp(-((ph%1)-.5)**2/0.004)*(0.5+0.5*noise((h,w),90,2,4)*2)
col*=1-0.13*np.clip(lines,0,1)[...,None]
ph2=hh*23+.3+noise((h,w),220,2,5)
col+=0.025*np.exp(-((ph2%1)-.5)**2/0.003)[...,None]
# ledges: cream band juts out, light lip and shadow under it
for lh in (0.31,0.56):
    d=(hh-lh)
    col*=1-0.22*np.exp(-(d+0.012)**2/0.00012)[...,None]*(d<0)[...,None]
    col+=0.06*np.exp(-(d-0.004)**2/0.00006)[...,None]
# erosion fluting: vertical runnels, tighter towards the far tip
a=(np.clip(X-VPx,0,None))**1.25
fl=np.zeros_like(X)
for k,(f,amp) in enumerate([(0.0032,1),(0.0071,.6),(0.016,.22)]):
    phs=rng.random()*6.28
    fl+=amp*np.sin(a*f+phs+noise((h,w),300,2,10+k)*4)*(0.5+np.clip(noise((1,w),60,2,15+k)[0]*3,-.5,.8))
# shade by slope of the flutes (sun from the left)
gx=np.gradient(fl,axis=1)*SS
shade=np.clip(gx*8,-1,1)
strength=(0.11+0.09*np.clip(1-abs(hh-0.6)*2,0,1))*(0.4+0.6*depth)
col*=(1+shade*strength)[...,None]
# runnel streaks dripping down from the cap
st=noise((1,w),14,3,20)[0]; st=np.clip((st-.12)*6,0,1)
col*=1-0.07*(st[None,:]*np.clip((Y-Tx)/60,0,1)*np.clip(hh,0,1))[...,None]
# light: brighter near top, shade near the foot, darker right edge of the frame
col*=(0.88+0.17*np.clip(hh,0,1.1))[...,None]
# rose and gold washes drifting over the face
patch=noise((h,w),220,3,70)
col=col*(1-np.clip(patch*1.4,0,.16)[...,None])+hexc('#A86561')*np.clip(patch*1.4,0,.16)[...,None]
col=col*(1-np.clip(-patch*1.2,0,.14)[...,None])+hexc('#EDA968')*np.clip(-patch*1.2,0,.14)[...,None]
# watercolour blotches + granulation
col*=(1+noise((h,w),120,3,30)*0.10)[...,None]
col*=(1+noise((h,w),6,2,31)*0.05)[...,None]
# sandy cap following the top (dune limestone), 4..14 px thick
capT=4+10*depth
dc=np.where(near,Y-Ix,Y-Tx)
cap=np.clip(1-(dc-capT)/3,0,1)
capcol=hexc('#E9C690')*(1+noise((h,w),30,2,40)*0.12)[...,None]
col=col*(1-cap[...,None])+capcol*cap[...,None]
# scrub on the very top: olive/bronze bumps
bump=np.abs(noise((1,w),10,3,50)[0])*9+2+3*d1
sc=np.clip(1-(dc-bump[None,:]*(0.6+0.4*np.interp(X,xs,np.ones(W))))/2,0,1)*(dc>-3)
scn=noise((h,w),5,3,51)
scrub=np.stack([np.interp(scn,[-.5,-.1,.15,.5],[c[i] for c in map(hexc,['#4E4630','#6E6640','#8C7E4E','#B09A5E'])]) for i in range(3)],-1)
col=col*(1-sc[...,None])+scrub*sc[...,None]
# aerial haze toward the far tip
haze=hexc('#EED3B8'); hz=np.where(near,np.clip(1-(X-376)/260,0,1)*0.25,0.55+0.3*np.clip(1-depth/0.3,0,1))
col=col*(1-hz[...,None])+haze*hz[...,None]
# alpha: face polygon with bumpy scrub top
topy=Tx-np.where(dc<0,0,0)
alpha=np.clip(np.minimum(Y-(Tx-np.interp(X,xs,np.zeros(W))),Bx-Y)*SS/1.5+0.5,0,1)*(X>=xt)
# scrub bumps poke above the line a little
bumpup=np.clip(noise((1,w),7,3,60)[0]*10,0,4)*d1
up=(Y<Tx)&(Y>=Tx-bumpup[None,:])
col[up]=scrub[up]; alpha[up]=1
# soft shadow on the sand below the foot
below=(Y>Bx)&(X>=376)
sd=np.clip(1-(Y-Bx)/22,0,1)*below*np.clip((X-376)/160,0,1)
shcol=hexc('#6E5040')
outA=alpha+sd*0.32*(1-alpha)
col=np.where(alpha[...,None]>0,col,shcol)
# boulders under the ink arcs
rocks=[]
if len(paths)>=3:
    for sub in re.findall(r'M[^M]+',paths[2]):
        pts=[tuple(map(float,p)) for p in re.findall(r'([\d.]+) ([\d.]+)',sub)]
        x0,y0=pts[0];x6,y6=pts[-1];x3,y3=pts[3]
        rocks.append(((x0+x6)/2-OX,(y0+y6)/2-OY,(x6-x0)/2,((y0+y6)/2-y3)))
rocks.sort(key=lambda r:r[1])
rk=hexc('#6F5A4B');rkl=hexc('#B39079');rkd=hexc('#3F3029')
for cx,cy,rx,ry in rocks:
    x0=int((cx-rx-2)*SS);x1=int((cx+rx+2)*SS);y0=int((cy-ry-2)*SS);y1=int((cy+ry*0.45+2)*SS)
    sy,sx=slice(max(y0,0),min(y1,h)),slice(max(x0,0),min(x1,w))
    xx=X[sy,sx];yy=Y[sy,sx]
    ny=np.where(yy<cy,(yy-cy)/max(ry,.5),(yy-cy)/max(ry*0.45,.5));nx=(xx-cx)/max(rx,.5)
    r2=nx**2+ny**2;m=np.clip((1-r2)*rx*SS/2.5,0,1)
    lit=np.clip(-nx*0.55-ny*0.8,-1,1)
    c=rk+(np.clip(lit,0,1)[...,None]*(rkl-rk))+(np.clip(-lit,0,1)[...,None]*(rkd-rk))*0.8
    c*= (1+noise(xx.shape,8,2,int(cx))*0.12)[...,None]
    col[sy,sx]=col[sy,sx]*(1-m[...,None])+c*m[...,None]
    outA[sy,sx]=np.maximum(outA[sy,sx],m)
    # contact shadow
    cs_=np.clip(1-((xx-cx-rx*0.2)/(rx*1.3))**2-((yy-cy-ry*0.45)/(ry*0.35+1))**2,0,1)*0.5*(m<1)
    outA[sy,sx]=np.maximum(outA[sy,sx],cs_)
img=np.concatenate([np.clip(col,0,1),np.clip(outA,0,1)[...,None]],-1)
im=Image.fromarray((img*255+.5).astype(np.uint8),'RGBA').resize((W,H),Image.LANCZOS)
im.save(sys.argv[3],'WEBP',quality=90,method=6)
# morning version: cooler, softer, a touch rosy
a_=np.asarray(im).astype(float)/255;c=a_[...,:3]
L=c.mean(-1,keepdims=True); c=L+(c-L)*0.82; c=c*np.array([1.0,0.985,0.93])+0.03
im2=Image.fromarray((np.concatenate([np.clip(c,0,1),a_[...,3:]],-1)*255+.5).astype(np.uint8),'RGBA')
im2.save(sys.argv[4],'WEBP',quality=90,method=6)
