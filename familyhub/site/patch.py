# Site improvements for the surfcoast-family-hub worker modules (run on a fresh download, see README.md).
#   python3 patch.py <mods dir>
# - practitioner profile pages /team/<id> (made from team.html), next free time + waitlist links
# - team page: names link to profiles, next free time line, Meaghan's button goes to contact
# - home: "Help me choose" finder, shorter phone layout (director letter folds, compact services)
# - every page: og:image, twitter card, apple-touch-icon, canonical; clinic JSON-LD on home and contact
# - new files: sitemap.xml, robots.txt, favicon.ico, apple-touch-icon.png, og.jpg (made by assets.py), /waitlist staff page
import sys, re, os, json, html as H
D = sys.argv[1]
def rd(n): return open(os.path.join(D, n), encoding='utf-8').read()
def wr(n, s): open(os.path.join(D, n), 'w', encoding='utf-8').write(s)
HERE = os.path.dirname(os.path.abspath(__file__))

LIVE = ['adi', 'hannah', 'melinda', 'ellie', 'maddy', 'michelle-ferris', 'laura', 'kate']
HXU = {'adi': 'psychologist/dr-adi-brown/256944/503631', 'hannah': 'widget/psychologist/hannah-jensen/680341/503631',
       'melinda': 'widget/psychologist/melinda-sullivan/1343231/503631', 'ellie': 'widget/psychologist/ellie-james/1026431/503631',
       'maddy': 'psychologist/ms-madelaine-keegan/1807285/503631', 'michelle-ferris': 'widget/social-worker/ms-michelle-ferris/331996/503631',
       'laura': 'widget/massage-therapist/ms-laura-rees/659711/503631', 'kate': 'widget/acupuncturist/kate-heagney/659721/503631'}
LEAVE = {'melissa'}

# ---------- team ----------
team = rd('m96-team.html')
if 'data-next=' not in team:
    team = team.replace('href="book-online.html#meaghan"><svg', 'href="contact.html"><svg').replace('Book with Meaghan</a>', 'Enquire about Meaghan</a>')
    def link_name(m):
        pid = m.group(1)
        body = m.group(2)
        body = re.sub(r'<h2>(.*?)</h2>', lambda x: '<h2><a class="m-link" href="team/%s">%s</a></h2>' % (pid, x.group(1)), body, 1)
        if pid in LIVE:
            body = body.replace('<div class="cta-row m-actions">', '<p class="m-next" data-next="%s" hidden></p><div class="cta-row m-actions">' % pid, 1)
        return '<article class="member card" id="%s">%s</article>' % (pid, body)
    team = re.sub(r'<article class="member card" id="([^"]+)">(.*?)</article>', link_name, team, flags=re.S)
    team = team.replace('</main>', '</main>\n<script src="next.js" defer></script>', 1)
    wr('m96-team.html', team)

# parse members (after the edit above)
members = []
for pid, a in re.findall(r'<article class="member card" id="([^"]+)">(.*?)</article>', team, re.S):
    name = re.sub('<[^>]+>', '', re.search(r'<h2>(.*?)</h2>', a).group(1))
    title = re.search(r'<p class="m-title">(.*?)</p>', a).group(1)
    acts = re.search(r'<div class="cta-row m-actions">(.*?)</div>\s*<div class="m-more"', a, re.S)
    btns = re.findall(r'(<a class="btn btn-primary btn-sm"[^>]*>.*?</a>)', acts.group(1), re.S) if acts else []
    more = re.search(r'<div class="m-more" id="more-[^"]+">(.*)</div>\s*</div>\s*$', a, re.S)
    members.append(dict(pid=pid, name=name, title=title, btn=btns[0] if btns else '', more=more.group(1).strip() if more else ''))
assert len(members) >= 10, len(members)

