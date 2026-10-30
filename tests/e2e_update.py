"""Test: banner nuova versione (aggiornamento del service worker) e gesto "Tira per aggiornare".
Serve una copia del sito su :8766 e modifica sw.js su disco per simulare una nuova versione."""
import os, shutil, subprocess, sys, time, json, re
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(__file__), '..'); SITE = '/tmp/nutri-site'
shutil.rmtree(SITE, ignore_errors=True)
shutil.copytree(ROOT, SITE, ignore=shutil.ignore_patterns('.git', 'tests', 'supabase'))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8766'], cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
BASE = 'http://localhost:8766/'; fails = []; errors = []
def check(n, c, x=''):
    print(('PASS ' if c else 'FAIL ') + n + (' ' + str(x) if x and not c else ''))
    if not c: fails.append(n)
def touch(cdp, kind, y, x=180):
    pts = [] if kind == 'touchEnd' else [{'x': x, 'y': y}]
    cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': pts})
def pull(cdp, y0, y1, release=True, steps=8):
    touch(cdp, 'touchStart', y0)
    for i in range(1, steps + 1): touch(cdp, 'touchMove', y0 + (y1 - y0) * i / steps); time.sleep(0.03)
    if release: touch(cdp, 'touchEnd', 0)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
        ctx = b.new_context(viewport={'width': 375, 'height': 760}, has_touch=True, is_mobile=True, locale='it-IT', permissions=['camera'])
        pg = ctx.new_page(); pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(BASE); pg.wait_for_function("navigator.serviceWorker.controller !== null || true"); pg.wait_for_timeout(1500)
        pg.reload(); pg.wait_for_timeout(800)
        check('SW controlla la pagina', pg.evaluate("!!navigator.serviceWorker.controller"))
        check('nessun banner alla prima installazione', pg.locator('#update-banner').is_hidden())
        cdp = ctx.new_cdp_session(pg)
        # ---------- pull to refresh ----------
        pg.evaluate("window.__marker = 1")
        pull(cdp, 200, 260, release=False); pg.wait_for_timeout(300)  # 30px effettivi (0.5): sotto soglia
        check('indicatore: "Tira per aggiornare"', pg.inner_text('#ptr-txt') == 'Tira per aggiornare' and pg.locator('#ptr.show').count() == 1, pg.evaluate("[document.getElementById('ptr').className, document.getElementById('ptr-txt').textContent, scrollY]"))
        touch(cdp, 'touchEnd', 0); pg.wait_for_timeout(300)
        check('rilascio sotto soglia: nessun ricaricamento', pg.evaluate("window.__marker") == 1 and pg.locator('#ptr.show').count() == 0)
        pull(cdp, 150, 420, release=False); pg.wait_for_timeout(300)
        check('indicatore: "Rilascia per aggiornare"', pg.inner_text('#ptr-txt') == 'Rilascia per aggiornare' and pg.locator('#ptr.ready').count() == 1)
        pg.screenshot(path='tests/out/12-ptr-rilascia.png')
        touch(cdp, 'touchEnd', 0)
        check('mostra "Aggiornamento…"', pg.inner_text('#ptr-txt') == 'Aggiornamento…' or pg.evaluate("window.__marker") is None)
        pg.wait_for_function("window.__marker === undefined", timeout=10000)
        check('rilascio oltre soglia: pagina ricaricata', True)
        pg.wait_for_timeout(1200)
        # non al top -> nessuna interferenza con lo scroll
        pg.evaluate("document.body.style.minHeight='3000px'; window.scrollTo(0,300); window.__marker=2"); pg.wait_for_timeout(200)
        pull(cdp, 200, 500, release=False)
        check('scrollato in basso: nessun indicatore', pg.locator('#ptr.show').count() == 0)
        touch(cdp, 'touchEnd', 0)
        pg.evaluate("window.scrollTo(0,0)")
        # scorrimento verso l'alto (dito su) al top: nessun indicatore
        touch(cdp, 'touchStart', 400); touch(cdp, 'touchMove', 350); touch(cdp, 'touchMove', 300)
        check('swipe verso l\'alto al top: nessun indicatore', pg.locator('#ptr.show').count() == 0); touch(cdp, 'touchEnd', 0)
        pg.evaluate("document.body.style.minHeight=''")
        # barcode con camera attiva: disabilitato
        pg.goto(BASE + '#/barcode'); pg.reload(); pg.wait_for_selector('#bc-start'); pg.click('#bc-start'); pg.wait_for_function("document.getElementById('bc-video').classList.contains('on')", timeout=10000)
        pull(cdp, 200, 460, release=False)
        check('camera/barcode attivi: gesto disabilitato', pg.locator('#ptr.show').count() == 0); touch(cdp, 'touchEnd', 0)
        pg.click('#bc-stop')
        # analisi non salvata: chiede conferma
        pg.goto(BASE + '#/home'); pg.reload(); pg.wait_for_selector('#in-gal', state='attached')
        pg.set_input_files('#in-gal', os.path.join(os.path.dirname(__file__), 'plate.jpg')) if False else None
        pg.evaluate("localStorage.setItem('nutri.settings', JSON.stringify({gemKey:'AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKE12345', gemModel:'gemini-3.8-flash', modelV:2}))"); pg.reload(); pg.wait_for_selector('#step-photo:not([hidden])')
        pg.set_input_files('#in-gal', os.path.join(os.path.dirname(__file__), 'plate.jpg')); pg.wait_for_selector('#step-preview:not([hidden])')
        pg.evaluate("window.__marker = 3")
        pull(cdp, 150, 420)
        pg.wait_for_selector('dialog[open]'); check('foto non salvata: chiede conferma prima di ricaricare', 'non ancora salvata' in pg.inner_text('dialog'))
        pg.click('dialog [data-r="0"]'); pg.wait_for_timeout(400)
        check('annullando resta tutto com\'è', pg.evaluate("window.__marker") == 3 and pg.locator('#ptr.show').count() == 0)
        # ---------- banner nuova versione ----------
        sw = open(f'{SITE}/sw.js').read()
        open(f'{SITE}/sw.js', 'w').write(sw.replace("nutripwa-v1.2.0", "nutripwa-v9.9.9"))
        pg.evaluate("window.__marker = 4")
        pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))")   # simula il ritorno in primo piano
        pg.wait_for_selector('#update-banner:not([hidden])', timeout=15000)
        t = pg.inner_text('#update-banner'); check('banner mostrato al ritorno in primo piano', 'È disponibile una nuova versione' in t and 'Aggiorna ora' in t, t)
        check('avviso: analisi non salvata', 'non salvata' in t, t)
        check('nessun ricaricamento automatico', pg.evaluate("window.__marker") == 4)
        pg.screenshot(path='tests/out/13-banner.png')
        pg.click('#upd-later'); check('"Più tardi" nasconde il banner', pg.locator('#update-banner').is_hidden())
        check('SW in attesa (non attivato da solo)', pg.evaluate("navigator.serviceWorker.getRegistration().then(r => !!r.waiting)"))
        check('ancora in cache la versione vecchia attiva', pg.evaluate("caches.keys()").count('nutripwa-v1.2.0') == 1)
        pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))")  # throttle 15 s: riprova dopo
        pg.wait_for_timeout(16000); pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        pg.wait_for_selector('#update-banner:not([hidden])', timeout=5000); check('banner riproposto al rientro', True)
        pg.click('#upd-now'); pg.wait_for_function("window.__marker === undefined", timeout=15000)
        pg.wait_for_timeout(1500)
        keys = pg.evaluate("caches.keys()"); check('dopo "Aggiorna ora": nuova versione attiva', keys == ['nutripwa-v9.9.9'], keys)
        check('banner sparito dopo il riavvio', pg.locator('#update-banner').is_hidden())
        # pulsante Opzioni
        pg.goto(BASE + '#/impostazioni'); pg.reload(); pg.wait_for_selector('#btn-checkupdate'); pg.click('#btn-checkupdate'); pg.wait_for_selector('.toast')
        check('"Controlla aggiornamenti": già aggiornato', 'ultima versione' in pg.inner_text('.toast'))
        pg.screenshot(path='tests/out/14-opzioni.png', full_page=True)
        b.close()
finally:
    srv.terminate()
real = [e for e in errors if 'Failed to load resource' not in e]
check('nessun errore console/JS', not real, real)
print('FALLITI:', fails or 'nessuno'); sys.exit(1 if fails else 0)
