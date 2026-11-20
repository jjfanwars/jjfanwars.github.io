#!/usr/bin/env python3
"""Build the Family Hub booking pages from src/ into this folder.

  python3 build.py          preview pages (book.html, manage.html, admin.html) that load the
                            site's styles and photos from the demo site, for GitHub Pages
  python3 build.py live     drop-in copies in live/ with relative links, to copy into the site itself

src/shell.html is the demo site's page shell (header, footer, head) with {{MAIN}}, {{TITLE}}, {{DESC}},
{{HEAD}} and {{BODY}} slots. Re-copy it from the site's book.html if the header or footer changes.
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'src')
DEMO = 'https://familyhub.aiautomationvic.com/'
PAGES_URL = 'https://jjfanwars.github.io/familyhub/'
OWN = ('book.html', 'manage.html', 'admin.html', 'privacy.html', 'refer.html', 'report.html', 'practitioner.html', 'sop.html')


def read(name):
    with open(os.path.join(SRC, name), encoding='utf-8') as f:
        return f.read()


def absolutise(html, site):
    if not site:
        return html

    def fix(m):
        attr, url = m.group(1), m.group(2)
        if re.match(r'(https?:|#|tel:|mailto:|data:|//)', url) or url.split('#')[0] in OWN:
            return m.group(0)
        return '%s="%s%s"' % (attr, site, url)
    return re.sub(r'\b(href|src)="([^"]*)"', fix, html)


def scripts(js_name, site):
    core = '<script>window.HUB_SITE=%r</script>\n<script src="hub-core.js"></script>\n' % site
    return core, '<script>\n' + read(js_name) + '</script>\n'


def preview_head():
    m = PAGES_URL + 'img/'
    return ('<!-- Preview build: styles and photos load from the demo site. Run build.py live for drop-in copies. -->\n'
            '<meta name="robots" content="noindex, nofollow"/>\n'
            '<style>html[data-scheme] .site-footer::before{-webkit-mask-image:url(%sedge-foot.svg);mask-image:url(%sedge-foot.svg)}'
            'html[data-scheme] .page-hero::after{-webkit-mask-image:url(%sedge-paper.svg);mask-image:url(%sedge-paper.svg)}</style>\n' % (m, m, m, m))


def site_page(main, css, js, title, desc, site, live):
    shell = read('shell.html')
    core, body = scripts(js, site)
    head = ('' if live else preview_head()) + read(css) + core
    out = (shell.replace('{{TITLE}}', title).replace('{{DESC}}', desc)
           .replace('{{MAIN}}', read(main)))
    out = absolutise(out, site)
    return out.replace('{{HEAD}}', head).replace('{{BODY}}', body)


def admin_page(site, live, html='admin.html', js='admin.js', title='Hub dashboard', desc='Bookings, cancellations and waitlist refills.', css=()):
    shell = read('shell.html')
    head = shell[:shell.index('{{HEAD}}')]
    head = re.sub(r'<script defer="" src="(script|theme)\.js"></script>\n?', '', head)
    head = head.replace('{{TITLE}}', title + ' | Surf Coast Family Hub').replace('{{DESC}}', desc)
    head = absolutise(head, site)
    core, body = scripts(js, site)
    page = read(html).replace('{{SITE}}', site)
    extra = ('' if live else preview_head()) + '<meta name="robots" content="noindex, nofollow"/>\n' + read('admin.css') + ''.join(read(c) for c in css) + core
    return head + extra + '</head>\n' + page.replace('</body>', body + '</body>') + '\n</html>\n'


def build(live):
    site = '' if live else DEMO
    outdir = os.path.join(HERE, 'live') if live else HERE
    os.makedirs(outdir, exist_ok=True)
    files = {
        'book.html': site_page('book-main.html', 'book.css', 'book.js', 'Book | Surf Coast Family Hub',
                               'Find the right practitioner, see their next free times and book online in under a minute.', site, live),
        'manage.html': site_page('manage-main.html', 'book.css', 'manage.js', 'Your booking | Surf Coast Family Hub',
                                 'Move or cancel your appointment.', site, live),
        'privacy.html': site_page('privacy-main.html', 'book.css', 'privacy.js', 'Privacy | Surf Coast Family Hub',
                                  'How Surf Coast Family Hub collects, uses and protects your personal and health information.', site, live),
        'refer.html': site_page('refer-main.html', 'book.css', 'refer.js', 'Send a referral | Surf Coast Family Hub',
                                'Refer a patient to Surf Coast Family Hub online. Secure, and the client gets a booking link straight away.', site, live),
        'admin.html': admin_page(site, live),
        'report.html': admin_page(site, live, 'report.html', 'report.js', 'Hub report', 'How the Hub is going: bookings, cancellations, refills, waitlist and referrals.', ('report.css',)),
        'practitioner.html': admin_page(site, live, 'practitioner.html', 'practitioner.js', 'Practitioner view', 'Your own bookings, refills, waitlist, referrals and booking button.', ('report.css',)),
        'sop.html': admin_page(site, live, 'sop.html', 'sop.js', 'Front desk SOP', 'How the Hub runs bookings, cancellations, the waitlist, referrals and client information.', ('report.css',)),
    }
    for name, html in files.items():
        with open(os.path.join(outdir, name), 'w', encoding='utf-8') as f:
            f.write(html)
    if live:
        with open(os.path.join(HERE, 'hub-core.js'), encoding='utf-8') as f, open(os.path.join(outdir, 'hub-core.js'), 'w', encoding='utf-8') as g:
            g.write(f.read())
    with open(os.path.join(SRC, 'widget.js'), encoding='utf-8') as f, open(os.path.join(outdir, 'widget.js'), 'w', encoding='utf-8') as g:
        g.write(f.read())
    print('built', ', '.join(files), 'in', outdir)


if __name__ == '__main__':
    build('live' in sys.argv[1:])
