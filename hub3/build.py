import sys
stage=open('lib/stage.js').read(); sound=open('lib/sound.js').read(); style=open('style.js').read()
for src,dst in [('sb_template.html','storyboard.html')]+([('player_template.html','index.html')] if len(sys.argv)>1 else []):
    s=open(src).read().replace('/*STAGE*/',stage).replace('/*SOUND*/',sound).replace('/*STYLE*/',style)
    open(dst,'w').write(s); print('built',dst,len(s))