# ---------- next.js (team + profile pages) ----------
NEXT_JS = r"""(function(){var els=[].slice.call(document.querySelectorAll('[data-next]'));if(!els.length)return;
var HX='https://www.halaxy.com/book/',U=%s,demo=/[?&]demo\b/.test(location.search),base=document.querySelector('[data-base]');base=base?base.getAttribute('data-base'):'';
var DF=new Intl.DateTimeFormat('en-AU',{weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',timeZone:'Australia/Melbourne'});
var ids=els.map(function(e){return e.getAttribute('data-next')});
fetch(base+'api/hx/next?pids='+ids.join(',')+(demo?'&demo=1':'')).then(function(r){return r.json()}).then(function(r){els.forEach(function(e){var id=e.getAttribute('data-next'),t=r.next&&r.next[id],q=demo?'?demo':'';
 if(t)e.innerHTML='<span class="nx-dot" aria-hidden="true"></span>Next free: <a href="'+base+'book-online.html'+q+'#'+id+'&t='+encodeURIComponent(t)+'">'+DF.format(new Date(t)).replace(/ (am|pm)$/i,'$1').replace(':00','')+'</a>';
 else if(r.live)e.innerHTML='Fully booked right now. <a href="'+base+'book-online.html'+q+'#'+id+'&wl">Join the waitlist</a>';
 else e.innerHTML='<a href="'+HX+U[id]+'" target="_blank" rel="noopener">See free times</a> · <a href="'+base+'book-online.html#'+id+'&wl">Join the waitlist</a>';
 e.hidden=false})}).catch(function(){})})();
""" % json.dumps(HXU)
wr('site-next.js.txt', NEXT_JS)

# ---------- shared bits ----------
def strip_main(page):
    i = page.find('<main'); j = page.find('</main>') + 7
    return page[:i], page[j:]
def absolutise(s):
    return re.sub(r'((?:href|src|srcset|content)=")(?!https?:|/|#|mailto:|tel:|data:|\{\{)([a-z0-9][^"]*\.(?:html|webp|css|js|svg|pdf|png|jpg|ico)(?:[?#][^"]*)?")', r'\1/\2', s)
def set_meta(head, title, desc, path):
    head = re.sub(r'<title>.*?</title>', '<title>%s</title>' % H.escape(title, False), head, 1, re.S)
    head = re.sub(r'<meta content="[^"]*" name="description"/>', '<meta content="%s" name="description"/>' % H.escape(desc), head, 1)
    head = re.sub(r'<meta content="[^"]*" property="og:title"/>', '<meta content="%s" property="og:title"/>' % H.escape(title), head, 1)
    head = re.sub(r'<meta content="[^"]*" property="og:description"/>', '<meta content="%s" property="og:description"/>' % H.escape(desc), head, 1)
    head = re.sub(r'<link href="\{\{ORIGIN\}\}[^"]*" rel="canonical"/>', '', head)
    return head.replace('</title>', '</title>\n<link href="{{ORIGIN}}%s" rel="canonical"/>' % path, 1)

