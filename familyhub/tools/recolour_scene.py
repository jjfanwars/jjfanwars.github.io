import numpy as np
from PIL import Image
from recol_hsv import rgb2hsv,hsv2rgb
def recolor(src,dst,field_h=40,bush_h=62,fs=1.7,bs=1.0,v0=.5,v1=.66,lo=55,hi=175,vb=1.0):
    a=np.asarray(Image.open(src).convert('RGBA')).astype(np.float64)/255
    h,s,v=rgb2hsv(a)
    w=np.clip((h-lo+12)/12,0,1)*np.clip((hi+12-h)/12,0,1)
    t=np.clip((v-v0)/(v1-v0),0,1)  # 1 = light field, 0 = dark bush
    nh=bush_h*(1-t)+field_h*t
    ns=np.clip(s*(bs*(1-t)+fs*t),0,.6)
    h2=h*(1-w)+nh*w; s2=s*(1-w)+ns*w; v2=np.clip(v*(1+(vb-1)*w),0,1)
    out=np.concatenate([hsv2rgb(h2,s2,v2),a[...,3:]],-1)
    Image.fromarray((out*255+.5).astype(np.uint8)).save(dst,'WEBP',quality=90,method=6)
M='w/mods/'
for f in ['m43-img_scrub-am-s','m44-img_scrub-am']: recolor(M+f+'.webp','new/'+f+'.webp')
for f in ['m45-img_scrub-warm-s','m46-img_scrub-warm']: recolor(M+f+'.webp','new/'+f+'.webp',field_h=34,bush_h=30,fs=1.7,bs=1.3,lo=30)
for f in ['m17-img_cliffs-am','m18-img_cliffs-warm']: recolor(M+f+'.webp','new/'+f+'.webp',field_h=44,bush_h=40,fs=1,bs=1)
