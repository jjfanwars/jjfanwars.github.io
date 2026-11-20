import numpy as np,sys
from PIL import Image
import colorsys
def rgb2hsv(a):
    r,g,b=[a[...,i] for i in range(3)]
    mx=a[...,:3].max(-1);mn=a[...,:3].min(-1);d=mx-mn
    h=np.zeros_like(mx)
    m=d>1e-6
    rm=m&(mx==r);gm=m&(mx==g)&~rm;bm=m&~rm&~gm
    h[rm]=((g-b)[rm]/d[rm])%6;h[gm]=((b-r)[gm]/d[gm])+2;h[bm]=((r-g)[bm]/d[bm])+4
    h=h*60;s=np.where(mx>0,d/np.maximum(mx,1e-6),0);return h,s,mx
def hsv2rgb(h,s,v):
    c=v*s;x=c*(1-np.abs((h/60)%2-1));m=v-c
    z=np.zeros_like(h);k=(h//60).astype(int)%6
    r=np.select([k==0,k==1,k==2,k==3,k==4,k==5],[c,x,z,z,x,c])
    g=np.select([k==0,k==1,k==2,k==3,k==4,k==5],[x,c,c,x,z,z])
    b=np.select([k==0,k==1,k==2,k==3,k==4,k==5],[z,z,x,c,c,x])
    return np.stack([r+m,g+m,b+m],-1)
def recolor(src,dst,lo=55,hi=175,base=38,span=16,sat=1.0,val=1.0):
    im=Image.open(src).convert('RGBA');a=np.asarray(im).astype(np.float64)/255
    h,s,v=rgb2hsv(a)
    w=np.clip((h-lo+12)/12,0,1)*np.clip((hi+12-h)/12,0,1)   # soft band edges
    nh=base+(np.clip(h,lo,hi)-lo)/(hi-lo)*span
    # darker pixels lean a bit more bronze/rosy for autumn depth
    nh=nh-(1-v)*10
    h2=h*(1-w)+nh*w
    s2=np.clip(s*(1+(sat-1)*w),0,1); v2=np.clip(v*(1+(val-1)*w),0,1)
    rgb=hsv2rgb(h2,s2,v2)
    out=np.concatenate([rgb,a[...,3:]],-1)
    Image.fromarray((out*255+.5).astype(np.uint8)).save(dst,'WEBP',quality=90,method=6)
if __name__=='__main__':
    M='w/mods/'
    for f in ['m43-img_scrub-am-s','m44-img_scrub-am']:
        recolor(M+f+'.webp','new/'+f+'.webp',base=34,span=18,sat=1.05,val=1.04)
    for f in ['m45-img_scrub-warm-s','m46-img_scrub-warm']:
        recolor(M+f+'.webp','new/'+f+'.webp',base=32,span=14,sat=1.1)
    for f in ['m17-img_cliffs-am','m18-img_cliffs-warm']:
        recolor(M+f+'.webp','new/'+f+'.webp',base=30,span=16,sat=.95)