# ---------- profile pages ----------
top, bottom = strip_main(team)
top = top.replace('<script src="next.js" defer></script>', '')
bottom = bottom.replace('<script src="next.js" defer></script>', '')
PROFILE_CSS = """<style>
.pf{display:grid;gap:28px;align-items:start}@media(min-width:820px){.pf{grid-template-columns:300px 1fr;gap:44px}}
.pf-side{position:relative}@media(min-width:820px){.pf-side{position:sticky;top:96px}}
.pf-side img{width:100%;max-width:300px;height:auto;border-radius:22px;display:block}
.pf-side .m-next{margin:14px 0 0}.pf-side .cta-row{margin-top:14px;flex-wrap:wrap}
.pf-body h2{margin-top:0}.pf-body details{margin-top:18px}
.pf-back{display:inline-block;margin:0 0 6px;font-weight:600}
.pf-more{margin-top:34px}.pf-more ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:8px}.pf-more a{display:inline-block;padding:6px 12px;border:1px solid currentColor;border-radius:999px;text-decoration:none;font-size:.92em}
</style>"""
others = [m for m in members if m['pid'] not in LEAVE]
for m in members:
    pid = m['pid']
    plain = re.sub(r'\s+', ' ', H.unescape(re.sub('<[^>]+>', ' ', m['more']))).strip()
    desc = (plain[:150].rsplit(' ', 1)[0] + '…') if len(plain) > 155 else plain
    title_txt = H.unescape(m['title'])
    title = '%s, %s | Surf Coast Family Hub, Jan Juc' % (m['name'], title_txt)
    btn = m['btn']
    if pid in LIVE:
        btn = '<a class="btn btn-primary" href="book-online.html#%s">Book with %s</a><a class="btn btn-outline" href="book-online.html#%s&amp;wl">Join the waitlist</a>' % (pid, m['name'].replace('Dr ', '').split()[0], pid)
    elif btn:
        btn = btn.replace('btn-sm', '')
    else:
        btn = '<a class="btn btn-outline" href="contact.html">Contact us</a>'
    if pid in LEAVE:
        btn = '<p><b>%s is on leave.</b> <a href="team.html">See the rest of the team</a>.</p>' % m['name'].split()[0]
    nxt = '<p class="m-next" data-next="%s" hidden></p>' % pid if pid in LIVE else ''
    ld = {"@context": "https://schema.org", "@type": "Person", "name": m['name'], "jobTitle": title_txt,
          "image": "{{ORIGIN}}/img/team/colour/%s.webp" % pid, "url": "{{ORIGIN}}/team/%s" % pid,
          "worksFor": {"@type": "MedicalClinic", "name": "Surf Coast Family Hub", "url": "{{ORIGIN}}/"}}
    chips = ''.join('<li><a href="team/%s">%s</a></li>' % (o['pid'], H.escape(o['name'])) for o in others if o['pid'] != pid)
    main = '''<main id="main">
<section class="page-hero hero-short"><div class="wrap">
<a class="pf-back" href="team.html">← Our team</a>
<h1>%s</h1>
<p class="lede">%s</p>
</div></section>
<section class="section section-tight"><div class="wrap"><div class="pf">
<div class="pf-side"><img alt="Portrait of %s" height="360" src="img/team/colour/%s.webp" width="360"/>%s<div class="cta-row">%s</div></div>
<div class="pf-body">%s</div>
</div>
<div class="pf-more"><h2>More of our team</h2><ul>%s</ul></div>
</div></section>
</main>
<script src="next.js" defer></script>
<script type="application/ld+json">%s</script>''' % (H.escape(m['name']), m['title'], H.escape(m['name']), pid, nxt, btn, m['more'].replace('<details>', '<details open>'), chips, json.dumps(ld))
    page = set_meta(top, title, desc, '/team/' + pid).replace('</head>', PROFILE_CSS + '\n</head>', 1) + main + bottom
    page = absolutise(page)
    page = page.replace('<html', '<html data-base="/"', 1) if 'data-base=' not in page else page
    wr('pf-%s.html' % pid, page)
PROFILES = [m['pid'] for m in members]

# ---------- home ----------
idx = rd('m89-index.html')
if 'id="finder"' not in idx:
    # compact services on phones
    idx = idx.replace('<section class="section">\n<div class="wrap">\n<div class="section-head w-blush">\n<p class="eyebrow">How Can We Help You?</p>',
                      '<section class="section svc-home">\n<div class="wrap">\n<div class="section-head w-blush">\n<p class="eyebrow">How Can We Help You?</p>', 1)
    assert 'svc-home' in idx
    # director letter folds on phones
    a = idx.find('<h3 class="director-h">From our director</h3>')
    p1 = idx.find('</p>', a) + 4
    sig = idx.find('<p class="director-sign">', p1)
    idx = idx[:p1] + '\n<div class="dir-more" id="dirMore">' + idx[p1:sig] + '</div>\n<button type="button" class="btn btn-outline btn-sm dir-toggle" aria-expanded="false" aria-controls="dirMore">Read Adi’s full letter</button>\n' + idx[sig:]
    # finder before services
    people = {m['pid']: [m['name'], H.unescape(m['title'])] for m in members if m['pid'] not in LEAVE}
    FINDER = open(os.path.join(HERE, 'finder.html'), encoding='utf-8').read().replace('/*PEOPLE*/', json.dumps(people)).replace('/*LIVE*/', json.dumps(LIVE))
    k = idx.find('<section class="section svc-home">')
    idx = idx[:k] + FINDER + '\n' + idx[k:]
    wr('m89-index.html', idx)

# ---------- head extras on every page ----------
CLINIC = {"@context": "https://schema.org", "@type": "MedicalClinic", "@id": "{{ORIGIN}}/#clinic", "name": "Surf Coast Family Hub",
          "description": "Psychology, counselling, couples therapy, child and family support, assessments, massage, acupuncture and osteopathy in Jan Juc, near Torquay.",
          "url": "{{ORIGIN}}/", "image": "{{ORIGIN}}/og.jpg", "logo": "{{ORIGIN}}/img/logo-mark.webp",
          "telephone": "+61 491 184 788", "email": "hello@surfcoastfamilyhub.com.au",
          "address": {"@type": "PostalAddress", "streetAddress": "16 Princes Terrace", "addressLocality": "Jan Juc", "addressRegion": "VIC", "postalCode": "3228", "addressCountry": "AU"},
          "areaServed": ["Jan Juc", "Torquay", "Surf Coast", "Geelong"],
          "sameAs": ["https://www.facebook.com/surfcoastfamilyhub", "https://www.instagram.com/surfcoastfamilyhub"],
          "employee": [{"@type": "Person", "name": m['name'], "jobTitle": H.unescape(m['title']), "url": "{{ORIGIN}}/team/" + m['pid']} for m in members if m['pid'] not in LEAVE]}
ROUTE = {'m89-index.html': '/', 'm15-contact.html': '/contact', 'm94-services.html': '/services', 'm96-team.html': '/team', 'm16-fees.html': '/fees',
         'm90-referrals.html': '/referrals', 'm100-first-visit.html': '/first-visit', 'm1-blog.html': '/blog', 'hub-book-online.html': '/book-online'}
HEAD_X = '''<meta content="{{ORIGIN}}/og.jpg" property="og:image"/>
<meta content="1200" property="og:image:width"/><meta content="630" property="og:image:height"/>
<meta content="Sunset over the beach at Jan Juc, Surf Coast Family Hub" property="og:image:alt"/>
<meta content="summary_large_image" name="twitter:card"/>
<link href="/apple-touch-icon.png" rel="apple-touch-icon"/>
'''
for n in sorted(os.listdir(D)):
    if not (n.endswith('.html') and (n.startswith('m') or n.startswith('pf-') or n == 'hub-book-online.html')) or n in ('m0-404.html', 'm14-changes.html'):
        continue
    s = rd(n)
    if 'property="og:image"' in s or '</head>' not in s:
        continue
    x = HEAD_X
    if n in ROUTE and 'rel="canonical"' not in s:
        x += '<link href="{{ORIGIN}}%s" rel="canonical"/>\n' % ROUTE[n]
    if '-blog_' in n:
        slug = n.split('-blog_', 1)[1]
        x += '<link href="{{ORIGIN}}/blog/%s" rel="canonical"/>\n' % slug[:-5]
    if n in ('m89-index.html', 'm15-contact.html'):
        x += '<script type="application/ld+json">%s</script>\n' % json.dumps(CLINIC)
    if 'property="og:url"' not in s and n in ROUTE:
        x += '<meta content="{{ORIGIN}}%s" property="og:url"/>\n' % ROUTE[n]
    s = s.replace('</head>', x + '</head>', 1)
    wr(n, s)

# ---------- styles ----------
st = rd('m95-styles.css.txt')
if '/* site pass 26 Nov */' not in st:
    st += open(os.path.join(HERE, 'extra.css'), encoding='utf-8').read()
    wr('m95-styles.css.txt', st)
sc = rd('m93-script.js.txt')
if 'dir-toggle' not in sc:
    sc += '\n(function(){var b=document.querySelector(".dir-toggle"),m=document.getElementById("dirMore");if(!b||!m)return;b.addEventListener("click",function(){var o=b.getAttribute("aria-expanded")!=="true";b.setAttribute("aria-expanded",o);m.classList.toggle("open",o);b.textContent=o?"Show less":"Read Adi’s full letter"})})();\n'
    wr('m93-script.js.txt', sc)

# ---------- sitemap + robots ----------
pages = ['/', '/services', '/team', '/referrals', '/fees', '/first-visit', '/blog', '/contact', '/book-online', '/privacy'] + ['/team/' + p for p in PROFILES if p not in LEAVE]
pages += ['/blog/' + n.split('-blog_', 1)[1][:-5] for n in sorted(os.listdir(D)) if '-blog_' in n]
wr('site-sitemap.xml.txt', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
   ''.join('<url><loc>{{ORIGIN}}%s</loc></url>\n' % p for p in pages) + '</urlset>\n')
wr('site-robots.txt', 'User-agent: *\nDisallow: /admin\nDisallow: /inbox\nDisallow: /report\nDisallow: /practitioner\nDisallow: /sop\nDisallow: /waitlist\nDisallow: /api/\nSitemap: {{ORIGIN}}/sitemap.xml\n')
wr('site-waitlist.html', open(os.path.join(HERE, 'waitlist.html'), encoding='utf-8').read())
json.dump(PROFILES, open(os.path.join(D, 'site-profiles.json'), 'w'))
print('patched', len(PROFILES), 'profiles')
